/**
 * Decides, for each file Drive returned, which catalog row it is.
 *
 * The hard part of this connector is not fetching — it is identity. The catalog
 * was first built from a partial local mirror (1.6 GB of a 3.5+ GiB corpus) whose
 * filenames Drive for Desktop had already rewritten, so "the same document" has
 * two spellings and only one of them has a Drive ID. Getting this wrong is not a
 * crash: it stamps a Drive ID onto the wrong row, and `find_grant_documents` then
 * serves confidently wrong content. So the rule is **never guess**.
 *
 * Identity precedence, strongest evidence first:
 *
 *   1. `drive_file_id` — an ID is the file. If a row already carries it, that row
 *      is the file regardless of what either path says.
 *   2. Exact path — Drive path equals the stored path.
 *   3. Normalized path, and only if unique. Two candidates means we would be
 *      picking one, so the file is left unmatched instead.
 *   4. No match — the file exists in Drive but not in the catalog. That is the
 *      1243-row gap the mirror never covered, so it becomes a new row.
 *
 * Pure: no database, no network. The sync applies what this returns.
 */

import { normalizePath } from '@lp-ai/lib-grants';

import type { DriveFile } from './drive-client.js';

export interface CatalogRow {
  id: string;
  path: string;
  driveFileId: string | null;
}

export type MatchedBy = 'drive_id' | 'exact_path' | 'normalized_path';

export interface Resolution {
  file: DriveFile;
  /** The catalog row to update, or null to create a new one. */
  rowId: string | null;
  matchedBy: MatchedBy | null;
  /**
   * Set when a normalized-path match had more than one candidate. The file still
   * becomes a new row, but flagged for review — a human should merge it.
   */
  ambiguousWith: string[];
}

export interface ReconcileResult {
  resolutions: Resolution[];
  counts: Record<'drive_id' | 'exact_path' | 'normalized_path' | 'created' | 'ambiguous', number>;
}

export function reconcile(files: DriveFile[], rows: CatalogRow[]): ReconcileResult {
  const byDriveId = new Map<string, string>();
  const byExactPath = new Map<string, string>();
  const byNormalizedPath = new Map<string, string[]>();

  for (const row of rows) {
    if (row.driveFileId !== null) byDriveId.set(row.driveFileId, row.id);
    byExactPath.set(row.path, row.id);
    const key = normalizePath(row.path);
    byNormalizedPath.set(key, [...(byNormalizedPath.get(key) ?? []), row.id]);
  }

  /**
   * A row may be claimed once. Two Drive files resolving to one row would mean
   * writing two different IDs to a column that is unique — the second write would
   * either fail or silently steal the row, so the second file becomes its own row.
   */
  const claimed = new Set<string>();
  const resolutions: Resolution[] = [];
  const counts = {
    drive_id: 0,
    exact_path: 0,
    normalized_path: 0,
    created: 0,
    ambiguous: 0,
  };

  // Deterministic order, so a re-run resolves the same way and the losing file in
  // a claim collision is always the same one.
  const ordered = [...files].sort((a, b) => a.path.localeCompare(b.path));

  for (const file of ordered) {
    let rowId: string | null = null;
    let matchedBy: MatchedBy | null = null;
    let ambiguousWith: string[] = [];

    const byId = byDriveId.get(file.id);
    const byPath = byExactPath.get(file.path);
    const normalized = byNormalizedPath.get(normalizePath(file.path)) ?? [];

    if (byId !== undefined && !claimed.has(byId)) {
      rowId = byId;
      matchedBy = 'drive_id';
    } else if (byPath !== undefined && !claimed.has(byPath)) {
      rowId = byPath;
      matchedBy = 'exact_path';
    } else if (normalized.length === 1 && normalized[0] && !claimed.has(normalized[0])) {
      rowId = normalized[0];
      matchedBy = 'normalized_path';
    } else if (normalized.length > 1) {
      ambiguousWith = normalized;
    }

    if (rowId !== null) {
      claimed.add(rowId);
      counts[matchedBy ?? 'exact_path'] += 1;
    } else {
      counts.created += 1;
      if (ambiguousWith.length > 0) counts.ambiguous += 1;
    }

    resolutions.push({ file, rowId, matchedBy, ambiguousWith });
  }

  return { resolutions, counts };
}
