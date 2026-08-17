/**
 * figures.ts — the frozen-figure verification work order.
 *
 * ## The problem this solves
 *
 * `kb_launchpad.json` answers carry a `verified` flag, but only 4 of 29 are `verified:false`. The
 * other 25 are `verified:true` — meaning "grounded in filed application material" — and are full of
 * figures that have since moved. So `verified` is the wrong axis for staleness: it fires on
 * `kb.docs`, which contains no figures at all, and stays silent on `kb.metrics`, which contains
 * five.
 *
 * Measured on 2026-07-27, total participant wages:
 *
 * | source                                            | figure       |
 * |---------------------------------------------------|--------------|
 * | filed William Penn narrative (in `kb.metrics`)    | $350,268     |
 * | KB's own reconciliation note (2026-07-23)         | $360,487     |
 * | live connector, `query_employment` aggregate      | $362,030.26  |
 *
 * Roughly $1,500 of drift every four days. Publishing the KB figure in an August application would
 * understate LaunchPad's outcomes by ~$12,000.
 *
 * ## Why this is a lookup and not a fetch
 *
 * This module returns the exact `query_*` call to run; it never runs one. `runTool`'s permission
 * check keys on the INBOUND tool name, so a grant tool that read the database internally would be
 * authorised as itself rather than as `query_finances` — laundering finance and donor data past the
 * classifier. The KB's own reconciliation note records that `query_finances` and `query_donors` are
 * blocked in some modes. Keeping the calls in the caller's hands means each one is ACL-checked and
 * usage-logged under its own name, per person.
 *
 * ## Drift versus definitional conflict
 *
 * A drift conflict resolves to the connector by recency. A DEFINITIONAL conflict does not resolve
 * automatically and must reach a person: "145 served" and "301 records" are both true of different
 * populations, and a 92% certification pass rate (per cohort) and 54.2% (all-time) are both true of
 * different denominators. Picking one silently would be the most damaging thing this layer could do.
 */

import { loadKnowledgeBase } from './data.js';
import type { KnowledgeBase } from './schemas.js';

export type FigureSeverity = 'high' | 'medium' | 'low';
export type ConflictKind = 'drift' | 'definitional' | 'content_gap' | 'unknown';

export interface FigureCheck {
  readonly key: string;
  /** The claim as it appears in the KB, so a reviewer can find it in the text. */
  readonly claim: string;
  /** KB slots whose text carries this claim. */
  readonly appears_in: readonly string[];
  /** The MCP tool to call. */
  readonly tool: string;
  /** Arguments to call it with, verbatim. */
  readonly args: Readonly<Record<string, string>>;
  /**
   * The population {@link args} actually returns, stated so a caller can compare it against what the
   * funder asked.
   *
   * Added 2026-08-17 (work package #275) after a peer session named the failure it prevents, which the
   * slot mechanism made worse rather than better. `args` is fixed at authoring time; the correct cut
   * depends on the question. `students_served_total` carries `query_type: 'total'`, which returns every
   * enrollment record ever — and TDJF, Philadelphia Foundation and Upwork all asked, in this batch, how
   * many young people were served *in the past twelve months*. A caller following the fill instruction
   * gets a live figure, correctly dated, and wrong, with nothing anywhere flagging it. **A live wrong
   * number is worse than a stale one**, because staleness has a warning attached and this does not.
   *
   * So the population is data rather than prose, and `slots.ts` puts it in front of the caller beside
   * the call. The rule it enables is the important part: **if the question's population differs from
   * this one, the stored sentence does not answer the question.** Not "fill it with a different cut" —
   * the sentence asserts its own population in its own wording ("young people served to date"), so a
   * twelve-month number dropped into it produces a sentence that is false about a true figure. The
   * honest outcome is to say the stored answer does not cover the ask.
   *
   * `.claude/skills/grant-writing/references/figure-cuts.md` holds the question-shape-to-cut catalogue,
   * including the cuts that do not exist. This field is not a substitute for it; it says what THIS call
   * returns, so a mismatch is visible without consulting anything.
   */
  readonly population: string;
  readonly conflict_kind: ConflictKind;
  readonly severity: FigureSeverity;
  readonly note: string;
}

