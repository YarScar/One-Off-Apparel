import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { McpStdioClient } from './mcp-client.js';

/**
 * The defect this suite exists for (OpenProject `#209`): `query_attendance` declared
 * `current_phase` in its input schema and read it nowhere. Every other occurrence of the
 * name in the handler was something else — the `group_by` enum member, or an output field
 * shaped from a joined student record.
 *
 * So a caller scoping attendance to one phase got **every phase back**, in a response
 * that read as though it were scoped. Not a silent zero but a silent *superset*, which is
 * the worse direction: a zero invites suspicion, and a plausible org-wide rate presented
 * as a phase rate does not. Any phase-scoped attendance rate ever quoted from this tool
 * was the org-wide rate.
 *
 * Every assertion below is a property of the fixture, so the suite behaves the same on an
 * empty database and on a developer's populated one. The two that actually pin the fix are
 * the membership ones: they name the student the phase must exclude, and they fail with
 * the filter reverted rather than merely on an empty table.
 */
const isLocalDb = (process.env['DATABASE_URL'] ?? '').includes('localhost');
const describeLocal = isLocalDb ? describe : describe.skip;

/** Namespaced so cleanup cannot touch a developer's own rows. */
const PREFIX = 'WP209-';

/**
 * Phase values that exist on no other row in any database this suite might run against.
 */
const PHASE_A = 'WP209PhaseA';
const PHASE_B = 'WP209PhaseB';

/**
 * Fixed at 2 (not 1) for every row: `sourceFormat` is the internal signal for which of the
 * 3 source spreadsheets a row came from (see AttendanceRecord.sourceFormat in
 * schema.prisma), and this suite is about `current_phase` scoping, not rate-calculation
 * shape — a value other than 1 keeps `addRow` on the P/A/E code path rather than blending
 * in a pre-aggregated percentage, so the rate under test is the code rate, unambiguously.
 */
const SOURCE_FORMAT = 2;

/**
 * Three students, and attendance rows chosen so the scoped and unscoped answers differ in
 * a way no other data can mask:
 *
 * - **1, 2 — `PHASE_A`, all `P`.** Two students, so `limit: 1` on `by_student` is a
 *   meaningful truncation. All present, so the phase-scoped rate is exactly 100.
 * - **3 — `PHASE_B`, all `A`.** The row a phase-scoped query must exclude, and the reason
 *   the unscoped rate cannot be 100. This is the student the pre-fix tool included in a
 *   `PHASE_A` query.
 */
const FIXTURE = [
  { n: '1', phase: PHASE_A, codes: ['P', 'P', 'P'] },
  { n: '2', phase: PHASE_A, codes: ['P', 'P'] },
  { n: '3', phase: PHASE_B, codes: ['A', 'A'] },
] as const;

const PHASE_A_STUDENTS = [`${PREFIX}1`, `${PREFIX}2`];
const PHASE_B_STUDENT = `${PREFIX}3`;

type Envelope = {
  error?: { code: string; message: string; suggestions?: string[] };
  filters_applied?: Record<string, unknown>;
  filters_ignored?: string[];
  total_students?: number;
  students_returned?: number;
  truncated?: boolean;
  students?: Array<{ student_number: string; attendance_rate_pct: number | null }>;
  total_rows_matched?: number;
  records?: Array<{ student_number: string }>;
  overall?: { student_count: number; attendance_rate_pct: number | null; rows_counted: number };
  breakdown?: Array<{ group: string; rows_counted: number }>;
};

async function seed(): Promise<void> {
  const { prisma } = await import('@lp-ai/lib-db');
  await prisma.attendanceRecord.deleteMany({ where: { sourceId: { startsWith: PREFIX } } });
  await prisma.student.deleteMany({ where: { studentNumber: { startsWith: PREFIX } } });
  for (const f of FIXTURE) {
    await prisma.student.create({
      data: {
        studentNumber: `${PREFIX}${f.n}`,
        canonicalName: `Fixture Student ${f.n}`,
        currentPhase: f.phase,
      },
    });
    for (const [i, code] of f.codes.entries()) {
      await prisma.attendanceRecord.create({
        data: {
          sourceId: `${PREFIX}${f.n}-${String(i)}`,
          sourceFormat: SOURCE_FORMAT,
          studentNumber: `${PREFIX}${f.n}`,
          date: new Date(`2025-03-0${String(i + 1)}`),
          code,
          rowData: {},
        },
      });
    }
  }
}

