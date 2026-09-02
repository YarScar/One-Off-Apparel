import { runSync, type SyncRunRecord } from '@lp-ai/lib-db';

import { syncDocs } from './sync-docs.js';

export type SyncResult = SyncRunRecord;

export { syncDocs } from './sync-docs.js';
export {
  makeDriveClient,
  makeOAuthDriveClient,
  buildPaths,
  dedupeById,
  toDriveFile,
} from './drive-client.js';
export type { DriveClient, DriveFile, DriveRoot } from './drive-client.js';
export { reconcile } from './reconcile.js';
export type { CatalogRow, Resolution } from './reconcile.js';

export async function sync(): Promise<SyncResult> {
  return runSync(
    'google-drive',
    async () => {
      const docsStats = await syncDocs();

      return {
        status: 'ok',
        recordsUpserted: docsStats.chunks_written,
        notes: `docs: configured=${docsStats.docs_configured} synced=${docsStats.docs_synced} chunks=${docsStats.chunks_written} skipped_empty=${docsStats.docs_skipped_empty} skipped_error=${docsStats.docs_skipped_error}`,
      };
    },
    { tables: ['document_chunks'] },
  );
}
