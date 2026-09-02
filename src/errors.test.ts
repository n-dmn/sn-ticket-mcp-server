import { describe, it, expect } from 'vitest';
import { ValidationError, ServiceNowApiError, AuthError } from './errors.js';

describe('error types', () => {
  it('ValidationError carries a message and the correct name', () => {
    const error = new ValidationError('unknown ticket_type: bogus');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ValidationError');
    expect(error.message).toBe('unknown ticket_type: bogus');
  });

  it('ServiceNowApiError carries status and body', () => {
    const error = new ServiceNowApiError('request failed', 404, { error: { message: 'Not Found' } });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ServiceNowApiError');
    expect(error.status).toBe(404);
    expect(error.body).toEqual({ error: { message: 'Not Found' } });
  });

  it('AuthError carries a message and the correct name', () => {
    const error = new AuthError('token refresh failed');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('AuthError');
    expect(error.message).toBe('token refresh failed');
  });
});
