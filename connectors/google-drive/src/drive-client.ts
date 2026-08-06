/**
 * Google Drive API wrapper for the grant corpus.
 *
 * This module exists because of a specific, diagnosed failure — see
 * `docs/data-sources/google-drive-discovery.md`. Content inside the shared
 * `Grants` tree is readable by file ID, but nothing inside it is *discoverable*:
 * listing a subfolder's children comes back empty and title/fullText search never
 * matches. That signature is what a Shared Drive looks like when queried without
 * the shared-drive flags, so **every call here sets them**. There is no code path
 * in this connector that talks to Drive without going through this file, which is
 * the point: a single omission of `includeItemsFromAllDrives` reintroduces the
 * bug silently, as an empty result rather than an error.
 *
 * Two other correctness rules are enforced here rather than left to callers:
 *
 *   - **Shortcuts are resolved to their target.** A shortcut's own ID reads as
 *     empty content, so storing it means cataloguing a file that cannot be
 *     fetched.
 *   - **Retries are bounded and backed off.** A walk of this corpus is ~4 pages
 *     for a shared drive and ~600 calls otherwise; at that volume Drive's rate
 *     limiter will refuse some of them, and an unhandled 429 truncates the walk
 *     into a wrong answer that looks like a right one.
 */

import { google, type drive_v3 } from 'googleapis';
import {
  FOLDER_MIME,
  SHORTCUT_MIME,
  contentClassForExt,
  contentClassForMime,
  driveUrlFor,
  fileExtension,
  type ContentClass,
} from '@lp-ai/lib-grants';

/** Flags without which a Shared Drive returns nothing at all. */
const ALL_DRIVES = { supportsAllDrives: true, includeItemsFromAllDrives: true } as const;

/** The API maximum. Fewer pages means fewer chances to be rate-limited. */
const PAGE_SIZE = 1000;

const LIST_FIELDS =
  'nextPageToken, files(id, name, mimeType, size, modifiedTime, parents, ' +
  'shortcutDetails(targetId, targetMimeType), trashed)';

export interface DriveFile {
  /** The ID content is fetched with — a shortcut's target, never the shortcut. */
  id: string;
  name: string;
  mimeType: string;
  /** Path below (and including) the root folder's name. Matches `grant_documents.path`. */
  path: string;
  size: number | null;
  modifiedTime: string | null;
  /** The shortcut's own ID, when this row was reached through one. */
  viaShortcutId: string | null;
  /** Whether text can be extracted from this file today. */
  contentClass: ContentClass;
  /** Extension as the catalog records it, '' for Google-native files. */
  ext: string;
  /** The URL a human opens. */
  url: string;
}

export interface DriveRoot {
  id: string;
  name: string;
  /**
   * Non-null iff the folder lives in a Shared Drive.
   *
   * This is the decisive fact the discovery diagnosis could not obtain without
   * credentials, and the reason it is returned rather than logged: the sync
   * records it in `sync_runs.notes`, so the answer survives the run.
   */
  driveId: string | null;
}

export interface DriveClient {
  resolveRoot(folderId: string): Promise<DriveRoot>;
  listTree(root: DriveRoot): Promise<{ files: DriveFile[]; apiCalls: number; strategy: string }>;
  /** Plain text for a Google-native document. Null when the type has no text export. */
  exportText(fileId: string, mimeType: string): Promise<string | null>;
}

// ---------------------------------------------------------------------------
// Retry
// ---------------------------------------------------------------------------

const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 500;

function statusOf(err: unknown): number | null {
  const code = (err as { code?: unknown; status?: unknown } | null)?.code;
  const status = (err as { status?: unknown } | null)?.status;
  const n = typeof code === 'number' ? code : typeof status === 'number' ? status : null;
  return n;
}

/**
 * Retries only what retrying can fix: rate limits and transient server errors.
 *
 * Anything else is rethrown **unchanged**, status code intact, because callers
 * branch on it — a 403 or 404 from a drive-scoped sweep is not a failure, it is
 * the signal to walk the folders instead.
 */
