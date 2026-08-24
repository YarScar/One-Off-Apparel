import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { McpStdioClient } from './mcp-client.js';

/**
 * Finishing the pass `#207` deliberately scoped to `query_enrollment` alone (OpenProject
 * `#210`). These three tools take a free-text filter, apply it as an exact column match,
 * enumerate nothing, and returned a well-formed empty answer for a value that cannot
 * match — the same shape, and in `query_students`' case the same *columns*: it filters
 * `students.enrollment_status` and `students.current_phase` with the same short source
 * codes, so the identical `enrollment_status: 'Active'` → confident zero was reachable
 * through it after #207 closed the other door.
 *
 * Every case comes in a pair, for the reason `#207`'s suite documents: a suite that only
 * asserts the error stays green if the check fires on *every* empty result, which replaces
 * a false zero with a false error and breaks every truthful zero in the tool.
 *
 * The rule under test, restated once for all three: **a value absent from its own
 * column's distinct values errors; a combination of values that are each present returns
 * an empty answer.**
 */
const isLocalDb = (process.env['DATABASE_URL'] ?? '').includes('localhost');
const describeLocal = isLocalDb ? describe : describe.skip;

/** Namespaced so cleanup cannot touch a developer's own rows. */
const PREFIX = 'WP210-';

/**
 * Values that exist on no other row in any database this suite might run against. Each
 * column gets an A and a B value held by disjoint students, which is what makes an
 * A-plus-B query a *guaranteed* zero rather than a probable one: both values are present,
 * so the domain check must pass them, and no row carries both.
 */
const STATUS_A = 'WP210StatusA';
const STATUS_B = 'WP210StatusB';
const PHASE_A = 'WP210PhaseA';
const PHASE_B = 'WP210PhaseB';
const WITHDRAWAL_A = 'WP210WdA';
const WITHDRAWAL_B = 'WP210WdB';
const HS_YEAR_A = 2103;
const HS_YEAR_B = 2104;

/** NSC-shaped but namespaced, so no real single-letter code collides with them. */
const PS_STATUS_A = 'WP210PsF';
const PS_STATUS_B = 'WP210PsW';
const PS_LEVEL_A = 'WP210PsJ';
const PS_LEVEL_B = 'WP210PsR';

const CERT_PHASE_A = 'WP210CertPhaseA';
const CERT_PHASE_B = 'WP210CertPhaseB';
const CERT_TYPE = 'WP210CertType';

/**
 * Two students, holding the A values and the B values respectively, with one
 * postsecondary row and one certification row each. Two is the minimum that makes every
 * "A plus B is empty, A alone is not" assertion below a property of the fixture.
 */
const STUDENTS = [
  {
    n: '1',
    enrollmentStatus: STATUS_A,
    currentPhase: PHASE_A,
    hsGraduationYear: HS_YEAR_A,
    withdrawalCode: WITHDRAWAL_A,
    ps: { enrollmentStatus: PS_STATUS_A, classLevel: PS_LEVEL_A },
    cert: { phase: CERT_PHASE_A, result: 'Pass', score: 900 },
  },
  {
    n: '2',
    enrollmentStatus: STATUS_B,
    currentPhase: PHASE_B,
    hsGraduationYear: HS_YEAR_B,
    withdrawalCode: WITHDRAWAL_B,
    ps: { enrollmentStatus: PS_STATUS_B, classLevel: PS_LEVEL_B },
    cert: { phase: CERT_PHASE_B, result: 'Fail', score: 400 },
  },
] as const;

type Envelope = {
  error?: { code: string; message: string; suggestions?: string[] };
  student_count?: number;
  students?: unknown[];
  breakdown?: unknown[];
  total?: number;
  passed?: number;
  pass_rate_pct?: number | null;
  total_records?: number;
  record_count?: number;
  distinct_students?: number;
  n?: number;
};

