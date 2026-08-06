/**
 * Tests for the two pure pieces of the Drive walk.
 *
 * `buildPaths` is what makes the one-sweep strategy possible, so it is also what
 * silently ruins the catalog if it is wrong: a misassembled path classifies a file
 * under the wrong funder, year and kind at once. `toDriveFile` decides which ID
 * gets stored, and storing a shortcut's own ID means cataloguing something that
 * reads as empty.
 *
 * Neither needs a network, which is the reason the tree reassembly lives in a
 * function rather than inline in the walk.
 */

import { describe, it, expect } from 'vitest';
import type { drive_v3 } from 'googleapis';

import { buildPaths, shortcutFolderTarget, toDriveFile } from './drive-client.js';

const FOLDER = 'application/vnd.google-apps.folder';
const SHORTCUT = 'application/vnd.google-apps.shortcut';
const DOC = 'application/vnd.google-apps.document';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const ROOT = { id: 'root', name: 'Grants' };

function folder(id: string, name: string, parent: string): drive_v3.Schema$File {
  return { id, name, mimeType: FOLDER, parents: [parent] };
}
function file(
  id: string,
  name: string,
  parent: string,
  mimeType = DOCX,
): drive_v3.Schema$File {
  return { id, name, mimeType, parents: [parent] };
}

describe('buildPaths', () => {
  it('reassembles a deep path from flat parent links', () => {
    const raw = [
      folder('f1', 'Prospects and Proposals', 'root'),
      folder('f2', 'Truist', 'f1'),
      folder('f3', '2026', 'f2'),
      folder('f4', 'Responses', 'f3'),
      file('d1', '8_10_2026 Truist Application.docx', 'f4'),
    ];

    expect(buildPaths(raw, ROOT).get('d1')).toBe(
      'Grants/Prospects and Proposals/Truist/2026/Responses/8_10_2026 Truist Application.docx',
    );
  });

  it('places a file directly in the root', () => {
    expect(buildPaths([file('d1', '990.pdf', 'root')], ROOT).get('d1')).toBe('Grants/990.pdf');
  });

  it('is independent of the order folders arrive in', () => {
    // A shared-drive sweep returns files in no useful order, and a child can and
    // does arrive before its parent.
    const deep = [
      file('d1', 'answers.docx', 'f3'),
      folder('f3', '2026', 'f2'),
      folder('f2', 'Truist', 'f1'),
      folder('f1', 'Prospects and Proposals', 'root'),
    ];
    expect(buildPaths(deep, ROOT).get('d1')).toBe(
      'Grants/Prospects and Proposals/Truist/2026/answers.docx',
    );
  });

  it('escapes a slash inside a Drive filename instead of forging folders', () => {
    // 121 files in the real corpus are named like this. Concatenated raw, one
    // filename becomes three fake folders that then classify as a subtree of the
    // funder that does not exist.
    const raw = [
      folder('f1', 'Prospects and Proposals', 'root'),
      folder('f2', 'Truist Foundation', 'f1'),
      file('d1', '8/10/2026 Truist Application', 'f2', DOC),
    ];
    expect(buildPaths(raw, ROOT).get('d1')).toBe(
      'Grants/Prospects and Proposals/Truist Foundation/8_10_2026 Truist Application',
    );
  });

  it('escapes a slash inside a Drive folder name too', () => {
    const raw = [
      folder('f1', 'Meetings / Site Visit', 'root'),
      file('d1', 'notes.docx', 'f1'),
    ];
    expect(buildPaths(raw, ROOT).get('d1')).toBe('Grants/Meetings _ Site Visit/notes.docx');
  });

  it('drops files that do not descend from the root', () => {
    // A shared drive can hold material this connector has no business cataloguing.
    const raw = [
      folder('other', 'HR', 'someOtherRoot'),
      file('d1', 'salaries.xlsx', 'other'),
      file('d2', 'budget.xlsx', 'root'),
    ];
    const paths = buildPaths(raw, ROOT);
    expect(paths.has('d1')).toBe(false);
    expect(paths.get('d2')).toBe('Grants/budget.xlsx');
  });

  it('drops a file whose parent chain is broken', () => {
    // The parent folder is not in the response — no path can be asserted, and
    // guessing one would file the document under a funder it does not belong to.
    expect(buildPaths([file('d1', 'orphan.docx', 'missing')], ROOT).has('d1')).toBe(false);
  });

  it('does not loop forever on a cyclic parent chain', () => {
    const cyclic = [
      { id: 'a', name: 'A', mimeType: FOLDER, parents: ['b'] },
      { id: 'b', name: 'B', mimeType: FOLDER, parents: ['a'] },
      file('d1', 'x.docx', 'a'),
    ];
    expect(buildPaths(cyclic, ROOT).has('d1')).toBe(false);
  });
});

