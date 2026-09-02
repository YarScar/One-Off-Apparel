import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@lp-ai/lib-db';
import { auth } from '../../../../auth';

export const dynamic = 'force-dynamic';

/**
 * The request body, parsed rather than cast. It was
 * `const body = await request.json().catch(() => ({}))` — an `any` — followed by
 * `body as { action?: string }` and a manual `includes` check, so the cast asserted a
 * shape nothing had verified. Same 400 and same message; the enum now does the check the
 * `includes` was doing by hand.
 */
const ActionRequestSchema = z.object({ action: z.enum(['approve', 'reject']) });

interface RouteParams {
  params: Promise<{
    id: string;
  }>;
}

export async function GET(request: Request, { params }: RouteParams): Promise<NextResponse> {
  const { id } = await params;
  try {
    const job = await prisma.awsResourceJob.findUnique({
      where: { id },
    });
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }
    return NextResponse.json(job);
  } catch (err) {
    process.stderr.write(`GET /api/aws-jobs/${id} error: ${err instanceof Error ? err.message : String(err)}\n`);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: RouteParams): Promise<NextResponse> {
  const { id } = await params;
  try {
    const session = await auth();
    const approverEmail = session?.user?.email;
    if (!approverEmail) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const raw: unknown = await request.json().catch(() => null);
    const parsed = ActionRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid action. Must be approve or reject' }, { status: 400 });
    }
    const { action } = parsed.data;

    const job = await prisma.awsResourceJob.findUnique({
      where: { id },
    });

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    const newStatus = action === 'approve' ? 'APPROVED' : 'REJECTED';
    const updatedJob = await prisma.awsResourceJob.update({
      where: { id },
      data: {
        status: newStatus,
        approver: approverEmail,
      },
    });

    // Write structured JSON audit log to stdout for security auditing
    process.stdout.write(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        event: 'aws_job_governance_action',
        jobId: id,
        action: action.toUpperCase(),
        developer: job.developer,
        resourceType: job.resourceType,
        actionType: job.actionType,
        approver: approverEmail,
      }) + '\n'
    );

    return NextResponse.json(updatedJob);
  } catch (err) {
    process.stderr.write(`POST /api/aws-jobs/${id} error: ${err instanceof Error ? err.message : String(err)}\n`);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
