import { prisma, linkAlias } from '@lp-ai/lib-db';
import { getSheetRows } from './sheets-client.js';
import {
  EXPECTED_STUDENTS_V2_HEADERS,
  EXPECTED_OUTCOMES_TAB_HEADERS,
  parseStudentV2Row,
  parseCertificationRow,
  parseOutcomesRow,
  parseOutcomesTabRow,
} from './parse.js';
import { HeaderMismatchError } from './errors.js';

// ---------------------------------------------------------------------------
// Source-of-truth split as of 2026-05, Outcomes tab added 2026-08-24:
//   - Students + PhaseCompletion + Outcomes → V2 sheet (env: GOOGLE_SHEETS_STUDENT_INFO_V2)
//   - Certifications → legacy sheet (env: GOOGLE_SHEETS_STUDENT_INFO_ID) — retired
//     2026-08-24, no replacement tab; syncCertifications() now no-ops.
//
// `students` rows are upserted by student_number (LP####). Rows in the DB that
// don't appear in the new sheet are NOT deleted — this preserves the FK web
// (phase outcomes, certifications, attendance, etc.); those students just
// stop receiving fresh updates.
// ---------------------------------------------------------------------------

function checkHeaders(live: string[], expected: readonly string[]): void {
  for (let i = 0; i < expected.length; i++) {
    const exp = expected[i]?.trim() ?? '';
    const actual = live[i]?.trim() ?? '';
    if (exp !== actual) {
      throw new HeaderMismatchError(
        `col ${i + 1}: expected "${exp}", got "${actual}"`,
      );
    }
  }
}

function toDate(yyyymmdd: string | null): Date | null {
  return yyyymmdd ? new Date(`${yyyymmdd}T00:00:00Z`) : null;
}

export async function syncStudents(): Promise<number> {
  const sheetId = process.env['GOOGLE_SHEETS_STUDENT_INFO_V2'];
  if (!sheetId) throw new Error('GOOGLE_SHEETS_STUDENT_INFO_V2 not set');

  // V2 sheet has 52 columns A..AZ.
  const headerRow = await getSheetRows(sheetId, 'Students!A1:AZ1');
  checkHeaders(headerRow[0] ?? [], EXPECTED_STUDENTS_V2_HEADERS);

  const dataRows = await getSheetRows(sheetId, 'Students!A2:AZ');
  let synced = 0;

  for (const raw of dataRows) {
    const s = parseStudentV2Row(raw);
    if (!s) continue;

    const data = {
      canonicalName: s.canonicalName,
      email: s.launchpadEmail ?? s.altSchoolEmail,
      suffix: s.suffix,
      enrollmentStatus: s.enrollmentStatus,
      currentPhase: s.currentPhase,
      dob: toDate(s.dob),
      gender: s.gender,
      raceEthnicity: s.raceEthnicity,
      schoolName: s.schoolName,
      hsGraduationYear: s.hsGraduationYear,
      ell: s.ell,
      entryDate: toDate(s.entryDate),
      withdrawalDate: toDate(s.withdrawalDate),
      withdrawalCode: s.withdrawalCode,
      launchpadEmail: s.launchpadEmail,
      altSchoolEmail: s.altSchoolEmail,
      asuriteUserId: s.asuriteUserId,
      rapidAccountNumber: s.rapidAccountNumber,
      phone: s.phone,
      altContact: s.altContact,
      city: s.city,
      state: s.state,
      zip: s.zip,
      idCardNumber: s.idCardNumber,
      docFolderUrl: s.docFolderUrl,
      tShirtSize: s.tShirtSize,
      interviewScore: s.interviewScore,
      algebraKeystoneScore: s.algebraKeystoneScore,
      hsGpa: s.hsGpa,
      algebra1Grade: s.algebra1Grade,
      geometryGrade: s.geometryGrade,
      worksOutsideLaunchpad: s.worksOutsideLaunchpad,
      hoursOutsideCommitted: s.hoursOutsideCommitted,
      permissionSlip: s.permissionSlip,
      extraTime: s.extraTime,
      cohort: s.cohort,
      techInterestOnboarding: s.techInterestOnboarding,
      interviewPassionScore: s.interviewPassionScore,
      interviewCollegeScore: s.interviewCollegeScore,
      workReadyQ1: s.workReadyQ1,
      income: s.income,
      parentalEd: s.parentalEd,
    };

    const student = await prisma.student.upsert({
      where: { studentNumber: s.studentNumber },
      create: { studentNumber: s.studentNumber, ...data },
      update: data,
    });

    // Ensure entity_aliases exist so resolveEntity() can find this student.
    await linkAlias({
      alias: s.canonicalName,
      entityType: 'student',
      entityId: student.id,
      source: 'google_sheets',
      confidence: 1.0,
    });
    await linkAlias({
      alias: s.studentNumber,
      entityType: 'student',
      entityId: student.id,
      source: 'google_sheets',
      confidence: 1.0,
    });

    synced += 1;
  }

  return synced;
}

