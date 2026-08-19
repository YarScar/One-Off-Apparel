import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { GetPromptResult } from '@modelcontextprotocol/sdk/types.js';

const NAME = 'board_reporting';

const DESCRIPTION =
  'Generate board packets, KPI dashboards, and presentation-ready reporting from live data. ' +
  'Produces current enrollment, completion, fundraising progress, cash position, and program ' +
  'outcomes — formatted for board consumption with narrative context. Output is CSV for data ' +
  'tables and structured narrative for presentation slides.';

export const boardReportingArgsSchema = {
  report_type: z
    .enum([
      'full_board_packet',
      'kpi_dashboard',
      'program_update',
      'fundraising_update',
      'executive_director_report',
      'committee_report',
    ])
    .describe(
      'Type of board report. ' +
      '"full_board_packet" — complete board meeting package with all sections. ' +
      '"kpi_dashboard" — KPI scorecard with current vs. target vs. prior period. ' +
      '"program_update" — program-focused update (enrollment, outcomes, stories). ' +
      '"fundraising_update" — development/fundraising progress report. ' +
      '"executive_director_report" — ED narrative report with key highlights and decisions needed. ' +
      '"committee_report" — finance or program committee deep-dive.',
    ),
  meeting_date: z
    .string()
    .optional()
    .describe('Date of the board meeting (e.g., "June 25, 2026"). Used for headers and "as of" dates. Defaults to today.'),
  period: z
    .string()
    .optional()
    .describe('Reporting period (e.g., "Q2 2026", "May 2026", "YTD"). Defaults to YTD.'),
  comparison_period: z
    .string()
    .optional()
    .describe('What to compare against (e.g., "same period last year", "prior quarter", "annual targets").'),
  kpi_targets: z
    .string()
    .optional()
    .describe(
      'Custom KPI targets as comma-separated pairs. Example: ' +
      '"enrollment: 200, cert pass rate: 85%, employment rate: 75%, attendance: 90%, fundraising: $500000". ' +
      'If not provided, targets will be derived from budget and historical performance.',
    ),
  committee: z
    .enum(['finance', 'program', 'development', 'governance', 'executive'])
    .optional()
    .describe('For committee_report: which committee. Determines the data focus.'),
  presentation_template: z
    .string()
    .optional()
    .describe(
      'Describe or paste the structure of your existing board packet template. Include: ' +
      'slide/page order, section names, what goes on each slide, any standard headers/footers, ' +
      'branding notes (colors, logo placement). If you have a Google Slides or PowerPoint URL, ' +
      'provide it and the system will attempt to match that structure. ' +
      'If not provided, the system will propose a default structure and ask for approval.',
    ),
  graph_preferences: z
    .string()
    .optional()
    .describe(
      'What graphs/charts the board expects. Examples: ' +
      '"bar chart for enrollment by phase, line chart for monthly revenue trend, ' +
      'pie chart for expense allocation, gauge for fundraising progress". ' +
      'If not provided, the system will propose chart types and ask for approval.',
    ),
  key_metrics: z
    .string()
    .optional()
    .describe(
      'The specific metrics the board wants to see, in priority order. Example: ' +
      '"1. Total enrollment, 2. Cert pass rate, 3. Employment placement rate, ' +
      '4. Revenue vs budget, 5. Cash runway, 6. Donor count". ' +
      'If not provided, the system will propose a metrics list and ask for approval.',
    ),
  audience_notes: z
    .string()
    .optional()
    .describe(
      'Context about the board audience: what they care about, concerns from last meeting, ' +
      'specific questions to address, new board members who need background, etc.',
    ),
  additional_context: z
    .string()
    .optional()
    .describe('Extra context: strategic plan priorities, upcoming decisions, major events, staffing changes, etc.'),
};

interface PromptArgs {
  report_type: string;
  meeting_date?: string | undefined;
  period?: string | undefined;
  comparison_period?: string | undefined;
  kpi_targets?: string | undefined;
  committee?: string | undefined;
  presentation_template?: string | undefined;
  graph_preferences?: string | undefined;
  key_metrics?: string | undefined;
  audience_notes?: string | undefined;
  additional_context?: string | undefined;
}

