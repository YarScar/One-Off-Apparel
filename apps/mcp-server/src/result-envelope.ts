/**
 * One truncation-reporting convention, shared by every tool that returns a capped
 * page of rows (work packages #195 and #276).
 *
 * The defect this exists to prevent is a single shape appearing three times: a tool
 * runs `findMany({ take: limit })` and reports `rows.length` as though it were the
 * size of the population. `query_competency` returned 1000 of ~2346 competency rows
 * and said nothing (#276); `query_students` returned `student_count: rows.length` on
 * its `list` path, which in the same repo means a real `prisma.count()` on
 * `query_enrollment`'s `total` path (#195). Both produce a well-formed number that
 * reads as a fact about the organization and is actually a page size.
 *
 * `query_finances` solved this first with `total_matching` + `truncated`. Rather than
 * a third bespoke variant, all of them now emit the same four keys, so a caller can
 * apply one rule everywhere: **quote `total_matching`, never `record_count`, and
 * treat `truncated: true` as "the rows are a sample, the count is not".**
 *
 * `total_matching` is always a real `count({ where })` over the same predicate as the
 * `findMany`, never inferred from the returned rows.
 */
export interface ResultEnvelope {
  /** Rows actually returned in this response. Never a population figure. */
  readonly record_count: number;
  /** Rows matching the query, counted in the database independently of `limit`. */
  readonly total_matching: number;
  /** True when `record_count < total_matching`, i.e. the rows are a partial slice. */
  readonly truncated: boolean;
  /** The cap that was applied, so a caller knows what to raise to get more. */
  readonly limit: number;
}

/**
 * Build the envelope from a returned page, a counted total, and the applied cap.
 *
 * `truncated` is derived rather than passed in: the one thing a caller of this helper
 * must not be able to do is report a count that disagrees with the flag beside it.
 */
export function resultEnvelope(returned: number, totalMatching: number, limit: number): ResultEnvelope {
  return {
    record_count: returned,
    total_matching: totalMatching,
    truncated: returned < totalMatching,
    limit,
  };
}

/** Default page size shared by the paged tools, and the ceiling a caller may raise it to. */
export const DEFAULT_LIMIT = 500;
export const MAX_LIMIT = 1000;

/** Clamp a caller-supplied limit into `[1, MAX_LIMIT]`, defaulting when absent. */
export function clampLimit(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(Math.floor(requested), MAX_LIMIT));
}