/**
 * Every `tool` and `query_type` below is checked against the live enums in
 * `apps/mcp-server/src/tools/`. `phase_budget_dashboard` is the real value; `phase_budget_summary` is
 * not in the enum.
 *
 * **Both halves of what this comment used to say were wrong, and the correction matters.** It said
 * three shipped prompt files still said `phase_budget_summary` and that the bad value "silently returns
 * zero rows". Reported by a peer session on 2026-08-17: all five occurrences across
 * `apps/mcp-server/src/prompts/{grant-writing,board-reporting,finance-audit}.ts` are fixed, and the bad
 * value fails **loudly** — `MCP error -32602 invalid_enum_value`, listing all 29 valid options. That
 * inverts the risk. "Silently returns zero rows" describes a figure quietly reported as zero, which is
 * the dangerous failure; a loud rejection is the safe one, and what it actually broke was a board report
 * or finance audit erroring out at the phase-cost step. Not re-verified here — the peer ran the call.
 */
export const FIGURE_CHECKS: readonly FigureCheck[] = [
  {
    key: 'employment_earnings_total',
    claim: '$350,268 total wages paid to 45 participants across 88 jobs; $229,000+ documented alumni wages',
    // kb.theory_of_change and kb.capacity added 2026-08-11: both carry the $229,000+ alumni-wage
    // restatement of the same underlying aggregate, and the same query_employment call settles all
    // three. kb.capacity was found by the `figure_claim_uncovered` check rather than by reading.
    appears_in: ['kb.metrics', 'kb.outcomes', 'kb.theory_of_change', 'kb.capacity'],
    tool: 'query_employment',
    args: { query_type: 'aggregate' },
    population:
      "Every participant employment record ever written — all phases, all statuses, all time. An all-time aggregate, NOT a period total.",
    conflict_kind: 'drift',
    severity: 'high',
    note:
      'Confirmed drifting: the connector reported $360,487 on 2026-07-23 and $362,030.26 on ' +
      '2026-07-27. Always quote the live figure.',
  },
  {
    key: 'students_served_total',
    claim: '~145 young people served',
    // kb.metrics added 2026-08-10: program.jobs_and_participants routes there, and a metrics-only
    // draft otherwise lost the live query_enrollment call, leaving only the definitional flag.
    appears_in: ['kb.capacity', 'kb.history', 'kb.metrics'],
    tool: 'query_enrollment',
    args: { query_type: 'total' },
    population:
      "Every enrollment record ever — all phases, all statuses, all time. The widest possible cut, and rarely what a funder asked for.",
    conflict_kind: 'definitional',
    severity: 'high',
    note:
      'The connector holds 301 enrollment records against the applications\' ~145 served. Both are ' +
      'true of different populations ("meaningfully participated" vs. every record). Do NOT ' +
      'auto-resolve — ask which population this funder is asking about, and pair with ' +
      'query_students breakdown by enrollment_status.',
  },
  {
    key: 'cert_pass_rate',
    // Corrected 2026-08-11: this read '92% certification pass rate'. No KB slot says that. The 92%
    // in kb.metrics and kb.capacity is the CohortÂ 1 paid-work rate (11 of 12 at six months) and now
    // belongs to `placement_rate` below; the certification claim is the PCEP range. A reviewer sent
    // to find "92% certification pass rate" in kb.metrics finds a 92% that means something else,
    // which is the confident-wrong-figure failure this module exists to prevent.
    claim: 'PCEP pass rates 70–100% per cohort; 100% in the most recent cohort',
    appears_in: ['kb.metrics', 'kb.outcomes'],
    tool: 'query_certifications',
    args: { query_type: 'summary' },
    population:
      "All certification attempts ever recorded, every cohort pooled. An all-time rate, not a per-cohort one.",
    conflict_kind: 'definitional',
    severity: 'high',
    note:
      'All-time PCEP is 32/59 = 54.2%; the applications quote per-cohort rates. Different ' +
      'denominators, both defensible. State which one you are quoting, in the sentence itself.',
  },
  {
    key: 'annual_budget',
    claim: '$1.34M FY2025 expenses; $1.68M FY2026 projected revenue',
    // kb.eligibility added 2026-08-11: both its prose and its `eligibility.budget_size` structured
    // value quote $1.34M, so an eligibility-only draft published the frozen budget figure with no
    // verification step.
    appears_in: ['kb.financials', 'kb.budget_narrative', 'kb.eligibility'],
    tool: 'query_finances',
    args: { query_type: 'annual' },
    population:
      'The annual finance tab: FY2025 actual through FY2028 projected. Name the fiscal year the ' +
      'question asked about — and **do not quote a FY2026 figure as a fiscal-year amount.** Reported ' +
      '2026-08-17 by a peer session, from the ledger\'s own hedge: `budget_actuals` returns the YTD row ' +
      'with `actuals` and `fy_actual_projected` BOTH equal to $1,734,075.87, and the Annual tab\'s ' +
      'column is `fy_2026_actual_projected`. The source fuses actual-to-date with full-year projection ' +
      'and nothing separates them, so "our FY2026 budget was X" is the wrong answer to the question ' +
      'asked. FY2025 is a clean `fy_2025_actual`. Flag [STAFF CONFIRM] on any current-year figure. ' +
      'Separately open (`grant-a54`): no live total matches the KB\'s former $1.34M FY2025 expenses — ' +
      'the closest is Total *Administrative* Expenses at $1,394,055.02, a narrower measure.',
    conflict_kind: 'drift',
    severity: 'high',
    note:
      'Corrected 2026-08-17 (work package #275, from a peer session\'s finding): this named ' +
      'get_finance_brief, on the reasoning that query_finances "may be denied by the role ACL". That ' +
      'traded a tool that might be refused for one that cannot answer at all — get_finance_brief ' +
      'returns aplos fund rows, an account COUNT, recent transactions, fund balances and recent gifts, ' +
      'and no income or expense total anywhere. query_finances(annual) is what holds these. If the ACL ' +
      'refuses it, flag [DATA UNAVAILABLE]; do not fall back to get_finance_brief and read a total that ' +
      'is not there.',
  },
  {
    key: 'enrollment_by_phase',
    claim: 'Program phases: Foundations, 101, LiftOff',
    appears_in: ['kb.programs', 'kb.program_desc'],
    tool: 'query_enrollment',
    args: { query_type: 'by_phase' },
    population:
      "Enrollment counts per phase by status (Completed / In Progress / Dropped Before Completion / Not Enrolled), all time. Participants appear in every phase they touched, so these do NOT sum to a participant total.",
    conflict_kind: 'content_gap',
    severity: 'high',
    note:
      'The platform records a Lightspeed phase that the KB program descriptions omit entirely, so a ' +
      'drafted program description built only from the KB is missing a phase. Queried 2026-08-11 — ' +
      'Lightspeed is a 7-week summer intensive, run twice: 2024-07-01 to 2024-08-19 (7 completers) ' +
      'and 2025-07-07 to 2025-08-27 (8), 15 of 15 completing and none dropping. 14 of the 15 sat ' +
      'PCEP and all 14 passed. Do NOT describe it as a linear stage between 101 and LiftOff: it ' +
      'runs in the summer gap between school years, no student has it as current_phase, and its ' +
      'completers show up later under LiftOff and Alumni. For the roster, by_phase gives only the ' +
      'counts and by_student cannot filter by phase at all (see the filter caveat in CLAUDE.md §4). ' +
      'This note used to send you to query_enrollment active_during for it. **Do not rely on that ' +
      'until OpenProject #278 is settled** — a peer session reports active_during matching only ' +
      'records with a non-null end_date, which would silently drop every In Progress record. ' +
      'Unverified here; #278 owns it.',
  },
  {
    key: 'prior_funding_wpf',
    claim: '$1.5M three-year William Penn grant from 2023, ending 6/30/26',
    appears_in: ['kb.sustainability'],
    tool: 'query_donors',
    args: { query_type: 'profile', donor_name: 'William Penn Foundation' },
    population:
      "Every recorded gift and grant from one named donor, all time.",
    conflict_kind: 'drift',
    severity: 'high',
    note: 'query_donors may be ACL-denied; fall back to get_finance_brief and flag if unavailable.',
  },
  {
    key: 'demographics_race',
    claim: '85% / 90% / 100% demographic shares',
    // Four slots added 2026-08-11. The same shares are restated across the corpus, and only two
    // slots declared them, so a draft built from any of the others published them unverified.
    appears_in: [
      'kb.dei',
      'kb.profile.demographics',
      'kb.need',
      'kb.target_population',
      'kb.metrics',
      'kb.eligibility',
    ],
    tool: 'query_enrollment',
    args: { query_type: 'by_race' },
    population:
      "Race and ethnicity across all enrollment records, all time. Values are free-text and multi-category — decide whether you are counting 'names this category at all' or 'this category alone', and say which.",
    conflict_kind: 'drift',
    severity: 'medium',
    note: 'Recompute from the connector; percentages move with each cohort.',
  },
  {
    key: 'employment_wage_range',
    claim: '$15,000–$35,000 earned; ~$20/hr',
    // Four slots added 2026-08-11: kb.outcomes carries the $15,000/$35,000 pair verbatim, and the
    // $20/hour client-work rate is restated in kb.programs, kb.budget_narrative and
    // kb.management_plan.
    appears_in: [
      'kb.metrics',
      'kb.program_desc',
      'kb.uniqueness',
      'kb.outcomes',
      'kb.programs',
      'kb.budget_narrative',
      'kb.management_plan',
    ],
    tool: 'query_employment',
    args: { query_type: 'aggregate' },
    population:
      "Every participant employment record ever written — all phases, all statuses, all time.",
    conflict_kind: 'drift',
    severity: 'medium',
    note: 'The same aggregate call returns avg_hourly_wage and avg_weekly_hours.',
  },
  {
    key: 'top_employers',
    claim: '17 employer partners / 20 employers',
    // kb.theory_of_change and kb.risk added 2026-08-11: both lean on "17+ partners" — the risk
    // narrative uses it as the mitigation for employer dependence, so a stale count there
    // understates a stated control.
    appears_in: ['kb.partnerships', 'kb.theory_of_change', 'kb.risk'],
    tool: 'query_employment',
    args: { query_type: 'by_employer' },
    population:
      "Every employer with at least one recorded placement, all time.",
    conflict_kind: 'drift',
    severity: 'medium',
    note: 'Two different counts appear in the KB; the connector settles it.',
  },
  {
    key: 'inc_client_work_booked',
    claim: '$75,000 in client work booked in July 2026 alone (Barra Launchpad Inc overview, ~1/3 of the full-year target); ' +
      // The range is written out as $50K-$80K, not $50-80K: the extractor reads a shared trailing
      // suffix as belonging to the second number only, so the abbreviated form tokenizes to a bare
      // `$50` — two orders of magnitude off, and generic enough to match unrelated prose.
      'two clients with hiring intent in writing at $50K-$80K',
    appears_in: ['kb.sustainability', 'kb.innovation'],
    tool: 'query_finances',
    args: { query_type: 'fund_balances', contains: 'Total Income' },
    population:
      'Income by fund, including the `launchpad_inc` fund column. FUND INCOME IS NOT BOOKINGS — it is ' +
      'money recognised against that fund, not client work contracted. The two answer different ' +
      'questions and the prose usually asks the second.',
    conflict_kind: 'drift',
    severity: 'medium',
    note:
      'Newest approved org overview (Barra, Jul 2026) introduces Inc. revenue and hiring-intent claims ' +
      'the KB and its previous checks do not carry. **No query_* tool returns Inc. client bookings ' +
      'directly** — still true. Retargeted twice on 2026-08-17 (work package #275): first from ' +
      'get_finance_brief, which returns no revenue figure at all despite being described here as "the ' +
      'closest revenue signal", then to this call rather than query_finances(annual). The second move ' +
      'came from reading our own record: `docs/runs/2026-08-11/filled/FIGURE-LEDGER.md` line 32 had ' +
      'already found the closest live figure on 2026-08-14 — the `launchpad_inc` fund column carries ' +
      'Total Income $305,000.00 — and marked it PARTIAL for exactly the reason above. Treat it as a ' +
      'floor and a different measure, not as the booked figure. If the prose asks for bookings, flag ' +
      '[DATA UNAVAILABLE].',
  },
  {
    key: 'program_size_reach',
    claim: 'more than 200 young Philadelphians through programming to date; "about 145 served"',
    appears_in: ['kb.capacity', 'kb.history', 'kb.metrics'],
    tool: 'query_enrollment',
    args: { query_type: 'total' },
    population:
      "Every enrollment record ever — all phases, all statuses, all time.",
    conflict_kind: 'definitional',
    severity: 'high',
    note:
      'The Barra Jul 2026 overview says 200+ "came through programming"; KB says ~145 "served"; the connector ' +
      'holds 301 records. Three populations, three definitions — do NOT auto-resolve. Ask which population this ' +
      'funder means and state it in the sentence.',
  },
  {
    key: 'phase_costs',
    claim: '$519K / $455K / $362K per phase; ~$6,000 per participant stipend floor',
    // Three slots added 2026-08-11: the $6,000 stipend floor is quoted as a programme feature in
    // kb.programs, kb.program_desc and kb.uniqueness, not only as a budget line.
    appears_in: [
      'kb.budget_narrative',
      'kb.financials',
      'kb.programs',
      'kb.program_desc',
      'kb.uniqueness',
    ],
    tool: 'query_finances',
    args: { query_type: 'phase_budget_dashboard' },
    population:
      'The phase budget dashboard tab as the connector last synced it (163 rows on 2026-08-14). ' +
      '**Its shape is not the KB sentence\'s shape.** The tab breaks out `hs` and `liftoff` against a ' +
      '`total_launchpad`; the stored prose splits Launchpad 101 / LiftOff / shared administrative cost. ' +
      'So `{{cost_shared_admin}}` is a RESIDUAL you compute — total_launchpad minus hs minus liftoff — ' +
      'not a column you read, and `{{phase_cost_101}}` is the `hs` column under a different name. Say ' +
      'which you did.',
    conflict_kind: 'drift',
    severity: 'medium',
    note:
      'Note the query_type is phase_budget_dashboard. phase_budget_summary is not a valid value and is ' +
      'rejected with invalid_enum_value rather than returning an empty result — see the header comment ' +
      'on FIGURE_CHECKS for the correction to what this note used to claim.',
  },
  {
    key: 'revenue_mix',
    claim: '60% / 25% / 10% / 5% revenue mix',
    appears_in: ['kb.sustainability'],
    tool: 'query_finances',
    args: { query_type: 'annual' },
    population:
      "The annual finance tab, FY2025 actual through FY2028 projected. Name the fiscal year.",
    conflict_kind: 'drift',
    severity: 'medium',
    note:
      'Sustainability narratives quote this mix; confirm before repeating it. Retargeted from ' +
      'get_finance_brief 2026-08-17 for the reason in the annual_budget note — a revenue mix needs ' +
      'revenue totals, and that tool returns none.',
  },
  {
    key: 'postsecondary_rate',
    claim: '(absent from the knowledge base)',
    appears_in: [],
    tool: 'query_postsecondary',
    args: { query_type: 'summary' },
    population:
      "Students with a National Student Clearinghouse record, all time.",
    conflict_kind: 'content_gap',
    severity: 'medium',
    note:
      'The connector holds 67 students with National Student Clearinghouse records, 3 graduated. ' +
      'No KB slot covers postsecondary outcomes, so any funder asking about them needs live data.',
  },
  {
    key: 'attendance_rate',
    claim: '(absent from the knowledge base)',
    appears_in: [],
    tool: 'query_attendance',
    args: { query_type: 'aggregate' },
    population:
      "All attendance records, all phases, all time.",
    conflict_kind: 'content_gap',
    severity: 'medium',
    note: 'No KB slot covers attendance. Pull live if asked.',
  },
  {
    key: 'competency_growth',
    claim: 'Competency growth described qualitatively',
    appears_in: ['kb.evaluation'],
    tool: 'query_competency',
    args: { query_type: 'scores' },
    population:
      "Competency scores. **Reported truncated at 1000 rows against roughly 2346 in the table** (peer session finding, 2026-08-17, unverified here) — so a single call is a partial slice and an org-wide figure computed from one is wrong.",
    conflict_kind: 'drift',
    severity: 'low',
    note: 'The evaluation narrative is qualitative; live scores can make it concrete.',
  },
  {
    key: 'placement_rate',
    // Added 2026-08-11. The paid-work rate was the most-quoted outcome in the corpus and had no
    // check at all: `cert_pass_rate` claimed the 92%, but 92% is 11 of 12 in paid work, not a
    // certification result. Four slots restate some form of it and none had a verification path.
    claim:
      '11 of 12 (92%) in paid work or training at six months; 100% in paid work now; ' +
      '95% of Launchpad 101 graduates to college, training or work',
    appears_in: ['kb.metrics', 'kb.outcomes', 'kb.capacity', 'kb.theory_of_change'],
    tool: 'query_employment',
    args: { query_type: 'aggregate' },
    population:
      "Participant and job counts, all time. No cohort placement rate exists in any tool: the denominator comes from query_enrollment and the cohort window is yours to state.",
    conflict_kind: 'unknown',
    severity: 'high',
    note:
      'No query_* tool returns a cohort placement rate directly — query_employment aggregate gives ' +
      'the participant and job counts, and the denominator has to come from query_enrollment. The ' +
      'cohort framing ("Cohort 1 at six months") is also a moving window: "100% in paid work now" ' +
      'is dated by whenever "now" was. Confirm both the numerator and the as-of date, or write ' +
      '[DATA UNAVAILABLE].',
  },
  {
    key: 'staff_count',
    claim: '15 staff / 9 staff',
    appears_in: ['kb.staff_bios'],
    tool: 'search_documents',
    args: { query: 'org chart staff roster' },
    population:
      "Whatever documents match the query string. Not a roster, and not a count.",
    conflict_kind: 'unknown',
    severity: 'medium',
    note:
      'No query_* tool covers headcount, and the KB states two different numbers. If the document ' +
      'search does not settle it, write [DATA UNAVAILABLE] rather than picking one.',
  },
];

