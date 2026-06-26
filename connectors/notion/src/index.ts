import { runSync, type SyncRunRecord } from '@lp-ai/lib-db';
import { syncMeetings } from './sync-meetings.js';
import { syncDatabases } from './sync-databases.js';

export type SyncResult = SyncRunRecord;

export async function sync(): Promise<SyncResult> {
  return runSync('notion', async () => {
    const meetings = await syncMeetings();
    const databases = await syncDatabases();

    const totalChunks = meetings.chunks_written + databases.chunks_written;
    const notes = [
      `meetings: discovered=${meetings.pages_discovered} synced=${meetings.pages_synced} chunks=${meetings.chunks_written}`,
      `databases: processed=${databases.databases_processed} discovered=${databases.pages_discovered} synced=${databases.pages_synced} chunks=${databases.chunks_written}`,
      `skipped: no_visibility=${meetings.pages_skipped_no_visibility} archived=${meetings.pages_skipped_archived + databases.pages_skipped_archived} empty=${databases.pages_skipped_empty} error=${meetings.pages_skipped_error + databases.pages_skipped_error}`,
    ].join('; ');
    console.log('notion: ' + notes);
    return {
      status: 'ok',
      recordsUpserted: totalChunks,
      notes,
    };
  }, {
    tables: ['document_chunks'],
  });
}

export { syncMeetings } from './sync-meetings.js';
export { syncDatabases } from './sync-databases.js';
