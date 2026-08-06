/**
 * Drive -> `grant_documents` catalog sync.
 *
 * What this connector does, and deliberately does not do:
 *
 *   - **Does** discover every file in the shared grant tree and record what and
 *     where it is, including the Drive file ID content is fetched with.
 *   - **Does not** ingest document text. Discovery is the thing that was broken
 *     (`docs/data-sources/google-drive-discovery.md`); retrieval already works by
 *     ID, so embedding the corpus (measured 2026-08-06: 1257 files, ~1.5 GiB) to
 *     answer questions a catalog query answers would be cost with no capability
 *     behind it. `document_chunks` stays out of this path until there is a stated
 *     need for semantic search over the corpus.
 *
 * Safety, per the root `CLAUDE.md` sync rule: this upserts on a stable key and
 * **never deletes**. Absence from a run is not evidence a document is gone — the
 * identity that vanished may simply be the one whose access lapsed, and deleting
 * the catalog because the credentials were wrong is exactly the failure the rule
 * exists to prevent.
 */

import { prisma } from '@lp-ai/lib-db';
import { classifyPath, needsReview } from '@lp-ai/lib-grants';

import {
  makeDriveClient,
  makeOAuthDriveClient,
  type DriveClient,
  type DriveFile,
  type DriveRoot,
} from './drive-client.js';
import { reconcile, type CatalogRow, type ReconcileResult } from './reconcile.js';

/** The shared "Grants" folder, when the environment does not name one. */
export const DEFAULT_GRANTS_FOLDER_ID = '1ZqQaFrfVZJ6kPvXNd3pPNVyaL8PpaX3S';

export interface CatalogSyncOptions {
  /** Report what would change without writing. */
  dryRun?: boolean;
  /** Called with each progress line, so the CLI can print and the sync can stay quiet. */
  onProgress?: (message: string) => void;
}

export interface CatalogSyncResult {
  root: DriveRoot;
  strategy: string;
  apiCalls: number;
  filesFound: number;
  updated: number;
  created: number;
  ambiguous: number;
  /** How each matched row was identified. A shift here is worth noticing. */
  matchedBy: ReconcileResult['counts'];
  /** Shortcut targets this identity cannot read. Recorded as not fetchable. */
  unreadable: number;
  /** Folders referenced but not listable — skipped, not fatal. */
  inaccessibleFolders: string[];
  /** Alias paths dropped because one Drive file is filed in several places. */
  duplicatePaths: string[];
  shortcutsResolved: number;
  /** Catalog rows the walk never reached. Left alone, not deleted. */
  notSeen: number;
  files: DriveFile[];
}

/** One line describing the run, short enough for `sync_runs.notes`. */
export function summarize(r: CatalogSyncResult): string {
  return (
    `${r.root.name}: ${String(r.filesFound)} files via ${r.strategy} in ` +
    `${String(r.apiCalls)} API calls | ${String(r.updated)} rows updated, ` +
    `${String(r.created)} created, ${String(r.ambiguous)} ambiguous (flagged for review), ` +
    `${String(r.shortcutsResolved)} shortcuts resolved (${String(r.unreadable)} unreadable), ` +
    `${String(r.inaccessibleFolders.length)} folders unlistable, ` +
    `${String(r.duplicatePaths.length)} duplicate paths dropped, ` +
    `${String(r.notSeen)} catalog rows not seen | ` +
    `matched by id/exact/normalized/loose/scoped-name: ${String(r.matchedBy.drive_id)}/` +
    `${String(r.matchedBy.exact_path)}/${String(r.matchedBy.normalized_path)}/` +
    `${String(r.matchedBy.loose_path)}/${String(r.matchedBy.scoped_name)} | ` +
    // Recorded because it is the answer to the open question in the discovery
    // doc, and a run's notes are where it will still be readable next month.
    `driveId=${r.root.driveId ?? 'none (My Drive)'}`
  );
}

/**
 * Walks Drive and reconciles the catalog against it.
 *
 * Split out from `sync()` so the CLI can dry-run it and so a test can drive it
 * with a fake client. Drive is treated as authoritative for everything except a
 * matched row's `path`: rewriting that would break `load-grant-catalog.ts`, which
 * upserts on the local mirror's spelling of the same file.
 */
