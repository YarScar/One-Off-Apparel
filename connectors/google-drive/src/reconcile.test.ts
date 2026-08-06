/**
 * Tests for catalog identity.
 *
 * The failure this guards against is not a crash: it is a Drive ID landing on the
 * wrong catalog row, after which `find_grant_documents` hands a grant writer a
 * different funder's document and nothing anywhere says so. Every case below is
 * either "matched the right row" or "refused to guess".
 */

import { describe, it, expect } from 'vitest';

import { reconcile, type CatalogRow } from './reconcile.js';
import type { DriveFile } from './drive-client.js';

function driveFile(path: string, id: string): DriveFile {
  const name = path.split('/').pop() ?? path;
  return {
    id,
    name,
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    path,
    size: 1,
    modifiedTime: null,
    viaShortcutId: null,
    unreadable: false,
    contentClass: 'text',
    ext: '.docx',
    url: `https://drive.google.com/file/d/${id}/view`,
  };
}

const row = (id: string, path: string, driveFileId: string | null = null): CatalogRow => ({
  id,
  path,
  driveFileId,
});

describe('reconcile', () => {
  it('matches on exact path', () => {
    const { resolutions, counts } = reconcile(
      [driveFile('Grants/Truist/answers.docx', 'D1')],
      [row('r1', 'Grants/Truist/answers.docx')],
    );
    expect(resolutions[0]?.rowId).toBe('r1');
    expect(resolutions[0]?.matchedBy).toBe('exact_path');
    expect(counts.created).toBe(0);
  });

  it('matches an existing Drive ID even when the paths disagree', () => {
    // The ID is the file. A row that already carries it is the file, whatever
    // either path says — this is how a renamed or moved document stays one row.
    const { resolutions } = reconcile(
      [driveFile('Grants/Truist/2026/answers.docx', 'D1')],
      [row('r1', 'Grants/Truist/old location/answers.docx', 'D1')],
    );
    expect(resolutions[0]?.rowId).toBe('r1');
    expect(resolutions[0]?.matchedBy).toBe('drive_id');
  });

  it('matches through Drive for Desktop’s filename rewriting', () => {
    // Drive holds `AI/ML Overview.docx`; the local mirror could not, so its row
    // reads `AI_ML Overview.docx`. Same document, two spellings.
    const { resolutions } = reconcile(
      [driveFile('Grants/Truist/AI/ML Overview.docx', 'D1')],
      [row('r1', 'Grants/Truist/AI_ML Overview.docx')],
    );
    expect(resolutions[0]?.rowId).toBe('r1');
    expect(resolutions[0]?.matchedBy).toBe('normalized_path');
  });

  it('matches a Google-native file against its .gdoc stub row', () => {
    const { resolutions } = reconcile(
      [driveFile('Grants/Cambiar/Thrive response', 'D1')],
      [row('r1', 'Grants/Cambiar/Thrive response.gdoc')],
    );
    expect(resolutions[0]?.matchedBy).toBe('normalized_path');
  });

  it('refuses an ambiguous normalized match and flags it instead', () => {
    // Two rows normalize the same way, so picking one would be a coin flip that
    // silently serves the wrong document.
    const { resolutions, counts } = reconcile(
      [driveFile('Grants/Truist/AI/ML Overview.docx', 'D1')],
      [row('r1', 'Grants/Truist/AI_ML Overview.docx'), row('r2', 'Grants/Truist/AI:ML Overview.docx')],
    );
    expect(resolutions[0]?.rowId).toBeNull();
    expect(resolutions[0]?.ambiguousWith).toHaveLength(2);
    expect(counts.ambiguous).toBe(1);
    expect(counts.created).toBe(1);
  });

  it('matches a downloaded Office copy of a Google-native file', () => {
    // The mirror was produced by downloading the tree, so a native Doc arrived as
    // `.docx`. 537 rows in the real corpus differ only this way, or by punctuation.
    const { resolutions } = reconcile(
      [driveFile('Grants/Truist/1Philadelphia Grant Application', 'D1')],
      [row('r1', 'Grants/Truist/1Philadelphia Grant Application.docx')],
    );
    expect(resolutions[0]?.rowId).toBe('r1');
    expect(resolutions[0]?.matchedBy).toBe('loose_path');
  });

  it('matches across inconsistent punctuation rewriting', () => {
    // Drive's `Meetings / Site Visit` came down as `Meetings - Site Visit` in one
    // place and `Meetings _ Site Visit` in another. No single substitution rule
    // covers it, so the loose key collapses punctuation instead of chasing them.
    const { resolutions } = reconcile(
      [driveFile('Grants/CCFF/Meetings _ Site Visit/2024/prep', 'D1')],
      [row('r1', 'Grants/CCFF/Meetings - Site Visit/2024/prep.docx')],
    );
    expect(resolutions[0]?.matchedBy).toBe('loose_path');
  });

  it('refuses a loose match with two candidates', () => {
    // The loose key is lossy by design — 68 keys collide in the real corpus — so it
    // is only ever allowed to name exactly one row.
    const { resolutions, counts } = reconcile(
      [driveFile('Grants/ATF/Budget 5.23', 'D1')],
      [row('r1', 'Grants/ATF/Budget 5.23.xlsx'), row('r2', 'Grants/ATF/Budget 5-23.pdf')],
    );
    expect(resolutions[0]?.rowId).toBeNull();
    expect(counts.ambiguous).toBe(1);
  });

  it('prefers a precise match over a loose one', () => {
    // r2 is the exact path. The loose key would also reach r1, and must not.
    const { resolutions } = reconcile(
      [driveFile('Grants/T/answers.docx', 'D1')],
      [row('r1', 'Grants/T/answers'), row('r2', 'Grants/T/answers.docx')],
    );
    expect(resolutions[0]?.rowId).toBe('r2');
    expect(resolutions[0]?.matchedBy).toBe('exact_path');
  });

  it('creates a row for a Drive file the mirror never held', () => {
    // Drive holds material the mirror never did — 655 files on the first real
    // walk — so this is an ordinary case, not an edge one.
    const { resolutions, counts } = reconcile([driveFile('Grants/New Funder/loi.docx', 'D1')], []);
    expect(resolutions[0]?.rowId).toBeNull();
    expect(resolutions[0]?.ambiguousWith).toHaveLength(0);
    expect(counts.created).toBe(1);
  });

  it('never assigns one catalog row to two Drive files', () => {
    // `drive_file_id` is unique, so a double claim would either throw or steal
    // the row. The second file gets its own row instead.
    const { resolutions, counts } = reconcile(
      [
        driveFile('Grants/Truist/AI/ML Overview.docx', 'D1'),
        driveFile('Grants/Truist/AI:ML Overview.docx', 'D2'),
      ],
      [row('r1', 'Grants/Truist/AI_ML Overview.docx')],
    );
    const claimed = resolutions.filter((r) => r.rowId === 'r1');
    expect(claimed).toHaveLength(1);
    expect(counts.created).toBe(1);
  });

  it('prefers the ID match when one file could match two rows two ways', () => {
    // r2 holds the ID, r1 merely shares the path. The ID wins.
    const { resolutions } = reconcile(
      [driveFile('Grants/Truist/answers.docx', 'D1')],
      [row('r1', 'Grants/Truist/answers.docx'), row('r2', 'Grants/Truist/elsewhere.docx', 'D1')],
    );
    expect(resolutions[0]?.rowId).toBe('r2');
    expect(resolutions[0]?.matchedBy).toBe('drive_id');
  });

  it('resolves the same input the same way every run', () => {
    const files = [
      driveFile('Grants/b.docx', 'D2'),
      driveFile('Grants/a.docx', 'D1'),
    ];
    const rows = [row('r1', 'Grants/a.docx'), row('r2', 'Grants/b.docx')];
    const first = reconcile(files, rows).resolutions.map((r) => [r.file.id, r.rowId]);
    const second = reconcile([...files].reverse(), rows).resolutions.map((r) => [r.file.id, r.rowId]);
    expect(first).toEqual(second);
  });
});
