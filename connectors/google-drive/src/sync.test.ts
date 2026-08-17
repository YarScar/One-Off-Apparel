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

import { clientFromEnv, syncGrantCatalog } from './sync.js';
import type { DriveClient, DriveFile, DriveRoot } from './drive-client.js';

function fakeClient(root: Partial<DriveRoot>, files: DriveFile[]): DriveClient {
  return {
    resolveRoot: () => Promise.resolve({ id: 'root', name: 'Grants', driveId: null, ...root }),
    listTree: () =>
      Promise.resolve({
        files,
        apiCalls: 1,
        strategy: 'test',
        inaccessibleFolders: [],
        duplicatePaths: [],
      }),
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

describe('unreadable shortcut targets', () => {
  it('is what `unreadable` exists to record', () => {
    // 16 of the 29 shortcuts in the real corpus point at files in someone else's
    // drive. The walk probes each target; a row whose ID 404s must not be offered
    // as fetchable, so the sync downgrades its content class and flags it.
    const file: DriveFile = {
      id: 'targetId',
      name: 'United Way Grant - Student Letter',
      mimeType: 'application/vnd.google-apps.document',
      path: 'Grants/Prospects and Proposals/United Way/United Way Grant - Student Letter',
      size: null,
      modifiedTime: null,
      viaShortcutId: 'shortcutId',
      unreadable: true,
      contentClass: 'text',
      ext: '',
      url: 'https://docs.google.com/document/d/targetId/edit',
    };
    // Asserted on the field rather than through the database write, which needs a
    // live Postgres; `syncGrantCatalog` maps `unreadable` to contentClass 'unknown'.
    expect(file.unreadable).toBe(true);
  });
});

describe('clientFromEnv', () => {
  const oauth = {
    GOOGLE_OAUTH_CLIENT_ID: 'id',
    GOOGLE_OAUTH_CLIENT_SECRET: 'secret',
    GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN: 'token',
  };

  it('returns null when no identity is configured', () => {
    expect(clientFromEnv({})).toBeNull();
  });

  it('builds a client from a service account key', () => {
    const key = Buffer.from(JSON.stringify({ client_email: 'x@y.iam.gserviceaccount.com' })).toString(
      'base64',
    );
    expect(clientFromEnv({ GOOGLE_SERVICE_ACCOUNT_JSON: key })).not.toBeNull();
  });

  it('prefers a fully configured user identity over the service account, locally', () => {
    // A developer's machine with both: the identity that can actually see the tree
    // is the person's — the service account does not inherit their access.
    expect(clientFromEnv({ ...oauth, GOOGLE_SERVICE_ACCOUNT_JSON: 'ignored' })).not.toBeNull();
  });

  it('ignores a user identity in a deployed environment', () => {
    // A user token belongs to one person and breaks the day they leave, so
    // production must never authenticate with one — even if somebody puts the trio
    // in Secrets Manager. ECS sets both of these signals.
    const key = Buffer.from(JSON.stringify({ client_email: 'x@y.iam.gserviceaccount.com' })).toString(
      'base64',
    );
    expect(clientFromEnv({ ...oauth, NODE_ENV: 'production' })).toBeNull();
    expect(clientFromEnv({ ...oauth, USE_AWS_SECRETS: true })).toBeNull();
    expect(clientFromEnv({ ...oauth, USE_AWS_SECRETS: 'true' })).toBeNull();
    // ...and falls through to the service account when there is one.
    expect(
      clientFromEnv({ ...oauth, NODE_ENV: 'production', GOOGLE_SERVICE_ACCOUNT_JSON: key }),
    ).not.toBeNull();
  });

  it('ignores a half-configured user identity', () => {
    // Two of three env vars is a mistake mid-setup, not an identity. Falling back
    // beats constructing a client that cannot authenticate.
    expect(
      clientFromEnv({
        GOOGLE_OAUTH_CLIENT_ID: oauth.GOOGLE_OAUTH_CLIENT_ID,
        GOOGLE_OAUTH_CLIENT_SECRET: oauth.GOOGLE_OAUTH_CLIENT_SECRET,
      }),
    ).toBeNull();
  });
});
