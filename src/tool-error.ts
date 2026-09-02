import { ValidationError, ServiceNowApiError, AuthError } from './errors.js';

export interface ToolErrorResult {
  [x: string]: unknown;
  content: { type: 'text'; text: string }[];
  isError: true;
}

export function toToolError(error: unknown): ToolErrorResult {
  if (error instanceof ValidationError) {
    return { content: [{ type: 'text', text: `validation_error: ${error.message}` }], isError: true };
  }
  if (error instanceof ServiceNowApiError) {
    return {
      content: [{ type: 'text', text: `servicenow_api_error (${error.status}): ${error.message}` }],
      isError: true
    };
  }
  if (error instanceof AuthError) {
    return { content: [{ type: 'text', text: `auth_error: ${error.message}` }], isError: true };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: 'text', text: `internal_error: ${message}` }], isError: true };
}
