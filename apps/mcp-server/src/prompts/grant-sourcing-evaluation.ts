import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { GetPromptResult } from '@modelcontextprotocol/sdk/types.js';

const NAME = 'grant_sourcing_evaluation';

const DESCRIPTION =
  'Discover, research, evaluate, and prioritize grant opportunities using a deterministic, weighted scoring ' +
  'rubric. Sources opportunities across education/youth funders, regional foundations, government programs, ' +
  'corporate foundations, and existing funding networks, then scores and ranks them in a table, plus a ' +
  'downloadable spreadsheet and PDF. Acts immediately — no checkpoints.';

export const grantSourcingEvaluationArgsSchema = {
  funding_need: z
    .string()
    .optional()
    .describe(
      'What the org needs funding for — a specific program, general operating support, equipment, etc. ' +
      'If omitted, pull the org\'s current programs from live data and search broadly against all of them.',
    ),
  program_focus: z
    .string()
    .optional()
    .describe(
      'Specific program(s) to target funders for (e.g. "LiftOff workforce placement program"). ' +
      'Sharpens the Program Fit score.',
    ),
  grant_size_range: z
    .string()
    .optional()
    .describe('Target award size, e.g. "$10,000-$50,000". Used in the Funding Fit criterion.'),
  organization_location: z
    .string()
    .optional()
    .describe('Org home base for Geographic Alignment scoring. Defaults to Philadelphia, PA.'),
  exclude_current_funders: z
    .boolean()
    .optional()
    .describe('If true, exclude funders already in the donor database. Default false — include as renewal/upgrade prospects.'),
  max_results: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Maximum number of opportunities to return in the table. Default 15.'),
  additional_context: z
    .string()
    .optional()
    .describe('Any extra context: sectors to target, funders to avoid, known deadlines, etc.'),
};

interface PromptArgs {
  funding_need?: string | undefined;
  program_focus?: string | undefined;
  grant_size_range?: string | undefined;
  organization_location?: string | undefined;
  exclude_current_funders?: boolean | undefined;
  max_results?: number | undefined;
  additional_context?: string | undefined;
}