export function buildBoardReportingMessages(args: PromptArgs): GetPromptResult {
  const period = args.period ?? 'YTD';
  const meetingDate = args.meeting_date ?? 'the upcoming board meeting';
  const comparison = args.comparison_period ?? 'annual targets';
  const hasTargets = !!args.kpi_targets?.trim();
  const hasTemplate = !!args.presentation_template?.trim();
  const hasGraphPrefs = !!args.graph_preferences?.trim();
  const hasKeyMetrics = !!args.key_metrics?.trim();
  const audienceClause = args.audience_notes
    ? `\n\n**Board audience notes:** ${args.audience_notes}`
    : '';
  const extraClause = args.additional_context
    ? `\n\nAdditional context:\n${args.additional_context}`
    : '';

  const systemMessage = `You are preparing board-level reporting for a nonprofit organization. Your audience is board members — they are strategic leaders, not day-to-day operators. They need clear, concise information they can act on, not raw data dumps.

You have access to the organization's live data through MCP tools. You MUST call these tools to get real numbers.

## CRITICAL SAFETY RULES

1. **NEVER FABRICATE DATA.** Every number must come from an MCP tool result. If data is unavailable, state it clearly with \`[DATA UNAVAILABLE: ...]\`. Board members make governance decisions based on these numbers.

2. **NEVER DISTRIBUTE EXTERNALLY.** You produce drafts for internal review. The ED/staff must review before the packet goes to the board. End every report with a review prompt.

3. **BOARD-APPROPRIATE TONE.** Write for strategic leaders: lead with headlines, explain significance, flag what needs their attention or decision. Avoid operational jargon. If a metric is bad, say so clearly — boards need honest reporting, not spin.

## INTERACTION MODEL

For board packets, you MUST confirm the presentation format, visual template, metrics, and graph preferences with the user BEFORE drafting. Do NOT skip these checkpoints — a board packet that doesn't match the board's expected format wastes everyone's time.

## OUTPUT FORMAT

- **All data tables → CSV format** with labeled filenames (e.g., \`kpi_scorecard.csv\`)
- **Narrative sections → clearly structured text** with headers, suitable for copying into a presentation deck
- **CSV conventions:** raw numeric values (no $ or commas in numbers), first row is headers, double-quote text with commas, dates as YYYY-MM-DD
- Each CSV block labeled: \`--- FILENAME: name.csv ---\``;

  const userMessage = `# Task: BOARD REPORTING — ${args.report_type.toUpperCase().replace(/_/g, ' ')}

**Board meeting:** ${meetingDate}
**Reporting period:** ${period}
**Comparison:** ${comparison}
${hasTargets ? `**KPI targets:** ${args.kpi_targets}` : '**KPI targets:** Derive from budget data and historical performance.'}
${args.committee ? `**Committee:** ${args.committee}` : ''}
${audienceClause}
${extraClause}

---

## Step 1: Gather All Data

Call these MCP tools in parallel. After each call, **write down the specific numbers you extracted** before moving on. Do not proceed to report building until you have documented every data point.

### Enrollment & program data:
- \`query_enrollment\` with query_type "total" → extract: total count
- \`query_enrollment\` with query_type "by_phase" → extract: count per phase (Foundations, 101, Lightspeed, LiftOff)
- \`query_enrollment\` with query_type "by_race" → extract: count and % per race/ethnicity
- \`query_enrollment\` with query_type "by_school" → extract: count per school
- \`query_students\` → extract: enrollment_status breakdown (E, EP, EL, N counts for retention calc)

### Outcome data:
- \`query_certifications\` with query_type "summary" → extract: total exams, passed count, failed count. Calculate: pass rate = passed / (passed + failed) * 100
- \`query_certifications\` with query_type "by_type" → extract: per-cert-type pass/fail counts
- \`query_certifications\` with query_type "by_phase" → extract: per-phase pass/fail counts
- \`query_employment\` with query_type "aggregate" → extract: job_count, active_jobs, student_count, total_earned, avg_wage, avg_hours
- \`query_employment\` with query_type "by_employer" → extract: top 5-10 employers with student counts
- \`query_postsecondary\` with query_type "summary" → extract: total records, distinct students, graduates, graduation rate
- \`query_attendance\` with query_type "aggregate" → extract: overall rate, per-cohort or per-phase rates if available

### Financial data:
- \`get_finance_brief\` → extract: fund balances (list each fund and amount), recent gifts (list amounts)
- \`query_finances\` with query_type "ytd" → extract: every revenue and expense line item with its amount. Write down each line.
- \`query_finances\` with query_type "budget_actuals" → extract: budget and actual for each line item. Calculate variances.
- \`query_finances\` with query_type "fund_balances" → extract: each fund name and closing balance. Sum them for total cash.
- \`query_finances\` with query_type "phase_budget_dashboard" → extract: budget per program phase

### Fundraising data:
- \`query_donors\` with query_type "summary" → extract: total donor count, lifetime giving total, contributing gift count
- \`query_finances\` with query_type "dev_giving_history" → extract: gift amounts, dates, campaigns. Sum for total raised.
- \`query_finances\` with query_type "dev_grants_tracker" → extract: each grant name, amount, status, deadlines
- \`query_finances\` with query_type "dev_prospect_pipeline" → extract: each prospect, ask amount, stage, likelihood
- \`query_finances\` with query_type "dev_launchpad_pipeline" → extract: LP-specific pipeline entries

### Qualitative / context:
- \`search_documents\` with query: "board" or "strategic plan" or "program update" — for narrative context
- \`search_conversations\` with query: "student success" or "program highlight" — for anecdotes

### After all calls complete:

**Produce a DATA INVENTORY** before proceeding. List every metric you extracted from the tool results:

\`\`\`
METRIC                          | VALUE    | SOURCE TOOL & QUERY TYPE            | FIELD / DERIVATION
Total enrollment                | [value]  | query_enrollment "total"            | direct from result
Cert pass rate                  | [value]  | query_certifications "summary"      | pass_rate_pct field
Employment avg wage             | [value]  | query_employment "aggregate"        | avg_wage field
Total revenue YTD               | [value]  | query_finances "ytd"                | sum of revenue line items (list them)
Cost per student                | [value]  | derived                             | total expenses / total enrollment
...
\`\`\`

This inventory is your source of truth. Every number in the final report MUST appear here first. If a number isn't in the inventory, it doesn't go in the report. For derived metrics (dividing values from different tools), list the inputs and the division.

---

## Step 2: Confirm Format, Metrics & Visuals

Before drafting anything, you MUST confirm the presentation format, key metrics, and graph preferences with the user. This ensures the output matches what the board expects.

### 2a. Presentation Template

${hasTemplate ? `The user provided a template description:

> ${args.presentation_template}

Review this template and confirm your understanding: "I'll structure the packet to match your template: [restate the structure]. Is that correct, or should I adjust anything?"` : `**No template was provided.** Present a proposed slide/page structure and ask the user to confirm or modify:

"Before I draft the packet, I need to know the format your board expects. Here's a proposed structure:

**Slide 1:** Cover — meeting date, organization name, reporting period
**Slide 2:** KPI Scorecard — traffic-light status for key metrics
**Slide 3:** Financial Summary — revenue, expenses, net, cash position
**Slide 4:** Budget vs. Actual — bar chart with variance highlights
**Slide 5:** Program Enrollment & Outcomes — by phase
**Slide 6:** Fundraising Progress — vs. annual goal
**Slide 7:** Development Pipeline — active grants and prospects
**Slide 8:** Highlights & Stories — 1-2 student/program highlights
**Slide 9:** Challenges & Risks — honest assessment
**Slide 10:** Items for Board Action — decisions needed
**Slide 11:** Upcoming Calendar — key dates next quarter

Do you have an existing PowerPoint or Google Slides template I should match? If so, please share it (URL or describe the layout — colors, logo placement, slide order, what goes where). Otherwise, confirm this structure works or tell me what to change."

**Wait for the user's response before proceeding.**`}

### 2b. Key Metrics

${hasKeyMetrics ? `The user specified these key metrics (in priority order):

> ${args.key_metrics}

Confirm: "I'll feature these metrics as the primary KPIs in the scorecard: [restate]. I'll also include supporting metrics where relevant. Does this look right?"` : `${hasTargets ? `The user provided KPI targets (${args.kpi_targets}) but didn't specify which metrics to prioritize.` : 'No specific metrics were provided.'}

**Propose a metrics list and ask for confirmation:**

"Which metrics matter most to your board? Here's what I'd recommend based on the data available, in priority order:

**Program Metrics:**
1. Total active enrollment
2. Certification pass rate
3. Employment placement rate
4. Average hourly wage
5. Postsecondary enrollment rate
6. Attendance rate

**Financial Metrics:**
7. Revenue vs. budget
8. Net surplus/deficit
9. Cash on hand / months of runway
10. Program expense ratio

**Fundraising Metrics:**
11. Total raised vs. annual goal
12. Donor count
13. Pipeline value

Please:
- Reorder these by what your board cares about most
- Remove any that aren't relevant
- Add any I'm missing (e.g., specific program outcomes, specific fund balances)
- For each metric, tell me the **target** if you have one (e.g., 'cert pass rate: 85%')"

**Wait for the user's response before proceeding.**`}

### 2c. Graphs & Visualizations

${hasGraphPrefs ? `The user specified these graph preferences:

> ${args.graph_preferences}

Confirm: "I'll describe these visualizations in the output so you can create them: [restate]. Any changes?"` : `**Propose graph types and ask for confirmation:**

"What graphs/charts does your board expect to see? I'll describe each visualization with the exact data so you can create them in your presentation tool. Here's what I'd recommend:

1. **KPI Scorecard** — table with traffic-light color coding (green/yellow/red)
2. **Revenue vs. Budget** — horizontal bar chart (actual vs. budget by category)
3. **Monthly Revenue & Expense Trend** — line chart (12-month trailing)
4. **Enrollment by Phase** — stacked bar or pie chart
5. **Fundraising Progress** — progress bar or gauge (raised vs. goal)
6. **Program Outcomes** — grouped bar chart (cert rate, employment rate, college rate by phase)
7. **Expense Allocation** — pie chart (program vs. admin vs. fundraising)

For each graph, I'll output the underlying data as CSV so you can plug it directly into your charting tool.

Please confirm which charts you want, modify any, or add others."

**Wait for the user's response before proceeding.**`}

---

## Step 3: Build the Report

Use the confirmed format, metrics, and graph preferences from Step 2. Structure the output to match the user's template.

${buildReportTypeInstructions(args)}

### Graph Data

For each confirmed graph/chart, output a dedicated CSV file with the data needed to create it:

\`--- FILENAME: chart_[name].csv ---\`

Each chart CSV should include:
- Column headers that map directly to chart axes/series
- Data sorted in the order it should appear in the chart
- A comment row at the top: \`# Chart Type: [bar/line/pie/gauge], Title: [title], X-Axis: [label], Y-Axis: [label]\`

Example:
\`\`\`
--- FILENAME: chart_revenue_vs_budget.csv ---
\`\`\`
\`\`\`csv
# Chart Type: horizontal bar, Title: Revenue vs Budget (YTD), X-Axis: Category, Y-Axis: Amount
Category,Actual,Budget
"Grants & Contributions",142000,150000
"Government Contracts",85000,80000
"Individual Giving",45000,60000
"Earned Revenue",12000,15000
\`\`\`

---

## Step 4: Final Quality Check

Before outputting, verify:
- [ ] Format matches the user's confirmed template (slide order, sections, branding notes)
- [ ] Only the user's confirmed metrics are featured as primary KPIs
- [ ] Every confirmed graph has a corresponding \`chart_*.csv\` data file
- [ ] Every number comes from a tool call — zero fabricated data
- [ ] All CSV blocks have a labeled filename
- [ ] CSV uses raw numeric values (no $ signs, no commas in numbers)
- [ ] Every \`[DATA UNAVAILABLE]\` flag is collected and listed
- [ ] Narrative is board-appropriate: headlines first, significance explained, action items clear
- [ ] Comparison data is included where available
- [ ] The report period and "as of" date are stated clearly

**"This is a draft for staff review. Please verify all figures and narrative before distributing to the board."**`;

  return {
    messages: [
      { role: 'assistant', content: { type: 'text', text: systemMessage } },
      { role: 'user', content: { type: 'text', text: userMessage } },
    ],
  };
}

function buildReportTypeInstructions(args: PromptArgs): string {
  const period = args.period ?? 'YTD';
  const comparison = args.comparison_period ?? 'annual targets';
  const meetingDate = args.meeting_date ?? '[meeting date]';

  switch (args.report_type) {
    case 'full_board_packet':
      return buildFullBoardPacket(period, comparison, meetingDate, args.kpi_targets);
    case 'kpi_dashboard':
      return buildKPIDashboard(period, comparison, args.kpi_targets);
    case 'program_update':
      return buildProgramUpdate(period, comparison);
    case 'fundraising_update':
      return buildFundraisingUpdate(period, comparison);
    case 'executive_director_report':
      return buildEDReport(period, meetingDate, args.audience_notes);
    case 'committee_report':
      return buildCommitteeReport(period, comparison, args.committee);
    default:
      return buildFullBoardPacket(period, comparison, meetingDate, args.kpi_targets);
  }
}

function buildFullBoardPacket(period: string, comparison: string, meetingDate: string, kpiTargets: string | undefined): string {
  return `### Full Board Packet

Produce a complete board meeting package with these sections:

**SECTION 1: Cover & Agenda Context**
Plain text — 2-3 sentences orienting the board: meeting date (${meetingDate}), reporting period (${period}), and 2-3 headline items they should pay attention to.

**SECTION 2: KPI Scorecard** → \`kpi_scorecard.csv\`

Columns: KPI, Current Value, Target, ${comparison}, Status, Trend
Status: On Track / Watch / Off Track
Trend: Improving / Stable / Declining

KPIs to include:
${kpiTargets ? `Use the provided targets: ${kpiTargets}` : 'Derive targets from budget and historical data.'}

Required KPIs by category and the tool call that provides each:

**ENROLLMENT & RETENTION** — from \`query_enrollment\`:
- Total active enrollment → "total" query_type
- Enrollment by phase → "by_phase" query_type
- Demographic breakdown → "by_race" query_type
- Retention → derive from enrollment_status counts in "by_student" or \`query_students\`

**PROGRAM OUTCOMES** — use the computed values returned by each tool:
- Certification pass rate → \`query_certifications\` "summary" returns pass_rate_pct, passed, failed, total
- Certification breakdown → \`query_certifications\` "by_type" returns count and avg_score per type
- Employment metrics → \`query_employment\` "aggregate" returns job_count, student_count, avg_wage, avg_hours, total_earned
- Top employers → \`query_employment\` "by_employer"
- Postsecondary → \`query_postsecondary\` "summary" returns total records, distinct students, graduates, graduation_rate
- Attendance → \`query_attendance\` "aggregate" returns rate

**FINANCIAL HEALTH** — from \`query_finances\` and \`get_finance_brief\`:
- Revenue & expenses → "ytd" query_type returns line items with amounts
- Budget vs actual → "budget_actuals" query_type
- Fund balances → "fund_balances" query_type
- Phase costs → "phase_budget_dashboard" query_type
- For derived metrics (cost per student, months of runway, program expense ratio): divide the values the tools returned. Show the division in the Notes column.

**FUNDRAISING** — from \`query_donors\` and \`query_finances\`:
- Donor summary → \`query_donors\` "summary" returns donor count, lifetime giving, gift count
- Giving history → \`query_finances\` "dev_giving_history"
- Active grants → \`query_finances\` "dev_grants_tracker"
- Pipeline → \`query_finances\` "dev_prospect_pipeline"

**RULES:**
- Use the values the tools return. If a tool returns a computed field (like pass_rate_pct or avg_wage), use it directly — do not re-derive it.
- For metrics that require combining data from multiple tools (like cost per student = expenses / enrollment), show the division in the Notes column so the reviewer can verify.
- If a tool doesn't return a value needed for a KPI, mark it \`[DATA UNAVAILABLE]\` — do not estimate.

**SECTION 3: Financial Summary** → \`financial_summary.csv\`

Columns: Category, Line Item, ${period} Amount, ${comparison} Amount, Variance, Variance %, Notes
Build from \`query_finances\` "ytd" and "budget_actuals" results. Variance = Actual - Budget. Variance % = Variance / Budget * 100.
"budget_actuals" spans two tabs — prior month and YTD — so the same account line appears twice, once per period. Group its rows by \`tab_name\` before computing anything: summing or differencing across both double-counts every line. Use the YTD rows for a ${period} figure and the prior-month rows for ${comparison}.

Also produce: \`budget_vs_actual.csv\`
Columns: Line Item, Budget, Actual, Variance, Variance %, Status
Status: On Track (within 10%), Watch (10-20%), Over/Under Budget (>20%)

**SECTION 4: Program Highlights**
Plain text — 1-2 paragraphs per program phase using data already gathered from the tools above. For each phase cite the enrollment count, certification results, employment outcomes, and attendance from the tool results. Flag any metric that declined vs comparison period.

**SECTION 5: Fundraising Dashboard** → \`fundraising_dashboard.csv\`

Columns: Metric, Value, Target, % of Target, Notes
Populate from \`query_donors\` "summary", \`query_finances\` "dev_giving_history" and "dev_grants_tracker" results. Every value must come from a tool result.

**SECTION 6: Development Pipeline** → \`development_pipeline.csv\`

Columns: Funder/Prospect, Type, Stage, Ask Amount, Likelihood, Expected Close Date, Notes
Pull directly from \`query_finances\` "dev_prospect_pipeline" and "dev_launchpad_pipeline" results. Do not add rows that aren't in the data.

**SECTION 7: Items Requiring Board Action**
Plain text — ONLY flag items supported by the data. Cite the specific numbers from tool results. If no data supports a board action, say so.

**SECTION 8: Upcoming Calendar**
Plain text — only include dates that appear in tool results (grant deadlines from dev_grants_tracker, dates from search_documents). Do not invent dates.`;
}

function buildKPIDashboard(period: string, comparison: string, kpiTargets: string | undefined): string {
  return `### KPI Dashboard / Scorecard

Produce a comprehensive KPI scorecard as CSV.

**PRIMARY OUTPUT:** \`kpi_scorecard.csv\`

Columns: Category, KPI, Current Value, Target, ${comparison}, % of Target, Status, Trend, Notes

Status values: On Track (>=90% of target), Watch (75-89%), Off Track (<75%)
Trend values: Improving, Stable, Declining (based on comparison to ${comparison})

${kpiTargets ? `**User-provided targets:** ${kpiTargets}\nUse these exact targets. Fill in any KPIs not listed by deriving from budget/historical.` : '**No targets provided.** Derive targets from budget data and historical performance. Note each derived target with "[DERIVED]" in Notes.'}

### KPI Categories and source tools:

**ENROLLMENT & RETENTION** — from \`query_enrollment\`:
- Total active enrollment → "total"
- New enrollments → "active_during" with date filters
- Retention → derive from enrollment_status counts
- Phase distribution → "by_phase"
- Demographics → "by_race"

**PROGRAM OUTCOMES** — use the computed values the tools return:
- Certification pass rate, attempts, passed, failed → \`query_certifications\` "summary" (returns pass_rate_pct)
- By cert type → \`query_certifications\` "by_type" (returns count, avg_score per type)
- Employment rate, wages, earnings → \`query_employment\` "aggregate" (returns student_count, avg_wage, total_earned)
- Postsecondary → \`query_postsecondary\` "summary" (returns graduation_rate, distinct students)
- Attendance → \`query_attendance\` "aggregate" (returns rate)

**FINANCIAL HEALTH** — from \`query_finances\` and \`get_finance_brief\`:
- Revenue & expenses → "ytd"
- Budget vs actual → "budget_actuals"
- Fund balances → "fund_balances"
- Phase costs → "phase_budget_dashboard"
- Derived metrics (cost per student, runway, expense ratio) → divide values from the tools above; show the division in Notes

**FUNDRAISING** — from \`query_donors\` and \`query_finances\`:
- Donor count & lifetime giving → \`query_donors\` "summary"
- Giving history → \`query_finances\` "dev_giving_history"
- Pipeline → \`query_finances\` "dev_prospect_pipeline"
- Grants → \`query_finances\` "dev_grants_tracker"

**RULES:**
- Use the values the tools return directly. If the tool computes a rate or average, use that — don't re-derive.
- For derived metrics (combining values from multiple tools), show the inputs and division in the Notes column.
- \`[DATA UNAVAILABLE]\` for anything a tool doesn't return. Never estimate.

### SECONDARY OUTPUT: \`kpi_trends.csv\`

If monthly data is available, produce a trend file:
Columns: KPI, Month 1, Month 2, Month 3, ..., Current Month

This lets the board see trajectories, not just snapshots.

### NARRATIVE SUPPLEMENT

After the CSV blocks, provide a brief (4-6 bullet points) **"Headlines for the Board"** section:
- Lead with the most positive metric
- Flag any Off Track items and what's being done about them
- Note any significant trends (improving or declining)
- One forward-looking item`;
}

function buildProgramUpdate(period: string, comparison: string): string {
  return `### Program Update Report

**OUTPUT 1:** \`program_metrics.csv\`

Columns: Phase, Enrolled, Completed, In Progress, Dropped, Completion Rate, Cert Pass Rate, Avg Attendance, Employment Rate, Avg Wage, College Enrollment Rate, Calculation Notes

Rows: Foundations, 101, Lightspeed, LiftOff, ALL PROGRAMS (total)

Populate each cell from the tool results gathered in Step 1:
- **Enrolled** → from \`query_enrollment\` "by_phase"
- **Completed / In Progress / Dropped** → from enrollment data if status breakdowns are available per phase; otherwise \`[DATA UNAVAILABLE]\`
- **Completion Rate** → Completed / Enrolled if both are available
- **Cert Pass Rate** → from \`query_certifications\` "by_phase" or "summary" — use the pass_rate_pct the tool returns
- **Avg Attendance** → from \`query_attendance\` "aggregate" (note if not phase-specific)
- **Employment Rate / Avg Wage** → from \`query_employment\` "aggregate" (note if not phase-specific)
- **College Enrollment Rate** → from \`query_postsecondary\` "summary"
- **ALL PROGRAMS row** → sum the counts; for rates, recalculate from totals (don't average percentages)

**OUTPUT 2:** \`outcomes_detail.csv\`

Columns: Outcome Category, Metric, ${period} Value, ${comparison} Value, Change, Calculation Notes
Rows:
- Certification types: one row per cert type from \`query_certifications\` "by_type". Value = pass rate (passed/attempted*100). Show calc in Notes.
- Employment: placement rate, avg wage, avg hours, total earnings — each from \`query_employment\` "aggregate". Show source field.
- Postsecondary: enrollment rate, by institution type — from \`query_postsecondary\` "summary" and "by_institution".
- Attendance: overall rate and by phase — from \`query_attendance\` "aggregate".

For Change column: ${period} Value - ${comparison} Value. Positive = improvement, negative = decline.

**OUTPUT 3:** \`employer_partners.csv\`

Columns: Employer, Students Placed, Avg Wage, Employment Type, Retention Notes

**NARRATIVE:**

For each program phase, write a 1-paragraph update covering:
1. **Enrollment & progression** — who's in the phase, how they're moving through
2. **Key outcomes** — the most notable achievement this period
3. **Student highlight** — pull from search_documents or search_conversations if available
4. **Challenges** — what's been hard, what's changing
5. **Next period outlook** — what's coming

End with an **"Impact Statement"** — 2-3 sentences summarizing the overall program impact with headline numbers (total students served, total certifications, total job placements, total college enrollments, aggregate wages earned). This is the "board meeting sound bite."`;
}

function buildFundraisingUpdate(period: string, comparison: string): string {
  return `### Fundraising / Development Update

**OUTPUT 1:** \`fundraising_summary.csv\`

Columns: Revenue Source, ${period} Raised, Annual Goal, % of Goal, ${comparison}, YoY Change

Rows: Foundation/Grants, Corporate, Individual (Major), Individual (General), Government, Events, In-Kind, Other, TOTAL

**OUTPUT 2:** \`active_grants.csv\`

Columns: Funder, Grant Name, Award Amount, Received to Date, Spent to Date, Remaining, Period, Next Report Due, Status

**OUTPUT 3:** \`pipeline.csv\`

Columns: Prospect/Funder, Type, Stage, Ask Amount, Likelihood, Expected Decision Date, Assigned To, Notes

Stage values: Identified, Cultivated, Solicited, Pending Decision, Awarded, Declined

**OUTPUT 4:** \`donor_metrics.csv\`

Columns: Metric, ${period} Value, ${comparison} Value, Change, Notes
Rows: Total donors, New donors, Retained donors, Lapsed donors, Donor retention rate, Average gift size, Median gift size, Recurring donors, Recurring revenue, Largest single gift.

**NARRATIVE:**

Write a development update with these sections:
1. **Revenue headline** — total raised, % of goal, trajectory (on track / ahead / behind)
2. **Major gifts & grants** — any significant new awards or renewals this period
3. **Pipeline outlook** — total pipeline value, expected closes this quarter, key pending decisions
4. **Donor engagement** — retention trends, new donor acquisition, campaign results
5. **Challenges & opportunities** — what's working, what isn't, where the board can help (introductions, events, etc.)
6. **Ask of the board** — specific things board members can do to support development`;
}

function buildEDReport(period: string, meetingDate: string, audienceNotes: string | undefined): string {
  return `### Executive Director Report

This is the ED's narrative report to the board. It should feel personal and strategic — not a data dump. The data supports the narrative; it doesn't replace it.

${audienceNotes ? `**Board context:** ${audienceNotes}\nTailor the report to address these concerns.` : ''}

**OUTPUT 1:** \`ed_report_metrics.csv\`

A compact table of the 10 most important numbers the ED wants the board to see:
Columns: Metric, Value, Context
(Context column: a brief phrase like "up 12% from last quarter" or "ahead of target" or "requires attention")

**NARRATIVE STRUCTURE:**

Write the ED report as structured text ready to be dropped into a presentation or document:

**1. Opening — "Where We Are" (1 paragraph)**
The headline: what's the state of the organization right now? Lead with the strongest proof point. Set the tone — confident, honest, forward-looking.

**2. Program Impact (2-3 paragraphs)**
What happened in programs this period. Use real numbers but lead with the human story. If search_documents or search_conversations surfaced a student anecdote, lead with it, then back it up with data.

**3. Financial Position (1-2 paragraphs)**
Plain-language financial summary. Not a P&L — a narrative. "We're on track against our $X budget, with $Y in cash and Z months of runway. Fundraising is at X% of our annual goal." Flag any concerns honestly.

**4. Strategic Progress (1-2 paragraphs)**
Tie the period's work to the strategic plan. What goals are being advanced? What milestones were hit? Reference any relevant documents found in the search.

**5. Challenges & Risks (1 paragraph)**
What's the ED worried about? Enrollment trends, funding gaps, staffing, external factors. Boards respect transparency.

**6. Decisions Needed (bullet list)**
Specific items requiring board input, approval, or discussion. Each bullet should include:
- What the decision is
- Why it's needed now
- The ED's recommendation

**7. Looking Ahead (1 paragraph)**
What's coming in the next quarter: key dates, milestones, opportunities.

**8. Gratitude (1-2 sentences)**
Acknowledge the board's contribution. Personal touch.`;
}

function buildCommitteeReport(period: string, comparison: string, committee: string | undefined): string {
  const comm = committee ?? 'finance';

  if (comm === 'finance') {
    return `### Finance Committee Report

Deep-dive financial report for the finance committee.

**OUTPUT 1:** \`finance_committee_summary.csv\`
Columns: Category, ${period}, Budget, Variance, Variance %, ${comparison}, YoY Change, Notes

Full income statement detail — not the high-level board summary but the line-item detail the finance committee needs.

**OUTPUT 2:** \`fund_balances_detail.csv\`
Columns: Fund, Opening Balance, Revenue, Expenses, Transfers, Closing Balance, Restriction Type, Deadline, Risk Level

**OUTPUT 3:** \`cash_flow.csv\`
Columns: Month, Beginning Cash, Inflows, Outflows, Net Cash Flow, Ending Cash
Provide monthly for the reporting period.

**OUTPUT 4:** \`budget_variance_detail.csv\`
Columns: Line Item, Annual Budget, ${period} Budget, ${period} Actual, $ Variance, % Variance, Explanation
Include EVERY line item with >5% variance. The Explanation column should note likely reasons from the data.

**NARRATIVE:**
1. **Financial health assessment** — overall fiscal position in 2-3 sentences
2. **Significant variances** — each >10% variance explained
3. **Cash flow outlook** — projected cash position for next 3 months
4. **Restricted fund status** — any at-risk funds
5. **Recommendations** — what the finance committee should recommend to the full board`;
  }

  if (comm === 'program') {
    return `### Program Committee Report

Deep-dive program report for the program committee.

**OUTPUT 1:** \`program_detail_by_phase.csv\`
Columns: Metric, Foundations, 101, Lightspeed, LiftOff, Total
Rows: Enrolled, Completed, In Progress, Dropped/Withdrawn, Completion Rate, Avg Attendance, Cert Attempts, Cert Pass Rate, Avg Cert Score

**OUTPUT 2:** \`outcome_trends.csv\`
Columns: Outcome, Current Period, Prior Period, Change, Target, % of Target
Monthly or quarterly granularity for trend analysis.

**OUTPUT 3:** \`student_demographics.csv\`
Columns: Dimension, Category, Count, % of Total
Dimensions: Race/Ethnicity, Gender, School, Graduation Year, Neighborhood

**OUTPUT 4:** \`post_program_outcomes.csv\`
Columns: Metric, Value, ${comparison}, Change, Notes
Rows: Employment rate, avg wage, avg hours, total earnings, college enrollment rate, college graduation rate, top employers (listed), top institutions (listed)

**NARRATIVE:**
1. **Program health summary** — strengths and concerns across phases
2. **Outcome highlights** — most compelling metrics
3. **Curriculum/model updates** — any changes made or needed
4. **Student stories** — 1-2 if available from documents
5. **Recommendations** — what the program committee should recommend to the full board`;
  }

  if (comm === 'development') {
    return `### Development Committee Report

Deep-dive fundraising report for the development committee.

**OUTPUT 1:** \`development_dashboard.csv\`
Columns: Metric, Current, Goal, % of Goal, Prior Year, YoY Change

Full fundraising metrics — the development committee needs granularity.

**OUTPUT 2:** \`donor_segments.csv\`
Columns: Segment, Donor Count, Total Giving, Avg Gift, Retention Rate, New This Period
Segments: Major ($10K+), Mid-Level ($1K-$10K), General (<$1K), Foundation, Corporate, Government

**OUTPUT 3:** \`grant_portfolio.csv\`
Columns: Funder, Program, Award, Period, Status, Next Action, Deadline, Renewal Likelihood

**OUTPUT 4:** \`prospect_research.csv\`
Columns: Prospect, Type, Estimated Capacity, Alignment Score, Connection, Stage, Next Step

**NARRATIVE:**
1. **Revenue trajectory** — on pace for annual goal?
2. **Major donor activity** — new, renewed, lapsed, upgraded
3. **Grant portfolio health** — success rate, pipeline quality
4. **Board engagement opportunities** — specific asks for committee members
5. **Strategic recommendations** — where to focus development effort next quarter`;
  }

  // Default: executive committee
  return `### Executive Committee Report

High-level strategic report combining financial, program, and organizational health.

**OUTPUT 1:** \`executive_dashboard.csv\`
Columns: Domain, KPI, Value, Target, Status, Board Action Needed
Domains: Financial, Program, Fundraising, Organizational

**NARRATIVE:**
1. **Organizational health summary** — 1 paragraph spanning programs, finances, team
2. **Strategic plan progress** — which goals are advancing
3. **Risk register** — top 3-5 organizational risks with mitigation status
4. **ED performance context** — key accomplishments and challenges (if appropriate)
5. **Decisions for the executive committee** — items to resolve before full board`;
}

export function registerBoardReportingPrompt(server: McpServer): void {
  server.registerPrompt(NAME, { description: DESCRIPTION, argsSchema: boardReportingArgsSchema }, (args) => {
    return buildBoardReportingMessages(args);
  });
}
