/**
 * Bearer-token verification middleware for /mcp.
 *
 * Two accepted paths:
 *  1. JWT issued by our /oauth/token endpoint (human-initiated calls via
 *     Anthropic Console). Returns the authenticated user identity.
 *  2. Static SYNC_SECRET — preserved for service-to-service callers
 *     (EventBridge → MCP / internal scripts). Returns a synthetic
 *     `_service` user.
 *
 * Tools then check canCallTool() against the user's roles. Service callers
 * bypass per-tool ACL (they are trusted system-to-system).
 */

import { loadEnv } from '@lp-ai/lib-config';
import { prisma } from '@lp-ai/lib-db';
import { verifyAccessToken } from './oauth/jwks.js';

export type CallerIdentity =
  | { kind: 'user'; email: string; roles: string[]; clientId: string }
  | { kind: 'service' };

export async function authenticateBearer(
  authHeader: string | undefined,
): Promise<CallerIdentity | null> {
  if (!authHeader) return null;
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const token = m[1]!.trim();

  const env = await loadEnv();

  // Path 2 first (cheap, no DB hit) — service-to-service bearer.
  if (env.SYNC_SECRET && token === env.SYNC_SECRET) {
    return { kind: 'service' };
  }

  // Path 1: try to verify as a JWT.
  const issuer = env.MCP_OAUTH_ISSUER ?? 'https://mcp.launchpadinc.org';
  const audience = env.MCP_PUBLIC_URL ?? issuer;
  try {
    const claims = await verifyAccessToken(token, { issuer, audience });
    const user = await prisma.mcpUser.findUnique({ where: { email: claims.sub } });
    if (!user) return null;
    if (user.status !== 'ACTIVE') return null;
    return { kind: 'user', email: user.email, roles: user.roles, clientId: claims.client_id };
  } catch {
    return null;
  }
}
