import { loadEnv } from '@lp-ai/lib-config';
import { runSync, type SyncRunRecord } from '@lp-ai/lib-db';

import { clientFromEnv, summarize, syncGrantCatalog, DEFAULT_GRANTS_FOLDER_ID } from './sync.js';
import { syncDocs } from './sync-docs.js';

export type SyncResult = SyncRunRecord;

export { syncGrantCatalog, summarize, clientFromEnv, DEFAULT_GRANTS_FOLDER_ID } from './sync.js';
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
      const env = await loadEnv();
      const client = clientFromEnv(env);
      if (!client) {
        return {
          status: 'noop',
          recordsUpserted: 0,
          notes: 'no Drive identity configured (GOOGLE_SERVICE_ACCOUNT_JSON, or the OAuth trio)',
        };
      }

      const folderId = env.GOOGLE_DRIVE_GRANTS_FOLDER_ID ?? DEFAULT_GRANTS_FOLDER_ID;
      const catalog = await syncGrantCatalog(client, folderId);

      let docsStats: Awaited<ReturnType<typeof syncDocs>> = {
        docs_configured: 0,
        docs_synced: 0,
        docs_skipped_empty: 0,
        docs_skipped_error: 0,
        chunks_written: 0,
      };
      try {
        docsStats = await syncDocs();
      } catch (err) {
        console.error(
          'google-drive-docs FAILED —',
          err instanceof Error ? err.message : String(err),
        );
      }

      const notes = [
        summarize(catalog),
        `docs: configured=${docsStats.docs_configured} synced=${docsStats.docs_synced} chunks=${docsStats.chunks_written} skipped_empty=${docsStats.docs_skipped_empty} skipped_error=${docsStats.docs_skipped_error}`,
      ].join('; ');

      return {
        status: 'ok',
        recordsUpserted: catalog.updated + catalog.created + docsStats.chunks_written,
        notes,
      };
    },
    // Declares the tables for the 5% integrity guard: a run that shrinks the
    // catalog is a discovery regression, and the guard is what says so.
    { tables: ['grant_documents', 'document_chunks'] },
  );
}