/** Detects a numeric claim: currency, percentage, or a multi-digit / spelled-out quantity. */
const NUMERIC_CLAIM = /\$[\d,]+|\d+(?:\.\d+)?\s?%|\b\d{2,}\b/;

/**
 * The three number questions whose answer is a LIVE figure, never a frozen KB value. Each maps to
 * the FIGURE_CHECK that names the exact `query_*` call. `buildAnswer` returns these as the
 * `fetch_figure` status, and the caller runs the call under its own name (TAD decision 3). A static
 * KB number for these would ship a figure that has already drifted — the failure figures.ts exists
 * to prevent. DECISIONS.md D1b.
 *
 * Absence from this map means a number question keeps the normal path.
 */
export const QUESTION_FIGURE_CHECKS: Readonly<Record<string, string>> = {
  'cover.budget_totals': 'annual_budget',
  'financials.operating_budget': 'annual_budget',
  'program.jobs_and_participants': 'students_served_total',
};

/** {@link QUESTION_FIGURE_CHECKS} resolved to the check object, keyed by question id. */
export function figureCheckForQuestion(questionId: string): FigureCheck | undefined {
  const key = QUESTION_FIGURE_CHECKS[questionId];
  if (key === undefined) return undefined;
  return FIGURE_CHECKS.find((c) => c.key === key);
}

