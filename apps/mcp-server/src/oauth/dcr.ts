/**
 * Dynamic Client Registration (RFC 7591).
 * Anthropic Console POSTs here on first connect; we mint a client_id and
 * persist the registration so subsequent authorize+token calls can resolve it.
 */

import { prisma } from '@lp-ai/lib-db';
import { randomUUID } from 'node:crypto';

// Allowed redirect URI domains. Loopback is always allowed for development.
// Extend this list as new OAuth clients are registered.
const ALLOWED_REDIRECT_DOMAINS = new Set([
  'claude.ai',
  'console.anthropic.com',
  'launchpadphilly.org',
  'launchpadinc.org',
]);

export interface DcrRequest {
  client_name?: string | undefined;
  redirect_uris: string[];
  grant_types?: string[] | undefined;
  response_types?: string[] | undefined;
  token_endpoint_auth_method?: string | undefined;
}

export interface DcrResponse {
  client_id: string;
  client_name: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: string;
  client_id_issued_at: number;
}

export async function registerClient(req: DcrRequest): Promise<DcrResponse> {
  process.stdout.write(
    JSON.stringify({ lvl: 'info', kind: 'dcr', client_name: req.client_name, redirect_uris: req.redirect_uris }) + '\n',
  );
  if (!Array.isArray(req.redirect_uris) || req.redirect_uris.length === 0) {
    throw new Error('invalid_redirect_uri');
  }
  // Enforce HTTPS on redirect URIs (loopback is allowed for development)
  for (const uri of req.redirect_uris) {
    try {
      const u = new URL(uri);
      const isLoopback = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
      if (u.protocol !== 'https:' && !isLoopback) {
        throw new Error(`invalid_redirect_uri: ${uri} must be https`);
      }
      if (!isLoopback) {
        const domain = u.hostname.split('.').slice(-2).join('.');
        if (!ALLOWED_REDIRECT_DOMAINS.has(domain) && !ALLOWED_REDIRECT_DOMAINS.has(u.hostname)) {
          throw new Error(`invalid_redirect_uri: domain ${u.hostname} is not allowed`);
        }
      }
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('invalid_redirect_uri')) throw e;
      throw new Error(`invalid_redirect_uri: ${uri}`);
    }
  }

  const clientId = `cli_${randomUUID()}`;
  await prisma.oAuthClient.create({
    data: {
      clientId,
      clientName: req.client_name ?? 'unnamed',
      redirectUris: req.redirect_uris,
    },
  });

  return {
    client_id: clientId,
    client_name: req.client_name ?? 'unnamed',
    redirect_uris: req.redirect_uris,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none', // public clients with PKCE
    client_id_issued_at: Math.floor(Date.now() / 1000),
  };
}
