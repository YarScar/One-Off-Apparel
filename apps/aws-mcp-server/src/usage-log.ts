import { prisma } from '@lp-ai/lib-db';

export interface UsageLogInput {
  toolName: string;
  input: unknown;
  output: unknown;
  durationMs: number;
  error?: string | undefined;
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
      },
    });
    // Also write to stdout so CloudWatch picks it up as a structured JSON log
    process.stdout.write(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        event: 'mcp_tool_execution',
        toolName: entry.toolName,
        durationMs: entry.durationMs,
        error: entry.error ?? null,
        input: entry.input,
        // Don't log full output to CloudWatch if it might be huge, just success/fail flag
        success: !entry.error,
      }) + '\n'
    );
  } catch (err) {
    process.stderr.write(
      `usage_log write failed for ${entry.toolName}: ${String(err)}\n`,
    );
  }
}
