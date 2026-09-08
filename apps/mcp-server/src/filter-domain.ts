import { toolError, type ToolError } from './errors.js';

/**
 * Turning an unmatchable filter value into a loud failure instead of a confident zero.
 *
 * The defect this exists for: `query_enrollment { query_type: 'by_phase',
 * enrollment_status: 'Active' }` returned `breakdown: []` beside
 * `filters_applied: { enrollment_status: 'Active' }`. `students.enrollment_status`
 * holds short source codes — `E` and `N` were the values present in production — so
 * `'Active'` occurs in no row and *cannot*, so the empty answer was an artefact of the
 * filter rather than a fact about the data. "How many active students" read as zero.
 *
 * The line drawn here, and the whole substance of the fix:
 *
 * - A value **absent from its own column's distinct values** can never match, whatever
 *   else the caller asked for. That is a bad input, and it errors.
 * - A **combination** of values that are each present but co-occur in no row is a
 *   truthful zero and must keep returning empty. Nobody can tell the caller their
 *   question was malformed, because it wasn't.
 *
 * Which is why every domain passed in here is read **unscoped** — the distinct values
 * of that one column across the whole table, never narrowed by the other filters. Scope
 * the domain by the sibling filters and the second case collapses into the first: the
 * last surviving filter always looks unmatchable and every real zero becomes an error.
 */

/** One filter value, checked against the values its column actually holds. */
export interface FilterDomainCheck {
  /** The tool input field, spelled as the caller spelled it. */
  field: string;
  /** `table.column` the field filters, so the message points somewhere real. */
  column: string;
  /** The value the caller supplied. */
  value: string | number;
  /**
   * Every distinct non-null value in that column, across the whole table and
   * unscoped by any other filter. Empty means the column is null in every row.
   */
  domain: readonly (string | number)[];
}

/**
 * How many values a message will spell out before it summarises the rest. The four
 * columns checked today hold a handful of codes each, so this is a guard against a
 * future caller pointing the check at a free-text column and getting a response
 * bigger than the answer would have been.
 */
export const MAX_LISTED_VALUES = 40;

/** Sorted for a stable message, then capped. Numbers sort numerically, not as strings. */
export function formatDomain(
  domain: readonly (string | number)[],
  max: number = MAX_LISTED_VALUES,
): string {
  const sorted = [...domain].sort((a, b) =>
    typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b)),
  );
  const shown = sorted.slice(0, max).map((v) => (typeof v === 'number' ? String(v) : `'${v}'`));
  const rest = sorted.length - shown.length;
  return rest > 0 ? `${shown.join(', ')} (+${rest} more)` : shown.join(', ');
}

/**
 * The first check whose value is absent from its column, as a `no_records` envelope.
 * `undefined` when every supplied value is one the column holds — including when that
 * combination will return no rows, which is a real zero and not this function's
 * business.
 *
 * `no_records` is reused rather than a new code invented: `query_finances` already
 * returns it for a query_type no table backs, which is the same "your input cannot be
 * answered from this data" case one level down.
 *
 * Checks are evaluated in the order given and only the first failure is reported, so
 * the message is deterministic. The values are listed in that same message rather than
 * left to a follow-up call, so a wrong code costs one round trip.
 */
export function unmatchableFilterError(
  checks: readonly FilterDomainCheck[],
): ToolError | undefined {
  for (const check of checks) {
    if (check.domain.includes(check.value)) continue;
    const shown = typeof check.value === 'number' ? check.value : `'${check.value}'`;

    // An empty domain is its own diagnosis, and a worse one: no value at all can match,
    // so the column is unpopulated rather than the caller wrong. Still an error, because
    // a zero from an unpopulated column is precisely the false fact being prevented.
    if (check.domain.length === 0) {
      return toolError(
        'no_records',
        `${check.field}=${shown} cannot match: ${check.column} is null in every row, so no value would match. Reading this as zero would report a gap in the data as a fact about the program.`,
        [
          `Omit ${check.field} to leave the query unscoped by it.`,
          `Check whether the sync that populates ${check.column} has run — HQ /sync.`,
        ],
      );
    }

    return toolError(
      'no_records',
      `${check.field}=${shown} occurs nowhere in ${check.column}, so no row can match it and an empty result would describe the filter rather than the data. Values present: ${formatDomain(check.domain)}.`,
      [
        `Retry ${check.field} with one of: ${formatDomain(check.domain)}.`,
        `Omit ${check.field} to leave the query unscoped by it.`,
      ],
    );
  }
  return undefined;
}
