export type ToolErrorCode =
  | 'entity_not_found'
  | 'no_records'
  | 'search_failed'
  | 'internal_error'
  | 'not_yet_implemented'
  | 'cohort_not_supported';

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

export function cohortNotSupported(): ToolError {
  return toolError(
    'cohort_not_supported',
    'Cohort is no longer tracked as a queryable dimension. Please specify a program phase (Foundations / 101 / Lightspeed / LiftOff) and a date range instead — phase history comes from the Phase Completion tab.',
    [
      'Filter by current_phase (or phase) to scope to a program phase.',
      'Filter by start_date/end_date to scope to a time range.',
    ],
  );
}
