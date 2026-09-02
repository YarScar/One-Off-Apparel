import type { CallToolResult, GetPromptResult } from '@modelcontextprotocol/sdk/types.js';

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

/**
 * The `registerTool` annotations shared by every read-only grant tool. Introduced under #24 (WP
 * #333) after a review found this exact object hand-copied across 8 of 9 grant tool registrations —
 * `openWorldHint` is the one field that legitimately varies (Drive-backed tools set it `true`; see
 * {@link READ_ONLY_OPEN_WORLD_ANNOTATIONS}).
 */
export const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

/** {@link READ_ONLY_ANNOTATIONS} for a tool that calls out to an external system (e.g. Drive). */
export const READ_ONLY_OPEN_WORLD_ANNOTATIONS = {
  ...READ_ONLY_ANNOTATIONS,
  openWorldHint: true,
} as const;

/**
 * Flattens a prompt's message list into the single `instructions` string every `skill_*` tool
 * returns. Extracted under #11 (WP #333) — the map/join below was hand-copied identically across
 * `skill-grant-writing.ts`, `-prospecting.ts`, `-sourcing-evaluation.ts`, `skill-board-reporting.ts`,
 * and `skill-finance-audit.ts`; each of those keeps its own args mapping, `build*Messages` call, and
 * `note` string, since those genuinely differ per skill.
 */
export function flattenMessages(messages: GetPromptResult['messages']): string {
  return messages
    .map((m) => {
      const text =
        typeof m.content === 'string' ? m.content : m.content.type === 'text' ? m.content.text : '';
      return `[${m.role.toUpperCase()}]\n${text}`;
    })
    .join('\n\n---\n\n');
}

export function parseStr(raw: Record<string, unknown>, key: string): string | undefined {
  return typeof raw[key] === 'string' ? (raw[key] as string) : undefined;
}

export function parseNum(raw: Record<string, unknown>, key: string): number | undefined {
  return typeof raw[key] === 'number' ? (raw[key] as number) : undefined;
}

/**
 * A string filter, with blank treated as absent, and trimmed.
 *
 * Lives beside `parseStr` because every tool that domain-checks a filter needs it, not
 * just `query_enrollment` where it started. `parseStr` alone returns `''` for a blank
 * value present in the payload, and a blank must not reach either the query or the
 * domain check: as a query predicate it is a literal column match on the branches that
 * read the value directly and a `{ not: null }` on the branches that test truthiness —
 * one payload, two answers — and as a domain check it errors on the empty string, which
 * is not a value the caller asked to match.
 *
 * Trimming is part of the same thing: ` 'Completed' ` is the value with the same intent,
 * and an untrimmed one matches nothing while reporting itself applied.
 *
 * Treating blank as absent still has to be *reported* where a tool echoes its filters —
 * see `blankFilters` in `tools/query-enrollment.ts`. Silently dropping it is the same
 * unscoping from the other direction.
 */
export function filterStr(raw: Record<string, unknown>, key: string): string | undefined {
  const trimmed = parseStr(raw, key)?.trim();
  return trimmed === undefined || trimmed === '' ? undefined : trimmed;
}
