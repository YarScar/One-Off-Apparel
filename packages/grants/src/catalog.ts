/**
 * Grant corpus classification — path in, catalog metadata out.
 *
 * The grant tree carries most of its meaning in folder names rather than file
 * contents: which funder a document belongs to, which application year it is part
 * of, whether it is a narrative response or a budget, and whether Launchpad even
 * wrote it. This module is the single implementation of reading that.
 *
 * Why it lives here rather than in the script that first grew it: two callers now
 * classify the same corpus — `scripts/build-grants-index.ts` walking the local
 * mirror, and `connectors/google-drive` walking Drive itself. Two copies would
 * mean a file classified one way when discovered locally and another way when
 * discovered remotely, which is worse than either being wrong consistently.
 *
 * Pure: no filesystem, no network, no database. Everything here is a function of
 * the path string, which is what makes it testable without either source.
 */

// ---------------------------------------------------------------------------
// Policy constants
// ---------------------------------------------------------------------------

/**
 * Applications from before this year are archive-only.
 *
 * Rationale, from the 2026-07-21 client meeting: Launchpad's program shifted
 * substantially (12-month full-stack -> shorter AI engineering focus), so older
 * applications describe a program that no longer exists. They stay searchable as
 * a research and comparison tool, but must never become drafting context, or a
 * model will confidently describe the old program.
 *
 * This is a policy choice, not a fact about the data — raise it when the program
 * shifts again.
 */
export const ARCHIVE_BEFORE_YEAR = 2025;

/**
 * Folder names meaning "nothing under here should be ingested".
 * `Project Management (do not ingest)` is an explicit instruction from the team;
 * `Ignore` folders park superseded drafts inside funder folders.
 */
const EXCLUDED_SEGMENTS = ['project management (do not ingest)', 'ignore'];

/**
 * Folder segments marking material Launchpad did not author: funder-published
 * NOFOs and scoring rubrics, and other grantees' winning applications kept for
 * study. Quoting these into a Launchpad submission would be plagiarism, so they
 * are flagged separately from merely-stale material.
 */
const EXTERNAL_REFERENCE_SEGMENTS = ['reference', 'references'];

/** Extensions we can turn into text today. Anything else needs another tool. */
const TEXT_EXTRACTABLE = new Set([
  '.docx', '.doc', '.dotx', '.pdf', '.xlsx', '.csv', '.pptx', '.vtt', '.html', '.txt',
  '.gdoc', '.gsheet',
]);

/** Audio/video/image files: no text to extract without transcription or OCR. */
const MEDIA = new Set(['.mp4', '.m4a', '.mp3', '.mov', '.heic', '.png', '.jpg', '.jpeg', '.gif']);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Collection =
  | 'prospects'
  | 'current_past'
  | 'program_descriptions'
  | 'org_reference'
  | 'internal_ai_os'
  | 'unknown';

export type DocKind =
  | 'application_response'
  | 'budget'
  | 'agreement'
  | 'report'
  | 'letter_of_support'
  | 'loi'
  | 'meeting_notes'
  | 'template'
  | 'attachment'
  | 'program_description'
  | 'external_reference'
  /** Interview and meeting transcripts, chiefly the Cambiar/Thrive research set. */
  | 'transcript'
  | 'other';

export type ContentClass = 'text' | 'media' | 'unknown';

/** What classification can say from a path alone. */
export interface Classification {
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
}

const COLLECTION_BY_SEGMENT = new Map<string, Collection>([
  ['prospects and proposals', 'prospects'],
  ['current and past', 'current_past'],
  ['launchpad program descriptions', 'program_descriptions'],
]);

/**
 * Folder segment -> document kind, checked deepest-first so that
 * `.../Grant Application/Finances` reads as a budget rather than a response.
 */
const KIND_BY_SEGMENT = new Map<string, DocKind>([
  ['responses', 'application_response'],
  ['grant application', 'application_response'],
  ['submission', 'application_response'],
  ['final submission', 'application_response'],
  ['finances', 'budget'],
  ['financials', 'budget'],
  ['budget', 'budget'],
  ['budgets', 'budget'],
  ['grant agreement', 'agreement'],
  ['reporting', 'report'],
  ['letters of support', 'letter_of_support'],
  ['completed los', 'letter_of_support'],
  ['los templates', 'template'],
  ['loi', 'loi'],
  ['meetings', 'meeting_notes'],
  ['meeting notes', 'meeting_notes'],
  ['attachments', 'attachment'],
  ['uploads', 'attachment'],
  ['additional information', 'attachment'],
  ['rfi', 'other'],
  ['grant info', 'other'],
]);

