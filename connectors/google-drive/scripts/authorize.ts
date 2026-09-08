/**
 * One-time browser consent, to get a refresh token for your own Google account.
 *
 * Why this exists: the scheduled sync runs as a service account, and a service
 * account is a separate identity that does **not** inherit the "Shared with me"
 * access a person has. Testing the walk against the real `Grants` tree as a
 * service account therefore needs the folder's owner to share it, which is
 * outside this repository's control. A team member who can already open the tree
 * can authorize their own account here in one round trip and prove the walk works
 * today. Production auth does not change.
 *
 * Usage:
 *   # 1. Create an OAuth client in the same GCP project:
 *   #    APIs & Services -> Credentials -> Create credentials -> OAuth client ID
 *   #    Application type: Desktop app.  Enable the Google Drive API too.
 *   # 2. Put the client into .env:
 *   #    GOOGLE_OAUTH_CLIENT_ID=...
 *   #    GOOGLE_OAUTH_CLIENT_SECRET=...
 *   # 3. Run this, and approve in the browser it opens:
 *   node --env-file=.env --import tsx connectors/google-drive/scripts/authorize.ts
 *   # 4. Paste the printed line into .env.
 *
 * Scope is `drive.readonly`, and this script writes nothing but its own output —
 * the token lands in your terminal, not on disk, so nothing can leak it into a
 * commit by accident.
 */

import { createServer } from 'node:http';
import { google } from 'googleapis';

const SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
/** Loopback on a fixed port, so the OAuth client's redirect URI can be registered once. */
const PORT = 5787;
const REDIRECT_URI = `http://127.0.0.1:${String(PORT)}/callback`;

const clientId = process.env['GOOGLE_OAUTH_CLIENT_ID'];
const clientSecret = process.env['GOOGLE_OAUTH_CLIENT_SECRET'];
if (!clientId || !clientSecret) {
  throw new Error(
    'GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET must be set in .env. ' +
      'Create a Desktop app OAuth client in the same GCP project as the Drive API.',
  );
}

const auth = new google.auth.OAuth2({ clientId, clientSecret, redirectUri: REDIRECT_URI });

const url = auth.generateAuthUrl({
  // Offline access is what makes Google issue a refresh token at all.
  access_type: 'offline',
  scope: [SCOPE],
  // Force the consent screen: Google omits the refresh token on a re-approval
  // that it considers already granted, which reads as a broken script.
  prompt: 'consent',
});

process.stdout.write(
  `Open this URL, approve, and this script will finish on its own:\n\n${url}\n\n` +
    `(listening on ${REDIRECT_URI} — add that exact URI to the OAuth client if Google rejects it)\n`,
);

const code = await new Promise<string>((resolve, reject) => {
  const server = createServer((req, res) => {
    const requestUrl = new URL(req.url ?? '/', `http://127.0.0.1:${String(PORT)}`);
    const received = requestUrl.searchParams.get('code');
    const error = requestUrl.searchParams.get('error');

    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(received ? 'Authorized. Close this tab and return to the terminal.' : `Failed: ${String(error)}`);
    server.close();

    if (received) resolve(received);
    else reject(new Error(`authorization failed: ${String(error)}`));
  });
  server.listen(PORT);
});

const { tokens } = await auth.getToken(code);
if (!tokens.refresh_token) {
  throw new Error(
    'Google returned no refresh token. That happens when the grant already exists — ' +
      'revoke this app at https://myaccount.google.com/permissions and run this again.',
  );
}

process.stdout.write(
  `\nAdd this line to .env:\n\nGOOGLE_DRIVE_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}\n\n` +
    'Then: node --env-file=.env --import tsx packages/grants/scripts/drive-walk-grants.ts --dry-run\n',
);
