/**
 * RSA keypair loading + JWT sign/verify for MCP OAuth (Phase 23).
 *
 * Private key comes from env (`JWT_PRIVATE_KEY`, populated from
 * lp-internal/jwt-signing in production). Public key is derived from the
 * private key at startup and exported via /.well-known/jwks.json so resource
 * servers (incl. aws-mcp-server) can verify access tokens without a shared
 * secret.
 */

import { importPKCS8, exportJWK, SignJWT, jwtVerify, type JWK, type CryptoKey } from 'jose';
import { createPublicKey } from 'node:crypto';
import { loadEnv } from '@lp-ai/lib-config';

type KeyLike = CryptoKey;

const ALG = 'RS256';

let cachedPrivate: KeyLike | null = null;
let cachedPrivatePem: string | null = null;
let cachedJwks: { keys: JWK[] } | null = null;

async function loadPrivateKey(): Promise<KeyLike> {
  if (cachedPrivate && cachedPrivatePem) return cachedPrivate;
  const env = await loadEnv();
  if (!env.JWT_PRIVATE_KEY) {
    throw new Error('JWT_PRIVATE_KEY not set — required for OAuth on the MCP server');
  }
  // Allow PEM with literal \n escapes (Secrets Manager value sometimes lands that way)
  const pem = env.JWT_PRIVATE_KEY.includes('\\n')
    ? env.JWT_PRIVATE_KEY.replace(/\\n/g, '\n')
    : env.JWT_PRIVATE_KEY;
  cachedPrivatePem = pem;
  cachedPrivate = (await importPKCS8(pem, ALG)) as KeyLike;
  return cachedPrivate;
}

async function loadPublicKey(): Promise<KeyLike> {
  await loadPrivateKey(); // ensures cachedPrivatePem is populated
  // node's crypto can derive the public key from a private PEM directly
  return createPublicKey(cachedPrivatePem!) as unknown as KeyLike;
}

async function kid(): Promise<string> {
  const env = await loadEnv();
  return env.JWT_KID ?? 'lp-mcp-default';
}

export async function jwks(): Promise<{ keys: JWK[] }> {
  if (cachedJwks) return cachedJwks;
  const pubKey = await loadPublicKey();
  const jwk = await exportJWK(pubKey);
  jwk.alg = ALG;
  jwk.kid = await kid();
  jwk.use = 'sig';
  cachedJwks = { keys: [jwk] };
  return cachedJwks;
}

export interface TokenClaims {
  sub: string; // user email
  scope: string; // space-separated
  client_id: string; // OAuth client ID
}

export async function signAccessToken(
  claims: TokenClaims,
  opts: { issuer: string; audience: string; lifetimeS: number },
): Promise<string> {
  const privKey = await loadPrivateKey();
  return new SignJWT({ scope: claims.scope, client_id: claims.client_id })
    .setProtectedHeader({ alg: ALG, kid: await kid(), typ: 'JWT' })
    .setSubject(claims.sub)
    .setIssuer(opts.issuer)
    .setAudience(opts.audience)
    .setIssuedAt()
    .setExpirationTime(`${opts.lifetimeS}s`)
    .setJti(crypto.randomUUID())
    .sign(privKey);
}

export async function verifyAccessToken(
  token: string,
  opts: { issuer: string; audience: string },
): Promise<TokenClaims> {
  const pubKey = await loadPublicKey();
  const { payload } = await jwtVerify(token, pubKey, {
    issuer: opts.issuer,
    audience: opts.audience,
    algorithms: [ALG],
  });
  return {
    sub: payload.sub as string,
    scope: (payload['scope'] as string) ?? '',
    client_id: (payload['client_id'] as string) ?? '',
  };
}
