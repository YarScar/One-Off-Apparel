import { NextResponse } from 'next/server';
import { prisma } from '@lp-ai/lib-db';
import { auth } from '../../../auth';
import { parseSpendReportCsv } from './_lib/parse';

export const dynamic = 'force-dynamic';

/**
 * Manual upload of Anthropic's Team-plan spend-report CSV (Settings > Analytics > Export
 * spend report on claude.ai — Owner/Primary Owner only). Auth is the normal NextAuth
 * session gate (this route isn't in middleware.ts's PUBLIC_PATHS) — a person is already
 * signed into HQ when they use this, no separate credential needed.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const session = await auth();
  const devBypass = process.env.NODE_ENV !== 'production' && process.env.HQ_DEV_NO_AUTH === 'true';
  const uploadedByEmail = session?.user?.email ?? (devBypass ? 'dev-local@launchpadphilly.org' : undefined);
  if (!uploadedByEmail) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!file || typeof file === 'string') {
    return NextResponse.json({ error: 'no_file' }, { status: 400 });
  }

  const coveredFromStr = form?.get('covered_from');
  const coveredToStr = form?.get('covered_to');
  const coveredFrom = typeof coveredFromStr === 'string' && coveredFromStr ? new Date(coveredFromStr) : null;
  const coveredTo = typeof coveredToStr === 'string' && coveredToStr ? new Date(coveredToStr) : null;

  if (coveredFrom && coveredTo) {
    const latestUpload = await prisma.claudeCsvUpload.findFirst({
      orderBy: { uploadedAt: 'desc' },
      select: { coveredFrom: true, coveredTo: true },
    });
    if (latestUpload?.coveredFrom && latestUpload.coveredTo && coveredFrom <= latestUpload.coveredTo) {
      const fmt = (d: Date): string => d.toISOString().slice(0, 10);
      return NextResponse.json(
        {
          error: 'overlapping_range',
          message:
            `This export covers ${fmt(coveredFrom)} → ${fmt(coveredTo)}, which overlaps the most recently ` +
            `uploaded export (covers ${fmt(latestUpload.coveredFrom)} → ${fmt(latestUpload.coveredTo)}). ` +
            `Upload an export that starts after ${fmt(latestUpload.coveredTo)}.`,
        },
        { status: 409 },
      );
    }
  }

  const csvText = await file.text();
  let rows: ReturnType<typeof parseSpendReportCsv>;
  try {
    rows = parseSpendReportCsv(csvText);
  } catch (err) {
    return NextResponse.json(
      { error: 'parse_failed', message: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }

  if (rows.length === 0) {
    return NextResponse.json({ error: 'empty_file' }, { status: 400 });
  }

  const upload = await prisma.claudeCsvUpload.create({
    data: {
      uploadedByEmail,
      originalFilename: file.name,
      coveredFrom,
      coveredTo,
      rowCount: rows.length,
      rows: {
        create: rows.map((r) => ({
          userEmail: r.userEmail,
          accountUuid: r.accountUuid,
          productType: r.productType,
          model: r.model,
          requestCount: r.requestCount,
          promptTokens: r.promptTokens,
          completionTokens: r.completionTokens,
          costUsd: r.costUsd,
          grossSpendUsd: r.grossSpendUsd,
          rowData: r.rowData,
        })),
      },
    },
  });

  return NextResponse.json({ status: 'ok', uploadId: upload.id, rowCount: rows.length });
}
