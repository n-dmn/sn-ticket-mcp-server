import { describe, it, expect } from 'vitest';
import { toToolError } from './tool-error.js';
import { ValidationError, ServiceNowApiError, AuthError } from './errors.js';

describe('toToolError', () => {
  it('maps a ValidationError to a validation_error tool result', () => {
    const result = toToolError(new ValidationError('unknown ticket_type: bogus'));
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('validation_error: unknown ticket_type: bogus');
  });

  it('maps a ServiceNowApiError to a servicenow_api_error tool result including the status', () => {
    const result = toToolError(new ServiceNowApiError('request failed', 404, {}));
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('servicenow_api_error (404): request failed');
  });

  it('maps an AuthError to an auth_error tool result', () => {
    const result = toToolError(new AuthError('token refresh failed'));
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('auth_error: token refresh failed');
  });

  it('maps an unrecognized error to an internal_error tool result', () => {
    const result = toToolError(new Error('unexpected'));
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('internal_error: unexpected');
  });
});
