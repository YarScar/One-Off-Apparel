import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(here, '..', '..', '..', '.env'), override: true });

const { runSync } = await import('@lp-ai/lib-db');
const { syncAttendance } = await import('./sync-attendance.js');

const result = await runSync(
  'google-sheets-attendance',
  async () => {
    const rows = await syncAttendance();
    return { status: 'ok', recordsUpserted: rows };
  },
  { tables: ['attendance_records'] },
);

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
