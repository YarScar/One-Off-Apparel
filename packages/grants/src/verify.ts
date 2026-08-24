/**
 * verify.ts — closed the honor-system hole in `figure_call`.
 *
 * `pipeline.ts`'s `fetch_figure` status tells the drafting model exactly which `query_*` call to run
 * and to write its returned number into the answer — but nothing mechanically checked that the number
 * that landed in the draft actually came from that call. This is that check.
 *
 * **Why the caller runs the call, not this module.** Same reasoning `figures.ts`'s header already
 * states for the deterministic layer: `runTool`'s permission check keys on the INBOUND tool name, so a
 * tool that re-ran `figure_call.tool` internally would be authorised as itself rather than as
 * `query_finances`/`query_donors`, laundering data past whatever role the ACL actually restricted. The
 * caller already ran the named tool under its own name to get `figure_call` in the first place — this
 * just diffs its own drafted text against that result. Do not "optimise" this by fetching here.
 */

import { literalFigures } from './slots.js';
import { expandMagnitudeSuffix, extractNumericClaims } from './figures.js';

export interface FigureCall {
  readonly tool: string;
  readonly args: Readonly<Record<string, string | number | boolean>>;
}

export interface FigureVerdict {
  /** True when every literal figure in the draft traces to a numeric value in `queryResult`. */
  readonly matched: boolean;
  /** Literal figures `literalFigures()` found in the draft, verbatim. */
  readonly drafted_figures: readonly string[];
  /** The subset of `drafted_figures` that could not be matched. Empty when `matched`. */
  readonly unmatched: readonly string[];
  /** Every numeric value found anywhere in `queryResult`, normalised, for a caller to inspect on mismatch. */
  readonly live_values: readonly string[];
}

/** Every numeric value reachable inside `value`, normalised the same way `extractNumericClaims` is. */
function numericLeaves(value: unknown, out: string[]): void {
  if (typeof value === 'number' && Number.isFinite(value)) {
    out.push(String(value));
  } else if (typeof value === 'string') {
    out.push(...extractNumericClaims(value));
  } else if (Array.isArray(value)) {
    for (const v of value) numericLeaves(v, out);
  } else if (value !== null && typeof value === 'object') {
    for (const v of Object.values(value)) numericLeaves(v, out);
  }
}

/**
 * Does every literal figure in `draftText` trace to a number `queryResult` actually returned?
 *
 * `figureCall` is not re-run here (see module header) — it is carried through only so a mismatch
 * message can name the call the caller was supposed to have sourced the figure from.
 */
export function verifyFigureAnswer(
  draftText: string,
  figureCall: FigureCall,
  queryResult: unknown,
): FigureVerdict {
  const draftedFigures = literalFigures(draftText);
  const liveLeaves: string[] = [];
  numericLeaves(queryResult, liveLeaves);
  const liveValues = [...new Set(liveLeaves)];
  const liveSet = new Set(liveValues);
  const liveNumbers = liveValues.map(Number).filter(Number.isFinite);

  const unmatched = draftedFigures.filter((figure) => {
    if (extractNumericClaims(figure).every((token) => liveSet.has(token))) return false;
    // extractNumericClaims strips a magnitude suffix ($1.34M -> "1.34"), which the live side (a raw
    // number, stringified) never contains — see figures.ts's own docstring on that gap. Fall back to
    // expanding the suffix and rounding a live number to the mantissa's own precision, so a
    // suffixed figure isn't flagged as wrong just because it wasn't spelled out in full.
    const expanded = expandMagnitudeSuffix(figure);
    if (expanded === undefined) return true;
    return !liveNumbers.some(
      (n) => Number((n / expanded.scale).toFixed(expanded.decimals)) === expanded.mantissa,
    );
  });

  return {
    matched: unmatched.length === 0,
    drafted_figures: draftedFigures,
    unmatched,
    live_values: liveValues,
  };
}
