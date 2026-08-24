import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { resultEnvelope, clampLimit, DEFAULT_LIMIT, MAX_LIMIT } from '../result-envelope.js';
import { McpStdioClient } from './mcp-client.js';

/**
 * Work packages #276 and #195.
 *
 * `query_competency` returned 1000 of ~2346 competency rows and said nothing, so a growth
 * figure computed from the response described an arbitrary slice (#276). `query_students`
 * returned `student_count: rows.length` on its `list` path — a page size under the name
 * `query_enrollment`'s `total` path uses for a real `prisma.count()` (#195). Both are the
 * same defect: a well-formed number that reads as a fact about the organization.
 *
 * The fix is one convention across all three tools, so these tests are deliberately shared
 * rather than three per-tool files: the thing being asserted is that the tools agree.
 */
describe('resultEnvelope', () => {
  it('flags a partial page as truncated', () => {
    expect(resultEnvelope(500, 2346, 500)).toEqual({
      record_count: 500,
      total_matching: 2346,
      truncated: true,
      limit: 500,
    });
  });

  it('does not flag a complete result', () => {
    expect(resultEnvelope(12, 12, 500)).toEqual({
      record_count: 12,
      total_matching: 12,
      truncated: false,
      limit: 500,
    });
  });

  it('reports an empty result as complete rather than truncated', () => {
    // An honest zero and a clipped page must not look alike; this is the direction the
    // sibling "silent empty result" work cares about.
    expect(resultEnvelope(0, 0, 500).truncated).toBe(false);
  });

  it('derives truncated from the two counts rather than trusting a caller', () => {
    // The one thing a caller of the helper must not be able to do is emit a count that
    // disagrees with the flag beside it.
    for (const [returned, total] of [
      [0, 1],
      [1, 1],
      [499, 500],
      [500, 500],
    ] as const) {
      const e = resultEnvelope(returned, total, 500);
      expect(e.truncated).toBe(e.record_count < e.total_matching);
    }
  });
});

describe('clampLimit', () => {
  it('defaults when absent', () => {
    expect(clampLimit(undefined)).toBe(DEFAULT_LIMIT);
  });

  it('caps at the maximum', () => {
    expect(clampLimit(100_000)).toBe(MAX_LIMIT);
  });

  it('keeps a legal request', () => {
    expect(clampLimit(25)).toBe(25);
  });

  it('floors a fractional limit and refuses a non-positive one', () => {
    // `take: 0` returns nothing and `take: -1` reverses direction in Prisma; either
    // would be reported as a complete empty result by the envelope above.
    expect(clampLimit(2.9)).toBe(2);
    expect(clampLimit(0)).toBe(1);
    expect(clampLimit(-5)).toBe(1);
  });

  it('defaults rather than propagating NaN', () => {
    expect(clampLimit(Number.NaN)).toBe(DEFAULT_LIMIT);
  });
});

/**
 * Live-DB half, gated like the rest of the suite: localhost only, so CI without a database
 * and any developer pointed at RDS skip rather than fail.
 *
 * The fixture is built here rather than assumed. `pnpm db:seed` inserts three students and
 * zero competency rows, so every assertion below would pass vacuously against the seed.
 */
const isLocalDb = (process.env['DATABASE_URL'] ?? '').includes('localhost');
const describeLocal = isLocalDb ? describe : describe.skip;

/** Namespaced so cleanup cannot touch a developer's own rows. */
const PREFIX = 'WP276-';
const COMPETENCY = 'WP276 Systems Thinking';
const SCHOOL = 'WP276 Fixture High School';
// Scopes the query_enrollment calls below to just these 3 fixture students —
// query_enrollment has no `school` filter, so current_phase serves that role instead.
const CURRENT_PHASE = 'WP276Phase';

/**
 * Three students, two competency rows each. Growth is deliberately front-loaded: the two
 * rows that sort first (student -1) carry growth 1, and the last four carry 10. So the
 * average over a `limit: 2` page is 1 and the average over all six is 7. A `growth_aggregate`
 * that silently paged would return the former, and the assertion below would catch it.
 */
const GROWTH: Record<string, [number, number]> = {
  '1': [1, 1],
  '2': [10, 10],
  '3': [10, 10],
};
const TOTAL_ROWS = 6;
const TRUE_AVG_GROWTH = (1 + 1 + 10 + 10 + 10 + 10) / TOTAL_ROWS;

interface Envelope {
  record_count: number;
  total_matching: number;
  truncated: boolean;
  limit: number;
}