export function containsNumericClaim(text: string): boolean {
  return NUMERIC_CLAIM.test(text);
}

/**
 * A whole numeric value, for extraction. Deliberately NOT {@link NUMERIC_CLAIM}.
 *
 * The two patterns answer different questions and need different precision. `NUMERIC_CLAIM` asks "are
 * there figures in here at all" — a coarse trigger for the live-verification warning, where matching
 * part of a number is as good as matching all of it. This asks "which values", where matching part of
 * a number is a defect: `\b\d{2,}\b` does not span a thousands comma, so `8,000` yields `000`, and a
 * rewrite that moved it to `9,000` would compare equal and pass. Comma-grouped counts are the most
 * common figure shape in grant prose — `8,000 students`, `1,200 hours` — so that miss would cover most
 * of what a resize could get wrong.
 *
 * Branch order is load-bearing: currency first (it may carry both a comma and a decimal), then
 * comma-grouped, then percentage, then any remaining bare number. A single-digit bare number is
 * included, unlike in `NUMERIC_CLAIM` — "2 campuses" becoming "5 campuses" is a fact change, and the
 * only place a lone digit is noise is when it was never a claim to begin with.
 */
const NUMERIC_VALUE = /\$\s?\d[\d,]*(?:\.\d+)?|\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?\s?%|\d+(?:\.\d+)?/g;