/** First match wins, so the most specific patterns are listed first. */
const KIND_BY_FILENAME: [RegExp, DocKind][] = [
  [/\b(loi|letter of inquiry|letter of intent)\b/i, 'loi'],
  [/\btemplates?\b/i, 'template'],
  [/\b(letters? of support|los)\b/i, 'letter_of_support'],
  [/\bagreements?\b/i, 'agreement'],
  [/(transcript|\binterviews?\b)/i, 'transcript'],
  // Administrative paperwork attached to an application, not narrative content.
  [/\b(consent|release|signature[_ ]request|w-?9|990)\b/i, 'attachment'],
  [/\b(reports?|reporting)\b/i, 'report'],
  [/\b(budgets?|financials?|invoices?|statement of (financial position|activities))\b/i, 'budget'],
  // Launchpad describing its own programs: prime drafting context, so worth
  // separating from the undifferentiated `other` pile.
  [/\b(overviews?|one[- ]pagers?|descriptions?|scale plan|teaser)\b/i, 'program_description'],
  // Generic application language last: budgets and letters often say "grant" too.
  [
    /\b(applications?|responses?|proposals?|narratives?|submissions?|rfp|rfi|nofo|questions?|questionnaires?)\b/i,
    'application_response',
  ],
];

/** Extensions we recognise. Anything else is treated as having no extension. */
const KNOWN_EXTENSIONS = new Set([
  '.docx', '.doc', '.dotx', '.pdf', '.xlsx', '.xls', '.csv', '.tsv', '.pptx', '.ppt',
  '.vtt', '.html', '.htm', '.txt', '.md', '.rtf', '.gdoc', '.gsheet', '.gslides',
  '.mp4', '.m4a', '.mp3', '.mov', '.wav', '.heic', '.png', '.jpg', '.jpeg', '.gif',
  '.zip', '.json', '.textclipping',
]);

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

/** Two-digit years are only believable in this window. */
const MIN_SHORT_YEAR = 20;
const MAX_SHORT_YEAR = 35;

/**
 * Pulls the application year out of one folder or file segment.
 *
 * Handles every shape present in the real tree: "2025", "2026 application",
 * "Spring 2026", "2023-2024 Grant", "8_7_2026 GSK Grant", "11.5.24 ASD AI High
 * School", "FY26", "F22".
 *
 * For a multi-year span the **earlier** year wins: a "2026-2028 Grant" was
 * applied for in 2026, and the later year just ends the funded period. Taking
 * the later year files a 2026 application under 2028, away from its siblings.
 *
 * Bare "M.D" forms such as the "7.28" in "WPF_Budget_Final 7.28.xlsx" are
 * deliberately not matched — reading that as 2028 is the exact error this
 * function exists to avoid.
 */
export function parseYear(segment: string): number | null {
  // Underscores are word characters, so `\b(20\d{2})\b` does not match the year in
  // "8_7_2026 GSK Grant" — and that form is all over the real tree. Scanning an
  // underscore-to-space copy restores the boundary. (This module's first version
  // documented that filename as handled while returning null for it; the short-date
  // branch below could not cover it either, since that requires a 2-digit year.)
  const spaced = segment.replace(/_/g, ' ');

  const span = /\b(20\d{2})\s*[-–—]\s*(20\d{2})\b/.exec(spaced);
  if (span?.[1]) return Number(span[1]);

  const fullYears = [...spaced.matchAll(/\b(20\d{2})\b/g)].map((m) => Number(m[1]));
  if (fullYears.length > 0) return Math.min(...fullYears);

  // Fiscal years are named for the year they *end* in: Building 21's FY27 runs
  // July 2026 - June 2027, so an "FY 27" folder holds a 2026 application. The
  // "Spring Point FY 27" folder confirms it — its own invoice reads 3.1.26-6.30.26.
  // Seasonal shorthand ("F22", "Sp25") is calendar-based and is not shifted.
  const fiscal = /\bFY\s?([23]\d)\b/i.exec(segment);
  if (fiscal?.[1]) {
    const yy = Number(fiscal[1]);
    if (yy >= MIN_SHORT_YEAR && yy <= MAX_SHORT_YEAR) return 2000 + yy - 1;
  }

  const seasonal = /\b(?:SP|FA|F|S)\s?([23]\d)\b/i.exec(segment);
  if (seasonal?.[1]) {
    const yy = Number(seasonal[1]);
    if (yy >= MIN_SHORT_YEAR && yy <= MAX_SHORT_YEAR) return 2000 + yy;
  }

  const shortDate = /\b(\d{1,2})[._-](\d{1,2})[._-]([23]\d)\b/.exec(segment);
  if (shortDate?.[3]) {
    const month = Number(shortDate[1]);
    const day = Number(shortDate[2]);
    const yy = Number(shortDate[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      if (yy >= MIN_SHORT_YEAR && yy <= MAX_SHORT_YEAR) return 2000 + yy;
    }
  }

  return null;
}

const norm = (s: string): string => s.trim().toLowerCase();

function classifyByFolder(segments: string[]): DocKind | null {
  // Deepest-first: the innermost folder is the most specific statement.
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const kind = KIND_BY_SEGMENT.get(norm(segments[i] ?? ''));
    if (kind) return kind;
  }
  return null;
}

