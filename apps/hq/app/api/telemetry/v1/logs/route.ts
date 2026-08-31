import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { prisma } from '@lp-ai/lib-db';
import { checkTelemetryAuth } from '../../_lib/auth';
import { attrsToRecord, nanoToDate, stringAttr, type OtlpAttribute } from '../../_lib/otlp';

export const dynamic = 'force-dynamic';

interface OtlpLogRecord {
  timeUnixNano?: string;
  eventName?: string;
  attributes?: OtlpAttribute[];
  body?: { stringValue?: string };
}

interface OtlpLogsPayload {
  resourceLogs?: Array<{
    scopeLogs?: Array<{ logRecords?: OtlpLogRecord[] }>;
  }>;
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!(await checkTelemetryAuth(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let payload: OtlpLogsPayload;
  try {
    payload = (await req.json()) as OtlpLogsPayload;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  let stored = 0;
  for (const rl of payload.resourceLogs ?? []) {
    for (const sl of rl.scopeLogs ?? []) {
      for (const record of sl.logRecords ?? []) {
        const attrs = attrsToRecord(record.attributes);
        // `eventName` is the modern OTLP field; older/other exporters carry the same value
        // as an `event.name` attribute instead — check both rather than assume one.
        const eventName = record.eventName ?? stringAttr(attrs, 'event.name') ?? 'unknown';
        const occurredAt = nanoToDate(record.timeUnixNano);

        const sourceId = createHash('sha256')
          .update(JSON.stringify({ eventName, attrs, t: record.timeUnixNano, body: record.body }))
          .digest('hex');

        await prisma.claudeTelemetryEvent.upsert({
          where: { sourceId },
          create: {
            sourceId,
            eventName,
            occurredAt,
            userId: stringAttr(attrs, 'user.id'),
            userEmail: stringAttr(attrs, 'user.email'),
            organizationId: stringAttr(attrs, 'organization.id'),
            sessionId: stringAttr(attrs, 'session.id'),
            promptId: stringAttr(attrs, 'prompt.id'),
            toolUseId: stringAttr(attrs, 'tool_use_id'),
            attributes: { ...attrs, ...(record.body ? { body: record.body } : {}) },
          },
          update: {},
        });
        stored += 1;
      }
    }
  }

  return NextResponse.json({ status: 'ok', stored });
}
