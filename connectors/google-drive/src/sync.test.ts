/**
 * Tests for the sync's refusal to treat an empty listing as success.
 *
 * This is the whole diagnosed bug in one behaviour. The original failure looked
 * exactly like an empty folder — root readable, children `{}` — so a connector
 * that reported `status: 'ok', 0 records` would have been the most expensive
 * possible outcome: green runs in the HQ `/sync` page while the catalog rotted.
 *
 * These cases stop before any database call, so they need no live Postgres.
 */

import { describe, it, expect } from 'vitest';

import { syncGrantCatalog } from './sync.js';
import type { DriveClient, DriveFile, DriveRoot } from './drive-client.js';

function fakeClient(root: Partial<DriveRoot>, files: DriveFile[]): DriveClient {
  return {
    resolveRoot: () => Promise.resolve({ id: 'root', name: 'Grants', driveId: null, ...root }),
    listTree: () => Promise.resolve({ files, apiCalls: 1, strategy: 'test' }),
    exportText: () => Promise.resolve(null),
  };
}

describe('syncGrantCatalog', () => {
  it('fails loudly when the root reads but lists nothing', async () => {
    await expect(syncGrantCatalog(fakeClient({}, []), 'folderId')).rejects.toThrow(
      /listed 0 files inside it/,
    );
  });

  it('names the access requirement people get wrong in the error', async () => {
    // A service account does not inherit a human's "Shared with me" access, and
    // that is the fix in nearly every instance of this failure — so the error says
    // it rather than leaving the reader to find the doc.
    await expect(syncGrantCatalog(fakeClient({}, []), 'folderId')).rejects.toThrow(/client_email/);
  });

  it('reports the shared-drive answer before it can fail', async () => {
    // `driveId` is the unconfirmed root cause in the discovery doc. Whether the
    // run succeeds or not, the identity resolved the root, so the answer is known.
    const seen: string[] = [];
    await syncGrantCatalog(fakeClient({ driveId: 'shared123' }, []), 'folderId', {
      onProgress: (m) => seen.push(m),
    }).catch(() => undefined);

    expect(seen[0]).toContain('shared drive shared123');
  });
});