async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      const status = statusOf(err);
      const retryable = status === 429 || status === 500 || status === 502 || status === 503;
      if (!retryable) throw err;
      lastError = err;
      if (attempt === MAX_ATTEMPTS) break;
      await new Promise((resolve) => setTimeout(resolve, BASE_DELAY_MS * 2 ** (attempt - 1)));
    }
  }
  throw new Error(
    `Drive ${label} failed after ${String(MAX_ATTEMPTS)} attempts of retryable errors: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

// ---------------------------------------------------------------------------
// File mapping
// ---------------------------------------------------------------------------

/**
 * Turns a raw API file into a `DriveFile`, resolving shortcuts.
 *
 * Returns null for folders (they are traversed, not catalogued) and for
 * shortcuts whose target Drive declines to name — a shortcut with no target is
 * a broken link, and recording its own unreadable ID is worse than skipping it.
 */
export function toDriveFile(raw: drive_v3.Schema$File, path: string): DriveFile | null {
  if (!raw.id || !raw.name || raw.mimeType === FOLDER_MIME) return null;

  const isShortcut = raw.mimeType === SHORTCUT_MIME;
  const id = isShortcut ? raw.shortcutDetails?.targetId : raw.id;
  if (!id) return null;

  const mimeType =
    (isShortcut ? raw.shortcutDetails?.targetMimeType : raw.mimeType) ?? 'application/octet-stream';
  const ext = fileExtension(raw.name);
  // Drive's MIME type is the better authority — Google-native files carry no
  // extension, and a file named without one still reports its real type. The
  // extension only decides when Drive says something uninformative.
  const byMime = contentClassForMime(mimeType);
  const contentClass = byMime === 'unknown' ? contentClassForExt(ext) : byMime;

  return {
    id,
    name: raw.name,
    mimeType,
    path,
    size: raw.size === undefined || raw.size === null ? null : Number(raw.size),
    modifiedTime: raw.modifiedTime ?? null,
    viaShortcutId: isShortcut ? raw.id : null,
    contentClass,
    ext,
    url: driveUrlFor(id, mimeType),
  };
}

/**
 * Rebuilds each file's path from the flat `parents` links a whole-drive sweep
 * returns, keeping only what actually descends from `rootId`.
 *
 * This is what makes the one-sweep strategy possible. `files.list` scoped to a
 * shared drive returns every file in it with its parent IDs but no paths, so the
 * tree is reassembled here instead of being re-derived with one API call per
 * folder. Files outside the root's subtree are dropped: a shared drive can hold
 * material that is none of this connector's business.
 *
 * Exported for testing — the reassembly is the part most likely to be wrong, and
 * it needs no network to check.
 */
export function buildPaths(
  raw: drive_v3.Schema$File[],
  root: { id: string; name: string },
): Map<string, string> {
  const folderName = new Map<string, string>([[root.id, root.name]]);
  const folderParent = new Map<string, string>();
  for (const f of raw) {
    if (f.mimeType !== FOLDER_MIME || !f.id) continue;
    folderName.set(f.id, f.name ?? f.id);
    const parent = f.parents?.[0];
    if (parent) folderParent.set(f.id, parent);
  }

  /** Root-relative path of a folder, or null if it does not descend from root. */
  const memo = new Map<string, string | null>([[root.id, root.name]]);
  const folderPath = (id: string): string | null => {
    const seen = new Set<string>();
    const chain: string[] = [];
    let current: string | undefined = id;

    while (current !== undefined && !memo.has(current)) {
      // A parent cycle cannot happen in Drive, but a malformed response must not
      // become an infinite loop in a scheduled job.
      if (seen.has(current)) return null;
      seen.add(current);
      chain.push(current);
      current = folderParent.get(current);
    }

    let base = current === undefined ? null : (memo.get(current) ?? null);
    for (const segment of chain.reverse()) {
      base = base === null ? null : `${base}/${folderName.get(segment) ?? segment}`;
      memo.set(segment, base);
    }
    return base;
  };

  const paths = new Map<string, string>();
  for (const f of raw) {
    if (!f.id || f.mimeType === FOLDER_MIME) continue;
    const parent = f.parents?.[0];
    if (!parent) continue;
    const dir = folderPath(parent);
    if (dir === null) continue;
    paths.set(f.id, `${dir}/${f.name ?? f.id}`);
  }
  return paths;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/** The one scope this connector ever asks for. It must never be able to write. */
const SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

/** A user's own Google identity, for a local run against real Drive. */
export interface OAuthUserCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

function serviceAccountAuth(serviceAccountJsonBase64: string): drive_v3.Drive {
  const credentials = JSON.parse(
    Buffer.from(serviceAccountJsonBase64, 'base64').toString('utf-8'),
  ) as object;
  return google.drive({
    version: 'v3',
    auth: new google.auth.GoogleAuth({ credentials, scopes: [SCOPE] }),
  });
}

/**
 * Authenticates as a human rather than as a service account.
 *
 * Why both exist: a service account is a separate identity that does **not**
 * inherit the "Shared with me" access a person has, so testing the walk against
 * the real `Grants` tree with one requires the folder's owner to share it —
 * outside this repository's control. A team member who can already open the tree
 * can authorize their own account in one browser round trip and prove the walk
 * works today. Production still runs as the service account: user tokens are
 * personal, and a scheduled job must not depend on one person's access.
 */
function oauthUserAuth(creds: OAuthUserCredentials): drive_v3.Drive {
  const auth = new google.auth.OAuth2({
    clientId: creds.clientId,
    clientSecret: creds.clientSecret,
  });
  auth.setCredentials({ refresh_token: creds.refreshToken });
  return google.drive({ version: 'v3', auth });
}

/** Service-account client. What the scheduled sync uses. */
export function makeDriveClient(serviceAccountJsonBase64: string): DriveClient {
  return makeClient(serviceAccountAuth(serviceAccountJsonBase64));
}

/** User-identity client, for a local run. See `oauthUserAuth`. */
export function makeOAuthDriveClient(creds: OAuthUserCredentials): DriveClient {
  return makeClient(oauthUserAuth(creds));
}

function makeClient(drive: drive_v3.Drive): DriveClient {

  async function listPages(
    params: drive_v3.Params$Resource$Files$List,
    onPage: (files: drive_v3.Schema$File[]) => void,
  ): Promise<number> {
    let pageToken: string | undefined;
    let calls = 0;
    do {
      const res = await withRetry('files.list', () =>
        drive.files.list({
          ...params,
          fields: LIST_FIELDS,
          pageSize: PAGE_SIZE,
          ...ALL_DRIVES,
          ...(pageToken ? { pageToken } : {}),
        }),
      );
      calls += 1;
      onPage(res.data.files ?? []);
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);
    return calls;
  }

  async function sweepDrive(
    root: { id: string; name: string },
    driveId: string,
  ): Promise<{ files: DriveFile[]; apiCalls: number; strategy: string }> {
    const raw: drive_v3.Schema$File[] = [];
    const apiCalls = await listPages({ q: 'trashed = false', corpora: 'drive', driveId }, (page) =>
      raw.push(...page),
    );

    const paths = buildPaths(raw, root);
    const files: DriveFile[] = [];
    for (const f of raw) {
      const path = f.id === undefined || f.id === null ? undefined : paths.get(f.id);
      if (path === undefined) continue;
      const mapped = toDriveFile(f, path);
      if (mapped) files.push(mapped);
    }
    return { files, apiCalls, strategy: `shared-drive sweep (${driveId})` };
  }

  async function walkFolders(
    root: DriveRoot,
  ): Promise<{ files: DriveFile[]; apiCalls: number; strategy: string }> {
    const files: DriveFile[] = [];
    const queue: { id: string; path: string }[] = [{ id: root.id, path: root.name }];
    let apiCalls = 0;
    let folders = 0;

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) break;
      folders += 1;
      apiCalls += await listPages({ q: `'${current.id}' in parents and trashed = false` }, (page) => {
        for (const f of page) {
          if (!f.id || !f.name) continue;
          const path = `${current.path}/${f.name}`;
          if (f.mimeType === FOLDER_MIME) {
            queue.push({ id: f.id, path });
            continue;
          }
          const mapped = toDriveFile(f, path);
          if (mapped) files.push(mapped);
        }
      });
    }

    return { files, apiCalls, strategy: `folder walk (${String(folders)} folders)` };
  }

  return {
    async resolveRoot(folderId): Promise<DriveRoot> {
      const res = await withRetry('files.get', () =>
        drive.files.get({
          fileId: folderId,
          fields: 'id, name, mimeType, driveId',
          // `get` needs the support flag too, or a shared-drive folder 404s.
          supportsAllDrives: true,
        }),
      );
      if (res.data.mimeType !== FOLDER_MIME) {
        throw new Error(`${folderId} is not a folder (got ${String(res.data.mimeType)})`);
      }
      return {
        id: res.data.id ?? folderId,
        name: res.data.name ?? 'Grants',
        driveId: res.data.driveId ?? null,
      };
    },

    async listTree(root): Promise<{ files: DriveFile[]; apiCalls: number; strategy: string }> {
      // Strategy 1 — one sweep of the shared drive.
      //
      // Drive has no recursive listing, so the obvious approach is one
      // `files.list` per folder: ~600 calls for this corpus, each a chance to be
      // rate-limited, and ~600 round trips of latency. Scoped to a shared drive
      // the whole thing comes back in ceil(n/1000) pages instead, with paths
      // reassembled locally from `parents`. Same answer, two orders of magnitude
      // fewer calls.
      if (root.driveId !== null) {
        try {
          return await sweepDrive(root, root.driveId);
        } catch (err) {
          const status = statusOf(err);
          // A drive-scoped query needs membership of that drive. An identity with
          // access to the folder but not the drive — which is exactly what "shared
          // with me" from another organization looks like — gets 403 or 404 here.
          // Falling back is the difference between a slower walk and no walk.
          if (status !== 403 && status !== 404) throw err;
        }
      }

      // Strategy 2 — breadth-first walk. One call per folder, so this is the
      // expensive path; it is correct, not fast. Used for a My Drive root, and
      // wherever the sweep above was refused.
      const walked = await walkFolders(root);
      return root.driveId === null
        ? walked
        : { ...walked, strategy: `${walked.strategy}, drive-scoped sweep refused` };
    },

    async exportText(fileId, mimeType): Promise<string | null> {
      if (contentClassForMime(mimeType) !== 'text') return null;
      if (!mimeType.startsWith('application/vnd.google-apps.')) return null;
      // Sheets export as CSV per-tab; `text/csv` on the file gives the first tab
      // only, which would silently truncate. Only docs and slides are safe here.
      if (!/\.(document|presentation)$/.test(mimeType)) return null;

      const res = await withRetry('files.export', () =>
        drive.files.export(
          { fileId, mimeType: 'text/plain' },
          { responseType: 'text' },
        ),
      );
      return typeof res.data === 'string' ? res.data : null;
    },
  };
}