export async function syncGrantCatalog(
  client: DriveClient,
  folderId: string,
  options: CatalogSyncOptions = {},
): Promise<CatalogSyncResult> {
  const progress = options.onProgress ?? ((): void => undefined);

  const root = await client.resolveRoot(folderId);
  progress(
    `root "${root.name}" (${root.id}) — ` +
      (root.driveId !== null ? `shared drive ${root.driveId}` : 'My Drive'),
  );

  const { files, apiCalls, strategy, inaccessibleFolders, duplicatePaths } =
    await client.listTree(root);
  progress(`${String(files.length)} files via ${strategy} in ${String(apiCalls)} API calls`);
  for (const folder of inaccessibleFolders) {
    progress(`  could not list (shortcut into an inaccessible drive): ${folder}`);
  }
  for (const duplicate of duplicatePaths) {
    progress(`  one file, several paths — kept one row: ${duplicate}`);
  }

  // An identity that can read the root but list nothing inside it is the original
  // bug's exact signature. Say so, rather than reporting a successful empty sync.
  if (files.length === 0) {
    throw new Error(
      `Read "${root.name}" but listed 0 files inside it. This is the discovery failure in ` +
        'docs/data-sources/google-drive-discovery.md, not an empty folder. The authenticated ' +
        'identity is almost certainly not a member of the shared drive: a service account does ' +
        "not inherit a human's \"Shared with me\" access, so the folder must be shared with its " +
        'client_email directly.',
    );
  }

  const rows: CatalogRow[] = await prisma.grantDocument.findMany({
    select: { id: true, path: true, driveFileId: true },
  });
  const { resolutions, counts } = reconcile(files, rows);

  const seenRowIds = new Set<string>();
  let updated = 0;
  let created = 0;

  for (const { file, rowId, ambiguousWith } of resolutions) {
    const meta = classifyPath(file.path);
    const review = needsReview(meta) || ambiguousWith.length > 0 || file.unreadable;

    const data = {
      driveFileId: file.id,
      driveUrl: file.url,
      mimeType: file.mimeType,
      filename: file.name,
      collection: meta.collection,
      funder: meta.funder,
      year: meta.year,
      docKind: meta.doc_kind,
      excluded: meta.exclude,
      externalReference: meta.external_ref,
      archiveOnly: meta.archive_only,
      needsReview: review,
      ext: file.ext || null,
      // An ID that 404s is not fetchable, whatever its type says. `find_grant_documents`
      // gates `fetchable` on contentClass, so this is what keeps it honest.
      contentClass: file.unreadable ? 'unknown' : file.contentClass,
      ...(file.size !== null ? { sizeBytes: BigInt(file.size) } : {}),
      ...(file.modifiedTime ? { modifiedAt: new Date(file.modifiedTime) } : {}),
      syncedAt: new Date(),
    };

    if (rowId !== null) {
      seenRowIds.add(rowId);
      updated += 1;
      if (options.dryRun) continue;
      // `path` is intentionally not written: a matched row keeps the spelling the
      // local-mirror loader upserts on, so the two paths cannot fight each other.
      await prisma.grantDocument.update({ where: { id: rowId }, data });
      continue;
    }

    created += 1;
    if (options.dryRun) continue;
    // Upsert rather than create: a path collision here means a concurrent or
    // earlier run already made the row, which is not an error worth failing on.
    await prisma.grantDocument.upsert({
      where: { path: file.path },
      create: { path: file.path, ...data },
      update: data,
    });
  }

  return {
    root,
    strategy,
    apiCalls,
    filesFound: files.length,
    updated,
    created,
    ambiguous: counts.ambiguous,
    matchedBy: counts,
    shortcutsResolved: files.filter((f) => f.viaShortcutId !== null).length,
    unreadable: files.filter((f) => f.unreadable).length,
    inaccessibleFolders,
    duplicatePaths,
    notSeen: rows.filter((r) => !seenRowIds.has(r.id)).length,
    files,
  };
}

/**
 * Closes the database connection this module opened.
 *
 * Exported for the CLI in `packages/grants/scripts/`: it must disconnect the same
 * Prisma client the sync used, and importing its own would leave this one holding
 * the event loop open.
 */
export async function disconnect(): Promise<void> {
  await prisma.$disconnect();
}

/**
 * Builds the client from the environment. Null when no identity is configured.
 *
 * A user identity wins when one is fully configured, because it is only ever set
 * deliberately for a local run — a machine that has both is a developer's, and the
 * one that can actually see the tree is the person's. Production sets only the
 * service account.
 */
export function clientFromEnv(env: {
  GOOGLE_SERVICE_ACCOUNT_JSON?: string | undefined;
  GOOGLE_OAUTH_CLIENT_ID?: string | undefined;
  GOOGLE_OAUTH_CLIENT_SECRET?: string | undefined;
  GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN?: string | undefined;
}): DriveClient | null {
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = env.GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN;
  if (clientId && clientSecret && refreshToken) {
    return makeOAuthDriveClient({ clientId, clientSecret, refreshToken });
  }

  const key = env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!key) return null;
  return makeDriveClient(key);
}
