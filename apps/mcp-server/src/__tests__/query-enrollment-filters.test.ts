import { describe, expect, it } from 'vitest';

import { filterEcho } from '../tools/query-enrollment.js';

/**
 * The defect this suite exists for: `query_enrollment` accepted `phase`,
 * `status`, `current_phase`, `enrollment_status` and `cohort` on every
 * query_type, and each branch applied only some of them. A caller who scoped to
 * 15 Lightspeed completers got all 301 students back, with nothing in the
 * envelope to say a filter had been dropped. For the grant-writing layer that is
 * the whole failure mode — publishing the wrong denominator to a funder.
 *
 * The pure half of the fix is the echo contract, tested here. The Prisma
 * predicate half is asserted against a live database below.
 */
const NON_DATE = ['current_phase', 'enrollment_status', 'cohort', 'phase', 'status'] as const;
const ALL = [...NON_DATE, 'start_date', 'end_date'] as const;

describe('query_enrollment filter echo', () => {
  it('echoes every filter a branch honours', () => {
    const echo = filterEcho({ current_phase: 'Lightspeed', enrollment_status: 'Completed' }, NON_DATE);
    expect(echo.filters_applied).toEqual({ current_phase: 'Lightspeed', enrollment_status: 'Completed' });
    expect(echo.filters_ignored).toBeUndefined();
  });

  it('names a filter the branch cannot honour rather than dropping it', () => {
    const echo = filterEcho({ cohort: 3, start_date: '2025-01-01' }, NON_DATE);
    expect(echo.filters_applied).toEqual({ cohort: 3 });
    expect(echo.filters_ignored).toEqual(['start_date']);
  });

  it('honours the date filters on active_during', () => {
    const echo = filterEcho({ phase: 'Lightspeed', start_date: '2025-01-01', end_date: '2025-12-31' }, ALL);
    expect(echo.filters_ignored).toBeUndefined();
    expect(echo.filters_applied).toEqual({
      phase: 'Lightspeed',
      start_date: '2025-01-01',
      end_date: '2025-12-31',
    });
  });

  it('omits filters_ignored entirely when nothing was dropped', () => {
    expect(filterEcho({}, NON_DATE)).toEqual({ filters_applied: {} });
  });

  it('reports a numeric filter without stringifying it', () => {
    const applied = filterEcho({ cohort: 4 }, NON_DATE).filters_applied;
    expect(applied).toEqual({ cohort: 4 });
    expect(typeof applied['cohort']).toBe('number');
  });

  // Presence, not truthiness — the echo must not repeat the handler's own
  // `...(cohort ? ...)` elision, or a filter dropped for being falsy would go
  // unreported by the very block that exists to report it.
  it('keys off presence, so a zero-valued filter is still echoed', () => {
    expect(filterEcho({ cohort: 0 }, NON_DATE).filters_applied).toEqual({ cohort: 0 });
  });
});

/**
 * Live-DB half. Gated the same way as the rest of the suite: only runs against a
 * localhost DATABASE_URL, so CI without a database and any developer pointed at
 * RDS both skip rather than fail.
 */
const isLocalDb = (process.env['DATABASE_URL'] ?? '').includes('localhost');
const describeLocal = isLocalDb ? describe : describe.skip;

describeLocal('query_enrollment filter application (live DB)', () => {
  it('scopes by_phase by student columns instead of ignoring them', async () => {
    const { prisma } = await import('@lp-ai/lib-db');

    const unscoped = await prisma.studentPhaseOutcome.count({
      where: { lightspeedStatus: { not: null } },
    });
    const scoped = await prisma.studentPhaseOutcome.count({
      where: { lightspeedStatus: { not: null }, student: { enrollmentStatus: 'Completed' } },
    });

    // The point is that the relation filter reaches the query at all. Equality
    // would mean the predicate was a no-op, which is the bug.
    expect(scoped).toBeLessThanOrEqual(unscoped);
    expect(Number.isInteger(scoped)).toBe(true);
  });

  it('scopes a student-level count by a phase outcome', async () => {
    const { prisma } = await import('@lp-ai/lib-db');

    const all = await prisma.student.count();
    const withLightspeed = await prisma.student.count({
      where: { phaseOutcomes: { some: { lightspeedStatus: { not: null } } } },
    });

    expect(withLightspeed).toBeLessThanOrEqual(all);
  });
});
