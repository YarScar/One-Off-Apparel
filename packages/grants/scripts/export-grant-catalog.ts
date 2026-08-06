/**
 * Exports the `grant_documents` catalog to shareable files.
 *
 * This exists because the other two artifacts each hold only half of what people
 * actually want. `data/grants-index.{csv,jsonl}` is written by
 * build-grants-index.ts straight from the local mirror and carries **no Drive
 * IDs** — the mirror does not record them. The IDs are added later, by
 * load-grant-catalog.ts and drive-walk-grants.ts, and land only in Postgres.
 * So neither file on disk pairs a document with its Drive ID.
 *
 * This script reads the catalog after those passes and writes the pairing out.
 * Run it again after the Drive walk to refresh.
 *
 * Usage:
 *   node --env-file=.env --import tsx packages/grants/scripts/export-grant-catalog.ts
 *
 * Outputs (into `data/`, gitignored — the rows name funders):
 *   data/grant-catalog.json  full catalog, one array
 *   data/grant-catalog.csv   same rows, spreadsheet-ready
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
// See load-grant-catalog.ts for why this is a relative import.
import { prisma } from '../../db/src/client.js';

const DATA_DIR = new URL('../../../data/', import.meta.url).pathname;

const COLUMNS = [
  'funder',
  'filename',
  'drive_file_id',
  'drive_url',
  'fetchable',
  'year',
  'doc_kind',
  'collection',
  'mime_type',
  'archive_only',
  'external_reference',
  'excluded',
  'needs_review',
  'content_class',
  'size_bytes',
  'modified_at',
  'path',
] as const;

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function main(): Promise<void> {
  const rows = await prisma.grantDocument.findMany({
    // Funder first, then newest year: the order a person browsing by funder wants.
    orderBy: [{ funder: 'asc' }, { year: 'desc' }, { filename: 'asc' }],
  });

  const out = rows.map((r) => ({
    funder: r.funder,
    filename: r.filename,
    drive_file_id: r.driveFileId,
    drive_url: r.driveUrl,
    // The single field worth checking before relying on a row: false means the
    // Drive ID is missing, so the document can be listed but not fetched.
    fetchable: r.driveFileId !== null && r.contentClass === 'text',
    year: r.year,
    doc_kind: r.docKind,
    collection: r.collection,
    mime_type: r.mimeType,
    archive_only: r.archiveOnly,
    external_reference: r.externalReference,
    excluded: r.excluded,
    needs_review: r.needsReview,
    content_class: r.contentClass,
    // BigInt does not survive JSON.stringify.
    size_bytes: r.sizeBytes === null ? null : Number(r.sizeBytes),
    modified_at: r.modifiedAt?.toISOString() ?? null,
    path: r.path,
  }));

  writeFileSync(join(DATA_DIR, 'grant-catalog.json'), `${JSON.stringify(out, null, 2)}\n`);
  writeFileSync(
    join(DATA_DIR, 'grant-catalog.csv'),
    `${[
      COLUMNS.join(','),
      ...out.map((r) => COLUMNS.map((c) => csvCell(r[c])).join(',')),
    ].join('\n')}\n`,
  );

  const withId = out.filter((r) => r.drive_file_id !== null).length;
  process.stdout.write(
    `exported ${String(out.length)} rows -> data/grant-catalog.{json,csv} | ` +
      `${String(withId)} have a Drive ID\n`,
  );
  if (withId < out.length) {
    process.stdout.write(
      `note: ${String(out.length - withId)} rows still need drive-walk-grants.ts to backfill ` +
        `their Drive ID; those export with drive_file_id: null and fetchable: false\n`,
    );
  }
}

await main();
await prisma.$disconnect();