async function seed(): Promise<void> {
  const { prisma } = await import('@lp-ai/lib-db');
  await cleanRows();
  for (const s of STUDENTS) {
    const studentNumber = `${PREFIX}${s.n}`;
    await prisma.student.create({
      data: {
        studentNumber,
        canonicalName: `Fixture Student ${s.n}`,
        enrollmentStatus: s.enrollmentStatus,
        currentPhase: s.currentPhase,
        hsGraduationYear: s.hsGraduationYear,
        withdrawalCode: s.withdrawalCode,
        distanceToOffice: 5,
        certifications: {
          create: {
            sourceId: `${PREFIX}cert-${s.n}`,
            type: CERT_TYPE,
            phase: s.cert.phase,
            result: s.cert.result,
            score: s.cert.score,
            date: '2025-05-01',
          },
        },
      },
    });
    await prisma.studentPostsecondary.create({
      data: {
        sourceId: `${PREFIX}ps-${s.n}`,
        studentNumber,
        institution: `${PREFIX}University`,
        enrollmentStatus: s.ps.enrollmentStatus,
        classLevel: s.ps.classLevel,
        graduated: false,
      },
    });
  }
}

async function cleanRows(): Promise<void> {
  const { prisma } = await import('@lp-ai/lib-db');
  await prisma.studentPostsecondary.deleteMany({ where: { sourceId: { startsWith: PREFIX } } });
  await prisma.studentCertification.deleteMany({ where: { sourceId: { startsWith: PREFIX } } });
  // Certifications cascade on student delete; postsecondary does not, hence the order.
  await prisma.student.deleteMany({ where: { studentNumber: { startsWith: PREFIX } } });
}

async function cleanup(): Promise<void> {
  const { prisma } = await import('@lp-ai/lib-db');
  await cleanRows();
  await prisma.$disconnect();
}

/** One client and one fixture for all three tools — they share the same student rows. */
function withServer(): { client: () => McpStdioClient } {
  let c: McpStdioClient;
  beforeAll(async () => {
    await seed();
    c = new McpStdioClient();
  });
  afterAll(async () => {
    c.close();
    await cleanup();
  });
  return { client: () => c };
}

/**
 * `query_students` is the one that matters, and the reason #210 says to do it first: same
 * `students` columns as `query_enrollment`, same codes, same `'Active'` failure available
 * today through a different tool.
 */
describeLocal('query_students unmatchable filter values (live DB)', () => {
  const { client } = withServer();

  it('errors on the reported value rather than returning an empty list', async () => {
    const unfiltered = (await client().callTool('query_students', {
      query_type: 'list',
    })) as Envelope;
    // Proves the empty answer would be the filter's doing, not an empty table.
    expect(unfiltered.student_count ?? 0).toBeGreaterThan(0);

    const res = (await client().callTool('query_students', {
      query_type: 'list',
      enrollment_status: 'Active',
    })) as Envelope;

    expect(res.students).toBeUndefined();
    expect(res.error?.code).toBe('no_records');
    expect(res.error?.message).toContain("enrollment_status='Active'");
    expect(res.error?.message).toContain('students.enrollment_status');
    expect(res.error?.message).toContain(STATUS_A);
    expect(res.error?.suggestions?.length ?? 0).toBeGreaterThan(0);
  });

  // Checked once ahead of the branches, so no query_type answers differently — the
  // per-branch divergence #207's suite exists for.
  it('errors identically on all three query types', async () => {
    for (const query_type of ['list', 'breakdown', 'numeric_stats']) {
      const res = (await client().callTool('query_students', {
        query_type,
        field: query_type === 'numeric_stats' ? 'distance_to_office' : 'current_phase',
        enrollment_status: 'Active',
      })) as Envelope;
      expect(res.error?.code).toBe('no_records');
      expect(res.students).toBeUndefined();
      expect(res.breakdown).toBeUndefined();
      expect(res.n).toBeUndefined();
    }
  });

  it('errors on each of the four exact-match filters, naming its own column', async () => {
    const cases = [
      { input: { current_phase: 'Phase Nine' }, column: 'students.current_phase', present: PHASE_A },
      {
        input: { hs_graduation_year: 1899 },
        column: 'students.hs_graduation_year',
        present: String(HS_YEAR_A),
      },
      {
        input: { withdrawal_code: 'Moved To Mars' },
        column: 'students.withdrawal_code',
        present: WITHDRAWAL_A,
      },
    ] as const;

    for (const c of cases) {
      const res = (await client().callTool('query_students', {
        query_type: 'list',
        ...c.input,
      })) as Envelope;
      expect(res.error?.code, JSON.stringify(c.input)).toBe('no_records');
      expect(res.error?.message).toContain(c.column);
      expect(res.error?.message).toContain(c.present);
    }
  });

  /**
   * The other direction. `PHASE_A` and `STATUS_B` are both real values in their columns;
   * no student carries both. That is a fact about the program, so it must come back as
   * zero — and this is the case that fails if a domain is ever scoped by its siblings.
   */
  it('returns a real zero, not an error, for present values that no student combines', async () => {
    const { prisma } = await import('@lp-ai/lib-db');
    const reference = await prisma.student.count({
      where: { currentPhase: PHASE_A, enrollmentStatus: STATUS_B },
    });
    expect(reference).toBe(0); // guaranteed by the fixture, not assumed
    // Each value on its own does match, which is what separates this from the cases above.
    expect(await prisma.student.count({ where: { currentPhase: PHASE_A } })).toBeGreaterThan(0);
    expect(await prisma.student.count({ where: { enrollmentStatus: STATUS_B } })).toBeGreaterThan(0);

    const list = (await client().callTool('query_students', {
      query_type: 'list',
      current_phase: PHASE_A,
      enrollment_status: STATUS_B,
    })) as Envelope;
    expect(list.error).toBeUndefined();
    expect(list.student_count).toBe(0);
    expect(list.students).toEqual([]);

    const breakdown = (await client().callTool('query_students', {
      query_type: 'breakdown',
      field: 'current_phase',
      current_phase: PHASE_A,
      enrollment_status: STATUS_B,
    })) as Envelope;
    expect(breakdown.error).toBeUndefined();
    expect(breakdown.breakdown).toEqual([]);
  });

  // `school` is a `contains` match and is deliberately not domain-checked (#210 keeps the
  // substring filters out of scope). A needle matching nothing must therefore still be a
  // silent zero here — asserted so the boundary is a decision on the record, not an
  // oversight someone later "fixes" by accident.
  it('does not domain-check the substring school filter', async () => {
    const res = (await client().callTool('query_students', {
      query_type: 'list',
      school: 'No Such School Anywhere',
    })) as Envelope;
    expect(res.error).toBeUndefined();
    expect(res.student_count).toBe(0);
  });

  it('treats a blank filter as absent rather than domain-checking the empty string', async () => {
    const blank = (await client().callTool('query_students', {
      query_type: 'list',
      enrollment_status: '   ',
    })) as Envelope;
    const absent = (await client().callTool('query_students', {
      query_type: 'list',
    })) as Envelope;
    expect(blank.error).toBeUndefined();
    expect(blank.student_count).toBe(absent.student_count);
  });
});