export async function syncOutcomes(): Promise<number> {
  const sheetId = process.env['GOOGLE_SHEETS_STUDENT_INFO_V2'];
  if (!sheetId) throw new Error('GOOGLE_SHEETS_STUDENT_INFO_V2 not set');

  const dataRows = await getSheetRows(sheetId, 'PhaseCompletion!A2:O');
  let synced = 0;
  const seenStudentIds = new Set<string>();

  for (let i = 0; i < dataRows.length; i += 1) {
    const raw = dataRows[i];
    if (!raw) continue;
    const parsed = parseOutcomesRow(raw);
    if (!parsed) continue;

    const student = await prisma.student.findUnique({
      where: { studentNumber: parsed.studentNumber },
      select: { id: true },
    });
    if (!student) {
      console.warn(`syncOutcomes: student ${parsed.studentNumber} not found, skipping row ${i + 2}`);
      continue;
    }

    seenStudentIds.add(student.id);

    const data = {
      foundationsStatus: parsed.foundationsStatus,
      foundationsStartDate: toDate(parsed.foundationsStartDate),
      foundationsEndDate: toDate(parsed.foundationsEndDate),
      phase101Status: parsed.phase101Status,
      phase101StartDate: toDate(parsed.phase101StartDate),
      phase101EndDate: toDate(parsed.phase101EndDate),
      lightspeedStatus: parsed.lightspeedStatus,
      lightspeedStartDate: toDate(parsed.lightspeedStartDate),
      lightspeedEndDate: toDate(parsed.lightspeedEndDate),
      liftoffStatus: parsed.liftoffStatus,
      liftoffStartDate: toDate(parsed.liftoffStartDate),
      liftoffEndDate: toDate(parsed.liftoffEndDate),
    };

    await prisma.studentPhaseOutcome.upsert({
      where: { studentId: student.id },
      create: { studentId: student.id, ...data },
      update: data,
    });

    synced += 1;
  }

  // Clean up rows for students no longer in the sheet (after all upserts succeed)
  if (seenStudentIds.size > 0) {
    const deleted = await prisma.studentPhaseOutcome.deleteMany({
      where: { studentId: { notIn: [...seenStudentIds] } },
    });
    if (deleted.count > 0) {
      console.log(`  student_phase_outcomes: removed ${deleted.count} stale rows`);
    }
  }

  return synced;
}

export async function syncCertifications(): Promise<number> {
  // Certifications lived on the legacy student-info sheet, retired 2026-08-24.
  // V2 has no replacement tab yet — existing rows are left as-is until one exists.
  const sheetId = process.env['GOOGLE_SHEETS_STUDENT_INFO_ID'];
  if (!sheetId) {
    console.warn('  syncCertifications: GOOGLE_SHEETS_STUDENT_INFO_ID not set (legacy sheet retired), skipping');
    return 0;
  }

  const dataRows = await getSheetRows(sheetId, 'Certifications!A2:H');
  let synced = 0;

  for (let i = 0; i < dataRows.length; i += 1) {
    const raw = dataRows[i];
    if (!raw) continue;
    const parsed = parseCertificationRow(raw);
    if (!parsed) continue;

    const student = await prisma.student.findUnique({
      where: { studentNumber: parsed.studentNumber },
      select: { id: true },
    });
    if (!student) {
      console.warn(`syncCertifications: student ${parsed.studentNumber} not found, skipping row ${i + 2}`);
      continue;
    }

    const data = {
      studentId: student.id,
      type: parsed.type,
      date: parsed.date,
      result: parsed.result,
      score: parsed.score,
      phase: parsed.phase,
    };

    await prisma.studentCertification.upsert({
      where: { sourceId: parsed.sourceId },
      create: { sourceId: parsed.sourceId, ...data },
      update: data,
    });

    synced += 1;
  }

  return synced;
}

