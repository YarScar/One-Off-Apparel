import { prisma } from '@lp-ai/lib-db';
import { getSheetRows, listSheetTitles, getSheetGridDimensions } from './sheets-client.js';

function headerToKey(raw: string): string {
  return raw
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .toLowerCase()
    .replace(/^_|_$/g, '');
}

const SKIP_HEADER_KEYS = new Set([
  'sheet_name',
  'sheet_id',
  'spreadsheet_name',
  'spreadsheet_id',
  'teacher_posting_date',
  'exp_start_time',
  'exp_end_time',
]);

function parseDateStr(v: string | undefined): Date | null {
  if (!v) return null;
  const t = v.trim();
  if (!t) return null;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (iso) {
    return new Date(`${iso[1]}-${iso[2]!.padStart(2, '0')}-${iso[3]!.padStart(2, '0')}T00:00:00Z`);
  }
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(t);
  if (us) {
    return new Date(`${us[3]}-${us[1]!.padStart(2, '0')}-${us[2]!.padStart(2, '0')}T00:00:00Z`);
  }
  return null;
}

// `cohort` here is a raw identifier for which source spreadsheet a row came from — not
// the removed student-facing cohort concept. Values 4-7 (not 1-3) are deliberate: 1/2/3
// identify rows from the old point-in-time cohort sheets (being retired). Keeping the new
// live sheets on a disjoint range means old and new attendance_records rows can never
// collide on this column while both exist during the cutover, and old rows stay easy to
// find and remove afterward (`WHERE cohort IN (1, 2, 3)`).
//
// NOTE: once the cohort-removal branch (`feat/remove-cohort-designation`) merges into
// main, `AttendanceRecord.cohort` is renamed to `sourceFormat` in the schema — this file
// (and its `cohort:` upsert fields below) will need a follow-up rename to match.
type CohortConfig = {
  cohort: 4 | 5 | 6 | 7;
  envKey: string;
};

const COHORT_CONFIGS: CohortConfig[] = [
  { cohort: 4, envKey: 'GOOGLE_SHEETS_ATTENDANCE_COHORT_1' },
  { cohort: 5, envKey: 'GOOGLE_SHEETS_ATTENDANCE_COHORT_2' },
  { cohort: 6, envKey: 'GOOGLE_SHEETS_ATTENDANCE_COHORT_3' },
  { cohort: 7, envKey: 'GOOGLE_SHEETS_ATTENDANCE_COHORT_4' },
];

const ROW_CHUNK_SIZE = 5000;

async function syncOneCohort(config: CohortConfig): Promise<number> {
  const spreadsheetId = process.env[config.envKey];
  if (!spreadsheetId) {
    console.warn(`  cohort ${config.cohort}: ${config.envKey} not set, skipping`);
    return 0;
  }

  let titles: string[];
  let dims: Map<string, { rowCount: number; columnCount: number }>;
  try {
    [titles, dims] = await Promise.all([
      listSheetTitles(spreadsheetId),
      getSheetGridDimensions(spreadsheetId),
    ]);
  } catch (err) {
    console.warn(`  cohort ${config.cohort}: failed to list tabs — ${err instanceof Error ? err.message : String(err)}`);
    return 0;
  }

  // Prefer an exact "attendanceData" tab — the current sheet template also ships an
  // "allAttendanceData" tab (one row per check-in/check-out event, not per day) which
  // would otherwise double-count attendance if picked up by the loose suffix match below.
  const exactTab = titles.find((t) => t.trim().toLowerCase() === 'attendancedata');
  const candidateTabs = exactTab ? [exactTab] : titles.filter((t) => /attendanceData\s*$/i.test(t));
  if (candidateTabs.length === 0) {
    console.warn(`  cohort ${config.cohort}: no tab matching "*attendanceData" — available: ${titles.join(', ')}`);
    return 0;
  }

  let chosenTab: string | null = null;
  let headers: string[] = [];
  for (const tab of candidateTabs) {
    const headerRange = `'${tab.replace(/'/g, "''")}'!A1:ZZ1`;
    let row1: string[] = [];
    try {
      const headerRows = await getSheetRows(spreadsheetId, headerRange);
      row1 = headerRows[0] ?? [];
    } catch {
      continue;
    }
    if (row1.some((c) => c?.trim() === 'Student Number')) {
      chosenTab = tab;
      headers = row1;
      break;
    }
  }

  if (!chosenTab) {
    console.warn(`  cohort ${config.cohort}: no tab with "Student Number" header (candidates: ${candidateTabs.join(', ')})`);
    return 0;
  }
  console.log(`  cohort ${config.cohort}: detected primary tab "${chosenTab}"`);

  const seenKeys = new Set<string>();
  const columnMap: { rawIdx: number; key: string }[] = [];
  for (let i = 0; i < headers.length; i += 1) {
    const raw = (headers[i] ?? '').trim();
    if (!raw) continue;
    const key = headerToKey(raw);
    if (!key || seenKeys.has(key) || SKIP_HEADER_KEYS.has(key)) continue;
    seenKeys.add(key);
    columnMap.push({ rawIdx: i, key });
  }
  if (columnMap.length === 0) return 0;

  const totalRows = dims.get(chosenTab)?.rowCount ?? 0;
  const sourcePrefix = `attendance:cohort_${config.cohort}`;
  let synced = 0;

  for (let chunkStart = 2; chunkStart <= totalRows; chunkStart += ROW_CHUNK_SIZE) {
    const chunkEnd = Math.min(chunkStart + ROW_CHUNK_SIZE - 1, totalRows);
    const dataRange = `'${chosenTab.replace(/'/g, "''")}'!A${chunkStart}:ZZ${chunkEnd}`;
    let chunkRows: string[][];
    try {
      chunkRows = await getSheetRows(spreadsheetId, dataRange);
    } catch (err) {
      console.warn(`  cohort ${config.cohort}: chunk ${chunkStart}-${chunkEnd} failed — ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    for (let j = 0; j < chunkRows.length; j += 1) {
      const raw = chunkRows[j];
      if (!raw || raw.every((c) => !c?.trim())) continue;

      const rowData: Record<string, string> = {};
      for (const { rawIdx, key } of columnMap) {
        rowData[key] = raw[rawIdx]?.trim() ?? '';
      }

      const studentNumber = rowData['student_number'];
      if (!studentNumber) continue;

      const date = parseDateStr(rowData['date']);
      const code = typeof rowData['code'] === 'string' && rowData['code'].trim()
        ? rowData['code'].trim().toUpperCase()
        : null;

      const sheetRowNumber = chunkStart + j;
      const sourceId = `${sourcePrefix}:${sheetRowNumber}`;

      await prisma.attendanceRecord.upsert({
        where: { sourceId },
        create: {
          sourceId,
          cohort: config.cohort,
          studentNumber,
          date,
          startDate: null,
          endDate: null,
          code,
          percentage: null,
          rowData,
        },
        update: {
          cohort: config.cohort,
          studentNumber,
          date,
          startDate: null,
          endDate: null,
          code,
          percentage: null,
          rowData,
        },
      });
      synced += 1;
    }
  }

  console.log(`  attendance:cohort_${config.cohort}: ${synced} rows synced (${columnMap.length} cols mapped, ${totalRows} rows total in tab)`);
  return synced;
}

export async function syncAttendance(): Promise<number> {
  let total = 0;
  for (const config of COHORT_CONFIGS) {
    total += await syncOneCohort(config);
  }
  return total;
}