describeLocal('query_postsecondary unmatchable filter values (live DB)', () => {
  const { client } = withServer();

  it('errors on an enrollment_status absent from the column, not on every query type silently', async () => {
    const unfiltered = (await client().callTool('query_postsecondary', {
      query_type: 'summary',
    })) as Envelope;
    expect(unfiltered.total_records ?? 0).toBeGreaterThan(0);

    const res = (await client().callTool('query_postsecondary', {
      query_type: 'summary',
      enrollment_status: 'Enrolled',
    })) as Envelope;
    expect(res.total_records).toBeUndefined();
    expect(res.error?.code).toBe('no_records');
    expect(res.error?.message).toContain("enrollment_status='Enrolled'");
    expect(res.error?.message).toContain('student_postsecondary.enrollment_status');
    expect(res.error?.message).toContain(PS_STATUS_A);
  });

  it('errors on an unmatchable class_level, and on every query type alike', async () => {
    for (const query_type of ['summary', 'records', 'graduates', 'by_institution', 'by_status', 'by_class_level']) {
      const res = (await client().callTool('query_postsecondary', {
        query_type,
        class_level: 'Sophomore',
      })) as Envelope;
      expect(res.error?.code, query_type).toBe('no_records');
      expect(res.error?.message).toContain('student_postsecondary.class_level');
      expect(res.error?.message).toContain(PS_LEVEL_A);
    }
  });

  it('returns a real zero for present codes that no record combines', async () => {
    const { prisma } = await import('@lp-ai/lib-db');
    const reference = await prisma.studentPostsecondary.count({
      where: { enrollmentStatus: PS_STATUS_A, classLevel: PS_LEVEL_B },
    });
    expect(reference).toBe(0);
    expect(
      await prisma.studentPostsecondary.count({ where: { enrollmentStatus: PS_STATUS_A } }),
    ).toBeGreaterThan(0);
    expect(
      await prisma.studentPostsecondary.count({ where: { classLevel: PS_LEVEL_B } }),
    ).toBeGreaterThan(0);

    const res = (await client().callTool('query_postsecondary', {
      query_type: 'summary',
      enrollment_status: PS_STATUS_A,
      class_level: PS_LEVEL_B,
    })) as Envelope;
    expect(res.error).toBeUndefined();
    expect(res.total_records).toBe(0);
    expect(res.distinct_students).toBe(0);

    const records = (await client().callTool('query_postsecondary', {
      query_type: 'records',
      enrollment_status: PS_STATUS_A,
      class_level: PS_LEVEL_B,
    })) as Envelope;
    expect(records.error).toBeUndefined();
    expect(records.record_count).toBe(0);
  });

  // `institution` is a `contains` filter, deliberately out of scope for the same reason as
  // `query_students.school`.
  it('does not domain-check the substring institution filter', async () => {
    const res = (await client().callTool('query_postsecondary', {
      query_type: 'summary',
      institution: 'No Such University Anywhere',
    })) as Envelope;
    expect(res.error).toBeUndefined();
    expect(res.total_records).toBe(0);
  });
});

