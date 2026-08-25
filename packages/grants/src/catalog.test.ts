/**
 * Tests for grant corpus classification.
 *
 * These rules were written against the real tree and every one of them encodes a
 * judgement that would otherwise be re-argued: which year a fiscal-year folder
 * belongs to, whether an old application may be drafted from, whether Launchpad
 * even wrote a document. Until this module was extracted from
 * `scripts/build-grants-index.ts`, none of it was tested, and the Drive walk was
 * about to grow a second copy.
 */

import { describe, it, expect } from 'vitest';

import {
  classifyPath,
  contentClassForExt,
  contentClassForMime,
  driveUrlFor,
  fileExtension,
  needsReview,
  normalizePath,
  parseYear,
  scopedNameKey,
} from './catalog.js';

describe('parseYear', () => {
  it('reads a plain four-digit year in any surrounding text', () => {
    expect(parseYear('2025')).toBe(2025);
    expect(parseYear('2026 application')).toBe(2026);
    expect(parseYear('Spring 2026')).toBe(2026);
  });

  it('takes the earlier year of a funded span', () => {
    // A "2026-2028 Grant" was applied for in 2026; filing it under 2028 separates
    // it from its own siblings.
    expect(parseYear('2026-2028 Grant')).toBe(2026);
    expect(parseYear('2023–2024 Grant')).toBe(2023);
  });

  it('shifts a fiscal year back to the year applied', () => {
    // Building 21's FY27 runs July 2026 - June 2027, so an FY 27 folder holds a
    // 2026 application.
    expect(parseYear('Spring Point FY 27')).toBe(2026);
    expect(parseYear('FY26')).toBe(2025);
  });

  it('does not shift calendar-based seasonal shorthand', () => {
    expect(parseYear('F22')).toBe(2022);
    expect(parseYear('Sp25')).toBe(2025);
  });

  it('reads short dates', () => {
    expect(parseYear('11.5.24 ASD AI High School')).toBe(2024);
    expect(parseYear('8_7_2026 GSK Grant')).toBe(2026);
  });

  it('refuses a bare month-day that only looks like a year', () => {
    // "7.28" in "WPF_Budget_Final 7.28.xlsx" is a date, not 2028. Reading it as a
    // year is the exact error this function exists to avoid.
    expect(parseYear('WPF_Budget_Final 7.28.xlsx')).toBeNull();
    expect(parseYear('no year here')).toBeNull();
  });
});

describe('classifyPath', () => {
  it('reads collection, funder, year and kind from the folder chain', () => {
    const c = classifyPath(
      'Grants/Prospects and Proposals/Truist/2026/Responses/8_10_2026 Truist Application.docx',
    );
    expect(c).toMatchObject({
      collection: 'prospects',
      funder: 'Truist',
      year: 2026,
      doc_kind: 'application_response',
      archive_only: false,
      external_ref: false,
      exclude: false,
    });
  });

  it('reads the innermost folder as the most specific statement', () => {
    // `.../Grant Application/Finances` is a budget, not a response.
    expect(
      classifyPath('Grants/Current and Past/GSK/2026/Grant Application/Finances/budget.xlsx')
        .doc_kind,
    ).toBe('budget');
  });

  it('lets a specific filename override a generic container folder', () => {
    expect(
      classifyPath(
        'Grants/Current and Past/CCFF/2026/Grant Application/7_31_26 CCFF Final Grant Report_.docx',
      ).doc_kind,
    ).toBe('report');
  });

  it('lets a template filename override a generic container folder', () => {
    expect(
      classifyPath('Grants/Current and Past/GSK/2026/Grant Application/Report Template.docx')
        .doc_kind,
    ).toBe('template');
  });

  it('lets an LOI filename override a generic container folder', () => {
    expect(
      classifyPath(
        'Grants/Prospects and Proposals/Truist/2026/Responses/Letter of Intent.docx',
      ).doc_kind,
    ).toBe('loi');
  });

  it('marks pre-2025 applications archive-only', () => {
    // The program shifted, so older applications describe something Launchpad no
    // longer runs. Searchable, never drafting context.
    const c = classifyPath('Grants/Current and Past/Barra/2023/Responses/answers.docx');
    expect(c.year).toBe(2023);
    expect(c.archive_only).toBe(true);
  });

  it('treats undated files as current', () => {
    // Usually live templates; hiding those from drafting is the worse error.
    expect(classifyPath('Grants/Prospects and Proposals/Truist/questions.docx').archive_only).toBe(
      false,
    );
  });

  it('flags externally authored material, and implies archive-only', () => {
    const c = classifyPath('Grants/Current and Past/GSK/2026/Reference/winning application.pdf');
    expect(c.external_ref).toBe(true);
    expect(c.doc_kind).toBe('external_reference');
    expect(c.archive_only).toBe(true);
  });

  it('honours the do-not-ingest folders', () => {
    expect(
      classifyPath('Launchpad Internal AI OS/Project Management (do not ingest)/notes.docx')
        .exclude,
    ).toBe(true);
    expect(classifyPath('Grants/Current and Past/GSK/2026/Ignore/superseded.docx').exclude).toBe(
      true,
    );
  });

  it('classifies anything outside Grants as the internal AI OS collection', () => {
    const c = classifyPath('Launchpad Internal AI OS/Meeting Transcripts/2026-07-21.vtt');
    expect(c.collection).toBe('internal_ai_os');
    expect(c.funder).toBeNull();
  });

  it('calls a file directly under Grants org reference', () => {
    expect(classifyPath('Grants/990.pdf').collection).toBe('org_reference');
  });

  it('knows the two organization-level folders real Drive turned out to have', () => {
    // Found by walking Drive: both hold prime drafting material — the live response
    // and report templates, and the demographics/outcomes reference sheets — and both
    // were landing in `unknown` and flagged for review.
    expect(classifyPath('Grants/Templates/Grant Response Template (MAKE A COPY)')).toMatchObject({
      collection: 'org_reference',
      doc_kind: 'template',
    });
    expect(classifyPath('Grants/Key Statistics/Launchpad Demographics').collection).toBe(
      'org_reference',
    );
  });
});

