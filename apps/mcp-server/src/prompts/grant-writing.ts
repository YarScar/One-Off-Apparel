import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { GetPromptResult } from '@modelcontextprotocol/sdk/types.js';

const NAME = 'grant_writing';

const DESCRIPTION =
  'Assemble a grant proposal or funder report draft using real organizational data. ' +
  'Accepts a URL to scrape grant requirements or pasted text. Researches the funder, ' +
  'pulls live program data, and drafts in the organization\'s voice — formatted for the ' +
  'specific submission method (email, web form, or document upload).';

export const grantWritingArgsSchema = {
  task_type: z
    .enum(['proposal', 'report'])
    .describe('Whether to draft a new grant proposal or a funder performance report.'),
  grant_requirements: z
    .string()
    .optional()
    .describe(
      'The funder\'s requirements pasted as text: RFP text, application questions, reporting template, ' +
      'scoring criteria, word/character limits. Provide this OR grant_url (at least one is required).',
    ),
  grant_url: z
    .string()
    .optional()
    .describe(
      'URL of the grant opportunity page. The system will scrape the page, extract requirements, ' +
      'eligibility criteria, deadlines, submission instructions, and application questions. ' +
      'Provide this OR grant_requirements (at least one is required).',
    ),
  funder_name: z
    .string()
    .optional()
    .describe('Name of the funding organization. If not provided, will be extracted from the grant requirements or URL.'),
  submission_format: z
    .enum(['email', 'web_form', 'document_upload', 'auto'])
    .optional()
    .describe(
      'How the grant is submitted. "auto" (default) will detect from the grant page/requirements. ' +
      '"email" formats as an email-ready draft with subject line. ' +
      '"web_form" formats as labeled field responses matching the form. ' +
      '"document_upload" formats as a polished document with headers and page structure.',
    ),
  program_area: z
    .string()
    .optional()
    .describe('Program or phase to focus on (e.g., "Foundations", "LiftOff", "workforce development"). Omit for org-wide.'),
  grant_focus: z
    .string()
    .optional()
    .describe('What the grant funds or the proposal theme (e.g., "youth workforce development", "digital literacy").'),
  time_period: z
    .string()
    .optional()
    .describe('Reporting period for reports (e.g., "2025", "Q3 2026"). For proposals, the proposed grant period.'),
  additional_context: z
    .string()
    .optional()
    .describe('Any additional instructions: word count targets, specific sections to emphasize, internal notes about this funder, etc.'),
};

interface PromptArgs {
  task_type: string;
  grant_requirements?: string | undefined;
  grant_url?: string | undefined;
  funder_name?: string | undefined;
  submission_format?: string | undefined;
  program_area?: string | undefined;
  grant_focus?: string | undefined;
  time_period?: string | undefined;
  additional_context?: string | undefined;
}