describeLocal('query_certifications unmatchable filter values (live DB)', () => {
  const { client } = withServer();

  /**
   * The worst-reading silent zero of the three: `summary` answered
   * `{ total: 0, passed: 0, pass_rate_pct: null }`, which is not "you asked for a phase
   * that does not exist" but "nobody in that phase has certified".
   */
  it('errors on an unmatchable phase rather than reporting zero of zero passed', async () => {
    const unfiltered = (await client().callTool('query_certifications', {
      query_type: 'summary',
    })) as Envelope;
    expect(unfiltered.total ?? 0).toBeGreaterThan(0);

    const res = (await client().callTool('query_certifications', {
      query_type: 'summary',
      phase: 'Phase Nine',
    })) as Envelope;
    expect(res.total).toBeUndefined();
    expect(res.pass_rate_pct).toBeUndefined();
    expect(res.error?.code).toBe('no_records');
    expect(res.error?.message).toContain("phase='Phase Nine'");
    expect(res.error?.message).toContain('student_certifications.phase');
    expect(res.error?.message).toContain(CERT_PHASE_A);
  });

  it('errors alike on every query type, including the raw-SQL by_zip branch', async () => {
    for (const query_type of ['summary', 'scores', 'by_type', 'by_phase', 'by_result', 'by_zip']) {
      const res = (await client().callTool('query_certifications', {
        query_type,
        phase: 'Phase Nine',
      })) as Envelope;
      expect(res.error?.code, query_type).toBe('no_records');
      expect(res.breakdown).toBeUndefined();
    }
  });

  /**
   * `CERT_PHASE_A` is a real phase and `Fail` a real result; the fixture's only Fail is in
   * `CERT_PHASE_B`, so the pair is an empty combination of real values. `result` is a
   * `z.enum` and so has no unmatchable form of its own — which is exactly why it makes a
   * clean second half for this pair.
   */
  it('returns a real zero for a present phase with a result no one in it holds', async () => {
    const { prisma } = await import('@lp-ai/lib-db');
    const reference = await prisma.studentCertification.count({
      where: { phase: CERT_PHASE_A, result: 'Fail' },
    });
    expect(reference).toBe(0);
    expect(await prisma.studentCertification.count({ where: { phase: CERT_PHASE_A } })).toBeGreaterThan(0);
    expect(await prisma.studentCertification.count({ where: { result: 'Fail' } })).toBeGreaterThan(0);

    const res = (await client().callTool('query_certifications', {
      query_type: 'summary',
      phase: CERT_PHASE_A,
      result: 'Fail',
    })) as Envelope;
    expect(res.error).toBeUndefined();
    expect(res.total).toBe(0);
    expect(res.pass_rate_pct).toBeNull();
  });

  // `type` is listed beside `phase` in #210's table but is a `contains` match, so it falls
  // under that ticket's out-of-scope substring class. Pinned so the distinction is
  // deliberate rather than forgotten.
  it('does not domain-check the substring type filter', async () => {
    const res = (await client().callTool('query_certifications', {
      query_type: 'summary',
      type: 'No Such Certification Anywhere',
    })) as Envelope;
    expect(res.error).toBeUndefined();
    expect(res.total).toBe(0);
  });
});
