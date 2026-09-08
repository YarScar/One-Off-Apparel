import { prisma } from '@lp-ai/lib-db';

export interface UsageLogInput {
  toolName: string;
  input: unknown;
  output: unknown;
  durationMs: number;
  error?: string | undefined;
  callerEmail?: string | undefined;
}

export async function logUsage(entry: UsageLogInput): Promise<void> {
  try {
    await prisma.usageLog.create({
      data: {
        toolName: entry.toolName,
        inputJson: entry.input as object,
        outputJson: entry.output as object,
        durationMs: entry.durationMs,
        error: entry.error ?? null,
        anthropicUserEmail: entry.callerEmail ?? null,
      },
    });
  } catch (err) {
    process.stderr.write(
      `usage_log write failed for ${entry.toolName}: ${String(err)}\n`,
    );
  }
}
