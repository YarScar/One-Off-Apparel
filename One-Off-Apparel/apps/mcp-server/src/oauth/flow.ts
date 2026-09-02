/**
 * OAuth 2.0 authorization-code-with-PKCE flow handlers.
 *
 *   GET  /oauth/authorize       — start; redirect to Google
 *   GET  /oauth/google-callback — Google returns; we issue OUR auth code,
 *                                 redirect to client's redirect_uri
 *   POST /oauth/token           — exchange code or refresh for access JWT
 *
 * State management: we encode the client's authorize params + PKCE challenge
 * directly into the `state` we send to Google, via an unguessable temporary
 * key written to `oauth_authorization_codes` (with no `code` until the user
 * actually authenticates). This avoids needing a separate "pending" table.
 *
 * Refresh tokens are opaque (random 256-bit) and stored as
 * `oauth_refresh_tokens` rows; rotated on every use.
 */

import { prisma } from '@lp-ai/lib-db';
import { loadEnv } from '@lp-ai/lib-config';
import { randomBytes, randomUUID } from 'node:crypto';
import { exchangeGoogleCode, googleAuthorizeUrl, isAllowedDomain } from './google.js';
import { verifyPkce } from './pkce.js';
import { signAccessToken } from './jwks.js';

const ACCESS_TOKEN_LIFETIME_S = 60 * 60; // 1 hour
const REFRESH_TOKEN_LIFETIME_S = 60 * 60 * 24 * 30; // 30 days
const AUTH_CODE_LIFETIME_S = 60 * 5; // 5 minutes

interface AuthorizeParams {
  response_type: string;
  client_id: string;
  redirect_uri: string;
  scope?: string | undefined;
  state?: string | undefined;
  code_challenge: string;
  code_challenge_method: string;
}