async function cleanup(): Promise<void> {
  const { prisma } = await import('@lp-ai/lib-db');
  await prisma.attendanceRecord.deleteMany({ where: { sourceId: { startsWith: PREFIX } } });
  await prisma.student.deleteMany({ where: { studentNumber: { startsWith: PREFIX } } });
  await prisma.$disconnect();
}

describeLocal('query_attendance current_phase (live DB)', () => {
  let client: McpStdioClient;

  beforeAll(async () => {
    await seed();
    client = new McpStdioClient();
  });

  afterAll(async () => {
    client.close();
    await cleanup();
  });

  // The reported defect, in the form that makes it visible: the phase must not merely
  // narrow the result, it must exclude a specific named student. Asserting only
  // `scoped <= unscoped` would stay green with the filter reverted.
  it('excludes students outside the phase on by_student, instead of returning every phase', async () => {
    const res = (await client.callTool('query_attendance', {
      query_type: 'by_student',
      current_phase: PHASE_A,
    })) as Envelope;

    const returned = (res.students ?? []).map((s) => s.student_number);
    for (const sn of PHASE_A_STUDENTS) expect(returned).toContain(sn);
    expect(returned).not.toContain(PHASE_B_STUDENT);
    expect(res.filters_applied).toEqual({ current_phase: PHASE_A });

    // And the pre-fix answer, for contrast: unscoped, the excluded student is present.
    const unscoped = (await client.callTool('query_attendance', {
      query_type: 'by_student',
    })) as Envelope;
    expect((unscoped.students ?? []).map((s) => s.student_number)).toContain(PHASE_B_STUDENT);
  });

  it('applies the phase on events, matching a Prisma reference rather than the whole table', async () => {
    const { prisma } = await import('@lp-ai/lib-db');
    const all = await prisma.attendanceRecord.count();
    const reference = await prisma.attendanceRecord.count({
      where: { studentNumber: { in: PHASE_A_STUDENTS } },
    });
    expect(reference).toBeLessThan(all); // the fixture's PHASE_B rows guarantee this

    const res = (await client.callTool('query_attendance', {
      query_type: 'events',
      current_phase: PHASE_A,
      limit: 500,
    })) as Envelope;

    expect(res.total_rows_matched).toBe(reference);
    expect((res.records ?? []).map((r) => r.student_number)).not.toContain(PHASE_B_STUDENT);
  });

  /**
   * The sharp one for the *reported* impact: a phase-scoped rate. The fixture's PHASE_A
   * students are present at every event and its PHASE_B student at none, so the scoped
   * rate is exactly 100 and the unscoped rate cannot be — whatever else is in the
   * database, one absent row drags the org-wide code rate below 100. Pre-fix, both
   * numbers were the same number.
   */
  it('reports the phase rate on aggregate, not the org-wide rate wearing the phase filter', async () => {
    const { prisma } = await import('@lp-ai/lib-db');
    const reference = await prisma.attendanceRecord.count({
      where: { studentNumber: { in: PHASE_A_STUDENTS } },
    });

    const scoped = (await client.callTool('query_attendance', {
      query_type: 'aggregate',
      group_by: 'overall',
      current_phase: PHASE_A,
    })) as Envelope;
    expect(scoped.overall?.attendance_rate_pct).toBe(100);
    expect(scoped.overall?.rows_counted).toBe(reference);
    expect(scoped.overall?.student_count).toBe(PHASE_A_STUDENTS.length);

    const unscoped = (await client.callTool('query_attendance', {
      query_type: 'aggregate',
      group_by: 'overall',
    })) as Envelope;
    expect(unscoped.overall?.attendance_rate_pct).toBeLessThan(100);
    expect(unscoped.overall?.rows_counted).toBeGreaterThan(reference);
  });

  // `group_by: 'current_phase'` is the input the filter was confusable with, and the one
  // that made the missing predicate hard to see by reading. Scoped, the breakdown has one
  // group; that is what proves the two names are now doing different jobs.
  it('narrows the breakdown when both current_phase and group_by:current_phase are given', async () => {
    const res = (await client.callTool('query_attendance', {
      query_type: 'aggregate',
      group_by: 'current_phase',
      current_phase: PHASE_A,
    })) as Envelope;
    expect((res.breakdown ?? []).map((b) => b.group)).toEqual([PHASE_A]);
  });

  it('scopes student_number and current_phase conjunctively rather than keeping only one', async () => {
    // The PHASE_B student is a real student number and PHASE_A is a real phase; the pair
    // matches nothing. That must be zero, not "every row for that student" and not an
    // error — `where.studentNumber` assigned twice would have silently kept one of them.
    const res = (await client.callTool('query_attendance', {
      query_type: 'events',
      student_number: PHASE_B_STUDENT,
      current_phase: PHASE_A,
    })) as Envelope;
    expect(res.error).toBeUndefined();
    expect(res.total_rows_matched).toBe(0);

    // Same student, own phase: the rows are there, so the zero above was the conjunction.
    const own = (await client.callTool('query_attendance', {
      query_type: 'events',
      student_number: PHASE_B_STUDENT,
      current_phase: PHASE_B,
    })) as Envelope;
    expect(own.total_rows_matched).toBeGreaterThan(0);
  });
});

