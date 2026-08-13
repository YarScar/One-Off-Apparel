// ---------------------------------------------------------------------------
// Hour logs (shared "Hours" spreadsheet, North10AI + LP Internal AI tabs)
//
// The team logs all billable hours in one Google Sheet, one tab per engagement.
// This sync reads both tabs, maps well-known columns to typed fields, and keeps
// the full raw row in row_data so nothing is lost when the sheet's layout
// changes.
//
// The sheet's headers are discovered at sync time (not hard-coded): each header
// cell is normalized to a snake_case key and classified into one of four slots —
// date / person / hours / task — by fuzzy name matching. A tab that has no
// recognizable headers is skipped with a warning, like the attendance syncs do.
//
// source_id is a stable per-row key: hours:<tabKey>:<sheetRowNumber>.
// Rows are upserted, then any hour_logs row whose source_id was NOT seen in
// this run is deleted (upsert + stale-cleanup pattern). If the sync crashes
// midway, existing data survives.
// ---------------------------------------------------------------------------

import { prisma } from '@lp-ai/lib-db';
import { getSheetRows, listSheetTitles } from './sheets-client.js';

const HOURS_TABS = ['North10AI', 'LP Internal AI'] as const;

function tabKey(tab: string): string {
  return tab.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function headerToKey(raw: string): string {
  return raw
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .toLowerCase()
    .replace(/^_|_$/g, '');
}

// Classify a header key into a canonical slot. The FIRST matching rule wins, and
// each header can only fill one slot (tracked via usedSlots). Order matters:
// "date" rules come before anything that might also contain "day"/"time".
type Slot = 'date' | 'person' | 'hours' | 'task';

function classifySlot(key: string, used: Set<Slot>): Slot | null {
  if (!used.has('date') && /date|day$/.test(key)) return 'date';
  if (!used.has('hours') && /^(hours|hrs|hour|time|duration|effort|qty|total)/.test(key)) return 'hours';
  if (!used.has('person') && /person|name|member|initials|who|employee|staff|developer|consultant|owner/.test(key)) return 'person';
  if (!used.has('task') && /task|desc|note|project|activity|what|work|summary|details|category|client/.test(key)) return 'task';
  return null;
}

function parseDateStr(v: string | undefined): Date | null {
  if (!v) return null;
  const t = v.trim();
  if (!t) return null;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (iso) {
    return new Date(`${iso[1]}-${iso[2]!.padStart(2, '0')}-${iso[3]!.padStart(2, '0')}T00:00:00Z`);
  }
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})(?=\D|$)/.exec(t);
  if (us) {
    const m = us[1]!.padStart(2, '0');
    const d = us[2]!.padStart(2, '0');
    const rawY = us[3]!;
    const y = rawY.length === 2 ? (parseInt(rawY, 10) < 70 ? `20${rawY}` : `19${rawY}`) : rawY;
    return new Date(`${y}-${m}-${d}T00:00:00Z`);
  }
  return null;
}

// Accepts "3.5", "3h 30m", "3 hrs", "1.25 hours" — anything whose leading
// number is a count of hours. Returns null when unparseable.
function parseHours(v: string | undefined): number | null {
  if (!v) return null;
  const t = v.trim();
  if (!t) return null;
  const m = /^(\d+(?:\.\d+)?)\s*h/.exec(t);
  if (m) return Number(m[1]);
  const n = Number(t);
  return isNaN(n) ? null : n;
}

type ColumnMap = { rawIdx: number; slot: Slot }[];

function mapColumns(headers: string[]): ColumnMap {
  const used = new Set<Slot>();
  const cols: ColumnMap = [];
  for (let i = 0; i < headers.length; i += 1) {
    const raw = (headers[i] ?? '').trim();
    if (!raw) continue;
    const slot = classifySlot(headerToKey(raw), used);
    if (!slot) continue;
    used.add(slot);
    cols.push({ rawIdx: i, slot });
  }
  return cols;
}

