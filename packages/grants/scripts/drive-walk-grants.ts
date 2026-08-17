/**
 * CLI over the Google Drive catalog sync: walks the shared "Grants" tree, writes a
 * manifest, and backfills `grant_documents`.
 *
 * This used to hold its own copy of the walk. It no longer does — the walk, the
 * shared-drive flags, the shortcut resolution and the row matching all live in
 * `connectors/google-drive`, so that the scheduled sync and this script cannot
 * behave differently. What remains here is what a script is actually for: a
 * dry run, and the two files a human wants to read afterwards.
 *
 * Usage:
 *   node --env-file=.env --import tsx packages/grants/scripts/drive-walk-grants.ts --dry-run
 *   node --env-file=.env --import tsx packages/grants/scripts/drive-walk-grants.ts
 *
 * `--dry-run` writes no database rows. It still reports the one fact the
 * discovery diagnosis could not obtain: whether the folder is in a Shared Drive.
 *
 * Requires GOOGLE_SERVICE_ACCOUNT_JSON (base64 of the key JSON) and optionally
 * GOOGLE_DRIVE_GRANTS_FOLDER_ID, falling back to the known Grants folder ID.
 *
 * IMPORTANT — the access requirement that makes or breaks this: a service account
 * is a separate identity and does not inherit the "Shared with me" access a human
 * has. Being able to open the folder in your own browser proves nothing. The
 * folder must be shared with the service account's client_email, or that account
 * added as a member of the shared drive.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
// Relative, for the reason given in load-grant-catalog.ts: `packages/grants` does
// not depend on the connector or on the database, and `scripts/` sits outside this
// package's build. Requires `pnpm --filter @lp-ai/lib-db build` and
// `pnpm --filter @lp-ai/lib-grants build` first, since the connector imports both
// as workspace packages.
import {
  clientFromEnv,
  disconnect,
  summarize,
  syncGrantCatalog,
  DEFAULT_GRANTS_FOLDER_ID,
} from '../../../connectors/google-drive/src/sync.js';

const DATA_DIR = new URL('../../../data/', import.meta.url).pathname;
const DRY_RUN = process.argv.includes('--dry-run');

const client = clientFromEnv(process.env);
if (!client) {
  throw new Error(
    'GOOGLE_SERVICE_ACCOUNT_JSON is not set. It holds the base64-encoded service ' +
      'account key. In production it comes from AWS Secrets Manager under lp-internal/.',
  );
}

const folderId = process.env['GOOGLE_DRIVE_GRANTS_FOLDER_ID'] ?? DEFAULT_GRANTS_FOLDER_ID;

const result = await syncGrantCatalog(client, folderId, {
  dryRun: DRY_RUN,
  onProgress: (message) => process.stdout.write(`${message}\n`),
});

// Always write the manifest: it is the audit trail for what Drive actually
// returned, and it survives a failed or partial database update.
writeFileSync(
  join(DATA_DIR, 'drive-manifest.jsonl'),
  `${result.files.map((f) => JSON.stringify(f)).join('\n')}\n`,
);
process.stdout.write(
  `wrote data/drive-manifest.jsonl (${String(result.files.length)} files)\n${summarize(result)}\n`,
);

if (DRY_RUN) {
  process.stdout.write('dry run: no database writes\n');
} else if (result.created > 0) {
  // Files Drive holds that the local mirror never did. Not an error — the mirror
  // is a partial snapshot, so this is the gap report.
  process.stdout.write(
    `note: ${String(result.created)} files had no catalog row and were added from Drive\n`,
  );
}

await disconnect();