/**
 * Unmatchable values, in pairs. A suite that only asserts the error would stay green if
 * the check erred on *every* empty result — replacing a false superset with a false error
 * and breaking every truthful zero in the tool.
 */
describeLocal('query_attendance unmatchable filter values (live DB)', () => {
  let client: McpStdioClient;

  beforeAll(async () => {
    await seed();
    client = new McpStdioClient();
  });

  afterAll(async () => {
    client.close();
    await cleanup();
  });

  it('errors on a phase no attendance-carrying student holds, listing the phases present', async () => {
    const unfiltered = (await client.callTool('query_attendance', {
      query_type: 'by_student',
    })) as Envelope;
    // Proves an empty answer would have been the filter's doing, not an empty table.
    expect(unfiltered.total_students ?? 0).toBeGreaterThan(0);

    const res = (await client.callTool('query_attendance', {
      query_type: 'by_student',
      current_phase: 'Phase Nine',
    })) as Envelope;

    expect(res.total_students).toBeUndefined();
    expect(res.error?.code).toBe('no_records');
    expect(res.error?.message).toContain("current_phase='Phase Nine'");
    expect(res.error?.message).toContain('students.current_phase');
    expect(res.error?.message).toContain(PHASE_A);
    expect(res.error?.suggestions?.length ?? 0).toBeGreaterThan(0);
  });

  // Checked once ahead of the branches, so no query_type can answer differently.
  it('errors on the same value from every query_type', async () => {
    for (const query_type of ['by_student', 'aggregate', 'events']) {
      const res = (await client.callTool('query_attendance', {
        query_type,
        current_phase: 'Phase Nine',
      })) as Envelope;
      expect(res.error?.code).toBe('no_records');
    }
  });

  // Cohort is not domain-checked like current_phase — it is rejected outright, regardless
  // of whether the value happens to exist anywhere, since the concept itself was removed.
  it('rejects any cohort filter with cohort_not_supported, not a domain check', async () => {
    const res = (await client.callTool('query_attendance', {
      query_type: 'aggregate',
      cohort: 1899,
    })) as Envelope;
    expect(res.error?.code).toBe('cohort_not_supported');

    const byCohortGroup = (await client.callTool('query_attendance', {
      query_type: 'aggregate',
      group_by: 'cohort',
    })) as Envelope;
    expect(byCohortGroup.error?.code).toBe('cohort_not_supported');
  });

  // A blank means "no filter" — sending it through the domain check would error on the
  // empty string, which is not a value the caller asked to match. It is *named* because
  // dropping it silently is the same unscoping the rest of this file is about.
  it('does not domain-check a blank current_phase, and says it ignored it', async () => {
    const blank = (await client.callTool('query_attendance', {
      query_type: 'by_student',
      current_phase: '   ',
    })) as Envelope;
    const absent = (await client.callTool('query_attendance', {
      query_type: 'by_student',
    })) as Envelope;

    expect(blank.error).toBeUndefined();
    expect(blank.total_students).toBe(absent.total_students);
    expect(blank.filters_ignored).toEqual(['current_phase']);
    expect(absent.filters_ignored).toBeUndefined(); // absent is not blank
  });
});