function classifyByFilename(filename: string): DocKind | null {
  // Underscores are word characters, so `\bReport\b` does not match "Report_"
  // — and these filenames are full of underscore-delimited words
  // ("Final Grant Report_Accelerate_Final.docx"). Swapping them for spaces
  // restores the word boundaries the patterns rely on, for the same reason
  // `parseYear` does it.
  const name = filename.replace(/_/g, ' ');
  for (const [pattern, kind] of KIND_BY_FILENAME) {
    if (pattern.test(name)) return kind;
  }
  return null;
}

/**
 * Classifies one file from its path.
 *
 * @param root      Top-level folder, e.g. "Grants" or "Launchpad Internal AI OS".
 * @param segments  Folders between the root and the file, root and filename excluded.
 * @param filename  The file's own name.
 */
export function classify(root: string, segments: string[], filename: string): Classification {
  const collection: Collection =
    root === 'Grants'
      ? (COLLECTION_BY_SEGMENT.get(norm(segments[0] ?? '')) ??
        (segments.length === 0 ? 'org_reference' : 'unknown'))
      : 'internal_ai_os';

  const exclude = segments.some((s) => EXCLUDED_SEGMENTS.includes(norm(s)));
  const external_ref = segments.some((s) => EXTERNAL_REFERENCE_SEGMENTS.includes(norm(s)));

  const funder =
    collection === 'prospects' || collection === 'current_past'
      ? (segments[1]?.trim() || null)
      : null;

  // Search the funder's subtree innermost-first, so a year deep in the path
  // beats a stray year in the funder's own name. Fall back to the filename.
  let year: number | null = null;
  const floor = funder ? 2 : 1;
  for (let i = segments.length - 1; i >= floor; i -= 1) {
    const parsed = parseYear(segments[i] ?? '');
    if (parsed !== null) {
      year = parsed;
      break;
    }
  }
  year ??= parseYear(filename);

  let doc_kind: DocKind;
  if (external_ref) {
    doc_kind = 'external_reference';
  } else if (collection === 'program_descriptions') {
    doc_kind = 'program_description';
  } else {
    doc_kind = classifyByFolder(segments) ?? classifyByFilename(filename) ?? 'other';
  }

  // A filename naming a specific artifact overrides a generic container folder
  // like "Grant Application", which says little on its own. Without this,
  // "7_31_26 CCFF Final Grant Report_.docx" reads as an application response
  // purely because of the folder it sits in.
  if (doc_kind === 'application_response') {
    const fromName = classifyByFilename(filename);
    if (fromName === 'template' || fromName === 'loi' || fromName === 'report') {
      doc_kind = fromName;
    }
  }

  return {
    collection,
    funder,
    year,
    doc_kind,
    exclude,
    external_ref,
    // Undated files are treated as current: they are usually live templates, and
    // hiding those from drafting is the worse error.
    archive_only: external_ref || (year !== null && year < ARCHIVE_BEFORE_YEAR),
  };
}

/**
 * Classifies from a full slash-separated path, e.g.
 * `Grants/Prospects and Proposals/Truist/2026/Responses/answers.docx`.
 *
 * This is the form the Drive walk produces, and the form the catalog's `path`
 * column stores, so it is the entry point for anything catalog-shaped.
 */
export function classifyPath(path: string): Classification & { root: string; filename: string } {
  const parts = path.split('/').filter((p) => p.length > 0);
  const root = parts.shift() ?? '';
  const filename = parts.pop() ?? '';
  return { root, filename, ...classify(root, parts, filename) };
}

/**
 * A row needs human review when inference was not decisive: no year, or a
 * doc_kind we could not pin down. These are the rows a person should correct
 * before anyone trusts a filter built on them.
 */
export function needsReview(c: {
  exclude: boolean;
  year: number | null;
  // Deliberately `string`, not the union: the local-mirror loader reads these back
  // out of JSONL, where they have already lost their narrower type.
  doc_kind: string;
  collection: string;
}): boolean {
  if (c.exclude) return false;
  return c.year === null || c.doc_kind === 'other' || c.collection === 'unknown';
}

// ---------------------------------------------------------------------------
// Drive MIME types
// ---------------------------------------------------------------------------

export const FOLDER_MIME = 'application/vnd.google-apps.folder';
export const SHORTCUT_MIME = 'application/vnd.google-apps.shortcut';

/** Drive mime types, so the catalog can state what a fetch will return. */
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
    // Native docs, sheets and slides export to text. Forms, sites, maps and the
    // rest do not, and a folder is not a document.
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
 * Normalizes a path so the same document found two ways compares equal.
 *
 * Drive for Desktop rewrites characters that are illegal in filenames and adds
 * an extension to Google-native files, so the local mirror and Drive disagree on
 * spelling for the same file. Comparison happens on this form; storage always
 * keeps the real Drive path.
 */
export function normalizePath(path: string): string {
  return path
    .toLowerCase()
    // Drive for Desktop substitutes '_' for '/' and ':' in names.
    .replace(/[/:]/g, '_')
    // Google-native files gain a .gdoc/.gsheet extension locally.
    .replace(/\.(gdoc|gsheet|gslides)$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}