export function buildGrantWritingMessages(args: PromptArgs): GetPromptResult {
  const isProposal = args.task_type === 'proposal';
  const hasUrl = !!args.grant_url?.trim();
  const hasPastedReqs = !!args.grant_requirements?.trim();
  const submissionFormat = args.submission_format ?? 'auto';

  const funderClause = args.funder_name
    ? `The funder is **${args.funder_name}**.`
    : 'The funder name was not provided — extract it from the grant requirements or URL.';
  const programClause = args.program_area
    ? `Focus on **${args.program_area}**.`
    : 'Cover the organization holistically across all program phases.';
  const focusClause = args.grant_focus
    ? `The grant theme / focus area is: **${args.grant_focus}**.`
    : '';
  const periodClause = args.time_period
    ? `Time period: **${args.time_period}**.`
    : '';
  const extraClause = args.additional_context
    ? `\n\nAdditional instructions from the user:\n${args.additional_context}`
    : '';

  const taskLabel = isProposal ? 'GRANT PROPOSAL DRAFT' : 'FUNDER PERFORMANCE REPORT';

  const systemMessage = `You are a grant writer for Launchpad, a nonprofit workforce development program that helps young people in Philadelphia gain technology skills, industry certifications, employment, and postsecondary education. You write in a confident, evidence-driven, human voice — not bureaucratic or generic. You always use real data, never placeholder numbers.

You have access to Launchpad's live data through MCP tools. You MUST call these tools to gather real numbers before writing.

You also have web access. When given a URL, you MUST fetch and scrape it to extract grant requirements. When researching a funder, use web search to understand their mission, language, priorities, and past grantees.

## CRITICAL SAFETY RULES — NEVER VIOLATE THESE

1. **NEVER SUBMIT ANYTHING TO A FUNDER.** You produce drafts only. You MUST NOT send emails, submit web forms, upload documents, or take any action that transmits content to a funder or external party. The user MUST review, edit, and submit everything themselves. Every draft must end with a clear review prompt before any submission action.

2. **NEVER FABRICATE DATA.** If a data point is not available from the MCP tools, you MUST state that the data is unavailable and flag it with \`[DATA UNAVAILABLE: ...]\`. Do NOT estimate, extrapolate, round, or invent any number, statistic, or outcome. Fabricated data in a grant application puts the entire organization at risk of losing funding, credibility, and nonprofit status. When in doubt, leave it out and flag it.

3. **ALWAYS PRODUCE A REVIEW DOCUMENT FIRST.** Even when the submission method is a web form or email, your primary output is always a complete review document that the user reads and approves. Only after the user has reviewed and explicitly approved the content should you offer to help format it for the submission method (copying into form fields, formatting the email, etc.).`;

  // ── Step 0: Acquire grant requirements ──────────────────────────
  let acquireStep: string;
  if (hasUrl && hasPastedReqs) {
    acquireStep = `## Step 0: Acquire & Verify Grant Requirements

The user provided BOTH a URL and pasted requirements.

**Grant URL:** ${args.grant_url}
**Pasted requirements:**
\`\`\`
${args.grant_requirements}
\`\`\`

1. **Fetch the URL** — Scrape the grant opportunity page. Extract:
   - Full application questions and narrative prompts
   - Eligibility criteria
   - Deadline(s)
   - Award amount / range
   - Submission instructions and format (email, online form, document upload, portal)
   - Any downloadable application forms or templates linked on the page
   - Scoring criteria or review rubric if published
2. **Reconcile** — The pasted text may be a partial copy or supplementary notes. Use the URL as the authoritative source, but incorporate any details from the pasted text that aren't on the page.
3. **List what you found** — Before proceeding, output a structured summary of the requirements you extracted.`;
  } else if (hasUrl) {
    acquireStep = `## Step 0: Acquire Grant Requirements from URL

**Grant URL:** ${args.grant_url}

You MUST fetch this URL and thoroughly scrape the grant opportunity page. Extract:
- **Application questions** — Every narrative prompt, short-answer field, and required section
- **Eligibility criteria** — Who can apply, geographic restrictions, org size/type requirements
- **Deadline(s)** — Application due date, LOI date, reporting dates
- **Award amount** — Grant size, range, or total funding pool
- **Submission method** — How to submit (email address, online portal/form, document upload). Note the EXACT method.
- **Required attachments** — Budget templates, board lists, 501(c)(3) letters, financial statements
- **Scoring criteria / review rubric** — If published, these determine what to emphasize
- **Linked documents** — If the page links to a downloadable RFP, application form, or guidelines PDF, fetch those too
- **Contact information** — Program officer name, email, phone for questions

If the page requires multiple clicks (e.g., "Apply Now" leads to a form), follow those links and extract the full application structure.

**Output a structured summary** of everything you extracted before proceeding. Flag anything unclear with \`[UNCLEAR FROM PAGE: ...]\`.`;
  } else if (hasPastedReqs) {
    acquireStep = `## Step 0: Review Pasted Grant Requirements

The user pasted the following grant requirements:

\`\`\`
${args.grant_requirements}
\`\`\`

Review this text and identify all requirements, questions, and submission details. If the funder name, submission method, or deadline are not included, flag them with \`[NOT PROVIDED: ...]\`.`;
  } else {
    acquireStep = `## Step 0: Acquire Grant Requirements

**No requirements or URL were provided.** Before proceeding, ask the user to provide either:
1. A URL to the grant opportunity page, OR
2. The pasted text of the grant requirements/RFP

You cannot write an effective proposal without knowing what the funder is asking for. Do NOT proceed with a generic template.`;
  }

  // ── Submission format instructions ──────────────────────────────
  const submissionStep = `## Submission Format

${submissionFormat === 'auto' ? `**Auto-detect:** Based on the grant requirements or URL, determine the submission method:
- **Email submission** — Look for "email your application to..." or a submission email address
- **Web form / portal** — Look for "apply online", "submit through our portal", or form fields
- **Document upload** — Look for "upload your proposal as a PDF/Word document", "attach your narrative"

Once detected, state the submission method clearly and format the output accordingly (see formatting rules in the writing step).

If you cannot determine the method, default to **document upload** format and flag: \`[SUBMISSION METHOD: Could not determine — formatted as document. Please verify.]\`` : submissionFormat === 'email' ? `**Email submission.** Format the final output as an email-ready draft:
- Include a subject line
- Formal salutation (use program officer name if known)
- Body contains the narrative responses
- Attachments section listing what needs to be attached separately
- Professional closing` : submissionFormat === 'web_form' ? `**Web form submission.** Format the final output as field-by-field responses:
- Use the exact field labels/questions from the form
- Respect character/word limits per field
- Keep responses self-contained (each field may be read independently)
- Note any fields that require selections (dropdowns, checkboxes) vs. free text
- Flag file upload fields with what to attach` : `**Document upload submission.** Format the final output as a polished document:
- Include a cover page with project title, organization name, date, funder name
- Use the funder's required section headings (or standard proposal structure)
- Professional formatting with clear headers and page-break suggestions
- Note recommended file format (PDF preferred unless specified otherwise)`}`;

  // ── Funder research step ────────────────────────────────────────
  const funderResearchStep = `## Step 1: Research the Funder

