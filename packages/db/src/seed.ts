import { prisma } from './client.js';
import { linkAlias } from './entity-resolution.js';

interface SeedStudent {
  studentNumber: string;
  canonicalName: string;
  email: string;
  currentPhase: string;
  enrollmentStatus: string;
  cohort: number;
  neighborhood: string;
  zip: string;
  schoolName: string;
  hsGraduationYear: number;
  dob: string;
  withdrawalCode?: string;
  withdrawalDate?: string;
  aliases: Array<{ alias: string; source: string }>;
  certifications: Array<{ type: string; phase: string; result: string; score: number; date: string }>;
}

const STUDENTS: SeedStudent[] = [
  {
    studentNumber: 'LP1042',
    canonicalName: 'Maria Garcia',
    email: 'maria.garcia@example.org',
    currentPhase: '101',
    enrollmentStatus: 'E',
    cohort: 2,
    neighborhood: 'Kensington',
    zip: '19125',
    schoolName: 'Kensington CAPA',
    hsGraduationYear: 2025,
    dob: '2007-04-12',
    aliases: [
      { alias: 'Maria Garcia', source: 'drive' },
      { alias: 'Maria G.', source: 'drive' },
      { alias: '@maria.g', source: 'slack' },
      { alias: 'LP1042', source: 'bigquery' },
    ],
    certifications: [
      { type: 'PCEP', phase: '101', result: 'Pass', score: 82, date: '2026-02-10' },
    ],
  },
  {
    studentNumber: 'LP1051',
    canonicalName: 'Tai Pham',
    email: 'tai.pham@example.org',
    currentPhase: 'Foundations',
    enrollmentStatus: 'W',
    cohort: 3,
    neighborhood: 'Olney',
    zip: '19141',
    schoolName: 'Olney High School',
    hsGraduationYear: 2024,
    dob: '2006-09-30',
    withdrawalCode: 'W2',
    withdrawalDate: '2026-03-01',
    aliases: [
      { alias: 'Tai Pham', source: 'drive' },
      { alias: '@tai.p', source: 'slack' },
      { alias: 'LP1051', source: 'bigquery' },
    ],
    certifications: [
      { type: 'PCEP', phase: '101', result: 'Pass', score: 90, date: '2026-02-12' },
    ],
  },
  {
    studentNumber: 'LP1078',
    canonicalName: 'Janelle Brooks',
    email: 'janelle.brooks@example.org',
    currentPhase: 'LiftOff',
    enrollmentStatus: 'E',
    cohort: 1,
    neighborhood: 'West Philly',
    zip: '19139',
    schoolName: 'West Philadelphia High School',
    hsGraduationYear: 2025,
    dob: '2007-01-22',
    aliases: [
      { alias: 'Janelle Brooks', source: 'drive' },
      { alias: 'Jay Brooks', source: 'drive' },
      { alias: '@janelle', source: 'slack' },
      { alias: 'LP1078', source: 'bigquery' },
    ],
    certifications: [
      { type: 'PCEP', phase: '101', result: 'Fail', score: 58, date: '2026-02-14' },
    ],
  },
];

const DONORS = [
  {
    organizationName: 'William Penn Foundation',
    email: 'grants@williampennfoundation.org',
    gifts: [
      { amount: 250000, giftDate: '2026-01-15', fund: 'Launchpad General', campaignName: 'Annual Grant', isRecurring: false },
    ],
    pipeline: [{ stage: 'Cultivation', askAmount: 500000, likelihood: 'Medium', notes: 'Q4 ask' }],
  },
  {
    firstName: 'Christian',
    lastName: 'Anonymous',
    email: 'christian@example.org',
    gifts: [
      { amount: 5000, giftDate: '2026-03-01', fund: 'Launchpad General', campaignName: 'Spring Appeal', isRecurring: false },
      { amount: 100, giftDate: '2026-04-01', fund: 'Launchpad General', campaignName: 'Monthly Sustainer', isRecurring: true },
    ],
    pipeline: [],
  },
];

