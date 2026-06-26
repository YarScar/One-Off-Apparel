import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { logUsage } from './usage-log.js';
import { canCallTool, permissionDeniedError } from './permissions.js';
import type { CallerIdentity } from './auth.js';

// AsyncLocalStorage would be cleaner, but every MCP request is processed
// synchronously inside the transport handler so a module-level slot works.
let currentCaller: CallerIdentity | null = null;

export function setCurrentCaller(caller: CallerIdentity | null): void {
  currentCaller = caller;
}

export function getCurrentCallerEmail(): string | null {
  return currentCaller?.kind === 'user' ? currentCaller.email : null;
}

// Tools that service callers (SYNC_SECRET) are allowed to invoke.
// This scopes the blast radius if the secret leaks — skill tools and
// write-capable tools are excluded.
const SERVICE_ALLOWED_TOOLS = new Set([
  'get_student_info',
  'query_students',
  'query_outcomes',
  'query_enrollment',
  'query_certifications',
  'query_competency',
  'query_finances',
  'query_donors',
  'query_attendance',
  'query_employment',
  'query_postsecondary',
  'search_conversations',
  'search_by_person',
  'get_entity_brief',
  'get_finance_brief',
  'search_documents',
]);

export async function runTool(
  toolName: string,
  input: unknown,
  handler: () => Promise<unknown>,
): Promise<CallToolResult> {
  const start = Date.now();
  const caller = currentCaller;
  let output: unknown;
  let errorMessage: string | undefined;

  // Per-tool ACL — service callers are scoped to data-query tools only.
  if (caller && caller.kind === 'service' && !SERVICE_ALLOWED_TOOLS.has(toolName)) {
    const denied = permissionDeniedError(toolName);
    errorMessage = denied.message;
    output = { error: denied };
    const durationMs = Date.now() - start;
    void logUsage({
      toolName,
      input,
      output,
      durationMs,
      error: errorMessage,
      callerEmail: '_service',
    });
    return {
      content: [{ type: 'text', text: JSON.stringify(output) }],
      isError: true,
    };
  }

  if (caller && caller.kind === 'user' && !(await canCallTool(toolName, caller.roles))) {
    const denied = permissionDeniedError(toolName);
    errorMessage = denied.message;
    output = { error: denied };
    const durationMs = Date.now() - start;
    void logUsage({
      toolName,
      input,
      output,
      durationMs,
      error: errorMessage,
      callerEmail: caller.email,
    });
    return {
      content: [{ type: 'text', text: JSON.stringify(output) }],
      isError: true,
    };
  }

  try {
    output = await handler();
  } catch (err) {
    const rawMessage = err instanceof Error ? err.message : String(err);
    process.stderr.write(`tool error [${toolName}]: ${rawMessage}\n`);
    errorMessage = sanitizeErrorMessage(rawMessage);
    output = {
      error: {
        code: 'internal_error',
        message: errorMessage,
      },
    };
  }
  const durationMs = Date.now() - start;
  void logUsage({
    toolName,
    input,
    output,
    durationMs,
    error: errorMessage,
    callerEmail: caller?.kind === 'user' ? caller.email : '_service',
  });
  const result: CallToolResult = {
    content: [{ type: 'text', text: JSON.stringify(output) }],
  };
  if (errorMessage) result.isError = true;
  return result;
}

const SENSITIVE_PATTERNS = [
  /postgresql:\/\/[^\s]+/gi,
  /password[=:]\s*\S+/gi,
  /Bearer\s+\S+/gi,
  /sk-[a-zA-Z0-9]+/g,
];

function sanitizeErrorMessage(message: string): string {
  let sanitized = message;
  for (const pattern of SENSITIVE_PATTERNS) {
    sanitized = sanitized.replace(pattern, '[REDACTED]');
  }
  return sanitized;
}

export function parseStr(raw: Record<string, unknown>, key: string): string | undefined {
  return typeof raw[key] === 'string' ? (raw[key] as string) : undefined;
}

export function parseNum(raw: Record<string, unknown>, key: string): number | undefined {
  return typeof raw[key] === 'number' ? (raw[key] as number) : undefined;
}
