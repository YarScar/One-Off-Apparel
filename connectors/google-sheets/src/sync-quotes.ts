/**
 * Ingest the Quote Bank spreadsheet into `document_chunks` for grant-writing
 * retrieval. Every row with a non-empty Quote becomes one embedded chunk whose
 * content is the quote plus a compact attribution line — so semantic search
 * matches on the quote itself, and the attribution rides along in both content
 * and metadata.
 *
 * Not a typed Postgres table on purpose: retrieval is the only current use.
 * If quotes need structural queries later ("all quotes from cohort 1"), a
 * `quotes` table can be added alongside without changing this path.
 */
import crypto from 'node:crypto';
import { prisma } from '@lp-ai/lib-db';
import { embedBatch } from '@lp-ai/lib-embedding';
import { getAllSheetRows } from './sheets-client.js';

function headerToKey(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\(.*?\)/g, '')
    .replace(/[?#]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

interface ColumnMap {
  name: number;
  role: number;
  cohort: number;
  school: number;
  company: number;
  title: number;
  source: number;
  quote: number;
}

function findColumn(headers: string[], candidates: string[]): number {
  const keys = headers.map(headerToKey);
  for (const cand of candidates) {
    const idx = keys.indexOf(cand);
    if (idx !== -1) return idx;
  }
  return -1;
}

function buildColumnMap(headers: string[]): ColumnMap | null {
  const map: ColumnMap = {
    name: findColumn(headers, ['name']),
    role: findColumn(headers, ['role_student_employer_other', 'role']),
    cohort: findColumn(headers, ['cohort_if_applicable', 'cohort']),
    school: findColumn(headers, ['school_if_applicable', 'school']),
    company: findColumn(headers, ['company_if_applicable', 'company']),
    title: findColumn(headers, ['title_if_applicable', 'title']),
    source: findColumn(headers, ['source']),
    quote: findColumn(headers, ['quote']),
  };
  if (map.quote === -1 || map.name === -1) return null;
  return map;
}

function cell(row: string[], idx: number): string {
  if (idx < 0 || idx >= row.length) return '';
  return (row[idx] ?? '').trim();
}

function attributionLine(row: string[], map: ColumnMap): string {
  const parts: string[] = [];
  const name = cell(row, map.name);
  const role = cell(row, map.role);
  const cohort = cell(row, map.cohort);
  const school = cell(row, map.school);
  const company = cell(row, map.company);
  const title = cell(row, map.title);

  if (name) parts.push(name);
  const context: string[] = [];
  if (role) context.push(role);
  if (cohort) context.push(`Cohort ${cohort}`);
  if (school) context.push(school);
  if (company && title) context.push(`${title} at ${company}`);
  else if (company) context.push(company);
  else if (title) context.push(title);
  if (context.length > 0) parts.push(`(${context.join(', ')})`);
  return parts.length > 0 ? `— ${parts.join(' ')}` : '';
}

function stableRowKey(row: string[], map: ColumnMap): string {
  const name = cell(row, map.name);
  const quote = cell(row, map.quote);
  return crypto.createHash('sha1').update(`${name}${quote}`).digest('hex').slice(0, 20);
}

export interface QuotesSyncStats {
  rows_seen: number;
  rows_synced: number;
  rows_skipped_empty: number;
  chunks_written: number;
}

export async function syncQuotes(): Promise<QuotesSyncStats> {
  const stats: QuotesSyncStats = {
    rows_seen: 0,
    rows_synced: 0,
    rows_skipped_empty: 0,
    chunks_written: 0,
  };

  const sheetId = process.env['GOOGLE_SHEETS_QUOTE_BANK_ID'];
  if (!sheetId) {
    console.log('google-sheets-quotes: GOOGLE_SHEETS_QUOTE_BANK_ID not set, skipping');
    return stats;
  }

  let sheetsByTab: Map<string, string[][]>;
  try {
    sheetsByTab = await getAllSheetRows(sheetId);
  } catch (err) {
    console.warn(
      `google-sheets-quotes: skipping — ${err instanceof Error ? err.message : String(err)}`,
    );
    return stats;
  }

  const allRows: string[][] = [];
  let headerRow: string[] | null = null;
  for (const [, rows] of sheetsByTab) {
    if (rows.length === 0) continue;
    if (headerRow === null) headerRow = rows[0] ?? null;
    for (let i = 1; i < rows.length; i += 1) allRows.push(rows[i] ?? []);
  }
  if (!headerRow || allRows.length === 0) {
    console.log('google-sheets-quotes: no rows found');
    return stats;
  }

  const columns = buildColumnMap(headerRow);
  if (!columns) {
    console.warn('google-sheets-quotes: header row missing required Name/Quote columns');
    return stats;
  }

  const contents: string[] = [];
  const rowMeta: Array<{
    sourceId: string;
    title: string | null;
    metadata: Record<string, unknown>;
  }> = [];
  const seenIds = new Set<string>();

  for (const row of allRows) {
    stats.rows_seen += 1;
    const quote = cell(row, columns.quote);
    if (!quote) {
      stats.rows_skipped_empty += 1;
      continue;
    }
    const key = stableRowKey(row, columns);
    if (seenIds.has(key)) continue;
    seenIds.add(key);

    const attribution = attributionLine(row, columns);
    const content = attribution ? `"${quote}"\n${attribution}` : `"${quote}"`;
    const name = cell(row, columns.name);
    const metadata: Record<string, unknown> = {
      subtype: 'quote',
      google_sheet_id: sheetId,
      quote_key: key,
      name: name || null,
      role: cell(row, columns.role) || null,
      cohort: cell(row, columns.cohort) || null,
      school: cell(row, columns.school) || null,
      company: cell(row, columns.company) || null,
      title: cell(row, columns.title) || null,
      source: cell(row, columns.source) || null,
    };
    contents.push(content);
    rowMeta.push({
      sourceId: `sheets:quote:${key}`,
      title: name || null,
      metadata,
    });
  }

  if (contents.length === 0) return stats;

  const embeddings = await embedBatch(contents);

  await prisma.$executeRaw`
    DELETE FROM document_chunks
    WHERE source = 'sheets'
      AND source_id LIKE 'sheets:quote:%'
  `;

  for (let i = 0; i < contents.length; i += 1) {
    const id = crypto.randomUUID();
    const meta = rowMeta[i]!;
    const embedding = embeddings[i]!;
    const embeddingLiteral = `[${embedding.join(',')}]`;
    const metadataJson = JSON.stringify(meta.metadata);

    await prisma.$executeRaw`
      INSERT INTO document_chunks (id, source, source_id, title, content, embedding, metadata, synced_at)
      VALUES (
        ${id},
        'sheets',
        ${meta.sourceId},
        ${meta.title},
        ${contents[i]!},
        ${embeddingLiteral}::vector(1536),
        ${metadataJson}::jsonb,
        NOW()
      )
    `;
    stats.chunks_written += 1;
    stats.rows_synced += 1;
  }

  return stats;
}
