import { loadEnv } from '@lp-ai/lib-config';

/**
 * Shared-secret check for the two OTLP ingestion routes. This endpoint is unauthenticated
 * at the NextAuth/middleware layer (Claude Code has no Google session to present), so it
 * verifies its own bearer token here instead — same pattern as the Notion webhook receiver.
 * Fails closed: an unset token means every request is rejected, not silently accepted.
 */
export async function checkTelemetryAuth(req: Request): Promise<boolean> {
  const env = await loadEnv();
  const expected = env.CLAUDE_TELEMETRY_SHARED_TOKEN;
  if (!expected) return false;
  const header = req.headers.get('authorization') ?? '';
  return header === `Bearer ${expected}`;
}
