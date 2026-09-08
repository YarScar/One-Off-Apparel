/**
 * JWT verification + SYNC_SECRET fallback for the AWS MCP server.
 *
 * This server is a "validation-only" resource — it does NOT issue tokens.
 * Tokens are issued by mcp-server (mcp.launchpadinc.org) and validated here
 * by fetching the JWKS from /.well-known/jwks.json on that server.
 *
 * Service callers (with SYNC_SECRET) keep working for backwards compatibility.
 */

import { loadEnv } from '@lp-ai/lib-config';
import { prisma } from '@lp-ai/lib-db';
import { jwtVerify, createRemoteJWKSet, type JWTVerifyGetKey } from 'jose';

export type CallerIdentity =
  | { kind: 'user'; email: string; roles: string[] }
  | { kind: 'service' };

let cachedJwks: JWTVerifyGetKey | null = null;

async function getRemoteJwks(): Promise<JWTVerifyGetKey> {
  if (cachedJwks) return cachedJwks;
  const env = await loadEnv();
  const issuer = env.MCP_OAUTH_ISSUER ?? 'https://mcp.launchpadinc.org';
  cachedJwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  return cachedJwks;
}

export async function authenticateBearer(
  authHeader: string | undefined,
): Promise<CallerIdentity | null> {
  if (!authHeader) return null;
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const token = m[1]!.trim();

  const env = await loadEnv();

  if (env.SYNC_SECRET && token === env.SYNC_SECRET) {
    return { kind: 'service' };
  }

  const issuer = env.MCP_OAUTH_ISSUER ?? 'https://mcp.launchpadinc.org';
  const audience = env.AWS_MCP_PUBLIC_URL ?? 'https://aws-mcp.launchpadinc.org';
  try {
    const jwks = await getRemoteJwks();
    const { payload } = await jwtVerify(token, jwks, {
      issuer,
      audience: [audience, env.MCP_PUBLIC_URL ?? issuer], // accept tokens with either audience
      algorithms: ['RS256'],
    });
    const email = payload.sub as string;
    const user = await prisma.mcpUser.findUnique({ where: { email } });
    if (!user) return null;
    if (user.status !== 'ACTIVE') return null;
    return { kind: 'user', email: user.email, roles: user.roles };
  } catch {
    return null;
  }
}
