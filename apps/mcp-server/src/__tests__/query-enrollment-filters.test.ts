import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { filterEcho, filterStr } from '../tools/query-enrollment.js';
import { McpStdioClient } from './mcp-client.js';

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
 * `filterStr` is what makes the echo's presence semantics safe to hold. The handler
 * now presence-tests every filter, so a blank string would otherwise reach the query
 * as a literal column match on the branches that read it directly and as
 * `{ not: null }` on the branches that test truthiness — one payload, two answers.
 */
describe('query_enrollment blank filters', () => {
  it('treats a blank or whitespace-only filter as absent', () => {
    expect(filterStr({ status: '' }, 'status')).toBeUndefined();
    expect(filterStr({ status: '   ' }, 'status')).toBeUndefined();
    expect(filterStr({}, 'status')).toBeUndefined();
  });

  it('trims a filter rather than matching on the padding', () => {
    expect(filterStr({ status: ' Completed ' }, 'status')).toBe('Completed');
  });

  it('ignores a non-string value rather than coercing it', () => {
    expect(filterStr({ status: 5 }, 'status')).toBeUndefined();
  });
});


/**
 * Live-DB half. Gated the same way as the rest of the suite: only runs against a
 * localhost DATABASE_URL, so CI without a database and any developer pointed at RDS
 * both skip rather than fail.
 *
 * These cases go through the real MCP server over stdio, and each compares the
 * tool's answer to a Prisma reference *and* to the answer an unfiltered query would
 * give. Both halves are needed: the reference proves the number is right, and the
 * inequality proves the predicate reached the query at all. An earlier version of
 * this file asserted only `scoped <= unscoped` and `Number.isInteger(scoped)`,
 * which stayed green with the entire fix reverted and on an empty database.
 *
 * The fixture is built here rather than assumed, for the same reason: `pnpm db:seed`
 * inserts three students and **zero** phase outcomes, so every phase-outcome
 * assertion against the seed alone would pass without executing anything.
 */
const isLocalDb = (process.env['DATABASE_URL'] ?? '').includes('localhost');
const describeLocal = isLocalDb ? describe : describe.skip;

/** Namespaced so cleanup cannot touch a developer's own rows. */
const FIXTURE_PREFIX = 'PR50-';
const KEPT = 'PR50Kept';
const DROPPED = 'PR50Dropped';

/**
 * Two rows carry the status under test and two do not, so a dropped
 * `enrollment_status` returns 3 where an applied one returns 2. Two matching rows is
 * also what makes the `limit: 1` truncation case meaningful.
 *
 * The fourth student carries **no outcome row**, and that is load-bearing rather than
 * filler: it is what makes "students with a Lightspeed outcome" strictly smaller than
 * "all students" a property of this fixture instead of a property of `pnpm db:seed`.
 * The seed inserts three students and zero phase outcomes, so on a developer's machine
 * that inequality held for free — and `.github/workflows/ci.yml` generates the client
 * and pushes the schema but never seeds, so in CI every student in the database was a
 * fixture student with an outcome, and the inequality read `3 < 3`.
 */
const FIXTURE = [
  { n: '1', status: KEPT, outcome: true },
  { n: '2', status: KEPT, outcome: true },
  { n: '3', status: DROPPED, outcome: true },
  { n: '4', status: DROPPED, outcome: false },
] as const;

