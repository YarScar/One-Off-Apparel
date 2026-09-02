export type ToolErrorCode =
  | 'validation_error'
  | 'execution_failed'
  | 'unauthorized'
  | 'approval_required'
  | 'job_not_found'
  | 'internal_error';

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