describe('needsReview', () => {
  it('flags a row whose year or kind was not decisive', () => {
    expect(needsReview({ exclude: false, year: null, doc_kind: 'report', collection: 'prospects' })).toBe(true);
    expect(needsReview({ exclude: false, year: 2026, doc_kind: 'other', collection: 'prospects' })).toBe(true);
    expect(needsReview({ exclude: false, year: 2026, doc_kind: 'report', collection: 'unknown' })).toBe(true);
  });

  it('does not flag a confident row, or an excluded one', () => {
    expect(needsReview({ exclude: false, year: 2026, doc_kind: 'report', collection: 'prospects' })).toBe(false);
    // Nobody needs to review something that will never be returned.
    expect(needsReview({ exclude: true, year: null, doc_kind: 'other', collection: 'unknown' })).toBe(false);
  });
});

describe('content class and extensions', () => {
  it('ignores things that only look like extensions', () => {
    expect(fileExtension('HFCT Question List (due 6.5.2026)')).toBe('');
    expect(fileExtension('answers.docx')).toBe('.docx');
  });

  it('calls Google-native docs, sheets and slides extractable', () => {
    expect(contentClassForMime('application/vnd.google-apps.document')).toBe('text');
    expect(contentClassForMime('application/vnd.google-apps.spreadsheet')).toBe('text');
    expect(contentClassForMime('application/vnd.google-apps.presentation')).toBe('text');
    // A form or a folder has no text to extract.
    expect(contentClassForMime('application/vnd.google-apps.form')).toBe('unknown');
    expect(contentClassForMime('application/vnd.google-apps.folder')).toBe('unknown');
  });

  it('agrees with itself on Google-native extensions vs. MIME types (#23 regression)', () => {
    // The extension path (fileExtension/contentClassForExt) and the MIME path
    // (contentClassForMime) classify the same file two different ways. They must agree,
    // or a file gets classified one way locally and another way via Drive.
    const cases: ReadonlyArray<[ext: string, mime: string]> = [
      ['.gdoc', 'application/vnd.google-apps.document'],
      ['.gsheet', 'application/vnd.google-apps.spreadsheet'],
      ['.gslides', 'application/vnd.google-apps.presentation'],
    ];
    for (const [ext, mime] of cases) {
      expect(contentClassForExt(ext)).toBe(contentClassForMime(mime));
      expect(contentClassForExt(ext)).toBe('text');
    }
  });

  it('calls audio, video and images media', () => {
    expect(contentClassForMime('video/mp4')).toBe('media');
    expect(contentClassForExt('.m4a')).toBe('media');
  });

  it('maps office MIME types back through the extension table', () => {
    expect(
      contentClassForMime(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ),
    ).toBe('text');
    expect(contentClassForMime('application/pdf')).toBe('text');
  });
});

describe('driveUrlFor', () => {
  it('uses the editor host each Google-native type actually opens in', () => {
    expect(driveUrlFor('X', 'application/vnd.google-apps.document')).toContain('/document/d/X');
    expect(driveUrlFor('X', 'application/vnd.google-apps.spreadsheet')).toContain(
      '/spreadsheets/d/X',
    );
    expect(driveUrlFor('X', 'application/pdf')).toBe('https://drive.google.com/file/d/X/view');
    expect(driveUrlFor('X', null)).toBe('https://drive.google.com/file/d/X/view');
  });
});

describe('scopedNameKey', () => {
  it('puts the same filename under one funder in one scope', () => {
    expect(scopedNameKey('Grants/Current and Past/GSK/2026/budget.xlsx')).toBe(
      scopedNameKey('Grants/Current and Past/GSK/2026/Finances/budget'),
    );
  });

  it('separates the same filename under different funders', () => {
    expect(scopedNameKey('Grants/Current and Past/GSK/2026/budget.xlsx')).not.toBe(
      scopedNameKey('Grants/Current and Past/Truist/2026/budget.xlsx'),
    );
  });

  it('shares one scope across the organization-level folders', () => {
    // `Grants/x` and `Grants/Templates/x` are the same document after a tidy-up.
    expect(scopedNameKey('Grants/Grant Report Template (MAKE A COPY).docx')).toBe(
      scopedNameKey('Grants/Templates/Grant Report Template (MAKE A COPY)'),
    );
  });
});

describe('normalizePath', () => {
  it('makes the mirror’s spelling and Drive’s spelling compare equal', () => {
    // Drive for Desktop cannot write '/' or ':' into a filename and appends an
    // extension to Google-native files.
    expect(normalizePath('Grants/T/AI/ML Overview.docx')).toBe(
      normalizePath('Grants/T/AI_ML Overview.docx'),
    );
    expect(normalizePath('Grants/T/Thrive response')).toBe(
      normalizePath('Grants/T/Thrive response.gdoc'),
    );
  });

  it('still distinguishes genuinely different documents', () => {
    expect(normalizePath('Grants/T/2026/answers.docx')).not.toBe(
      normalizePath('Grants/T/2025/answers.docx'),
    );
  });
});
