/**
 * Google OAuth identity delegation. Reuses the existing HQ OAuth client
 * (AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET) — operator must add the MCP server's
 * google-callback URL to that client's Authorized Redirect URIs.
 *
 * Flow:
 *   /oauth/authorize         — store the client's auth params in a "pending"
 *                              row, redirect user to Google with `state` =
 *                              pending id
 *   /oauth/google-callback   — Google calls back; we exchange the code for
 *                              an ID token, extract email, verify domain,
 *                              upsert mcp_users, then redirect user back to
 *                              the OAuth client's redirect_uri with our own
 *                              auth code.
 */

import { loadEnv } from '@lp-ai/lib-config';

export interface GoogleIdentity {
  email: string;
  emailVerified: boolean;
  name?: string | undefined;
}

interface IdTokenPayload {
  email: string;
  email_verified: boolean;
  name?: string;
}

function googleCallbackUrl(issuer: string): string {
  return `${issuer}/oauth/google-callback`;
}

export async function googleAuthorizeUrl(state: string): Promise<string> {
  const env = await loadEnv();
  const issuer = env.MCP_OAUTH_ISSUER ?? 'https://mcp.launchpadinc.org';
  if (!env.AUTH_GOOGLE_ID) throw new Error('AUTH_GOOGLE_ID not set');

  const params = new URLSearchParams({
    client_id: env.AUTH_GOOGLE_ID,
    redirect_uri: googleCallbackUrl(issuer),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'online',
    prompt: 'select_account',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeGoogleCode(code: string): Promise<GoogleIdentity> {
  const env = await loadEnv();
  const issuer = env.MCP_OAUTH_ISSUER ?? 'https://mcp.launchpadinc.org';
  if (!env.AUTH_GOOGLE_ID || !env.AUTH_GOOGLE_SECRET) {
    throw new Error('Google OAuth client credentials not configured');
  }

  const params = new URLSearchParams({
    code,
    client_id: env.AUTH_GOOGLE_ID,
    client_secret: env.AUTH_GOOGLE_SECRET,
    redirect_uri: googleCallbackUrl(issuer),
    grant_type: 'authorization_code',
  });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google token exchange failed: ${res.status} ${text}`);
  }
  const json = (await res.json()) as { id_token?: string; access_token?: string };
  if (!json.id_token) throw new Error('Google did not return id_token');

  // Decode the ID token (we don't need to verify signature here — Google's
  // TLS-protected response is the trust anchor for the code exchange).
  const [, payloadB64] = json.id_token.split('.');
  if (!payloadB64) throw new Error('Malformed id_token');
  const padded = payloadB64 + '='.repeat((4 - (payloadB64.length % 4)) % 4);
  const payload = JSON.parse(
    Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8'),
  ) as IdTokenPayload;

  return {
    email: payload.email,
    emailVerified: payload.email_verified,
    name: payload.name,
  };
}

export async function isAllowedDomain(email: string): Promise<boolean> {
  const env = await loadEnv();
  const raw = env.AUTH_ALLOWED_DOMAIN ?? 'launchpadphilly.org';
  // Comma-separated list of allowed domains. Single-value config still works.
  const allowed = raw
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  const lower = email.toLowerCase();
  return allowed.some((d) => lower.endsWith(`@${d}`));
}