Before gathering internal data, research the funding organization to understand their language, values, and priorities. This ensures the proposal speaks their language, not just ours.

${args.funder_name ? `**Funder:** ${args.funder_name}` : '**Funder:** (extract from the grant requirements or URL above)'}

### What to research:

1. **Mission & values** — Search the web for the funder's mission statement, about page, and annual report. Note their exact language for the issues they care about. Do they say "workforce development" or "economic mobility"? "Youth" or "young adults"? "Underserved" or "historically marginalized"? Mirror their terminology.

2. **Funding priorities & focus areas** — What do they fund? What are their current strategic priorities? Are they shifting focus areas? What's their theory of change?

3. **Past grantees** — Search for their recent grants. Have they funded organizations like Launchpad before? What types of programs do they favor? What grant sizes are typical?

4. **This specific grant program** — If this is a named grant program (not general operating support), research its history. How many awards per cycle? What were past winning projects?

5. **Key people** — Who is the program officer? Who reviews applications? Understanding the audience helps calibrate tone.

6. **Language patterns** — Note specific phrases, frameworks, or buzzwords the funder uses in their own materials. The proposal should use their vocabulary naturally — not as keyword stuffing, but as alignment.

### Output:
Produce a brief **Funder Intelligence Summary** (for internal use, not included in the final draft) covering:
- Funder's preferred language/terminology for key concepts
- Their top 3 stated priorities relevant to this proposal
- Notable past grants to similar organizations
- Any red flags or misalignments to navigate
- Recommended tone (e.g., "data-heavy and formal" vs. "story-driven and warm")`;

  // ── Internal data gathering step ────────────────────────────────
  const dataGatherStep = `## Step 2: Gather Internal Data

Call the following MCP tools to collect real organizational data. Make parallel calls where possible. **Prioritize data pulls that directly answer the funder's requirements.**

### Always pull (core organizational data):

**Past narratives & voice:**
- \`search_documents\` with query: "grant proposal" or "program description" or "narrative" — find past proposals and curated language to match the organization's voice.
${args.grant_focus ? `- \`search_documents\` with query: "${args.grant_focus}" — find content relevant to this proposal's theme.` : ''}
${args.funder_name ? `- \`search_documents\` with query: "${args.funder_name}" — find any past correspondence, proposals, or reports related to this funder.` : ''}

**Program scale & demographics:**
- \`query_enrollment\` with query_type "total" — current headcount.
- \`query_enrollment\` with query_type "by_phase" — breakdown by program phase.
- \`query_enrollment\` with query_type "by_race" — demographic diversity data.
${args.program_area ? `- \`query_enrollment\` with query_type "by_phase" filtered to "${args.program_area}" — phase-specific enrollment.` : ''}

