import { prisma } from './client.js';
import { linkAlias } from './entity-resolution.js';

interface SeedStudent {
  studentNumber: string;
  canonicalName: string;
  email: string;
  currentPhase: string;
  enrollmentStatus: string;
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

/**
 * Development CRM rows, in the `development:*` shape `sync-development-crm.ts` writes and
 * `query_donors` / `get_entity_brief` / `get_finance_brief` read since #306.
 *
 * These mirror {@link DONORS} deliberately. `DONORS` seeds `donor_contacts` / `donor_gifts` /
 * `donor_pipeline`, which **no connector has ever written** — the three tools that read them were
 * dead in production, and #306 repointed them here. The typed tables are left seeded so anything
 * still reading them keeps working, but they are no longer the donor path.
 *
 * The column keys are copied from live `query_finances dev_*` responses, not invented, because the
 * connector derives them from the sheet's own header row: a key that does not match the sheet would
 * make the seed exercise a schema that only exists in the seed.
 *
 * William Penn is given the real two-gifts-per-year shape ($425,000 Launchpad + $75,000 Network)
 * rather than one round number, so the `by_project` split and `launchpad_only` scoping are actually
 * covered locally. A single-project fixture would pass whether or not scoping worked.
 */
const DEV_CRM = [
  {
    sourceId: 'development:contacts:2',
    tabName: 'development:contacts',
    period: null,
    rowData: {
      contact_id: 'D-197',
      donor_name: 'William Penn Foundation',
      status: 'Active',
      projects: 'Launchpad, Network',
      primary_fund: 'Network Unrestricted, William Penn',
      donor_type_coa: '4000.11 - Foundations',
      primary_first_name: 'Stephanie',
      primary_last_name: 'Waller',
      primary_email: 'grants@williampennfoundation.org',
      relationship_owner: 'Development',
      // Left wrong on purpose: this is what the real sheet serves for this funder, and the tools
      // must not read it. See dev-crm.ts::summariseGiving.
      lifetime_giving: '$0.00',
      fy25_giving: '$0.00',
      cy2025_giving: '$500,000.00',
    },
  },
  {
    sourceId: 'development:contacts:3',
    tabName: 'development:contacts',
    period: null,
    rowData: {
      contact_id: 'D-042',
      donor_name: 'Christian Anonymous',
      status: 'Active',
      projects: 'Launchpad',
      primary_fund: 'Launchpad Unrestricted',
      donor_type_coa: '4000.12 - Individuals',
      primary_first_name: 'Christian',
      primary_last_name: 'Anonymous',
      primary_email: 'christian@example.org',
      lifetime_giving: '$5,100.00',
    },
  },
  {
    sourceId: 'development:giving history:2',
    tabName: 'development:giving history',
    period: null,
    rowData: {
      gift_id: 'G-0431', contact_id: 'D-197', donor_name: 'William Penn Foundation',
      date: 'Aug 2024', fiscal_year: 'FY25', gross_amount: '$425,000.00',
      fund_name: 'William Penn', project: 'Launchpad', grant_status: 'Funded',
    },
  },
  {
    sourceId: 'development:giving history:3',
    tabName: 'development:giving history',
    period: null,
    rowData: {
      gift_id: 'G-0430', contact_id: 'D-197', donor_name: 'William Penn Foundation',
      date: 'Aug 2024', fiscal_year: 'FY25', gross_amount: '$75,000.00',
      fund_name: 'Network Unrestricted', project: 'Network', grant_status: 'Funded',
    },
  },
  {
    sourceId: 'development:giving history:4',
    tabName: 'development:giving history',
    period: null,
    rowData: {
      gift_id: 'G-0500', contact_id: 'D-042', donor_name: 'Christian Anonymous',
      date: 'Mar 2026', fiscal_year: 'FY26', gross_amount: '$5,000.00',
      fund_name: 'Launchpad Unrestricted', project: 'Launchpad', grant_status: 'Funded',
    },
  },
  {
    sourceId: 'development:giving history:5',
    tabName: 'development:giving history',
    period: null,
    rowData: {
      gift_id: 'G-0501', contact_id: 'D-042', donor_name: 'Christian Anonymous',
      date: 'Apr 2026', fiscal_year: 'FY26', gross_amount: '$100.00',
      fund_name: 'Launchpad Unrestricted', project: 'Launchpad', grant_status: 'Funded',
      recurring: 'Yes',
    },
  },
  {
    sourceId: 'development:grants tracker:2',
    tabName: 'development:grants tracker',
    period: null,
    rowData: {
      contact_id: 'D-197', funder: 'William Penn Foundation', coa: '4000.11 - Foundations',
      status: 'Funded', lifecycle: 'Active', project_s: 'Launchpad, Network',
      fund_s: 'Network Unrestricted, William Penn',
      lifetime_total: '$500,000.00', received_to_date: '$500,000.00',
      outstanding_pledge: '$0.00', unfunded_pledges: '$0.00',
      // The withholding markers the real tracker carries. `cell()` must return null for these.
      owner: '[VP]', deadline: '[VP]', po_contact: '[VP]', gh_grant_agree: 'NOT YET MARKED',
    },
  },
  {
    sourceId: 'development:prospect pipeline:2',
    tabName: 'development:prospect pipeline',
    period: null,
    rowData: {
      contact_id: 'D-197', donor_name: 'William Penn Foundation', prospect_id: 'P-0041',
      month: 'Nov 2026', fiscal_year: 'FY27', fund_name: 'Launchpad Unrestricted',
      project: 'Launchpad', grant_status: 'Prospect', gross_amount: '$225,000',
      projected_amt: '$45,000', weighted: '20%',
    },
  },
  {
    sourceId: 'development:denied:2',
    tabName: 'development:denied',
    period: null,
    rowData: {
      donor_name: 'Eagles Social Justic Fund', month: 'Nov 2022', project: 'Launchpad',
      fund_name: 'Launchpad Unrestricted', grant_status: 'Denied', gross_amount: '$25,000',
      committed_amt: '$0',
    },
  },
] as const;

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
): Promise<{ studentsInserted: number; donorsInserted: number; devCrmRowsInserted: number }> {
  const force = opts.force ?? process.env['SEED_FORCE'] === 'true';

  if (!force) {
    const [studentCount, donorCount] = await Promise.all([
      prisma.student.count(),
      prisma.donorContact.count(),
    ]);
    if (studentCount > 0 || donorCount > 0) {
      return { studentsInserted: 0, donorsInserted: 0, devCrmRowsInserted: 0 };
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

  for (const d of DEV_CRM) {
    await prisma.financeSnapshot.create({ data: { ...d, rowData: { ...d.rowData } } });
  }

  return {
    studentsInserted: STUDENTS.length,
    donorsInserted: DONORS.length,
    devCrmRowsInserted: DEV_CRM.length,
  };
}
