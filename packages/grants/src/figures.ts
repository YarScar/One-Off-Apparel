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
  readonly conflict_kind: ConflictKind;
  readonly severity: FigureSeverity;
  readonly note: string;
}

/**
 * Every `tool` and `query_type` below is checked against the live enums in
 * `apps/mcp-server/src/tools/`. `phase_budget_dashboard` in particular is the real value — three
 * shipped prompt files still say `phase_budget_summary`, which is not in the enum and silently
 * returns zero rows.
 */
export const FIGURE_CHECKS: readonly FigureCheck[] = [
  {
    key: 'employment_earnings_total',
    claim: '$350,268 total wages paid to 45 participants across 88 jobs',
    appears_in: ['kb.metrics', 'kb.outcomes'],
    tool: 'query_employment',
    args: { query_type: 'aggregate' },
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
    claim: '92% certification pass rate; 100% in the most recent cohort',
    appears_in: ['kb.metrics', 'kb.outcomes'],
    tool: 'query_certifications',
    args: { query_type: 'summary' },
    conflict_kind: 'definitional',
    severity: 'high',
    note:
      'All-time PCEP is 32/59 = 54.2%; the applications quote per-cohort rates. Different ' +
      'denominators, both defensible. State which one you are quoting, in the sentence itself.',
  },
  {
    key: 'annual_budget',
    claim: '$1.34M FY2025 expenses; $1.68M FY2026 projected revenue',
    appears_in: ['kb.financials', 'kb.budget_narrative'],
    tool: 'get_finance_brief',
    args: { period: 'ytd' },
    conflict_kind: 'drift',
    severity: 'high',
    note:
      'Prefer get_finance_brief — query_finances may be denied by the role ACL. If it is, flag ' +
      '[DATA UNAVAILABLE] rather than quoting the frozen figure as if confirmed.',
  },
  {
    key: 'enrollment_by_phase',
    claim: 'Program phases: Foundations, 101, LiftOff',
    appears_in: ['kb.programs', 'kb.program_desc'],
    tool: 'query_enrollment',
    args: { query_type: 'by_phase' },
    conflict_kind: 'content_gap',
    severity: 'high',
    note:
      'The platform records a Lightspeed phase (Foundations -> 101 -> Lightspeed -> LiftOff) that ' +
      'the KB program descriptions omit entirely. A drafted program description built only from ' +
      'the KB will be missing a phase.',
  },
  {
    key: 'prior_funding_wpf',
    claim: '$1.5M three-year William Penn grant from 2023, ending 6/30/26',
    appears_in: ['kb.sustainability'],
    tool: 'query_donors',
    args: { query_type: 'profile', donor_name: 'William Penn Foundation' },
    conflict_kind: 'drift',
    severity: 'high',
    note: 'query_donors may be ACL-denied; fall back to get_finance_brief and flag if unavailable.',
  },
  {
    key: 'demographics_race',
    claim: '85% / 90% / 100% demographic shares',
    appears_in: ['kb.dei', 'kb.profile.demographics'],
    tool: 'query_enrollment',
    args: { query_type: 'by_race' },
    conflict_kind: 'drift',
    severity: 'medium',
    note: 'Recompute from the connector; percentages move with each cohort.',
  },
  {
    key: 'employment_wage_range',
    claim: '$15,000–$35,000 earned; ~$20/hr',
    appears_in: ['kb.metrics', 'kb.program_desc', 'kb.uniqueness'],
    tool: 'query_employment',
    args: { query_type: 'aggregate' },
    conflict_kind: 'drift',
    severity: 'medium',
    note: 'The same aggregate call returns avg_hourly_wage and avg_weekly_hours.',
  },
  {
    key: 'top_employers',
    claim: '17 employer partners / 20 employers',
    appears_in: ['kb.partnerships'],
    tool: 'query_employment',
    args: { query_type: 'by_employer' },
    conflict_kind: 'drift',
    severity: 'medium',
    note: 'Two different counts appear in the KB; the connector settles it.',
  },
  {
    key: 'inc_client_work_booked',
    claim: '$75,000 in client work booked in July 2026 alone (Barra Launchpad Inc overview, ~1/3 of the full-year target); ' +
      'two clients with hiring intent in writing at $50-80K',
    appears_in: ['kb.sustainability', 'kb.innovation'],
    tool: 'get_finance_brief',
    args: { period: 'ytd' },
    conflict_kind: 'drift',
    severity: 'medium',
    note:
      'Newest approved org overview (Barra, Jul 2026) introduces Inc. revenue and hiring-intent claims ' +
      'the KB and its previous checks do not carry. No query_* tool returns Inc. client bookings directly — ' +
      'get_finance_brief gives the closest revenue signal; if it cannot confirm, flag [DATA UNAVAILABLE] rather ' +
      'than quoting the overview figure as current.',
  },
  {
    key: 'program_size_reach',
    claim: 'more than 200 young Philadelphians through programming to date; "about 145 served"',
    appears_in: ['kb.capacity', 'kb.history', 'kb.metrics'],
    tool: 'query_enrollment',
    args: { query_type: 'total' },
    conflict_kind: 'definitional',
    severity: 'high',
    note:
      'The Barra Jul 2026 overview says 200+ "came through programming"; KB says ~145 "served"; the connector ' +
      'holds 301 records. Three populations, three definitions — do NOT auto-resolve. Ask which population this ' +
      'funder means and state it in the sentence.',
  },
  {
    key: 'phase_costs',
    claim: '$519K / $455K / $362K per phase; ~$6,000 per participant',
    appears_in: ['kb.budget_narrative', 'kb.financials'],
    tool: 'query_finances',
    args: { query_type: 'phase_budget_dashboard' },
    conflict_kind: 'drift',
    severity: 'medium',
    note: 'Note the query_type is phase_budget_dashboard — phase_budget_summary is not a valid value.',
  },
  {
    key: 'revenue_mix',
    claim: '60% / 25% / 10% / 5% revenue mix',
    appears_in: ['kb.sustainability'],
    tool: 'get_finance_brief',
    args: { period: 'ytd' },
    conflict_kind: 'drift',
    severity: 'medium',
    note: 'Sustainability narratives quote this mix; confirm before repeating it.',
  },
  {
    key: 'postsecondary_rate',
    claim: '(absent from the knowledge base)',
    appears_in: [],
    tool: 'query_postsecondary',
    args: { query_type: 'summary' },
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
    conflict_kind: 'drift',
    severity: 'low',
    note: 'The evaluation narrative is qualitative; live scores can make it concrete.',
  },
  {
    key: 'staff_count',
    claim: '15 staff / 9 staff',
    appears_in: ['kb.staff_bios'],
    tool: 'search_documents',
    args: { query: 'org chart staff roster' },
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

export interface FigureWorkOrder {
  readonly policy: string;
  readonly kb_snapshot_date: string;
  readonly items: readonly FigureCheck[];
  readonly definitional_conflicts: readonly string[];
  readonly blocked: readonly { readonly tool: string; readonly reason: string }[];
}

const POLICY =
  'Live LP Internal AI connector figures supersede these knowledge-base figures by recency. Do not ' +
  'publish any figure below until the paired query_* call confirms it. On a drift conflict the ' +
  'connector wins. A DEFINITIONAL conflict is not auto-resolved — escalate it to staff with both ' +
  'numbers and their definitions. If a tool is denied by your role, write [DATA UNAVAILABLE] rather ' +
  'than quoting the frozen figure as if confirmed.';

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
          'May be denied by the role ACL (sensitive finance data). Fall back to get_finance_brief ' +
          'and flag [DATA UNAVAILABLE].',
      },
      {
        tool: 'query_donors',
        reason:
          'May be denied by the role ACL (donor PII). Fall back to get_finance_brief and flag ' +
          '[DATA UNAVAILABLE].',
      },
    ],
  };
}
