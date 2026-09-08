/**
 * Generic Drive path/MIME/identity-key utilities.
 *
 * Extracted from the old `@lp-ai/lib-grants` package (`src/catalog.ts`) when that package
 * was removed — these functions are pure path/string transforms with no grant-domain
 * dependency, used by `drive-client.ts` and `reconcile.ts`. `FUNDER_COLLECTIONS` still
 * reflects the old grant-corpus folder taxonomy ("Prospects and Proposals", "Current and
 * Past"); update it if `scopedNameKey`'s funder-scoping behavior needs to match a
 * different folder structure.
 */

const TEXT_EXTRACTABLE = new Set([
  '.docx', '.doc', '.dotx', '.pdf', '.xlsx', '.csv', '.pptx', '.vtt', '.html', '.txt',
  '.gdoc', '.gsheet', '.gslides',
]);

const MEDIA = new Set(['.mp4', '.m4a', '.mp3', '.mov', '.heic', '.png', '.jpg', '.jpeg', '.gif']);

const KNOWN_EXTENSIONS = new Set([
  '.docx', '.doc', '.dotx', '.pdf', '.xlsx', '.xls', '.csv', '.tsv', '.pptx', '.ppt',
  '.vtt', '.html', '.htm', '.txt', '.md', '.rtf', '.gdoc', '.gsheet', '.gslides',
  '.mp4', '.m4a', '.mp3', '.mov', '.wav', '.heic', '.png', '.jpg', '.jpeg', '.gif',
  '.zip', '.json', '.textclipping',
]);

export type ContentClass = 'text' | 'media' | 'unknown';

/**
 * Like `path.extname`, but returns '' for things that only look like extensions.
 * "HFCT ... Question List (due 6.5.2026)" has no extension, yet `extname` reads
 * the trailing ".2026)" as one.
 */
export function fileExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot <= 0) return '';
  const ext = filename.slice(dot).toLowerCase();
  return KNOWN_EXTENSIONS.has(ext) ? ext : '';
}

/** Whether text can be extracted from this extension today. */
export function contentClassForExt(ext: string): ContentClass {
  if (TEXT_EXTRACTABLE.has(ext)) return 'text';
  if (MEDIA.has(ext)) return 'media';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Drive MIME types
// ---------------------------------------------------------------------------

export const FOLDER_MIME = 'application/vnd.google-apps.folder';
export const SHORTCUT_MIME = 'application/vnd.google-apps.shortcut';

/** Drive mime types, so callers can state what a fetch will return. */
const MIME_BY_EXT: Record<string, string> = {
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword',
  '.dotx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.template',
  '.pdf': 'application/pdf',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.csv': 'text/csv',
  '.vtt': 'text/vtt',
  '.html': 'text/html',
  '.gdoc': 'application/vnd.google-apps.document',
  '.gsheet': 'application/vnd.google-apps.spreadsheet',
  '.gslides': 'application/vnd.google-apps.presentation',
  '.mp4': 'video/mp4',
  '.m4a': 'audio/mp4',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.heic': 'image/heic',
};

export function mimeForExt(ext: string): string | null {
  return MIME_BY_EXT[ext] ?? null;
}

/**
 * Text extractability judged from a Drive MIME type rather than a filename.
 *
 * Drive is the better authority: Google-native files carry no extension at all,
 * and a `.docx` named without its extension still reports the right MIME. Where
 * Drive says nothing useful, the caller falls back to `contentClassForExt`.
 */
export function contentClassForMime(mimeType: string): ContentClass {
  if (mimeType.startsWith('application/vnd.google-apps.')) {
    return /\.(document|spreadsheet|presentation)$/.test(mimeType) ? 'text' : 'unknown';
  }
  if (/^(audio|video|image)\//.test(mimeType)) return 'media';
  const byExt = [...Object.entries(MIME_BY_EXT)].find(([, m]) => m === mimeType);
  if (byExt?.[0]) return contentClassForExt(byExt[0]);
  if (mimeType.startsWith('text/')) return 'text';
  return 'unknown';
}

/** The URL a human opens. Google-native types need their editor-specific host. */
export function driveUrlFor(id: string, mimeType: string | null): string {
  switch (mimeType) {
    case 'application/vnd.google-apps.spreadsheet':
      return `https://docs.google.com/spreadsheets/d/${id}/edit`;
    case 'application/vnd.google-apps.document':
      return `https://docs.google.com/document/d/${id}/edit`;
    case 'application/vnd.google-apps.presentation':
      return `https://docs.google.com/presentation/d/${id}/edit`;
    default:
      return `https://drive.google.com/file/d/${id}/view`;
  }
}

/**
 * Escapes one Drive name for use as a path segment.
 *
 * Drive filenames may contain `/` and `:`; paths may not. Escaping to `_` is what
 * Drive for Desktop already does locally, so the two spellings agree for free.
 */
export function escapePathSegment(name: string): string {
  return name.replace(/[/:]/g, '_');
}

const COMPARABLE_EXT =
  /\.(gdoc|gsheet|gslides|docx?|dotx|xlsx?|pptx?|pdf|csv|tsv|txt|rtf|md|vtt|html?|jpe?g|png|heic|gif|mp4|m4a|mp3|mov|wav|zip)$/;

/** Collections whose second path segment names a funder (see `scopedNameKey`). */
const FUNDER_COLLECTIONS = new Set(['prospects and proposals', 'current and past']);

/**
 * `looseKey`, `scopedNameKey`, and `normalizePath` sit at three different looseness levels on the
 * same identity-resolution ladder (see `reconcile.ts`'s tiered lookup, run in order: drive_id ->
 * exact_path -> normalized_path -> loose_path -> scoped_name). These branded types are erased at
 * compile time (no runtime cost); each function below is the only place allowed to assert its own
 * brand.
 */
export type NormalizedPath = string & { readonly __brand: 'NormalizedPath' };
export type LooseKey = string & { readonly __brand: 'LooseKey' };
export type ScopedNameKey = string & { readonly __brand: 'ScopedNameKey' };

/**
 * A deliberately lossy comparison key: same document, however either side spelled it.
 * Collapses every run of non-alphanumerics to one space and drops the extension.
 */
export function looseKey(path: string): LooseKey {
  return path
    .toLowerCase()
    .replace(COMPARABLE_EXT, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim() as LooseKey;
}

/**
 * A key for "same filename, same funder" — scoped to the second path segment when the
 * first names a funder-bearing collection, so same-named files in different funder
 * folders don't collide. Callers must additionally require the key to be unique on
 * **both** sides.
 */
export function scopedNameKey(path: string): ScopedNameKey {
  const segments = path.split('/');
  const collection = segments[1]?.toLowerCase() ?? '';
  const scope =
    segments.length > 3 && FUNDER_COLLECTIONS.has(collection)
      ? looseKey(`${collection}/${segments[2] ?? ''}`)
      : '';
  return `${scope}||${looseKey(segments[segments.length - 1] ?? '')}` as ScopedNameKey;
}

export function normalizePath(path: string): NormalizedPath {
  return path
    .toLowerCase()
    .replace(/[/:]/g, '_')
    .replace(/\.(gdoc|gsheet|gslides)$/, '')
    .replace(/\s+/g, ' ')
    .trim() as NormalizedPath;
}
