/**
 * Builds a flat, reviewable index of everything under `data/`.
 *
 * The Drive export in `data/` carries most of its meaning in folder names rather
 * than file contents: which funder a document belongs to, which application year
 * it is part of, whether it is a narrative response or a budget, and whether
 * Launchpad even wrote it. Nested 7 levels deep, none of that is queryable.
 *
 * This script reads that structure and emits one row per file, so the corpus can
 * be reviewed in a spreadsheet and corrected before anything downstream consumes
 * it. It is strictly read-only: no file under `data/` is moved, renamed, or
 * modified.
 *
 * Usage:
 *   pnpm exec tsx packages/grants/scripts/build-grants-index.ts
 *
 * Outputs (into `data/`, which is gitignored — the paths themselves name funders):
 *   data/grants-index.csv     reviewable in Sheets/Excel
 *   data/grants-index.jsonl   one JSON object per line, for programmatic use
 *   data/grants-index-summary.md  tallies + the anomalies worth eyeballing
 */

import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
// Classification lives in the package's `src` because two callers need it: this
// script, walking the local mirror, and `connectors/google-drive`, walking Drive.
// Imported by relative path for the same reason `load-grant-catalog.ts` imports
// the database that way — `scripts/` sits outside this package's build.
import {
  classify,
  contentClassForExt,
  fileExtension,
  type Collection,
  type ContentClass,
  type DocKind,
} from '../src/catalog.js';

export interface IndexRow {
  /** Top-level folder under data/, e.g. "Grants". */
  root: string;
  /** Path relative to data/, the stable identifier for a row. */
  path: string;
  filename: string;
  collection: Collection;
  funder: string | null;
  year: number | null;
  doc_kind: DocKind;
  /** Sits under an explicit do-not-ingest folder. */
  exclude: boolean;
  /** Launchpad did not author this. Implies archive_only. */
  external_ref: boolean;
  /** Reference only — must not be used as drafting context. */
  archive_only: boolean;
  ext: string;
  /** 'text' | 'media' | 'unknown' — whether text can be extracted today. */
  content_class: ContentClass;
  /** Our recommendation: ingest this into document_chunks? */
  ingest: boolean;
  size_bytes: number;
  modified: string;
  /** Folder nesting depth below data/. */
  depth: number;
}

// ---------------------------------------------------------------------------
// Walk + emit
// ---------------------------------------------------------------------------

const DATA_DIR = new URL('../../../data/', import.meta.url).pathname;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function buildRows(): IndexRow[] {
  const rows: IndexRow[] = [];

  for (const file of walk(DATA_DIR)) {
    const rel = relative(DATA_DIR, file);
    const parts = rel.split('/');
    const filename = parts.pop() ?? '';
    const root = parts.shift() ?? '';
    // Skip our own output files.
    if (!root || filename.startsWith('grants-index')) continue;

    const ext = fileExtension(filename);
    const content_class = contentClassForExt(ext);

    const meta = classify(root, parts, filename);
    const stat = statSync(file);

    rows.push({
      root,
      path: rel,
      filename,
      ...meta,
      ext,
      content_class,
      // VTT transcripts count as text; audio/video are skipped pending a
      // transcription decision.
      ingest: !meta.exclude && content_class === 'text',
      size_bytes: stat.size,
      modified: stat.mtime.toISOString(),
      depth: parts.length,
    });
  }

  return rows.sort((a, b) => a.path.localeCompare(b.path));
}

function tally<K extends keyof IndexRow>(rows: IndexRow[], key: K): [string, number][] {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = String(r[key] ?? 'null');
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

function summary(rows: IndexRow[]): string {
  const L: string[] = [];
  const table = (title: string, pairs: [string, number][]): void => {
    L.push(`### ${title}\n`, '| value | files |', '|---|---:|');
    for (const [k, v] of pairs) L.push(`| ${k} | ${v} |`);
    L.push('');
  };

  L.push('# Grants index — summary', '');
  L.push(`Generated from \`data/\`. **${rows.length}** files indexed. Files were not modified.`, '');
  L.push(
    `- **${rows.filter((r) => r.ingest).length}** recommended for ingestion`,
    `- **${rows.filter((r) => r.exclude).length}** excluded (do-not-ingest folders)`,
    `- **${rows.filter((r) => r.external_ref).length}** externally authored (never use as drafting context)`,
    `- **${rows.filter((r) => r.archive_only).length}** archive-only (reference, not drafting context)`,
    `- **${rows.filter((r) => r.content_class === 'media').length}** media (no text without transcription/OCR)`,
    `- **${new Set(rows.map((r) => r.funder).filter(Boolean)).size}** distinct funders`,
    '',
  );

  table('Collection', tally(rows, 'collection'));
  table('Document kind', tally(rows, 'doc_kind'));
  table('Application year', tally(rows, 'year'));
  table('Extension', tally(rows, 'ext'));

  // The rows most likely to be misclassified — worth a human pass.
  L.push('## Needs review', '');
  const unknownYear = rows.filter((r) => r.year === null && r.ingest && r.funder);
  const otherKind = rows.filter((r) => r.doc_kind === 'other' && r.ingest);
  const unknownColl = rows.filter((r) => r.collection === 'unknown');
  L.push(
    `- **${unknownYear.length}** ingestable funder files with **no year** — the path never states one.`,
    `- **${otherKind.length}** ingestable files classified **\`other\`** — neither folder nor filename was decisive.`,
    `- **${unknownColl.length}** files in an **unrecognized collection**.`,
    '',
    'Sorted samples of each are in the CSV; filter on `year=""` or `doc_kind=other`.',
    '',
  );

  L.push('## Caveats', '');
  L.push(
    '- **No Drive file IDs.** This index was built from the local `data/` mirror, which',
    '  does not record them. Mapping rows back to Drive requires an API walk of the',
    '  shared folder; the `path` column is the join key until then.',
    '- **Snapshot.** Reflects `data/` at generation time, not live Drive.',
    '- `year`, `doc_kind`, and `funder` are inferred from folder and file names only.',
    '  Nothing here was derived from file contents.',
    '',
  );

  return L.join('\n');
}

const rows = buildRows();

const COLUMNS: (keyof IndexRow)[] = [
  'path', 'root', 'collection', 'funder', 'year', 'doc_kind',
  'ingest', 'exclude', 'external_ref', 'archive_only',
  'ext', 'content_class', 'size_bytes', 'modified', 'depth', 'filename',
];

const csv = [
  COLUMNS.join(','),
  ...rows.map((r) => COLUMNS.map((c) => csvCell(r[c])).join(',')),
].join('\n');

writeFileSync(join(DATA_DIR, 'grants-index.csv'), `${csv}\n`);
writeFileSync(
  join(DATA_DIR, 'grants-index.jsonl'),
  `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`,
);
writeFileSync(join(DATA_DIR, 'grants-index-summary.md'), summary(rows));

process.stdout.write(
  `indexed ${String(rows.length)} files -> data/grants-index.{csv,jsonl} + -summary.md\n`,
);
