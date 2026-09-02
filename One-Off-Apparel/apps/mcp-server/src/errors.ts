export type ToolErrorCode =
  | 'entity_not_found'
  | 'no_records'
  | 'search_failed'
  | 'internal_error'
  | 'not_yet_implemented'
  // Not a failure — the tool needs a fact or a decision only the caller's conversation has (e.g.
  // which program, or which fiscal-sponsorship framing). Distinct from `no_records`/`entity_not_found`
  // because nothing is missing from the data; the caller just hasn't asked the person yet.
  | 'needs_input';

export interface ToolError {
  error: {
    code: ToolErrorCode;
    message: string;
    suggestions?: string[];
  };
}

export function toolError(
  code: ToolErrorCode,
  message: string,
  suggestions?: string[],
): ToolError {
  return suggestions
    ? { error: { code, message, suggestions } }
    : { error: { code, message } };
}

export function notImplemented(toolName: string): ToolError {
  return toolError(
    'not_yet_implemented',
    `${toolName} is scaffolded but not yet implemented. See docs/mcp-server-spec.md.`,
  );
}
