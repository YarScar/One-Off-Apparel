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

// Internal-only classification of which source spreadsheet a row came from,
// and thus which shape its rate math uses (avg percentage vs P/A/E ratio).
// This is never exposed to MCP callers — see query-attendance.ts.
type SourceFormatConfig = {
  sourceFormat: 1 | 2 | 3;
  envKey: string;
};

const SOURCE_FORMAT_CONFIGS: SourceFormatConfig[] = [
  { sourceFormat: 1, envKey: 'GOOGLE_SHEETS_ATTENDANCE_COHORT_1' },
  { sourceFormat: 2, envKey: 'GOOGLE_SHEETS_ATTENDANCE_COHORT_2' },
  { sourceFormat: 3, envKey: 'GOOGLE_SHEETS_ATTENDANCE_COHORT_3' },
];

const ROW_CHUNK_SIZE = 5000;

async function syncOneSource(config: SourceFormatConfig): Promise<number> {
  const spreadsheetId = process.env[config.envKey];
  if (!spreadsheetId) {
    console.warn(`  source ${config.sourceFormat}: ${config.envKey} not set, skipping`);
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
    console.warn(`  source ${config.sourceFormat}: failed to list tabs — ${err instanceof Error ? err.message : String(err)}`);
    return 0;
  }

  const candidateTabs = titles.filter((t) => /attendanceData\s*$/i.test(t));
  if (candidateTabs.length === 0) {
    console.warn(`  source ${config.sourceFormat}: no tab matching "*attendanceData" — available: ${titles.join(', ')}`);
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
    console.warn(`  source ${config.sourceFormat}: no tab with "Student Number" header (candidates: ${candidateTabs.join(', ')})`);
    return 0;
  }
  console.log(`  source ${config.sourceFormat}: detected primary tab "${chosenTab}"`);

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
  const sourcePrefix = `attendance:source_${config.sourceFormat}`;
  let synced = 0;

  for (let chunkStart = 2; chunkStart <= totalRows; chunkStart += ROW_CHUNK_SIZE) {
    const chunkEnd = Math.min(chunkStart + ROW_CHUNK_SIZE - 1, totalRows);
    const dataRange = `'${chosenTab.replace(/'/g, "''")}'!A${chunkStart}:ZZ${chunkEnd}`;
    let chunkRows: string[][];
    try {
      chunkRows = await getSheetRows(spreadsheetId, dataRange);
    } catch (err) {
      console.warn(`  source ${config.sourceFormat}: chunk ${chunkStart}-${chunkEnd} failed — ${err instanceof Error ? err.message : String(err)}`);
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
          sourceFormat: config.sourceFormat,
          studentNumber,
          date,
          startDate: null,
          endDate: null,
          code,
          percentage: null,
          rowData,
        },
        update: {
          sourceFormat: config.sourceFormat,
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

  console.log(`  attendance:source_${config.sourceFormat}: ${synced} rows synced (${columnMap.length} cols mapped, ${totalRows} rows total in tab)`);
  return synced;
}

export async function syncAttendance(): Promise<number> {
  let total = 0;
  for (const config of SOURCE_FORMAT_CONFIGS) {
    total += await syncOneSource(config);
  }
  return total;
}