/**
 * Every numeric value in a text, normalised for comparison.
 *
 * Added at G4 for `resize.ts`, which compares a rewrite's figures against its source to catch an
 * invented one. Normalisation strips `$`, `%`, commas, and inner whitespace, so `$1,200`, `1,200`, and
 * `1200` all compare equal. That is deliberate: the check exists to catch a figure that was not in the
 * source at all, not to police formatting, and rule 2 of the resize guardrail lets a rewrite reformat
 * what it keeps.
 *
 * **What it does not catch.** A magnitude suffix is not part of the token, so `$1.34M` normalises to
 * `1.34` — a rewrite restating it as `$1.34B` reads as the same value. Catching that needs unit
 * awareness rather than a wider pattern, and the figure work order in this same module is what covers
 * a wrong magnitude: every figure has to be confirmed against a live `query_*` call before publishing
 * regardless of what this check said. Recorded here so the gap is known rather than assumed away.
 */
export function extractNumericClaims(text: string): string[] {
  const matches = text.match(NUMERIC_VALUE) ?? [];
  return matches.map((m) => m.replace(/[$%,\s]/g, ''));
}

/**
 * Currency amounts inside a {@link FigureCheck.claim}, with their magnitude suffix attached.
 *
 * Feeds the `figure_claim_uncovered` integrity check in `data.ts`, which asks the inverse of
 * `figure_check_ref_dangling`: not "does every declared slot exist" but "does every slot carrying
 * this claim get declared". An undeclared slot is invisible — `buildFigureWorkOrder()` scopes by
 * `appears_in`, so a draft built from that slot alone publishes the frozen figure with no
 * verification item and no warning.
 *
 * **Currency only, on purpose.** Percentages and bare counts are not distinctive enough to scan on.
 * Measured against the 2026-08-11 corpus, `100%` matches the certification rate, the free-and-
 * reduced-lunch share, and the current paid-work rate — three unrelated claims; `60%` matches both
 * the revenue mix and "40–60% administrative time savings". Every one of those is a false positive,
 * and a check that cries wolf on a third of the corpus gets ignored. Currency tokens produced zero
 * false positives on the same corpus. The trade is real and recorded: a percentage-only claim gets
 * no coverage check, and `appears_in` for those is maintained by hand.
 *
 * The suffix is part of the token because `$1.34M` and `$1.34` are different figures — the same gap
 * {@link extractNumericClaims} documents for the resize guardrail, closed here because a check on
 * whole claims can afford to be strict.
 *
 * The `(?![A-Za-z])` after the suffix is load-bearing. Without it, `$500,000 Kresge grant` tokenizes
 * to `$500,000 K` — a token no KB text contains, so the claim silently loses its coverage check
 * entirely, which is the failure this whole check exists to prevent.
 */
