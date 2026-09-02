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
  escapePathSegment,
  fileExtension,
  type ContentClass,
} from './path-utils.js';

/** Flags without which a Shared Drive returns nothing at all. */
const ALL_DRIVES = { supportsAllDrives: true, includeItemsFromAllDrives: true } as const;

/** The API maximum. Fewer pages means fewer chances to be rate-limited. */
const PAGE_SIZE = 1000;

/**
 * Per-request timeout.
 *
 * gaxios has none by default, so a socket that stops responding hangs the process
 * with no output. In production this runs as a one-off Fargate task with no
 * timeout of its own, which means one bad connection burns a task until somebody
 * notices. A timeout turns that into a retry, and then into a failed run with an
 * error in `sync_runs`.
 */
const REQUEST_TIMEOUT_MS = 30_000;

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
  /**
   * The stored ID exists but this identity cannot read it.
   *
   * Real and common: 16 of the 29 shortcuts in the corpus point at files in
   * someone else's drive. Cataloguing those as fetchable hands a grant writer an
   * ID that 404s, which is worse than saying so.
   */
  unreadable: boolean;
  /** Whether text can be extracted from this file today. */
  contentClass: ContentClass;
  /** Extension as the catalog records it, '' for Google-native files. */
  ext: string;
  /** The URL a human opens. */
  url: string;
}