**Outcomes & effectiveness:**
- \`query_certifications\` with query_type "summary" — overall pass rates and credential counts.
- \`query_certifications\` with query_type "by_type" — breakdown by certification type.
- \`query_employment\` with query_type "aggregate" — job placement rates, average wages, total earnings.
- \`query_employment\` with query_type "by_employer" — top employers (shows employer quality).
- \`query_postsecondary\` with query_type "summary" — college enrollment and graduation rates.

**Engagement:**
- \`query_attendance\` with query_type "aggregate" — overall attendance/engagement rates.

**Financials:**
- \`get_finance_brief\`${args.time_period ? ` with period matching "${args.time_period}"` : ''} — fund balances, recent gifts, revenue snapshot.
- \`query_finances\` with query_type "budget_actuals" — budget vs. actual for demonstrating fiscal discipline.
${isProposal ? `- \`query_finances\` with query_type "phase_budget_dashboard" — per-phase cost breakdowns for budget narrative.` : `- \`query_finances\` with query_type "ytd" — year-to-date financial performance.`}

### Pull if relevant to the funder's requirements:

${args.funder_name ? `**Funder relationship:**
- \`query_donors\` with query_type "profile" and donor_name "${args.funder_name}" — pull the funder's giving history, pipeline status, and relationship context.` : ''}

**Anecdotes & qualitative evidence** (pull if the funder asks for stories, impact examples, or testimonials):
- \`search_conversations\` with query: "${args.grant_focus ?? args.program_area ?? 'student success story'}" — pull team discussions, meeting notes with real anecdotes.
- \`search_documents\` with query: "student story" or "success" or "testimonial" — find compelling individual stories.

**Additional targeted pulls** — Based on your analysis of the funder's requirements, make additional tool calls for any specific data they request. For example:
- If they ask about a specific demographic, use \`query_enrollment\` with appropriate filters.
- If they ask about specific program phases, use \`query_enrollment\` filtered to that phase.
- If they want competency/skill development data, use \`query_competency\`.
- If they want year-over-year trends, make multiple time-filtered calls.`;

  // ── Analysis and writing steps ──────────────────────────────────
  const analysisStep = `## Step 3: Analyze the Requirements

Now that you have both funder intelligence and internal data, map them together:

1. **List every question/section** the funder requires — number each one
2. **Map data to requirements** — For each question, which data points and which funder language apply?
3. **Identify the strongest numbers** — The most compelling metrics for THIS funder's priorities
4. **Note terminology alignment** — Where the funder uses specific language, plan to mirror it
5. **Identify gaps** — Requirements you cannot answer with available data
6. **Select 1-2 student anecdotes** if available and if the funder values qualitative evidence
7. **Check word/character limits** — Note per-section limits and plan content density accordingly`;

  const writingStep = `## Step 4: Write the Draft

### Structure

${isProposal ? `**If the funder specifies a structure** (sections, questions, headings), use EXACTLY their structure. Number your responses to match their questions. Use their section headings.

**If the funder gives no specific structure**, use this default:

1. **Executive Summary** (1 paragraph) — Lead with the most compelling outcome stat. State who Launchpad is, who it serves, what it does, and what this grant would fund.
2. **Organization Background** — History, mission, enrollment, demographics.
3. **Statement of Need** — Community context, the gap this program addresses.
4. **Program Description** — Phases (Foundations -> 101 -> Lightspeed -> LiftOff), certifications, competency model.
5. **Goals & Measurable Outcomes** — Specific targets grounded in actual historical performance.
6. **Evaluation Plan** — How outcomes are tracked (real-time data infrastructure is a differentiator).
7. **Budget Narrative** — Actual cost-per-student, phase budgets, fund allocation.
8. **Sustainability** — Diversified funding, fiscal trajectory.` : `**If the funder provides a reporting template**, follow it exactly. Answer every field.

**If no template is provided**, use this default:

