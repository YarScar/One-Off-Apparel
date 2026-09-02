import { NextResponse } from 'next/server';
import { prisma } from '@lp-ai/lib-db';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: 'ok', ts: new Date().toISOString() });
  } catch (err) {
    return NextResponse.json(
      { status: 'error', error: err instanceof Error ? err.message : String(err) },
      { status: 503 },
    );
  }
}
