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
 * classifier. The KB's own reconciliation note records that `query_finances` is blocked in some
 * modes. Keeping the calls in the caller's hands means each one is ACL-checked and usage-logged
 * under its own name, per person. (That note also named `query_donors` as blocked. It is not, and
 * never was for this role. It *was* empty until #306 repointed it from the unpopulated
 * `donor_contacts` tables at the `development:*` CRM tabs; it works now. See its `blocked` entry for
 * the two things that still need care: default scope, and where its totals come from.)
 *
 * ## Drift versus definitional conflict
 *
 * A drift conflict resolves to the connector by recency. A DEFINITIONAL conflict does not resolve
 * automatically and must reach a person: "145 served" and "301 records" are both true of different
 * populations, and a 92% certification pass rate (per cohort) and 54.2% (all-time) are both true of
 * different denominators. Picking one silently would be the most damaging thing this layer could do.
 */

import { join } from 'node:path';

import type { KnowledgeBase } from './schemas.js';
import { figureChecksArraySchema } from './schemas.js';
import { SEED_DIR, parseSeed } from './seed-io.js';

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
  /**
   * The tool call's arguments. Widened from `Record<string, string>` 2026-08-19 (#306): tool inputs
   * are not all strings — `launchpad_only` is a boolean and `limit` a number — and a work order that
   * printed `launchpad_only: "true"` would be telling the drafter to send the wrong type. Both
   * consumers interpolate these into a display string, so a non-string value needs no other change.
   */
  readonly args: Readonly<Record<string, string | number | boolean>>;
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
  /**
   * History/rationale for this entry — why a slot was added to {@link appears_in}, or what a past
   * correction fixed. Lived as an inline `//` comment beside the entry when this array was hand-edited
   * TS source; moved to a data field under #8 (WP #333) when it became `seed/figure_checks.json`,
   * since JSON has no comment syntax. Unlike {@link note}, this is not guidance for the drafting
   * agent — most entries have none.
   */
  readonly _provenance?: string | undefined;
}

/**
 * Every `tool` and `query_type` in `seed/figure_checks.json` is checked against the live enums in
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
 *
 * Moved from a hand-edited array literal to schema-validated seed JSON under #8 (WP #333) — every
 * entry below used to be a `{ ... }` object literal in this file; a figure correction is now a data
 * diff against `seed/figure_checks.json`, validated at load time by `figureChecksArraySchema`
 * (`schemas.ts`), not a code diff here. See `seed-io.ts`'s header comment for why the loader is
 * self-contained in this file rather than routed through `data.ts`'s other loaders.
 */
export const FIGURE_CHECKS: readonly FigureCheck[] = parseSeed(
  join(SEED_DIR, 'figure_checks.json'),
  figureChecksArraySchema,
);

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

const MAGNITUDE_SUFFIX = /^\$?\s?(\d[\d,]*(?:\.\d+)?)\s?([MKB])$/i;
const MAGNITUDE_SCALE: Readonly<Record<string, number>> = { K: 1e3, M: 1e6, B: 1e9 };

/**
 * Expands a magnitude-suffixed currency token (`$1.34M`) to the raw value it stands for, at the
 * mantissa's own decimal precision — `1.34` and `2` decimal places, not a scaled float.
 *
 * Exists for `verify.ts`, which has to compare a drafted figure that may be written either way
 * (`$1,340,000` or `$1.34M`) against a live query result that is always a raw number. Returns
 * `undefined` for a token with no suffix — callers fall back to plain string comparison for those.
 * Deliberately not folded into {@link extractNumericClaims}: that function is also relied on by
 * `resize.ts` for a same-shaped source-vs-rewrite comparison where the suffix-blindness is
 * documented as acceptable, and widening it there would change that check's semantics unasked.
 */
export function expandMagnitudeSuffix(
  token: string,
): { readonly mantissa: number; readonly decimals: number; readonly scale: number } | undefined {
  const m = token.match(MAGNITUDE_SUFFIX);
  if (!m || !m[1] || !m[2]) return undefined;
  const mantissaStr = m[1].replace(/,/g, '');
  const mantissa = Number(mantissaStr);
  const decimals = mantissaStr.includes('.') ? (mantissaStr.split('.')[1]?.length ?? 0) : 0;
  const scale = MAGNITUDE_SCALE[m[2].toUpperCase()];
  if (scale === undefined) return undefined;
  return { mantissa, decimals, scale };
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
  /**
   * Per-tool caveats: reasons a call may not return the value the work order asks it for. Widened
   * 2026-08-19 (#306) beyond ACL denial, which is what it originally held. A permitted tool over an
   * unpopulated table (`query_donors`) and a reachable tab with wrong columns (`dev_contacts`) fail
   * the drafter exactly as an ACL denial does, and there was no other channel that reached them.
   * Consumers rendering this list should not label it "ACL-denied" — read `reason` for the kind.
   */
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
 * wrong; pass nothing for the whole map. `kb` is taken as a parameter rather than loaded here,
 * matching `computeIntegrityReport(bank, kb)`'s pattern in data.ts — the caller already has one
 * loaded and this keeps the function pure.
 */
export function buildFigureWorkOrder(
  kbRefs: readonly string[] | undefined,
  kb: KnowledgeBase,
): FigureWorkOrder {
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
          'Works as of 2026-08-19 (#306), and NOT ACL-denied — this entry used to claim donor PII made ' +
          'it deniable, and then that it was permanently empty. It was empty: it read `donor_contacts` ' +
          'and friends, which no connector writes. It now reads the same `development:*` CRM tabs ' +
          '`query_finances`\'s `dev_*` types serve. Two things to know. (1) It defaults to ' +
          'launchpad_only=true, and the scope changes every total — `scope` and `scope_note` on the ' +
          'response say which one you got. (2) Its giving totals are SUMMED from gift rows, not read ' +
          'from the Contacts tab, whose lifetime and fiscal-year columns are wrong at source. Prefer ' +
          'it over raw `dev_*` rows for a funder profile: only it gives the per-project split that ' +
          'separates a Launchpad grant from a Building 21 one.',
      },
      {
        tool: 'query_finances { query_type: "dev_contacts" }',
        reason:
          'Reachable, and its giving columns are wrong at source. Recorded 2026-08-19 (#306): ' +
          '`lifetime_giving`, `fy25_giving` and `fy26_giving` read $0.00 on rows whose ' +
          'dev_grants_tracker lifetime total is six figures (William Penn: $0.00 here against ' +
          '$1,600,000.00 there). The calendar-year columns (`cy2025_giving`) carry real values. Use ' +
          'this tab for program officer, relationship owner and Drive links; take every giving figure ' +
          'from dev_grants_tracker or dev_giving_history. The fix belongs in the sheet, not here.',
      },
    ],
  };
}