const CLAIM_CURRENCY = /\$\s?\d[\d,]*(?:\.\d+)?(?:\s?[MKB](?![A-Za-z]))?/g;

export function extractCurrencyClaims(text: string): string[] {
  return [...new Set((text.match(CLAIM_CURRENCY) ?? []).map((m) => m.trim()))];
}

/**
 * Does `text` state `token` as a whole figure?
 *
 * The boundaries are what make the coverage check usable: a plain `includes` treats `$50` as present
 * in `$50,000` and `$1.34` as present in `$1.34M`, which on the 2026-08-11 corpus turned 8 real
 * findings into 40. The lookahead rejects a longer number continuing to the right; the lookbehind
 * rejects one continuing to the left.
 *
 * Three ways a figure continues to the right, all rejected: more digits (`$20` in `$20,000`), a
 * decimal (`$20` in `$20.50`), and a magnitude suffix (`$1.34` in `$1.34M`, `$1.34 M`). The decimal
 * arm is `\.\d`, not a bare `.`, so a token ending a sentence — `costs $50K.` — still matches. The
 * suffix arm carries the same `(?![A-Za-z])` as {@link CLAIM_CURRENCY} so `$50 Kresge` does not read
 * as `$50K`.
 */
export function statesFigure(text: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `(?<![\\d.,])${escaped}(?![\\d,]*\\d|\\.\\d|\\s?[MKB](?![A-Za-z]))`,
  ).test(text);
}