export async function syncOutcomesTab(): Promise<number> {
  const sheetId = process.env['GOOGLE_SHEETS_STUDENT_INFO_V2'];
  if (!sheetId) throw new Error('GOOGLE_SHEETS_STUDENT_INFO_V2 not set');

  // 25 cols A..Y.
  const headerRow = await getSheetRows(sheetId, 'Outcomes!A1:Y1');
  checkHeaders(headerRow[0] ?? [], EXPECTED_OUTCOMES_TAB_HEADERS);

  const dataRows = await getSheetRows(sheetId, 'Outcomes!A2:Y');
  let synced = 0;

  for (let i = 0; i < dataRows.length; i += 1) {
    const raw = dataRows[i];
    if (!raw) continue;
    const o = parseOutcomesTabRow(raw);
    if (!o) continue;
    if (o.studentNumber === 'LP0000') continue; // demo/test account, not a real outcome

    const student = await prisma.student.findUnique({
      where: { studentNumber: o.studentNumber },
      select: { id: true, currentPhase: true },
    });
    if (!student) {
      console.warn(`syncOutcomesTab: student ${o.studentNumber} not found, skipping row ${i + 2}`);
      continue;
    }

    await prisma.student.update({
      where: { id: student.id },
      data: {
        hsDiploma: o.hsDiploma,
        hsFinalGpa: o.hsFinalGpa,
        collegeCreditsEarned: o.collegeCreditsEarned,
        highestPcepScore: o.highestPcepScore,
        internshipStatus: o.internshipStatus,
        internshipHours: o.internshipHours,
        internshipPayRate: o.internshipPayRate,
        internshipSite: o.internshipSite,
        collegeEnroll: o.collegeEnroll,
        university: o.university,
        major: o.major,
        workforceProgramReferral: o.workforceProgramReferral,
        workforceReferralStatus: o.workforceReferralStatus,
        initialPlacementHourlyWage: o.initialPlacementHourlyWage,
        initialPlacementWeeklyHours: o.initialPlacementWeeklyHours,
        initialPlacementStartDate: o.initialPlacementStartDate ? new Date(`${o.initialPlacementStartDate}T00:00:00Z`) : null,
        initialPlacementSite: o.initialPlacementSite,
        status12moPostPlacement: o.status12moPostPlacement,
        currentEmployer: o.currentEmployer,
        currentHourlyWage: o.currentHourlyWage,
        currentWeeklyHours: o.currentWeeklyHours,
        currentEmploymentUpdatedAt: o.currentEmploymentUpdatedAt ? new Date(`${o.currentEmploymentUpdatedAt}T00:00:00Z`) : null,
      },
    });

    // PCEP score doubles as a certification (>70 = Pass) — see query_certifications,
    // whose description already names PCEP as the expected `type`. One row per
    // student: the sheet only carries a single "highest" score, not a history of
    // attempts, so this upserts rather than appending.
    if (o.highestPcepScore !== null) {
      const sourceId = `outcomes_pcep:${o.studentNumber}`;
      const data = {
        studentId: student.id,
        type: 'PCEP',
        date: null,
        result: Number(o.highestPcepScore) > 70 ? 'Pass' : 'Fail',
        score: o.highestPcepScore,
        phase: student.currentPhase ?? 'Unspecified',
      };
      await prisma.studentCertification.upsert({
        where: { sourceId },
        create: { sourceId, ...data },
        update: data,
      });
    }

    synced += 1;
  }

  return synced;
}