1. **Executive Summary** — Headline outcome, grant period, amount, what it funded.
2. **Program Activities** — What happened: enrollment, phases delivered, milestones.
3. **Outcomes Achieved** — Every measurable outcome with actual numbers vs. targets.
4. **Financial Report** — How grant dollars were spent. Budget vs. actual.
5. **Challenges & Lessons Learned** — Honest about difficulties. Funders respect transparency.
6. **Stories of Impact** — 1-2 individual student journeys.
7. **Looking Ahead** — What comes next.`}

### Output: Always a Review Document First

**Regardless of submission method, your primary output is a complete review document.** The user must read and approve every word before anything is submitted. Structure it clearly so the user can review efficiently.

At the end of the review document, include:

1. A **Submission Checklist** noting the submission method, deadline, required attachments, and any \`[DATA UNAVAILABLE]\` flags that need resolution.
2. A clear statement: **"This is a draft for your review. Please read carefully, make any edits, and confirm before submitting."**
3. Submission-specific formatting notes (below) so the user knows what the next step looks like.

### Submission-Specific Formatting Notes

Include these notes at the END of the review document to guide the user on next steps after they approve:

**If email submission:**
- Provide a suggested subject line, recipient address, salutation, and sign-off
- List all required attachments: \`[ATTACH: IRS determination letter]\`, \`[ATTACH: Board list]\`, etc.
- Note: "Once you have reviewed and finalized this draft, I can help you format it as an email ready to send."

**If web form:**
- Map each response to the corresponding form field label
- Note character/word limits per field
- For dropdown/checkbox fields: \`[SELECT: option name]\`
- For file upload fields: \`[UPLOAD: description of what to attach]\`
- Note: "Once you have reviewed and finalized these responses, I can help you walk through entering them into the form fields."

**If document upload:**
- Note recommended formatting: cover page, section headers, page breaks
- Suggest file format (PDF preferred unless funder specifies otherwise)
- Note: "Once you have reviewed and finalized this draft, copy it into Word or Google Docs, format it, and export as PDF for upload."

**REMINDER: Do NOT send, submit, or upload anything. The user handles all submissions.**

### Writing Rules

- **Use the funder's language.** Mirror the terminology from your funder research. If they say "economic empowerment," don't write "job placement." If they say "BIPOC youth," don't write "underserved populations."
- **Answer every question the funder asks.** Do not skip any. If you lack data, flag it with \`[DATA UNAVAILABLE: ...]\`.
- **Respect word/character limits.** If the funder says 500 words for a section, stay under 500.
- **ONLY use real numbers from the tool results.** If a tool returned the number, use it. If it didn't, do NOT write a number — write \`[DATA UNAVAILABLE: description]\` instead. Never estimate, round from memory, or use phrases like "approximately" or "nearly" to disguise a guess. Every statistic in this document must be traceable to a specific tool call.
- **Write in active, confident voice.** Not "students were provided with opportunities" but "students earned certifications, secured jobs, and enrolled in college."
- **Cite metrics naturally.** "Of the 142 students enrolled this year..." not "According to our database..."
- **Be specific about the program model.** Launchpad's phased approach is distinctive — use it.
- **Match the organization's existing voice.** If you found past proposals in the document search, mirror their tone and style — but adapt it to this funder's language.
- **Flag data gaps prominently.** Use \`[DATA UNAVAILABLE: description of what's missing and which tool was checked]\` so the team knows exactly what to fill in and where to find it. Collect all flags into a summary list at the end.
- **Lead with what the funder cares about.** If their scoring criteria weight outcomes at 40%, make outcomes your strongest section.

### Final Checklist

After writing, verify:
- [ ] Every funder question is answered
- [ ] ALL numbers come from actual tool results — zero fabricated data points
- [ ] Every \`[DATA UNAVAILABLE]\` flag includes which tool was checked and what was missing
- [ ] Word/character limits are respected
- [ ] Funder's terminology is used consistently
- [ ] Submission method and formatting notes are included
- [ ] All \`[DATA UNAVAILABLE]\`, \`[ACTION NEEDED]\`, and \`[ATTACH]\` flags are collected into a summary list at the end
- [ ] Deadline is noted: \`[DEADLINE: date]\`
- [ ] Draft ends with: **"This is a draft for your review. Please read carefully, make any edits, and confirm before submitting."**
- [ ] NOTHING has been sent, submitted, or uploaded to any external party`;

  const userMessage = `# Task: ${taskLabel}

${funderClause}
${programClause}
${focusClause}
${periodClause}
${extraClause}

---

${acquireStep}

---

${submissionStep}

---

${funderResearchStep}

---

${dataGatherStep}

---

${analysisStep}

---

${writingStep}`;

  return {
    messages: [
      { role: 'assistant', content: { type: 'text', text: systemMessage } },
      { role: 'user', content: { type: 'text', text: userMessage } },
    ],
  };
}

export function registerGrantWritingPrompt(server: McpServer): void {
  server.registerPrompt(NAME, { description: DESCRIPTION, argsSchema: grantWritingArgsSchema }, (args) => {
    return buildGrantWritingMessages(args);
  });
}