export interface FigureWorkOrder {
  readonly policy: string;
  readonly kb_snapshot_date: string;
  readonly items: readonly FigureCheck[];
  readonly definitional_conflicts: readonly string[];
  readonly blocked: readonly { readonly tool: string; readonly reason: string }[];
}

/**
 * Restated 2026-08-17, work package #275. The old wording — "do not publish any figure until the
 * paired call confirms it" — was the right instruction and was unenforceable, because the figure it
 * described was sitting inside the stored sentence. An instruction not to publish a number that is
 * already written into the answer is a request to remember something under deadline.
 *
 * The corpus now stores language only: a figure with a live source is a `{{slot}}`, and `pipeline.ts`
 * refuses to return slotted text as an answer at all. So this policy stops asking for diligence and
 * starts describing what the mechanism does. The `claim` strings below are kept deliberately — they are
 * the last recorded value of each figure, which is what makes a drift conflict legible ("the filed
 * application said $350,268") without any of them being what a draft publishes.
 */
const POLICY =
  'Committed artifacts store LANGUAGE ONLY. Every figure with a live source is a {{slot}} in the ' +
  'stored text, filled from the call named for it; a draft with an unfilled slot is not an answer and ' +
  'the tools will not return it as one. The `claim` values below are the last recorded figure, kept so ' +
  'a conflict is legible — they are NOT publishable. On a drift conflict the connector wins. A ' +
  'DEFINITIONAL conflict is not auto-resolved: run the call, then escalate to staff with both numbers ' +
  'and their definitions. If a tool is denied by your role, leave the slot unfilled and say which one ' +
  '— do not substitute a frozen figure, and do not delete the sentence to hide the gap.';

