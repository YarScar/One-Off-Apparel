import { prisma } from '@lp-ai/lib-db';
import { getSheetRows } from './sheets-client.js';
import { parseEmploymentRow } from './parse.js';

// ---------------------------------------------------------------------------
// Employment tab (Student Information V2)
//
// One row per (student × job × date-range). The same logical job may span
// multiple rows when the student's hourly rate or weekly hours changed —
// each row covers one date range at one rate so that hours and total pay
// can be tracked accurately over time.
//
// source_id uses a stable composite natural key:
//   employment:<studentNumber>:<employerName>:<startDate>:<jobTitle>
// so that row reordering in the sheet does not create orphans.
//
// Consolidation into logical jobs (same student + employer + title = one job)
// happens at query time in query_employment, not here. This connector
// faithfully stores every row from the sheet.
//
// Upsert + stale cleanup: rows are upserted, then any sourceIds NOT seen in
// this run are deleted. If the sync crashes midway, existing data survives.
// ---------------------------------------------------------------------------

const EXPECTED_HEADERS = [
  'studentId',
  'studentName',
  'employerName',
  'employmentType',
  'jobTitle',
  'startDate',
  'endDate',
  'hourlyWage',
  'weeklyHours',
  'totalEarned',
  'exitCode',
  'Notes',
] as const;

export class EmploymentHeaderMismatchError extends Error {
  constructor(public detail: string) {
    super(`employment_header_mismatch: ${detail}`);
  }
}

function checkHeaders(live: string[]): void {
  for (let i = 0; i < EXPECTED_HEADERS.length; i++) {
    const expected = EXPECTED_HEADERS[i]?.trim() ?? '';
    const actual = live[i]?.trim() ?? '';
    if (expected !== actual) {
      throw new EmploymentHeaderMismatchError(
        `col ${i + 1}: expected "${expected}", got "${actual}"`,
      );
    }
  }
}

function toDate(yyyymmdd: string | null): Date | null {
  return yyyymmdd ? new Date(`${yyyymmdd}T00:00:00Z`) : null;
}

function stableSourceId(studentNumber: string, employerName: string | null, startDate: string | null, jobTitle: string | null): string {
  const employer = (employerName ?? '').trim().toLowerCase().replace(/\s+/g, '_');
  const start = startDate ?? 'nodate';
  const title = (jobTitle ?? '').trim().toLowerCase().replace(/\s+/g, '_');
  return `employment:${studentNumber}:${employer}:${start}:${title}`;
}

export async function syncEmployment(): Promise<number> {
  const sheetId = process.env['GOOGLE_SHEETS_STUDENT_INFO_V2'];
  if (!sheetId) throw new Error('GOOGLE_SHEETS_STUDENT_INFO_V2 not set');

  let rows: string[][];
  try {
    console.log('\n  fetching employment tab from student info v2...');
    rows = await getSheetRows(sheetId, 'Employment!A1:L');
  } catch (err) {
    console.warn(`  skipping employment: ${err instanceof Error ? err.message : String(err)}`);
    return 0;
  }

  if (rows.length < 1) {
    console.warn('  skipping employment: empty tab');
    return 0;
  }

  checkHeaders(rows[0] ?? []);

  let synced = 0;
  let skippedBlank = 0;
  let skippedNoStudent = 0;
  let skippedRowErrors = 0;
  const skippedEmployers: string[] = [];
  const seenSourceIds = new Set<string>();
  const keyOccurrences = new Map<string, number>();

  for (let i = 1; i < rows.length; i += 1) {
    const raw = rows[i];
    if (!raw || raw.every((c) => !c?.trim())) {
      skippedBlank += 1;
      continue;
    }

    const parsed = parseEmploymentRow(raw);
    if (!parsed) {
      skippedNoStudent += 1;
      const employer = raw[2]?.trim();
      if (employer && skippedEmployers.length < 50) {
        skippedEmployers.push(`row ${i + 1}: "${employer}"`);
      }
      continue;
    }

    const baseKey = stableSourceId(parsed.studentNumber, parsed.employerName, parsed.startDate, parsed.jobTitle);
    const occ = (keyOccurrences.get(baseKey) ?? 0) + 1;
    keyOccurrences.set(baseKey, occ);
    const sourceId = occ === 1 ? baseKey : `${baseKey}:${occ}`;
    seenSourceIds.add(sourceId);

    const data = {
      studentNumber: parsed.studentNumber,
      studentName:   parsed.studentName,
      employerName:  parsed.employerName,
      employmentType: parsed.employmentType,
      jobTitle:      parsed.jobTitle,
      startDate:     toDate(parsed.startDate),
      endDate:       toDate(parsed.endDate),
      hourlyWage:    parsed.hourlyWage,
      weeklyHours:   parsed.weeklyHours,
      totalEarned:   parsed.totalEarned,
      exitCode:      parsed.exitCode,
      notes:         parsed.notes,
    };

    try {
      await prisma.studentEmployment.upsert({
        where: { sourceId },
        create: { sourceId, ...data },
        update: data,
      });
      synced += 1;
    } catch (err) {
      const employer = parsed.employerName ?? '(unknown)';
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`  student_employment: row ${i + 1} (${parsed.studentNumber} @ "${employer}") FAILED — ${msg}`);
      skippedRowErrors += 1;
    }
  }

  // Remove rows whose sourceId was not seen (genuinely removed from sheet)
  if (seenSourceIds.size > 0) {
    const deleted = await prisma.studentEmployment.deleteMany({
      where: { sourceId: { notIn: [...seenSourceIds] } },
    });
    if (deleted.count > 0) {
      console.log(`  student_employment: removed ${deleted.count} stale rows`);
    }
  }

  console.log(`  student_employment: ${synced} rows synced`);
  if (skippedBlank > 0) {
    console.log(`  student_employment: ${skippedBlank} blank rows skipped`);
  }
  if (skippedNoStudent > 0) {
    console.log(`  student_employment: ${skippedNoStudent} rows skipped (no student_number in col A)`);
    if (skippedEmployers.length > 0) {
      console.log(`  student_employment: examples — ${skippedEmployers.join('; ')}`);
    }
  }
  if (skippedRowErrors > 0) {
    console.log(`  student_employment: ${skippedRowErrors} rows skipped due to per-row insert errors (see warnings above)`);
  }
  return synced;
}