/**
 * `limit` was the tool's other declared-and-partly-read input: only the `events` branch
 * ever read it, so a caller who asked `by_student` for ten students got every student, and
 * `aggregate` reported nothing about having ignored it.
 */
describeLocal('query_attendance limit (live DB)', () => {
  let client: McpStdioClient;

  beforeAll(async () => {
    await seed();
    client = new McpStdioClient();
  });

  afterAll(async () => {
    client.close();
    await cleanup();
  });

  it('pages by_student on limit, keeping the matched total separate from the page size', async () => {
    const res = (await client.callTool('query_attendance', {
      query_type: 'by_student',
      current_phase: PHASE_A,
      limit: 1,
    })) as Envelope;

    expect(res.total_students).toBe(PHASE_A_STUDENTS.length); // 2 matched
    expect(res.students).toHaveLength(1); // 1 returned
    expect(res.students_returned).toBe(1);
    expect(res.truncated).toBe(true);
    expect(res.filters_applied).toEqual({ current_phase: PHASE_A, limit: 1 });
  });

  it('returns the page in a stable order rather than whatever Postgres yields', async () => {
    const first = (await client.callTool('query_attendance', {
      query_type: 'by_student',
      current_phase: PHASE_A,
      limit: 1,
    })) as Envelope;
    const second = (await client.callTool('query_attendance', {
      query_type: 'by_student',
      current_phase: PHASE_A,
      limit: 1,
    })) as Envelope;
    expect(first.students?.[0]?.student_number).toBe(`${PREFIX}1`);
    expect(second.students?.[0]?.student_number).toBe(first.students?.[0]?.student_number);
  });

  it('names limit as ignored on aggregate rather than appearing to have applied it', async () => {
    const res = (await client.callTool('query_attendance', {
      query_type: 'aggregate',
      group_by: 'overall',
      current_phase: PHASE_A,
      limit: 1,
    })) as Envelope;
    expect(res.filters_applied).toEqual({ current_phase: PHASE_A });
    expect(res.filters_ignored).toEqual(['limit']);
    // And it really was ignored: both students are still counted.
    expect(res.overall?.student_count).toBe(PHASE_A_STUDENTS.length);
  });

  /**
   * Both row-returning branches clamp — `events` at 500, `by_student` at 1000 — and the echo used
   * to report the caller's number, so an envelope could say `limit: 5000` while `truncated: true`
   * in the same object said the opposite. The echo is the clamp now.
   */
  it('echoes the clamped limit rather than an over-large ask', async () => {
    const events = (await client.callTool('query_attendance', {
      query_type: 'events',
      current_phase: PHASE_A,
      limit: 5000,
    })) as Envelope;
    expect(events.filters_applied).toEqual({ current_phase: PHASE_A, limit: 500 });

    const byStudent = (await client.callTool('query_attendance', {
      query_type: 'by_student',
      current_phase: PHASE_A,
      limit: 5000,
    })) as Envelope;
    expect(byStudent.filters_applied).toEqual({ current_phase: PHASE_A, limit: 1000 });
  });

  it('returns every matched student when no limit is given', async () => {
    const res = (await client.callTool('query_attendance', {
      query_type: 'by_student',
      current_phase: PHASE_A,
    })) as Envelope;
    expect(res.students).toHaveLength(PHASE_A_STUDENTS.length);
    expect(res.truncated).toBe(false);
  });
});
