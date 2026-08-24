import { prisma } from '@lp-ai/lib-db';
import { getAllSheetRows } from './sheets-client.js';

function parseNumStr(v: string | undefined): string | null {
  const s = v?.trim().replace(/,/g, '');
  return s !== undefined && s !== '' && !isNaN(Number(s)) ? s : null;
}

function parseIntOrNull(v: string | undefined): number | null {
  const n = parseInt(v?.trim() ?? '', 10);
  return isNaN(n) ? null : n;
}

function normalizeScoreColumn(raw: string): string | null {
  switch (raw.trim()) {
    case 'Student Number':      return 'student_number';
    case 'Competency':          return 'competency';
    case 'Portfolio':           return 'portfolio';
    case 'Baseline':            return 'baseline';
    case 'Performance Level':   return 'performance_level';
    case 'Growth':              return 'growth';
    case 'Progress':            return 'progress';
    case 'Total ER':            return 'total_er';
    case 'Completed ER':        return 'completed_er';
    case 'Missed ER':           return 'missed_er';
    case 'Total Opportunities': return 'total_opportunities';
    default:                    return null;
  }
}

export async function syncStudentCompetency(): Promise<number> {
  const sheetId = process.env['GOOGLE_SHEETS_STUDENT_COMPETENCY'];
  if (!sheetId) throw new Error('GOOGLE_SHEETS_STUDENT_COMPETENCY not set');

  let allSheets: Map<string, string[][]>;
  try {
    allSheets = await getAllSheetRows(sheetId);
  } catch (err) {
    console.warn(`  skipping student competency: ${err instanceof Error ? err.message : String(err)}`);
    return 0;
  }

  let rows: string[][] | null = null;
  for (const [, tabRows] of allSheets) {
    if (tabRows[0]?.some((c) => c?.trim() === 'Student Number')) {
      rows = tabRows;
      break;
    }
  }
  if (!rows) {
    console.warn('  skipping student competency: could not detect tab with "Student Number" header');
    return 0;
  }

  const headerRow = rows[0] ?? [];
  const columnMap: { rawIdx: number; key: string }[] = headerRow
    .map((h, i) => {
      const key = normalizeScoreColumn(h?.trim() ?? '');
      return key === null ? null : { rawIdx: i, key };
    })
    .filter((e): e is { rawIdx: number; key: string } => e !== null);

  // Keyed by student + competency rather than sheet row number: a row-number key would
  // silently reattach to whatever row happens to land in that position the next time this
  // points at a different sheet, overwriting unrelated data instead of cleanly replacing it.
  const seenSourceIds = new Set<string>();
  let synced = 0;

  for (let i = 1; i < rows.length; i += 1) {
    const raw = rows[i];
    if (!raw || raw.every((c) => !c?.trim())) continue;

    const rowData: Record<string, string> = {};
    for (const { rawIdx, key } of columnMap) {
      rowData[key] = raw[rawIdx]?.trim() ?? '';
    }
    if (Object.values(rowData).every((v) => !v)) continue;

    const studentNumber = rowData['student_number'];
    const competency = rowData['competency'];
    if (!studentNumber || !competency) continue;

    const sourceId = `student_competency:${studentNumber}:${competency}`;
    seenSourceIds.add(sourceId);

    const data = {
      studentNumber,
      competency,
      portfolio: rowData['portfolio'] || null,
      baseline: parseNumStr(rowData['baseline']),
      performanceLevel: parseNumStr(rowData['performance_level']),
      growth: parseNumStr(rowData['growth']),
      progress: parseNumStr(rowData['progress']),
      totalEr: parseIntOrNull(rowData['total_er']),
      completedEr: parseIntOrNull(rowData['completed_er']),
      missedEr: parseIntOrNull(rowData['missed_er']),
      totalOpportunities: parseIntOrNull(rowData['total_opportunities']),
    };

    await prisma.studentCompetency.upsert({
      where: { sourceId },
      create: { sourceId, ...data },
      update: data,
    });
    synced += 1;
  }

  if (seenSourceIds.size > 0) {
    const { count: removed } = await prisma.studentCompetency.deleteMany({
      where: { sourceId: { notIn: [...seenSourceIds] } },
    });
    if (removed > 0) console.log(`  student competency: removed ${removed} stale row(s) no longer in the source`);
  }

  return synced;
}