async function syncTab(spreadsheetId: string, tab: string, allTabs: string[]): Promise<number> {
  const actual = allTabs.find((t) => t.toLowerCase() === tab.toLowerCase());
  if (!actual) {
    console.warn(`  hours: tab "${tab}" not found in spreadsheet (available: ${allTabs.join(', ')})`);
    return 0;
  }

  const range = `'${actual.replace(/'/g, "''")}'!A1:ZZ`;
  let rows: string[][];
  try {
    rows = await getSheetRows(spreadsheetId, range);
  } catch (err) {
    console.warn(`  hours: failed to read tab "${actual}" — ${err instanceof Error ? err.message : String(err)}`);
    return 0;
  }

  const headers = rows[0] ?? [];
  const cols = mapColumns(headers);
  if (cols.length === 0) {
    console.warn(`  hours: tab "${actual}" has no recognizable headers — available cols: ${headers.join(', ') || '(none)'}`);
    return 0;
  }

  const prefix = `hours:${tabKey(actual)}`;
  let synced = 0;
  let skipped = 0;
  const seenSourceIds = new Set<string>();

  for (let i = 1; i < rows.length; i += 1) {
    const raw = rows[i];
    if (!raw || raw.every((c) => !c?.trim())) continue;

    const rowData: Record<string, string> = {};
    for (let c = 0; c < raw.length; c += 1) {
      const cell = raw[c]?.trim();
      if (cell !== undefined && cell !== '') rowData[headers[c]?.trim() ?? `col_${c + 1}`] = cell;
    }

    const get = (slot: Slot): string | undefined => {
      for (const col of cols) {
        if (col.slot === slot) {
          const v = raw[col.rawIdx]?.trim();
          if (v) return v;
        }
      }
      return undefined;
    };

    const logDate = parseDateStr(get('date'));
    const personName = get('person') ?? null;
    const hours = parseHours(get('hours'));

    // Skip header-like/subtotal rows that carry neither a date nor a person nor hours.
    if (!logDate && !personName && hours === null) {
      skipped += 1;
      continue;
    }

    const sourceId = `${prefix}:${i + 1}`;
    seenSourceIds.add(sourceId);

    const data = {
      project: actual,
      sourceTab: actual,
      logDate,
      personName,
      hours: hours === null ? null : hours,
      task: get('task') ?? null,
      rowData,
    };

    try {
      await prisma.hourLog.upsert({
        where: { sourceId },
        create: { sourceId, ...data },
        update: data,
      });
      synced += 1;
    } catch (err) {
      console.warn(`  hour_logs: row ${i + 1} in tab "${actual}" FAILED — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Remove rows whose source_id was not seen (genuinely deleted from the sheet).
  if (seenSourceIds.size > 0) {
    const deleted = await prisma.hourLog.deleteMany({
      where: { sourceId: { notIn: [...seenSourceIds] } },
    });
    if (deleted.count > 0) {
      console.log(`  hour_logs: removed ${deleted.count} stale rows`);
    }
  }

  console.log(`  hour_logs: tab "${actual}" — ${synced} rows synced, ${skipped} header/subtotal rows skipped`);
  return synced;
}

export async function syncHours(): Promise<number> {
  const spreadsheetId = process.env['GOOGLE_SHEETS_HOURS_ID'];
  if (!spreadsheetId) {
    console.warn('  hour_logs: GOOGLE_SHEETS_HOURS_ID not set, skipping');
    return 0;
  }

  // Resolve actual tab titles once (the sheet is shared and tabs could be renamed).
  let titles: string[];
  try {
    titles = await listSheetTitles(spreadsheetId);
  } catch (err) {
    console.warn(`  hour_logs: failed to list tabs — ${err instanceof Error ? err.message : String(err)}`);
    return 0;
  }

  let total = 0;
  for (const tab of HOURS_TABS) {
    total += await syncTab(spreadsheetId, tab, titles);
  }
  return total;
}