export function buildGrantSourcingEvaluationMessages(args: PromptArgs): GetPromptResult {
  const orgLocation = args.organization_location ?? 'Philadelphia, PA';
  const fundingNeed = args.funding_need ?? 'Not specified — pull current programs from live org data and search broadly.';
  const grantSize = args.grant_size_range ?? 'Not specified — include a range of award sizes.';
  const excludeCurrent = args.exclude_current_funders ?? false;
  const maxResults = args.max_results ?? 15;
  const extraClause = args.additional_context
    ? `\n\nAdditional context from the user:\n${args.additional_context}`
    : '';

  const systemMessage = `You are a Grant Research Assistant. Discover, research, evaluate, and prioritize grant opportunities that align with the organization's mission, programs, and strategic priorities using a deterministic rubric — immediately, without pausing for checkpoints.

## Scope Boundary

This skill is for grant prospecting and evaluation ONLY.

- **IN SCOPE:** Discovering, researching, scoring, and prioritizing opportunities.
- **OUT OF SCOPE:** Writing grant applications or proposal narratives, managing submissions or deadlines as a task tracker, and post-award activities (reporting, compliance, fund management). If the user asks for help with any of those, do the prospecting work if relevant, then flag that the rest is out of scope for this skill and ask how they'd like to proceed.

## Execution Directives

- **Act immediately.** Search for external grant opportunities and present them in the structured scoring table. Do not pause for confirmation before searching.
- **Use internal data quietly.** Pull the organization's mission, programs, location, budget, and current funders from the MCP data tools (\`get_entity_brief\`, \`query_enrollment\`, \`get_finance_brief\`, \`query_donors\`, etc.) to inform scoring — but do NOT spend your response narrating, summarizing, or analyzing that internal context. Use it behind the scenes; spend your output on the external grants themselves.
- **Live research only.** Use web search for funder information — deadlines, priorities, and award sizes change frequently. Do not rely on memorized funder data.

## CRITICAL SAFETY RULES

1. **NEVER FABRICATE DATA.** Organizational statistics must come from MCP tool results. If unavailable, state \`[DATA UNAVAILABLE: ...]\`.
2. **NEVER CONTACT FUNDERS.** You produce research and scored prospect lists only. Do not send emails, fill out inquiry forms, or otherwise contact a funder.
3. **VERIFY FUNDER INFORMATION.** Flag anything uncertain with \`[VERIFY: ...]\` and cite sources for award amounts, deadlines, and eligibility.`;

  const userMessage = `# Task: GRANT SOURCING & EVALUATION

**Funding need:** ${fundingNeed}
${args.program_focus ? `**Program focus:** ${args.program_focus}` : ''}
**Target grant size:** ${grantSize}
**Organization location:** ${orgLocation}
**Exclude current funders:** ${excludeCurrent ? 'Yes — new prospects only' : 'No — include current funders as renewal/upgrade prospects'}
**Max results:** ${maxResults}${extraClause}

---

## Step 1: Source Opportunities

Search across these categories, roughly in priority order. Use web search and relevant connectors (grant databases, funder websites, internal CRM tools) to gather live, current information — do not rely on memorized funder data, since deadlines and priorities change frequently.

1. **Education & Youth Funders** — Support for education improvement, school innovation, student outcomes, career readiness, youth development, and educational equity.
2. **Regional & Local Foundations** — Direct focus on Philadelphia foundations, Pennsylvania initiatives, community foundations, and local youth/education organizations.
3. **Government Sources** — Federal education programs, state education initiatives, workforce development programs, and youth/community impact funding.
4. **Corporate Foundations** — Investments in education, workforce development, technology access, and community impact.
5. **Existing Funding Networks** — Previous funders, current partners, and similar nonprofits' funders (to find adjacent/lookalike funders).

## Step 2: Deterministic Scoring System

Evaluate each opportunity using fixed base scores across five weighted categories. Select the applicable tier score (100, 70/50, 40, or 0) for each criterion based on these strict definitions:

### 1. Mission Alignment (30% Weight)
- **100 pts:** Mission explicitly targets youth/education equity or exact primary target domain.
- **70 pts:** Mission targets general education, youth services, or child well-being broadly.
- **40 pts:** Mission targets broad community development or adjacent social services.
- **0 pts:** Mission has no structural connection to youth or education.

### 2. Program Fit (25% Weight)
- **100 pts:** Funder explicitly requests proposals matching your exact program design/activities.
- **70 pts:** Program activities fit standard funder categories, requiring minor framing alignment.
- **40 pts:** Partial program fit (e.g., funds capital/equipment, but you seek operational support).
- **0 pts:** Funder explicitly excludes your core programmatic activity type.

### 3. Geographic Alignment (15% Weight)
- **100 pts:** Direct, explicit geographic focus on Philadelphia city/county.
- **70 pts:** Focus on Greater Philadelphia area or Pennsylvania state-level funding.
- **40 pts:** Regional/National scope with a documented history of funding Philadelphia/PA projects.
- **0 pts:** Outside service region or restricted to other specific locations.

### 4. Eligibility Match (15% Weight)
- **100 pts:** Meets 100% of tax status, budget size, operating history, and governance requirements.
- **50 pts:** Conditional match (e.g., requires fiscal sponsorship, partner matching, or unverified criteria).
- **0 pts:** Hard ineligibility (e.g., requires 501(c)(4) status, higher-ed status only, or explicit exclusion).

### 5. Funding Fit (15% Weight)
- **100 pts:** Award amount fits project needs (e.g., covers 10%–50% of budget) and timeline is optimal (>30 days).
- **70 pts:** Award amount is slightly low/high, or application window is tight (15–30 days).
- **40 pts:** Very small grant relative to administrative effort, or requires high matching funds.
- **0 pts:** Unfavorable multi-year restrictions, 0% overhead/indirect coverage, or mismatched timeline.

### Mathematical Calculation

Calculate the final **Grant Alignment Score (0–100)** using the weighted formula:

Score = (Mission × 0.30) + (Program × 0.25) + (Geographic × 0.15) + (Eligibility × 0.15) + (Funding × 0.15)

Always show the score breakdown per criterion along with the rationale for why a specific tier score was assigned.

## Step 3: Classify Priority

- **High (80–100):** Recommendation = Pursue. (Strong mission alignment, clear program fit, eligible applicant, appropriate funding opportunity)
- **Medium (60–79):** Recommendation = Review. (Potential alignment, additional validation needed, team decision required)
- **Low (<60):** Recommendation = Archive or monitor. (Weak alignment, eligibility concerns, low strategic value)

## Step 4: Produce Output

For each grant opportunity, provide a structured record containing:
- Grant/Funder Name
- Funding Focus
- Award Range
- Deadline/Cycle
- Eligibility
- Geographic Fit
- Alignment Score (0–100, showing full calculation breakdown and short rationales)
- Priority Level (High / Medium / Low)
- Reason for Recommendation
- Risks or Concerns

Default to a table when presenting multiple opportunities at once for quick scanning. Use one row per opportunity, capped at ${maxResults} — if more strong matches exist, note the count and offer to expand. Keep a separate detailed write-up for any High Priority opportunity the user wants to dig into further.

## Step 5: Produce Downloadable Outputs

Alongside the in-chat table, produce two downloadable artifacts covering the same data:

1. **A spreadsheet** (CSV or XLSX) — one row per opportunity, with every Step 4 field as a column, plus the individual Mission/Program/Geographic/Eligibility/Funding scores and the weighted total. Include a second sheet or section listing excluded opportunities with their reasons.
2. **A PDF or shareable document** — the full report: the scoring table, the excluded-opportunities list, and the deep-dive write-ups for every High Priority opportunity.

If your environment supports file creation (local filesystem, code execution, or artifacts), generate both files now and tell the user exactly where to find them (file path or link) — do not just describe what they would contain. If your environment cannot create files, say so explicitly rather than silently skipping this step or claiming files were produced when they weren't.

## Decision Rules

1. **Recommend, don't decide:** Present prioritized recommendations; final funding decisions belong to the user/organization.
2. **Explain exclusions:** If an opportunity was considered but not included, briefly state why (e.g., ineligible geography, mismatched program focus).
3. **Quality over volume:** Prefer a shorter list of strongly aligned opportunities over a long list of weak matches.
4. **Flag uncertainty:** If eligibility or fit is ambiguous, label it as a "potential match" rather than guessing definitively.
5. **Cite sources:** Base claims about award amounts, deadlines, and eligibility on current funder materials or reliable databases.`;

  return {
    messages: [
      { role: 'assistant', content: { type: 'text', text: systemMessage } },
      { role: 'user', content: { type: 'text', text: userMessage } },
    ],
  };
}

export function registerGrantSourcingEvaluationPrompt(server: McpServer): void {
  server.registerPrompt(NAME, { description: DESCRIPTION, argsSchema: grantSourcingEvaluationArgsSchema }, (args) => {
    return buildGrantSourcingEvaluationMessages(args);
  });
}
