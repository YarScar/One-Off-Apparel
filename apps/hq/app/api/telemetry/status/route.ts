import { NextResponse } from 'next/server';
import { prisma } from '@lp-ai/lib-db';

export const dynamic = 'force-dynamic';

/**
 * "Is the pipeline actually receiving data" check, distinct from "is the server up" —
 * a `/api/health`-style check would still say healthy if nobody's Claude Code ever
 * reaches this endpoint. The threshold is day-scale, not minute-scale, on purpose:
 * nights and weekends are legitimate silence, not a broken pipeline, so this only flags
 * a gap long enough to rule that out.
 */
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export async function GET(): Promise<NextResponse> {
  const [lastMetric, lastEvent] = await Promise.all([
    prisma.claudeTelemetryMetric.findFirst({ orderBy: { receivedAt: 'desc' }, select: { receivedAt: true } }),
    prisma.claudeTelemetryEvent.findFirst({ orderBy: { receivedAt: 'desc' }, select: { receivedAt: true } }),
  ]);

  const lastReceivedAt = [lastMetric?.receivedAt, lastEvent?.receivedAt]
    .filter((d): d is Date => d !== undefined)
    .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

  const ageMs = lastReceivedAt ? Date.now() - lastReceivedAt.getTime() : null;
  const status = lastReceivedAt === null ? 'no_data_yet' : ageMs! > STALE_AFTER_MS ? 'stale' : 'healthy';

  return NextResponse.json({
    status,
    last_received_at: lastReceivedAt?.toISOString() ?? null,
    stale_after_seconds: STALE_AFTER_MS / 1000,
  });
}
