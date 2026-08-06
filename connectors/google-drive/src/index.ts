import { loadEnv } from '@lp-ai/lib-config';
import { runSync, type SyncRunRecord } from '@lp-ai/lib-db';

import { clientFromEnv, summarize, syncGrantCatalog, DEFAULT_GRANTS_FOLDER_ID } from './sync.js';

export type SyncResult = SyncRunRecord;

export { syncGrantCatalog, summarize, clientFromEnv, DEFAULT_GRANTS_FOLDER_ID } from './sync.js';
export { makeDriveClient, buildPaths, toDriveFile } from './drive-client.js';
export type { DriveClient, DriveFile, DriveRoot } from './drive-client.js';
export { reconcile } from './reconcile.js';
export type { CatalogRow, Resolution } from './reconcile.js';

export async function sync(): Promise<SyncResult> {
  return runSync(
    'google-drive',
    async () => {
      const env = await loadEnv();
      const client = clientFromEnv(env);
      if (!client) {
        return { status: 'noop', recordsUpserted: 0, notes: 'GOOGLE_SERVICE_ACCOUNT_JSON not set' };
      }

      const folderId = env.GOOGLE_DRIVE_GRANTS_FOLDER_ID ?? DEFAULT_GRANTS_FOLDER_ID;
      const result = await syncGrantCatalog(client, folderId);

      return {
        status: 'ok',
        recordsUpserted: result.updated + result.created,
        notes: summarize(result),
      };
    },
    // Declares the table for the 5% integrity guard: a run that shrinks the
    // catalog is a discovery regression, and the guard is what says so.
    { tables: ['grant_documents'] },
  );
}
