/**
 * Loads the flat grant index into the `grant_documents` catalog table.
 *
 * Reads `data/grants-index.jsonl` (produced by build-grants-index.ts) and upserts
 * one row per file. Nothing under `data/` is read for content and nothing is
 * modified — this moves metadata only.
 *
 * Drive file IDs come from two places:
 *   1. `.gdoc` / `.gsheet` stub files in the mirror, which embed their `doc_id`.
 *      Harvested here, so the catalog is immediately useful for those.
 *   2. A Drive API walk (see drive-walk-grants.ts), merged on `path` later.
 *
 * Usage:
 *   pnpm exec tsx packages/grants/scripts/load-grant-catalog.ts
 *   pnpm exec tsx packages/grants/scripts/load-grant-catalog.ts --dry-run
 *
 * Safe to re-run: upserts on `path`, and never deletes rows whose file has
 * vanished from the local mirror. The mirror is a snapshot, and one produced by
 * *downloading* the tree — so absence from it is not evidence a document is gone.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
// Imported by relative path rather than as `@lp-ai/lib-db`. `packages/grants` is
// deliberately dependency-free apart from zod — the deterministic grant logic must
// not reach a database — and `scripts/` is outside this package's build
// (tsconfig includes only `src`). A relative import keeps that contract intact.
import { prisma } from '../../db/src/client.js';
// The catalog's classification vocabulary, shared with the Drive connector so the
// two discovery paths cannot disagree about the same file.
import { driveUrlFor, mimeForExt, needsReview } from '../src/catalog.js';

const DATA_DIR = new URL('../../../data/', import.meta.url).pathname;
const INDEX_PATH = join(DATA_DIR, 'grants-index.jsonl');

const DRY_RUN = process.argv.includes('--dry-run');

interface IndexRow {
  root: string;
  path: string;
  filename: string;
  collection: string;
  funder: string | null;
  year: number | null;
  doc_kind: string;
  exclude: boolean;
  external_ref: boolean;
  archive_only: boolean;
  ext: string;
  content_class: string;
  size_bytes: number;
  modified: string;
  depth: number;
}

/**
 * Harvests Drive IDs from `.gdoc` / `.gsheet` stubs.
 *
 * Google Drive for Desktop writes these as small JSON files holding the real
 * document's `doc_id` rather than its contents, so they are the only place the
 * local mirror records a Drive ID at all.
 *
 * Returns a map of index `path` -> Drive file ID.
 */
function harvestStubIds(): Map<string, string> {
  const ids = new Map<string, string>();

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(gdoc|gsheet|gslides)$/i.test(entry)) continue;
      try {
        const parsed = JSON.parse(readFileSync(full, 'utf8')) as { doc_id?: string };
        if (parsed.doc_id) {
          ids.set(full.slice(DATA_DIR.length), parsed.doc_id);
        }
      } catch {
        // A stub we cannot parse is not worth failing the load over.
      }
    }
  };

  walk(DATA_DIR);
  return ids;
}

async function main(): Promise<void> {
  if (!existsSync(INDEX_PATH)) {
    throw new Error(
      `missing ${INDEX_PATH} — run build-grants-index.ts first`,
    );
  }

  const rows = readFileSync(INDEX_PATH, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as IndexRow);

  const stubIds = harvestStubIds();

  let withId = 0;
  let flagged = 0;

  for (const row of rows) {
    const id = stubIds.get(row.path) ?? null;
    if (id) withId += 1;
    const review = needsReview({
      exclude: row.exclude,
      year: row.year,
      doc_kind: row.doc_kind,
      collection: row.collection,
    });
    if (review) flagged += 1;

    if (DRY_RUN) continue;

    const data = {
      filename: row.filename,
      collection: row.collection,
      funder: row.funder,
      year: row.year,
      docKind: row.doc_kind,
      excluded: row.exclude,
      externalReference: row.external_ref,
      archiveOnly: row.archive_only,
      needsReview: review,
      ext: row.ext || null,
      contentClass: row.content_class,
      sizeBytes: BigInt(row.size_bytes),
      modifiedAt: new Date(row.modified),
      mimeType: mimeForExt(row.ext),
      // Only overwrite an existing ID when we actually have one, so a later
      // Drive walk's IDs survive a re-run of this local pass.
      ...(id ? { driveFileId: id, driveUrl: driveUrlFor(id, mimeForExt(row.ext)) } : {}),
      syncedAt: new Date(),
    };

    await prisma.grantDocument.upsert({
      where: { path: row.path },
      create: { path: row.path, ...data },
      update: data,
    });
  }

  const verb = DRY_RUN ? 'would load' : 'loaded';
  process.stdout.write(
    `${verb} ${String(rows.length)} rows | ${String(withId)} with a Drive ID | ` +
      `${String(flagged)} flagged needs_review\n`,
  );
  if (withId < rows.length) {
    process.stdout.write(
      `note: ${String(rows.length - withId)} rows have no Drive ID yet — ` +
        `run drive-walk-grants.ts to backfill them\n`,
    );
  }
}

await main();
await prisma.$disconnect();