/** The target of a shortcut that points at a folder: traverse it, do not catalog it. */
export function shortcutFolderTarget(raw: drive_v3.Schema$File): string | null {
  if (raw.mimeType !== SHORTCUT_MIME) return null;
  if (raw.shortcutDetails?.targetMimeType !== FOLDER_MIME) return null;
  return raw.shortcutDetails.targetId ?? null;
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

/** What one enumeration of the tree produced, and what it could not reach. */
export interface TreeListing {
  files: DriveFile[];
  apiCalls: number;
  strategy: string;
  /** Folders the identity could see referenced but not list. Skipped, not fatal. */
  inaccessibleFolders: string[];
  /**
   * Alias paths dropped because the same Drive file is filed in more than one place.
   *
   * A curated tree does this deliberately — a budget shortcut inside the application
   * folder, the file itself under reporting — but `grant_documents.drive_file_id` is
   * unique, so one Drive file is one row. The canonical instance is kept and these
   * are reported, because a grant writer seeing the same document three times is its
   * own kind of wrong.
   */
  duplicatePaths: string[];
}

export interface DriveClient {
  resolveRoot(folderId: string): Promise<DriveRoot>;
  listTree(root: DriveRoot): Promise<TreeListing>;
  /** Plain text for a Google-native document. Null when the type has no text export. */
  exportText(fileId: string, mimeType: string): Promise<string | null>;
  /** Raw bytes of a binary file (e.g. an uploaded .docx) — for callers that parse it themselves. */
  downloadFile(fileId: string): Promise<Buffer>;
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
 * Returns null for folders (they are traversed, not catalogued), for shortcuts
 * **to** folders (7 of them in the corpus — a folder is not a document, and
 * cataloguing one produces a row nothing can ever fetch), and for shortcuts whose
 * target Drive declines to name — a shortcut with no target is a broken link.
 */
export function toDriveFile(raw: drive_v3.Schema$File, path: string): DriveFile | null {
  if (!raw.id || !raw.name || raw.mimeType === FOLDER_MIME) return null;

  const isShortcut = raw.mimeType === SHORTCUT_MIME;
  const id = isShortcut ? raw.shortcutDetails?.targetId : raw.id;
  if (!id) return null;

  const mimeType =
    (isShortcut ? raw.shortcutDetails?.targetMimeType : raw.mimeType) ?? 'application/octet-stream';
  // A shortcut to a folder is a traversal instruction, not a document.
  if (mimeType === FOLDER_MIME) return null;
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
    // Set later, by the one probe per shortcut in `verifyShortcutTargets`.
    unreadable: false,
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
    folderName.set(f.id, escapePathSegment(f.name ?? f.id));
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
    paths.set(f.id, `${dir}/${escapePathSegment(f.name ?? f.id)}`);
  }
  return paths;
}

/**
 * Reduces the walk to one entry per Drive file.
 *
 * Three files in the real corpus appear at two or three paths each, because a
 * shortcut points at a file that also lives elsewhere in the tree. The direct
 * instance wins — a shortcut is a pointer, and the file's own location is where it
 * lives — with the lexicographically first path as the tie-break so a re-run makes
 * the same choice.
 *
 * Exported for testing: the `drive_file_id` unique constraint means getting this
 * wrong fails the whole sync, which is exactly what it did before this existed.
 */
export function dedupeById(files: DriveFile[]): { files: DriveFile[]; duplicatePaths: string[] } {
  const best = new Map<string, DriveFile>();
  const duplicatePaths: string[] = [];

  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    const held = best.get(file.id);
    if (held === undefined) {
      best.set(file.id, file);
      continue;
    }
    // Prefer the direct instance; otherwise the first path already held wins.
    const replace = held.viaShortcutId !== null && file.viaShortcutId === null;
    best.set(file.id, replace ? file : held);
    duplicatePaths.push(`${(replace ? held : file).path} (same file as ${(replace ? file : held).path})`);
  }

  return { files: [...best.values()], duplicatePaths };
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
        drive.files.list(
          {
            ...params,
            fields: LIST_FIELDS,
            pageSize: PAGE_SIZE,
            ...ALL_DRIVES,
            ...(pageToken ? { pageToken } : {}),
          },
          { timeout: REQUEST_TIMEOUT_MS },
        ),
      );
      calls += 1;
      onPage(res.data.files ?? []);
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);
    return calls;
  }

  /**
   * One probe per shortcut, to find out whether its target can actually be read.
   *
   * Worth the calls — 29 out of 616 in this corpus — because the alternative is a
   * catalog row promising content that 404s. Nothing else in the walk needs this:
   * an ordinary file listed inside the tree is readable by the identity that listed
   * it, and only shortcuts can point outside.
   */
  /** True when the identity can see the file/folder at all. */
  async function canRead(fileId: string): Promise<boolean> {
    try {
      await withRetry('files.get', () =>
        drive.files.get(
          { fileId, fields: 'id', supportsAllDrives: true },
          { timeout: REQUEST_TIMEOUT_MS },
        ),
      );
      return true;
    } catch (err) {
      const status = statusOf(err);
      if (status !== 403 && status !== 404) throw err;
      return false;
    }
  }

  async function verifyShortcutTargets(files: DriveFile[]): Promise<number> {
    let calls = 0;
    for (const file of files) {
      if (file.viaShortcutId === null) continue;
      calls += 1;
      if (await canRead(file.id)) {
        // Readable: nothing to record.
      } else {
        file.unreadable = true;
      }
    }
    return calls;
  }

  async function sweepDrive(
    root: { id: string; name: string },
    driveId: string,
  ): Promise<TreeListing> {
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
    const deduped = dedupeById(files);
    return {
      files: deduped.files,
      duplicatePaths: deduped.duplicatePaths,
      apiCalls: apiCalls + (await verifyShortcutTargets(deduped.files)),
      strategy: `shared-drive sweep (${driveId})`,
      // A sweep sees the whole drive, so nothing inside it was unreachable. A
      // shortcut pointing out of the drive is reported per-file as `unreadable`.
      inaccessibleFolders: [],
    };
  }

  async function walkFolders(root: DriveRoot): Promise<TreeListing> {
    const files: DriveFile[] = [];
    const queue: { id: string; path: string }[] = [{ id: root.id, path: root.name }];
    // Shortcuts can point at a folder that is already in the tree, or at an
    // ancestor of it. Without this, that is an infinite walk.
    const visited = new Set<string>();
    const inaccessibleFolders: string[] = [];
    /** Folder-shortcut targets to check before walking into them. */
    const shortcutFolders: { id: string; path: string }[] = [];
    let apiCalls = 0;
    let folders = 0;

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) break;
      if (visited.has(current.id)) continue;
      visited.add(current.id);
      folders += 1;

      try {
        apiCalls += await listPages(
          { q: `'${current.id}' in parents and trashed = false` },
          (page) => {
            for (const f of page) {
              if (!f.id || !f.name) continue;
              const path = `${current.path}/${escapePathSegment(f.name)}`;

              if (f.mimeType === FOLDER_MIME) {
                queue.push({ id: f.id, path });
                continue;
              }
              // A shortcut to a folder is part of the curated corpus: the files
              // behind it are real, so follow it rather than dropping the subtree.
              const folderTarget = shortcutFolderTarget(f);
              if (folderTarget !== null) {
                // Not enqueued directly: an inaccessible folder lists as **empty
                // rather than failing**, which is the original bug's own signature.
                // Silently walking one would report a real subtree as absent.
                shortcutFolders.push({ id: folderTarget, path });
                continue;
              }

              const mapped = toDriveFile(f, path);
              if (mapped) files.push(mapped);
            }
          },
        );
      } catch (err) {
        const status = statusOf(err);
        if (status !== 403 && status !== 404) throw err;
        // Reached through a shortcut into someone else's drive. One unreadable
        // subtree must not lose the rest of the catalog.
        inaccessibleFolders.push(current.path);
        folders -= 1;
      }

      // Drained after each folder rather than at the end, so a shortcut inside a
      // shortcut's target is followed too.
      while (shortcutFolders.length > 0) {
        const target = shortcutFolders.shift();
        if (!target || visited.has(target.id)) continue;
        apiCalls += 1;
        if (await canRead(target.id)) queue.push(target);
        else inaccessibleFolders.push(target.path);
      }
    }

    const deduped = dedupeById(files);
    return {
      files: deduped.files,
      duplicatePaths: deduped.duplicatePaths,
      apiCalls: apiCalls + (await verifyShortcutTargets(deduped.files)),
      strategy: `folder walk (${String(folders)} folders)`,
      inaccessibleFolders,
    };
  }

  return {
    async resolveRoot(folderId): Promise<DriveRoot> {
      const res = await withRetry('files.get', () =>
        drive.files.get(
          {
            fileId: folderId,
            fields: 'id, name, mimeType, driveId',
            // `get` needs the support flag too, or a shared-drive folder 404s.
            supportsAllDrives: true,
          },
          { timeout: REQUEST_TIMEOUT_MS },
        ),
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

    async listTree(root): Promise<TreeListing> {
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
          { responseType: 'text', timeout: REQUEST_TIMEOUT_MS },
        ),
      );
      return typeof res.data === 'string' ? res.data : null;
    },

    async downloadFile(fileId): Promise<Buffer> {
      const res = await withRetry('files.get(alt=media)', () =>
        drive.files.get(
          { fileId, alt: 'media', supportsAllDrives: true },
          { responseType: 'arraybuffer', timeout: REQUEST_TIMEOUT_MS },
        ),
      );
      return Buffer.from(res.data as ArrayBuffer);
    },
  };
}
