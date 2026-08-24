import crypto from 'node:crypto';
import { loadEnv } from '@lp-ai/lib-config';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
const JWT_GRANT = 'urn:ietf:params:oauth:grant-type:jwt-bearer';

interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

let cachedServiceAccount: ServiceAccount | null = null;

async function getServiceAccount(): Promise<ServiceAccount> {
  if (cachedServiceAccount) return cachedServiceAccount;
  const env = await loadEnv();
  const raw = env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON not set');
  // Stored base64-encoded (same convention as the Google connectors).
  const json = Buffer.from(raw, 'base64').toString('utf-8');
  cachedServiceAccount = JSON.parse(json) as ServiceAccount;
  return cachedServiceAccount;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/**
 * Mint a calendar.readonly access token for a specific user via domain-wide
 * delegation: the service account signs a JWT with `sub` = the user's email
 * (impersonation) and exchanges it. Requires the DWD grant + Calendar API in the
 * `lp-internal-ai` Google project — see docs/setup/05-google-connectors.md.
 */
async function getAccessTokenForUser(userEmail: string): Promise<string> {
  const sa = await getServiceAccount();
  const now = Math.floor(Date.now() / 1000);
  const tokenUri = sa.token_uri ?? TOKEN_URL;

  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: sa.client_email,
    sub: userEmail, // impersonated user (DWD)
    scope: CALENDAR_SCOPE,
    aud: tokenUri,
    iat: now,
    exp: now + 3600,
  };

  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsigned);
  const assertion = `${unsigned}.${base64url(signer.sign(sa.private_key))}`;

  const res = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: JWT_GRANT, assertion }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google token exchange failed for ${userEmail}: ${String(res.status)} — ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error(`No access_token returned for ${userEmail}`);
  return data.access_token;
}

export interface CalendarEvent {
  id: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  organizer?: { email?: string; displayName?: string; self?: boolean };
  creator?: { email?: string };
  attendees?: Array<{
    email?: string;
    displayName?: string;
    organizer?: boolean;
    resource?: boolean;
    responseStatus?: string;
  }>;
}

/**
 * List events on a user's primary calendar within [timeMinIso, timeMaxIso],
 * impersonating that user. Single (recurrence-expanded) events, sorted by start.
 */
export async function listEventsForUser(
  userEmail: string,
  timeMinIso: string,
  timeMaxIso: string,
): Promise<CalendarEvent[]> {
  const token = await getAccessTokenForUser(userEmail);
  const params = new URLSearchParams({
    timeMin: timeMinIso,
    timeMax: timeMaxIso,
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '15',
  });
  const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Calendar events.list failed for ${userEmail}: ${String(res.status)} — ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as { items?: CalendarEvent[] };
  return data.items ?? [];
}
