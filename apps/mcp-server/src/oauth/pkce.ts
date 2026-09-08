/**
 * PKCE (RFC 7636) — S256 challenge verification.
 * Anthropic sends a code_verifier on the token request; we recompute the
 * challenge and compare to what they originally registered with the auth code.
 */

import { createHash } from 'node:crypto';

function base64UrlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

export function challengeFromVerifier(verifier: string): string {
  return base64UrlEncode(createHash('sha256').update(verifier).digest());
}

export function verifyPkce(verifier: string, expectedChallenge: string): boolean {
  if (!verifier || !expectedChallenge) return false;
  const got = challengeFromVerifier(verifier);
  // constant-time compare
  if (got.length !== expectedChallenge.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) {
    diff |= got.charCodeAt(i) ^ expectedChallenge.charCodeAt(i);
  }
  return diff === 0;
}
