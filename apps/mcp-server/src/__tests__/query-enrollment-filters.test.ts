import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ALL_FILTERS,
  NON_DATE_FILTERS,
  blankFilters,
  filterEcho,
  filterStr,
} from '../tools/query-enrollment.js';
import { McpStdioClient } from './mcp-client.js';

/**
 * The defect this suite exists for: `query_enrollment` accepted `phase`,
 * `status`, `current_phase`, `enrollment_status` and `cohort` on every
 * query_type, and each branch applied only some of them. A caller who scoped to
 * the Lightspeed completers got every student back, with nothing in the
 * envelope to say a filter had been dropped. For the grant-writing layer that is
 * the whole failure mode — publishing the wrong denominator to a funder.
 *
 * The pure half of the fix is the echo contract, tested here. The Prisma
 * predicate half is asserted against a live database below.
 *
 * These bind to the handler's own constants rather than to local copies. An earlier
 * version declared its own `NON_DATE` / `ALL` arrays, which made all six echo cases
 * decorative with respect to the wiring: deleting a name from `NON_DATE_FILTERS` left
 * every one of them green, though that is precisely the regression they exist to catch.
 */
const NON_DATE = NON_DATE_FILTERS;
const ALL = ALL_FILTERS;

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

  // The wiring guard the local-copy arrays used to make impossible. Dropping a name
  // from either constant — or reordering `filters_ignored`, which callers read
  // positionally in logs — fails here rather than passing everywhere.
  it('pins the filter names the handler passes to the echo', () => {
    expect([...NON_DATE_FILTERS]).toEqual([
      'current_phase',
      'enrollment_status',
      'cohort',
      'phase',
      'status',
    ]);
    expect([...ALL_FILTERS]).toEqual([...NON_DATE_FILTERS, 'start_date', 'end_date']);
  });

  it('names a blank filter as ignored rather than omitting it from both lists', () => {
    const echo = filterEcho({ cohort: 2 }, NON_DATE, ['status']);
    expect(echo.filters_applied).toEqual({ cohort: 2 });
    expect(echo.filters_ignored).toEqual(['status']);
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

  // Order follows ALL_FILTERS, not payload order, so the echo reads the same way
  // whatever order a caller happened to send the keys in.
  it('names every blank filter, and only the blank ones', () => {
    expect(blankFilters({ status: '', phase: '   ', current_phase: 'Lightspeed' })).toEqual([
      'phase',
      'status',
    ]);
  });

  it('does not treat a numeric or absent value as blank', () => {
    expect(blankFilters({ cohort: 0, status: 'Completed' })).toEqual([]);
    expect(blankFilters({})).toEqual([]);
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

const OUTCOMES = {
  lightspeed: {
    lightspeedStatus: 'Completed',
    lightspeedStartDate: new Date('2025-06-01'),
    lightspeedEndDate: new Date('2025-07-31'),
  },
  foundations: {
    foundationsStatus: 'Completed',
    foundationsStartDate: new Date('2025-01-01'),
    foundationsEndDate: new Date('2025-02-28'),
  },
} as const;

/**
 * Every inequality this suite asserts is a property of these five rows, so the suite
 * behaves identically on an empty database and a populated one. Each row earns its place:
 *
 * - **1, 2 — `KEPT`, Lightspeed.** Two rows carrying the status under test, so a dropped
 *   `enrollment_status` returns more than an applied one. Two is also the minimum that
 *   makes the `limit: 1` truncation cases meaningful.
 * - **3 — `DROPPED`, Lightspeed.** The row an applied `enrollment_status` must exclude.
 * - **4 — `DROPPED`, no outcome row at all.** Makes "students with a Lightspeed outcome"
 *   strictly smaller than "all students" a property of the fixture rather than of
 *   `pnpm db:seed`. The seed inserts three students and zero phase outcomes, so on a
 *   developer's machine that inequality held for free; `.github/workflows/ci.yml`
 *   generates the client and pushes the schema but never seeds, so in CI every student
 *   was a fixture student with an outcome and the inequality read `3 < 3`.
 * - **5 — `KEPT`, Foundations only.** A student in scope, with an outcome row, that a
 *   Lightspeed query must not count. Without it, "all outcome rows for a `KEPT` student"
 *   and "Lightspeed outcome rows for a `KEPT` student" are the same number, and every
 *   assertion below passes whether or not `phase` is applied as a predicate at all —
 *   which is exactly how `active_during` shipped ignoring `phase`.
 */
const FIXTURE = [
  { n: '1', status: KEPT, outcome: 'lightspeed' },
  { n: '2', status: KEPT, outcome: 'lightspeed' },
  { n: '3', status: DROPPED, outcome: 'lightspeed' },
  { n: '4', status: DROPPED, outcome: 'none' },
  { n: '5', status: KEPT, outcome: 'foundations' },
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
          ...(f.outcome === 'none' ? {} : { phaseOutcomes: { create: OUTCOMES[f.outcome] } }),
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

  it('reads a blank filter the same way on every branch, and says it ignored it', async () => {
    // A blank value means "no filter" uniformly, rather than reaching one branch as a
    // literal column match and another as `{ not: null }`. It is *named* because
    // dropping it silently is the same unscoping from the other direction: the caller
    // believes the query was narrowed and the envelope mentions no filter at all.
    const blank = (await client.callTool('query_enrollment', {
      query_type: 'total',
      phase: 'Lightspeed',
      status: '',
    })) as {
      student_count: number;
      filters_applied: Record<string, unknown>;
      filters_ignored?: string[];
    };
    const absent = (await client.callTool('query_enrollment', {
      query_type: 'total',
      phase: 'Lightspeed',
    })) as { student_count: number; filters_ignored?: string[] };

    expect(blank.student_count).toBeGreaterThan(0); // the fixture has Lightspeed rows
    expect(blank.student_count).toBe(absent.student_count);
    expect(blank.filters_applied).toEqual({ phase: 'Lightspeed' });
    expect(blank.filters_ignored).toEqual(['status']);
    expect(absent.filters_ignored).toBeUndefined(); // absent is not blank
  });

  /**
   * `active_during` took `phase` as a column selector only: `PHASE_FIELDS[phase]` chose
   * which columns `status` and the dates were written against, and `phase` itself never
   * entered `where`. Dates hid it, because a non-null date column implies the phase
   * exists — so the hole was only visible on a dateless call, which is legal.
   */
  it('requires the phase outcome to exist on active_during, not merely name its columns', async () => {
    const { prisma } = await import('@lp-ai/lib-db');
    const inScope = await prisma.studentPhaseOutcome.count({
      where: { student: { enrollmentStatus: KEPT } },
    });
    const lightspeed = await prisma.studentPhaseOutcome.count({
      where: { lightspeedStatus: { not: null }, student: { enrollmentStatus: KEPT } },
    });
    // Fixture student 5 is the difference: `KEPT`, has an outcome row, no Lightspeed data.
    expect(lightspeed).toBeLessThan(inScope);

    const res = (await client.callTool('query_enrollment', {
      query_type: 'active_during',
      phase: 'Lightspeed',
      enrollment_status: KEPT,
    })) as { student_count: number };
    expect(res.student_count).toBe(lightspeed);

    // The sharper form: no fixture student has any LiftOff data, so a phase that is a
    // real predicate returns nothing, and a phase that only selects columns returns
    // every outcome row in scope.
    const liftoff = (await client.callTool('query_enrollment', {
      query_type: 'active_during',
      phase: 'LiftOff',
      enrollment_status: KEPT,
    })) as { student_count: number; filters_applied: Record<string, unknown> };
    expect(liftoff.student_count).toBe(0);
    expect(liftoff.filters_applied).toEqual({ phase: 'LiftOff', enrollment_status: KEPT });
  });

  it('reports the matched count on by_student, not the size of the page returned', async () => {
    const { prisma } = await import('@lp-ai/lib-db');
    const matched = await prisma.student.count({ where: { enrollmentStatus: KEPT } });
    expect(matched).toBeGreaterThan(1); // fixture: three KEPT students, page size 1

    const res = (await client.callTool('query_enrollment', {
      query_type: 'by_student',
      enrollment_status: KEPT,
      limit: 1,
    })) as {
      student_count: number;
      returned?: number;
      truncated?: boolean;
      limit?: number;
      students: unknown[];
    };

    expect(res.students).toHaveLength(1);
    expect(res.student_count).toBe(matched);
    expect(res.truncated).toBe(true);
    expect(res.returned).toBe(1);
    expect(res.limit).toBe(1);
  });

  it('reports the matched count on active_during, not the size of the page returned', async () => {
    const { prisma } = await import('@lp-ai/lib-db');
    // No dates and no status, so the predicate is the student scope plus the phase
    // existing — `phase` is a predicate, not just a column selector.
    const matched = await prisma.studentPhaseOutcome.count({
      where: { lightspeedStatus: { not: null }, student: { enrollmentStatus: KEPT } },
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