function newOpaque(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Handle GET /oauth/authorize.
 * Returns a Location URL the caller should 302 to (either Google or the
 * client's redirect_uri with an error).
 */
export async function handleAuthorize(query: URLSearchParams): Promise<{
  status: number;
  redirect: string;
}> {
  const params: AuthorizeParams = {
    response_type: query.get('response_type') ?? '',
    client_id: query.get('client_id') ?? '',
    redirect_uri: query.get('redirect_uri') ?? '',
    scope: query.get('scope') ?? undefined,
    state: query.get('state') ?? undefined,
    code_challenge: query.get('code_challenge') ?? '',
    code_challenge_method: query.get('code_challenge_method') ?? '',
  };

  if (params.response_type !== 'code') {
    return clientErrorRedirect(params.redirect_uri, params.state, 'unsupported_response_type');
  }
  if (params.code_challenge_method !== 'S256') {
    return clientErrorRedirect(
      params.redirect_uri,
      params.state,
      'invalid_request',
      'code_challenge_method must be S256',
    );
  }
  if (!params.code_challenge) {
    return clientErrorRedirect(params.redirect_uri, params.state, 'invalid_request', 'missing code_challenge');
  }

  const client = await prisma.oAuthClient.findUnique({ where: { clientId: params.client_id } });
  if (!client) {
    return { status: 400, redirect: '' }; // unrecoverable; can't redirect to an unverified URI
  }
  if (!client.redirectUris.includes(params.redirect_uri)) {
    return { status: 400, redirect: '' };
  }

  // Stash the request parameters in a placeholder row (no user_email yet).
  // The Google callback resolves this and replaces it with a real code.
  const pendingId = randomUUID();
  await prisma.oAuthAuthorizationCode.create({
    data: {
      code: `pending_${pendingId}`,
      clientId: params.client_id,
      userEmail: '', // filled in after Google login
      redirectUri: params.redirect_uri,
      codeChallenge: params.code_challenge,
      scopes: params.scope?.split(/\s+/).filter(Boolean) ?? [],
      expiresAt: new Date(Date.now() + AUTH_CODE_LIFETIME_S * 1000),
    },
  });

  // `state` going to Google encodes the pendingId plus the client's own state.
  const ourState = `${pendingId}.${encodeURIComponent(params.state ?? '')}`;
  const googleUrl = await googleAuthorizeUrl(ourState);
  return { status: 302, redirect: googleUrl };
}

/**
 * Handle GET /oauth/google-callback.
 * Google returns ?code & ?state where state = pendingId.clientState.
 */
export async function handleGoogleCallback(query: URLSearchParams): Promise<{
  status: number;
  redirect: string;
  body?: string;
}> {
  const code = query.get('code');
  const state = query.get('state');
  if (!code || !state) {
    return { status: 400, redirect: '', body: 'missing code or state' };
  }
  const [pendingId, clientStateEncoded] = state.split('.');
  if (!pendingId) {
    return { status: 400, redirect: '', body: 'malformed state' };
  }
  const clientState = decodeURIComponent(clientStateEncoded ?? '');

  const pending = await prisma.oAuthAuthorizationCode.findUnique({
    where: { code: `pending_${pendingId}` },
  });
  if (!pending) {
    return { status: 400, redirect: '', body: 'expired or unknown authorization request' };
  }
  if (pending.expiresAt.getTime() < Date.now()) {
    await prisma.oAuthAuthorizationCode.delete({ where: { code: pending.code } });
    return { status: 400, redirect: '', body: 'authorization request expired' };
  }

  // Exchange Google code → identity
  const identity = await exchangeGoogleCode(code);
  if (!identity.emailVerified) {
    return { status: 403, redirect: '', body: 'Google email not verified' };
  }
  if (!(await isAllowedDomain(identity.email))) {
    return { status: 403, redirect: '', body: 'email domain not permitted' };
  }

  // Upsert mcp_users — first sign-in starts PENDING (no access).
  const user = await prisma.mcpUser.upsert({
    where: { email: identity.email.toLowerCase() },
    update: { lastLogin: new Date() },
    create: {
      email: identity.email.toLowerCase(),
      status: 'PENDING',
      roles: [],
      lastLogin: new Date(),
    },
  });

  if (user.status !== 'ACTIVE') {
    return clientErrorBody(
      user.status === 'PENDING'
        ? 'Your account is pending admin approval. An admin will be notified shortly.'
        : 'Your account is disabled. Contact an LP Internal AI admin.',
    );
  }

  // Replace the pending row with a real authorization code.
  const realCode = newOpaque();
  await prisma.$transaction([
    prisma.oAuthAuthorizationCode.delete({ where: { code: pending.code } }),
    prisma.oAuthAuthorizationCode.create({
      data: {
        code: realCode,
        clientId: pending.clientId,
        userEmail: user.email,
        redirectUri: pending.redirectUri,
        codeChallenge: pending.codeChallenge,
        scopes: pending.scopes,
        expiresAt: new Date(Date.now() + AUTH_CODE_LIFETIME_S * 1000),
      },
    }),
  ]);

  const params = new URLSearchParams({ code: realCode });
  if (clientState) params.set('state', clientState);
  return {
    status: 302,
    redirect: `${pending.redirectUri}?${params.toString()}`,
  };
}

/** Handle POST /oauth/token for both `authorization_code` and `refresh_token` grants. */
export async function handleToken(body: URLSearchParams): Promise<{
  status: number;
  json: Record<string, unknown>;
}> {
  const grant = body.get('grant_type');
  if (grant === 'authorization_code') return await tokenAuthorizationCode(body);
  if (grant === 'refresh_token') return await tokenRefresh(body);
  return { status: 400, json: { error: 'unsupported_grant_type' } };
}

async function tokenAuthorizationCode(body: URLSearchParams): Promise<{
  status: number;
  json: Record<string, unknown>;
}> {
  const code = body.get('code') ?? '';
  const clientId = body.get('client_id') ?? '';
  const codeVerifier = body.get('code_verifier') ?? '';
  const redirectUri = body.get('redirect_uri') ?? '';

  const fail = (msg: string) => {
    process.stdout.write(
      JSON.stringify({ lvl: 'warn', kind: 'token_auth_code', reason: msg, client_id: clientId, code_present: !!code, redirect_uri: redirectUri }) + '\n',
    );
    return { status: 400, json: { error: 'invalid_grant', error_description: msg } };
  };

  const row = await prisma.oAuthAuthorizationCode.findUnique({ where: { code } });
  if (!row) return fail('unknown code');
  if (row.usedAt) return fail('code already used');
  if (row.expiresAt.getTime() < Date.now()) return fail('code expired');
  if (row.clientId !== clientId) return fail('client_id mismatch');
  if (row.redirectUri !== redirectUri) return fail('redirect_uri mismatch');
  if (!verifyPkce(codeVerifier, row.codeChallenge)) return fail('PKCE check failed');

  // Atomically mark as used — prevents race condition where two requests
  // exchange the same code concurrently.
  const updated = await prisma.oAuthAuthorizationCode.updateMany({
    where: { code, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (updated.count === 0) return fail('code already used');

  return await issueTokens(row.userEmail, row.clientId, row.scopes);
}

async function tokenRefresh(body: URLSearchParams): Promise<{
  status: number;
  json: Record<string, unknown>;
}> {
  const refreshToken = body.get('refresh_token') ?? '';
  const clientId = body.get('client_id') ?? '';

  const row = await prisma.oAuthRefreshToken.findUnique({ where: { tokenId: refreshToken } });
  if (!row) return { status: 400, json: { error: 'invalid_grant', error_description: 'unknown refresh_token' } };
  if (row.revokedAt) return { status: 400, json: { error: 'invalid_grant', error_description: 'refresh_token revoked' } };
  if (row.expiresAt.getTime() < Date.now()) {
    return { status: 400, json: { error: 'invalid_grant', error_description: 'refresh_token expired' } };
  }
  if (row.clientId !== clientId) return { status: 400, json: { error: 'invalid_grant' } };

  // Check user is still ACTIVE — disabling is the kill-switch.
  const user = await prisma.mcpUser.findUnique({ where: { email: row.userEmail } });
  if (!user || user.status !== 'ACTIVE') {
    await prisma.oAuthRefreshToken.update({
      where: { tokenId: row.tokenId },
      data: { revokedAt: new Date() },
    });
    return { status: 400, json: { error: 'invalid_grant', error_description: 'account inactive' } };
  }

  // Rotate: revoke this one and issue a new pair.
  await prisma.oAuthRefreshToken.update({
    where: { tokenId: row.tokenId },
    data: { revokedAt: new Date() },
  });

  return await issueTokens(row.userEmail, row.clientId, []);
}

async function issueTokens(
  userEmail: string,
  clientId: string,
  scopes: string[],
): Promise<{ status: number; json: Record<string, unknown> }> {
  const env = await loadEnv();
  const issuer = env.MCP_OAUTH_ISSUER ?? 'https://mcp.launchpadinc.org';
  const audience = env.MCP_PUBLIC_URL ?? issuer;

  const accessToken = await signAccessToken(
    {
      sub: userEmail,
      scope: scopes.join(' '),
      client_id: clientId,
    },
    { issuer, audience, lifetimeS: ACCESS_TOKEN_LIFETIME_S },
  );

  const refreshTokenId = newOpaque();
  await prisma.oAuthRefreshToken.create({
    data: {
      tokenId: refreshTokenId,
      clientId,
      userEmail,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_LIFETIME_S * 1000),
    },
  });

  return {
    status: 200,
    json: {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_LIFETIME_S,
      refresh_token: refreshTokenId,
      scope: scopes.join(' '),
    },
  };
}

function clientErrorRedirect(
  redirectUri: string,
  state: string | undefined,
  error: string,
  description?: string,
): { status: number; redirect: string } {
  if (!redirectUri) return { status: 400, redirect: '' };
  const params = new URLSearchParams({ error });
  if (description) params.set('error_description', description);
  if (state) params.set('state', state);
  return { status: 302, redirect: `${redirectUri}?${params.toString()}` };
}

function clientErrorBody(message: string): { status: number; redirect: string; body: string } {
  return {
    status: 403,
    redirect: '',
    body: `<!doctype html><meta charset="utf-8"><title>LP Internal AI</title><style>body{font-family:system-ui;max-width:36rem;margin:4rem auto;padding:0 1rem;line-height:1.5;color:#333}</style><h1>LP Internal AI</h1><p>${message}</p>`,
  };
}