describe('shortcutFolderTarget', () => {
  it('names the folder to traverse, and nothing else', () => {
    expect(
      shortcutFolderTarget({
        id: 's',
        mimeType: SHORTCUT,
        shortcutDetails: { targetId: 'folderId', targetMimeType: FOLDER },
      }),
    ).toBe('folderId');
    // A shortcut to a document is a document, not a traversal target.
    expect(
      shortcutFolderTarget({
        id: 's',
        mimeType: SHORTCUT,
        shortcutDetails: { targetId: 'docId', targetMimeType: DOC },
      }),
    ).toBeNull();
    expect(shortcutFolderTarget({ id: 'f', mimeType: FOLDER })).toBeNull();
  });
});

describe('toDriveFile', () => {
  it('stores a shortcut’s target ID, not the shortcut’s own', () => {
    // Reading a shortcut's own ID returns empty content — this is the bug the
    // discovery doc records as Fix 3.
    const mapped = toDriveFile(
      {
        id: 'shortcutId',
        name: 'Cambiar Thrive response',
        mimeType: SHORTCUT,
        shortcutDetails: { targetId: 'realId', targetMimeType: DOC },
      },
      'Grants/x',
    );

    expect(mapped?.id).toBe('realId');
    expect(mapped?.viaShortcutId).toBe('shortcutId');
    expect(mapped?.mimeType).toBe(DOC);
    expect(mapped?.url).toBe('https://docs.google.com/document/d/realId/edit');
  });

  it('skips a shortcut that points at a folder', () => {
    // 7 of the 29 shortcuts in the corpus do. A folder is not a document, and
    // cataloguing one makes a row nothing can ever fetch — it is a traversal
    // instruction, handled by `shortcutFolderTarget`.
    expect(
      toDriveFile(
        {
          id: 's',
          name: 'Old Development Folder',
          mimeType: SHORTCUT,
          shortcutDetails: { targetId: 'folderId', targetMimeType: FOLDER },
        },
        'Grants/x',
      ),
    ).toBeNull();
  });

  it('skips a shortcut with no target', () => {
    expect(
      toDriveFile({ id: 's', name: 'broken link', mimeType: SHORTCUT }, 'Grants/x'),
    ).toBeNull();
  });

  it('skips folders', () => {
    expect(toDriveFile({ id: 'f', name: 'Truist', mimeType: FOLDER }, 'Grants/Truist')).toBeNull();
  });

  it('reads text extractability from the MIME type, not the filename', () => {
    // A Google-native doc has no extension at all, so an extension-only rule
    // would mark the most valuable files in the corpus unreadable.
    const native = toDriveFile({ id: 'd', name: 'Truist Application', mimeType: DOC }, 'Grants/x');
    expect(native?.contentClass).toBe('text');
    expect(native?.ext).toBe('');

    const video = toDriveFile({ id: 'v', name: 'site visit.mp4', mimeType: 'video/mp4' }, 'Grants/v');
    expect(video?.contentClass).toBe('media');
  });

  it('falls back to the extension when Drive reports a generic type', () => {
    const mapped = toDriveFile(
      { id: 'd', name: 'budget.xlsx', mimeType: 'application/octet-stream' },
      'Grants/b',
    );
    expect(mapped?.contentClass).toBe('text');
    expect(mapped?.ext).toBe('.xlsx');
  });

  it('keeps the real filename even where the path had to escape it', () => {
    // The path is a key; the name is what a human reads. They are allowed to differ.
    const mapped = toDriveFile(
      { id: 'd', name: '12/8/25 Vanguard Response', mimeType: DOC },
      'Grants/x/12_8_25 Vanguard Response',
    );
    expect(mapped?.name).toBe('12/8/25 Vanguard Response');
    expect(mapped?.path).toBe('Grants/x/12_8_25 Vanguard Response');
  });

  it('carries size and modified time through as given', () => {
    const mapped = toDriveFile(
      { id: 'd', name: 'x.docx', mimeType: DOCX, size: '2048', modifiedTime: '2026-07-01T00:00:00Z' },
      'Grants/x.docx',
    );
    expect(mapped?.size).toBe(2048);
    expect(mapped?.modifiedTime).toBe('2026-07-01T00:00:00Z');
  });
});