describeLocal('truncation reporting across query_competency / query_students / query_enrollment (live DB)', () => {
  let client: McpStdioClient;

  beforeAll(async () => {
    const { prisma } = await import('@lp-ai/lib-db');
    await prisma.studentCompetency.deleteMany({ where: { studentNumber: { startsWith: PREFIX } } });
    await prisma.student.deleteMany({ where: { studentNumber: { startsWith: PREFIX } } });

    for (const n of ['1', '2', '3']) {
      await prisma.student.create({
        data: {
          studentNumber: `${PREFIX}${n}`,
          // Identical names on purpose: `canonicalName` is not unique, so this is the
          // fixture that makes the missing tie-break observable as reordering.
          canonicalName: 'WP276 Duplicate Name',
          schoolName: SCHOOL,
          currentPhase: CURRENT_PHASE,
        },
      });
      const pair = GROWTH[n];
      if (!pair) throw new Error(`no growth fixture for ${n}`);
      for (const [i, growth] of pair.entries()) {
        await prisma.studentCompetency.create({
          data: {
            sourceId: `${PREFIX}${n}-${i}`,
            studentNumber: `${PREFIX}${n}`,
            competency: COMPETENCY,
            baseline: 2,
            performanceLevel: 4,
            growth,
            progress: 50,
          },
        });
      }
    }
    client = new McpStdioClient();
  });

  afterAll(async () => {
    const { prisma } = await import('@lp-ai/lib-db');
    client.close();
    await prisma.studentCompetency.deleteMany({ where: { studentNumber: { startsWith: PREFIX } } });
    await prisma.student.deleteMany({ where: { studentNumber: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it('query_competency scores reports the true total beside a truncated page', async () => {
    const res = (await client.callTool('query_competency', {
      query_type: 'scores',
      competency: COMPETENCY,
      limit: 2,
    })) as Envelope & { truncation_note?: string; records: unknown[] };

    expect(res.record_count).toBe(2);
    expect(res.records).toHaveLength(2);
    // The #276 defect verbatim: this used to be the only number in the envelope.
    expect(res.total_matching).toBe(TOTAL_ROWS);
    expect(res.truncated).toBe(true);
    expect(res.truncation_note).toContain('growth_aggregate');
  });

  it('query_competency scores does not claim truncation on a complete result', async () => {
    const res = (await client.callTool('query_competency', {
      query_type: 'scores',
      competency: COMPETENCY,
      limit: 100,
    })) as Envelope;

    expect(res.record_count).toBe(TOTAL_ROWS);
    expect(res.total_matching).toBe(TOTAL_ROWS);
    expect(res.truncated).toBe(false);
  });

  it('query_competency scores returns a stable page across identical calls', async () => {
    const call = async (): Promise<string[]> => {
      const res = (await client.callTool('query_competency', {
        query_type: 'scores',
        competency: COMPETENCY,
        limit: 3,
      })) as { records: Array<{ student_number: string; competency: string }> };
      return res.records.map((r) => r.student_number);
    };
    expect(await call()).toEqual(await call());
  });

  it('query_competency growth_aggregate computes over every row, not over a page', async () => {
    const res = (await client.callTool('query_competency', {
      query_type: 'growth_aggregate',
      competency: COMPETENCY,
      // Passed deliberately: growth_aggregate must ignore it. If it ever pages, the
      // average below becomes 1 rather than 7.
      limit: 2,
    })) as {
      row_count: number;
      student_count: number;
      growth_row_count: number;
      avg_growth: number;
      min_growth: number;
      max_growth: number;
      by_competency: Array<{ competency: string; avg_growth: number; row_count: number }>;
    };

    expect(res.row_count).toBe(TOTAL_ROWS);
    expect(res.student_count).toBe(3);
    expect(res.growth_row_count).toBe(TOTAL_ROWS);
    expect(res.avg_growth).toBeCloseTo(TRUE_AVG_GROWTH, 5);
    // The page average, which is what the caller was previously forced to compute.
    expect(res.avg_growth).not.toBeCloseTo(1, 5);
    expect(res.min_growth).toBeCloseTo(1, 5);
    expect(res.max_growth).toBeCloseTo(10, 5);
    // A JSON number, not a serialized Prisma Decimal object.
    expect(typeof res.avg_growth).toBe('number');

    const row = res.by_competency.find((c) => c.competency === COMPETENCY);
    expect(row?.row_count).toBe(TOTAL_ROWS);
    expect(row?.avg_growth).toBeCloseTo(TRUE_AVG_GROWTH, 5);
  });

  it('query_students list reports the true total, not the page size', async () => {
    const res = (await client.callTool('query_students', {
      query_type: 'list',
      school: SCHOOL,
      limit: 2,
    })) as Envelope & { student_count: number; students: unknown[] };

    expect(res.students).toHaveLength(2);
    expect(res.record_count).toBe(2);
    // The #195 defect verbatim: `student_count` was `rows.length`.
    expect(res.student_count).toBe(3);
    expect(res.total_matching).toBe(3);
    expect(res.truncated).toBe(true);
  });

  it('query_students list is stable across identical calls despite duplicate names', async () => {
    const call = async (): Promise<Array<string | null>> => {
      const res = (await client.callTool('query_students', {
        query_type: 'list',
        school: SCHOOL,
        limit: 2,
      })) as { students: Array<{ student_number: string | null }> };
      return res.students.map((s) => s.student_number);
    };
    expect(await call()).toEqual(await call());
  });

  it('query_enrollment by_student carries the same envelope keys as its siblings', async () => {
    const res = (await client.callTool('query_enrollment', {
      query_type: 'by_student',
      current_phase: CURRENT_PHASE,
      limit: 2,
    })) as Envelope & { student_count: number };

    expect(res.student_count).toBe(3);
    expect(res.total_matching).toBe(3);
    expect(res.record_count).toBe(2);
    expect(res.truncated).toBe(true);
    expect(res.limit).toBe(2);
  });

  it('all three tools spell the envelope the same way', async () => {
    const keys = (o: object): string[] =>
      ['record_count', 'total_matching', 'truncated', 'limit'].filter((k) => k in o);

    const [competency, students, enrollment] = await Promise.all([
      client.callTool('query_competency', { query_type: 'scores', competency: COMPETENCY, limit: 1 }),
      client.callTool('query_students', { query_type: 'list', school: SCHOOL, limit: 1 }),
      client.callTool('query_enrollment', { query_type: 'by_student', current_phase: CURRENT_PHASE, limit: 1 }),
    ]);

    const expected = ['record_count', 'total_matching', 'truncated', 'limit'];
    expect(keys(competency as object)).toEqual(expected);
    expect(keys(students as object)).toEqual(expected);
    expect(keys(enrollment as object)).toEqual(expected);
  });
});