describeLocal('query_enrollment filter application (live DB)', () => {
  let client: McpStdioClient;

  beforeAll(async () => {
    const { prisma } = await import('@lp-ai/lib-db');
    await prisma.student.deleteMany({ where: { studentNumber: { startsWith: FIXTURE_PREFIX } } });
    for (const f of FIXTURE) {
      await prisma.student.create({
        data: {
          studentNumber: `${FIXTURE_PREFIX}${f.n}`,
          canonicalName: `Fixture Student ${f.n}`,
          enrollmentStatus: f.status,
          ...(f.outcome
            ? {
                phaseOutcomes: {
                  create: {
                    lightspeedStatus: 'Completed',
                    lightspeedStartDate: new Date('2025-06-01'),
                    lightspeedEndDate: new Date('2025-07-31'),
                  },
                },
              }
            : {}),
        },
      });
    }
    client = new McpStdioClient();
  });

  afterAll(async () => {
    const { prisma } = await import('@lp-ai/lib-db');
    client.close();
    await prisma.student.deleteMany({ where: { studentNumber: { startsWith: FIXTURE_PREFIX } } });
    await prisma.$disconnect();
  });

  it('applies enrollment_status on total instead of counting every student', async () => {
    const { prisma } = await import('@lp-ai/lib-db');
    const all = await prisma.student.count();
    const reference = await prisma.student.count({ where: { enrollmentStatus: KEPT } });

    const res = (await client.callTool('query_enrollment', {
      query_type: 'total',
      enrollment_status: KEPT,
    })) as { student_count: number; filters_applied: Record<string, unknown> };

    expect(reference).toBeLessThan(all); // the fixture guarantees this
    expect(res.student_count).toBe(reference);
    expect(res.filters_applied).toEqual({ enrollment_status: KEPT });
  });

  it('applies student columns to by_phase, which used to build the predicate and discard it', async () => {
    const { prisma } = await import('@lp-ai/lib-db');
    const unscoped = await prisma.studentPhaseOutcome.count({
      where: { lightspeedStatus: { not: null } },
    });
    const reference = await prisma.studentPhaseOutcome.count({
      where: { lightspeedStatus: { not: null }, student: { enrollmentStatus: KEPT } },
    });

    const res = (await client.callTool('query_enrollment', {
      query_type: 'by_phase',
      phase: 'Lightspeed',
      enrollment_status: KEPT,
    })) as { breakdown: Array<{ count: number }>; filters_applied: Record<string, unknown> };

    expect(reference).toBeLessThan(unscoped);
    expect(res.breakdown.reduce((n, b) => n + b.count, 0)).toBe(reference);
    expect(res.filters_applied).toEqual({ phase: 'Lightspeed', enrollment_status: KEPT });
  });

  it('applies phase and status together on a student-level count', async () => {
    const { prisma } = await import('@lp-ai/lib-db');
    const reference = await prisma.student.count({
      where: { phaseOutcomes: { some: { lightspeedStatus: 'Completed' } } },
    });
    const all = await prisma.student.count();

    const res = (await client.callTool('query_enrollment', {
      query_type: 'total',
      phase: 'Lightspeed',
      status: 'Completed',
    })) as { student_count: number };

    expect(reference).toBeLessThan(all); // fixture student 4 has no outcome row
    expect(res.student_count).toBe(reference);
  });

  it('reads a blank filter the same way on every branch', async () => {
    // `status: ''` used to become a literal column match where a branch read it
    // directly and `{ not: null }` where a branch tested truthiness: `total` returned
    // 0 while `by_phase` returned the full breakdown, and neither echo mentioned it.
    const blank = (await client.callTool('query_enrollment', {
      query_type: 'total',
      phase: 'Lightspeed',
      status: '',
    })) as { student_count: number; filters_applied: Record<string, unknown> };
    const absent = (await client.callTool('query_enrollment', {
      query_type: 'total',
      phase: 'Lightspeed',
    })) as { student_count: number };

    expect(blank.student_count).toBeGreaterThan(0); // the fixture has Lightspeed rows
    expect(blank.student_count).toBe(absent.student_count);
    expect(blank.filters_applied).toEqual({ phase: 'Lightspeed' });
  });

  it('reports the matched count on active_during, not the size of the page returned', async () => {
    const { prisma } = await import('@lp-ai/lib-db');
    // With no dates and no status, `active_during`'s where clause is just the student
    // scope — `phase` selects which columns are read, it does not require the outcome
    // to exist — so the reference is every outcome row for a fixture student.
    const matched = await prisma.studentPhaseOutcome.count({
      where: { student: { enrollmentStatus: KEPT } },
    });

    const res = (await client.callTool('query_enrollment', {
      query_type: 'active_during',
      phase: 'Lightspeed',
      enrollment_status: KEPT,
      limit: 1,
    })) as {
      student_count: number;
      returned?: number;
      truncated?: boolean;
      students: unknown[];
    };

    expect(matched).toBeGreaterThan(1); // fixture: two KEPT rows, page size 1
    expect(res.students).toHaveLength(1);
    expect(res.student_count).toBe(matched);
    expect(res.truncated).toBe(true);
    expect(res.returned).toBe(1);
  });
});
