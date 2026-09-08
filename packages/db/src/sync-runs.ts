import { prisma } from './client.js';

export interface SyncRunResult {
  status: 'ok' | 'noop' | 'error';
  recordsUpserted?: number;
  notes?: string;
}

export interface SyncRunRecord {
  id: string;
  connector: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  recordsUpserted: number;
  error: string | null;
  notes: string | null;
  durationMs: number;
}

export interface SyncRunOptions {
  /** Postgres table names to count before/after the sync for integrity checking. */
  tables?: string[];
  /** Maximum allowed percentage drop before flagging. Default: 5. */
  dropThresholdPct?: number;
}

const INTEGRITY_THRESHOLD_DEFAULT = 5;

type TableCounts = Record<string, number>;

async function getTableCounts(tables: string[]): Promise<TableCounts> {
  const counts: TableCounts = {};
  for (const table of tables) {
    // Use parameterized raw query — table names are from our own code, not user input,
    // but we validate them against a strict pattern anyway.
    if (!/^[a-z_]+$/.test(table)) continue;
    const result = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT COUNT(*) as count FROM "${table}"`,
    );
    counts[table] = Number(result[0]?.count ?? 0);
  }
  return counts;
}

function buildIntegrityWarnings(
  before: TableCounts,
  after: TableCounts,
  thresholdPct: number,
): string[] {
  const warnings: string[] = [];
  for (const table of Object.keys(before)) {
    const pre = before[table] ?? 0;
    const post = after[table] ?? 0;
    if (pre === 0) continue; // can't compute drop % from zero
    const dropPct = ((pre - post) / pre) * 100;
    if (dropPct > thresholdPct) {
      warnings.push(
        `INTEGRITY WARNING: ${table} dropped from ${pre} to ${post} rows (${dropPct.toFixed(1)}% loss)`,
      );
    }
  }
  return warnings;
}

export async function runSync(
  connector: string,
  body: () => Promise<SyncRunResult>,
  options?: SyncRunOptions,
): Promise<SyncRunRecord> {
  const tables = options?.tables ?? [];
  const thresholdPct = options?.dropThresholdPct ?? INTEGRITY_THRESHOLD_DEFAULT;

  const startedAt = new Date();
  const run = await prisma.syncRun.create({
    data: { connector, status: 'running', startedAt },
  });

  // Snapshot row counts before sync
  const countsBefore = tables.length > 0 ? await getTableCounts(tables) : {};

  let status: 'ok' | 'noop' | 'error' = 'ok';
  let recordsUpserted = 0;
  let notes: string | null = null;
  let errorMessage: string | null = null;

  try {
    const result = await body();
    status = result.status;
    recordsUpserted = result.recordsUpserted ?? 0;
    notes = result.notes ?? null;
  } catch (err) {
    status = 'error';
    errorMessage = err instanceof Error ? err.message : String(err);
  }

  // Snapshot row counts after sync and check for data loss
  if (tables.length > 0 && status !== 'error') {
    const countsAfter = await getTableCounts(tables);
    const warnings = buildIntegrityWarnings(countsBefore, countsAfter, thresholdPct);
    if (warnings.length > 0) {
      const warningText = warnings.join('; ');
      console.error(`[${connector}] ${warningText}`);
      notes = notes ? `${notes} | ${warningText}` : warningText;
    }
  }

  const finishedAt = new Date();
  await prisma.syncRun.update({
    where: { id: run.id },
    data: {
      status,
      finishedAt,
      recordsUpserted,
      error: errorMessage,
      notes,
    },
  });

  return {
    id: run.id,
    connector,
    status,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    recordsUpserted,
    error: errorMessage,
    notes,
    durationMs: finishedAt.getTime() - startedAt.getTime(),
  };
}