const FINANCE = [
  {
    sourceId: 'seed:fund_balances:1',
    tabName: 'fund_balances',
    period: '2026-Q1',
    rowData: { account: 'Launchpad General', amount: 1240000, fund: 'Launchpad' },
  },
  {
    sourceId: 'seed:fund_balances:2',
    tabName: 'fund_balances',
    period: '2026-Q1',
    rowData: { account: 'LiftOff', amount: 380000, fund: 'LiftOff' },
  },
  {
    sourceId: 'seed:ytd:1',
    tabName: 'ytd',
    period: '2026 YTD',
    rowData: { account: 'Salaries', amount: -540000, fund: 'Launchpad' },
  },
  {
    sourceId: 'seed:ytd:2',
    tabName: 'ytd',
    period: '2026 YTD',
    rowData: { account: 'Stipends', amount: -94000, fund: 'Launchpad' },
  },
];

export async function seed(
  opts: { force?: boolean } = {},
): Promise<{ studentsInserted: number; donorsInserted: number }> {
  const force = opts.force ?? process.env['SEED_FORCE'] === 'true';

  if (!force) {
    const [studentCount, donorCount] = await Promise.all([
      prisma.student.count(),
      prisma.donorContact.count(),
    ]);
    if (studentCount > 0 || donorCount > 0) {
      return { studentsInserted: 0, donorsInserted: 0 };
    }
  }

  await prisma.attendanceRecord.deleteMany();
  await prisma.studentCertification.deleteMany();
  await prisma.studentCompetency.deleteMany();
  await prisma.studentPhaseOutcome.deleteMany();
  await prisma.studentInfo.deleteMany();
  await prisma.studentEmployment.deleteMany();
  await prisma.studentPostsecondary.deleteMany();
  await prisma.entityAlias.deleteMany();
  await prisma.student.deleteMany();
  await prisma.donorGift.deleteMany();
  await prisma.donorPipeline.deleteMany();
  await prisma.donorContact.deleteMany();
  await prisma.financeSnapshot.deleteMany();

  for (const s of STUDENTS) {
    const student = await prisma.student.create({
      data: {
        studentNumber: s.studentNumber,
        canonicalName: s.canonicalName,
        email: s.email,
        currentPhase: s.currentPhase,
        enrollmentStatus: s.enrollmentStatus,
        cohort: s.cohort,
        neighborhood: s.neighborhood,
        zip: s.zip,
        schoolName: s.schoolName,
        hsGraduationYear: s.hsGraduationYear,
        dob: new Date(s.dob),
        withdrawalCode: s.withdrawalCode ?? null,
        withdrawalDate: s.withdrawalDate ? new Date(s.withdrawalDate) : null,
      },
    });
    for (const a of s.aliases) {
      await linkAlias({
        alias: a.alias,
        entityType: 'student',
        entityId: student.id,
        source: a.source,
      });
    }
    for (const c of s.certifications) {
      await prisma.studentCertification.create({
        data: {
          sourceId: `seed:certification:${s.studentNumber}:${c.type}`,
          studentId: student.id,
          type: c.type,
          phase: c.phase,
          result: c.result,
          score: c.score,
          date: c.date,
        },
      });
    }
  }

  for (const d of DONORS) {
    const donor = await prisma.donorContact.create({
      data: {
        firstName: d.firstName ?? null,
        lastName: d.lastName ?? null,
        organizationName: d.organizationName ?? null,
        email: d.email,
      },
    });
    for (const g of d.gifts) {
      await prisma.donorGift.create({
        data: { ...g, donorContactId: donor.id },
      });
    }
    for (const p of d.pipeline) {
      await prisma.donorPipeline.create({
        data: { ...p, donorContactId: donor.id },
      });
    }
  }

  for (const f of FINANCE) {
    await prisma.financeSnapshot.create({ data: f });
  }

  return { studentsInserted: STUDENTS.length, donorsInserted: DONORS.length };
}