/**
 * Build the verification work order for a set of KB slots.
 *
 * Pass the slots a draft actually uses and the result is scoped to the figures that draft can get
 * wrong; pass nothing for the whole map.
 */
export function buildFigureWorkOrder(kbRefs?: readonly string[]): FigureWorkOrder {
  const kb: KnowledgeBase = loadKnowledgeBase();
  const wanted = kbRefs === undefined ? null : new Set(kbRefs);

  const items = FIGURE_CHECKS.filter((check) => {
    if (wanted === null) return true;
    // Content gaps have no `appears_in`; they are relevant when nothing covers them, so they are
    // only included in the unscoped map.
    return check.appears_in.some((ref) => wanted.has(ref));
  });

  return {
    policy: POLICY,
    kb_snapshot_date: kb.meta.updated,
    items,
    definitional_conflicts: items
      .filter((i) => i.conflict_kind === 'definitional')
      .map((i) => i.key),
    blocked: [
      {
        tool: 'query_finances',
        reason:
          'May be denied by the role ACL (sensitive finance data). There is NO fallback for a total: ' +
          'get_finance_brief returns fund rows, an account count, transactions, balances and gifts, and ' +
          'no income or expense total. If this is denied, leave the slot unfilled and say so. Corrected ' +
          '2026-08-17 — this used to name get_finance_brief as the fallback.',
      },
      {
        tool: 'query_donors',
        reason:
          'May be denied by the role ACL (donor PII). get_finance_brief carries recent gifts and may ' +
          'settle a specific grant; it will not settle a donor profile. Leave the slot unfilled rather ' +
          'than approximating.',
      },
    ],
  };
}
