import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { prisma } from '@lp-ai/lib-db';
import { checkTelemetryAuth } from '../../_lib/auth';
import { attrsToRecord, nanoToDate, stringAttr, type OtlpAttribute } from '../../_lib/otlp';

export const dynamic = 'force-dynamic';

interface OtlpNumberDataPoint {
  attributes?: OtlpAttribute[];
  timeUnixNano?: string;
  asInt?: string | number;
  asDouble?: number;
}

interface OtlpMetric {
  name: string;
  unit?: string;
  sum?: { dataPoints?: OtlpNumberDataPoint[] };
  gauge?: { dataPoints?: OtlpNumberDataPoint[] };
}

interface OtlpMetricsPayload {
  resourceMetrics?: Array<{
    scopeMetrics?: Array<{ metrics?: OtlpMetric[] }>;
  }>;
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!(await checkTelemetryAuth(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let payload: OtlpMetricsPayload;
  try {
    payload = (await req.json()) as OtlpMetricsPayload;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  let stored = 0;
  for (const rm of payload.resourceMetrics ?? []) {
    for (const sm of rm.scopeMetrics ?? []) {
      for (const metric of sm.metrics ?? []) {
        const dataPoints = metric.sum?.dataPoints ?? metric.gauge?.dataPoints ?? [];
        for (const dp of dataPoints) {
          const attrs = attrsToRecord(dp.attributes);
          const value = dp.asDouble ?? (dp.asInt !== undefined ? Number(dp.asInt) : 0);
          const recordedAt = nanoToDate(dp.timeUnixNano);

          // Hashing the raw data point (not a generated id) is what makes a retried/re-sent
          // export upsert into the same row instead of double-counting — see CLAUDE.md's
          // sync safety rule; this is the same discipline applied to a push endpoint.
          const sourceId = createHash('sha256')
            .update(JSON.stringify({ name: metric.name, unit: metric.unit, attrs, value, t: dp.timeUnixNano }))
            .digest('hex');

          await prisma.claudeTelemetryMetric.upsert({
            where: { sourceId },
            create: {
              sourceId,
              metricName: metric.name,
              value,
              unit: metric.unit ?? null,
              recordedAt,
              userId: stringAttr(attrs, 'user.id'),
              userEmail: stringAttr(attrs, 'user.email'),
              organizationId: stringAttr(attrs, 'organization.id'),
              sessionId: stringAttr(attrs, 'session.id'),
              attributes: attrs,
            },
            update: {},
          });
          stored += 1;
        }
      }
    }
  }

  return NextResponse.json({ status: 'ok', stored });
}
