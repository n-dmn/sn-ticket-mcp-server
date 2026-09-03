import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TokenManager } from './auth.js';
import { AuthError } from '../errors.js';
import type { ServiceNowConfig } from '../config.js';

const config: ServiceNowConfig = {
  instanceUrl: 'https://dev12345.service-now.com',
  tokenUrl: 'https://dev12345.service-now.com/oauth_token.do',
  clientId: 'client-id',
  clientSecret: 'client-secret',
  username: 'svc-account',
  password: 'svc-password'
};

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body)
  } as Response;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('TokenManager', () => {
  it('authenticates with a password grant when no token is cached', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 1800 })
    );
    const tokenManager = new TokenManager(config, fetchImpl);

    const token = await tokenManager.getAccessToken();

    expect(token).toBe('access-1');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(config.tokenUrl);
    const body = init.body as URLSearchParams;
    expect(body.get('grant_type')).toBe('password');
    expect(body.get('client_id')).toBe('client-id');
    expect(body.get('client_secret')).toBe('client-secret');
    expect(body.get('username')).toBe('svc-account');
    expect(body.get('password')).toBe('svc-password');
    expect(body.get('scope')).toBe('useraccount');
  });

  it('reuses a cached token that is not near expiry', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 1800 })
    );
    const tokenManager = new TokenManager(config, fetchImpl);

    await tokenManager.getAccessToken();
    const second = await tokenManager.getAccessToken();

    expect(second).toBe('access-1');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('refreshes the token via refresh_token grant once it is near expiry', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 60 }))
      .mockResolvedValueOnce(jsonResponse({ access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 1800 }));
    const tokenManager = new TokenManager(config, fetchImpl);

    await tokenManager.getAccessToken();
    vi.advanceTimersByTime(31_000);
    const second = await tokenManager.getAccessToken();

    expect(second).toBe('access-2');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const refreshBody = fetchImpl.mock.calls[1][1].body as URLSearchParams;
    expect(refreshBody.get('grant_type')).toBe('refresh_token');
    expect(refreshBody.get('refresh_token')).toBe('refresh-1');
  });

  it('falls back to a fresh password grant when refresh fails', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 60 }))
      .mockResolvedValueOnce(jsonResponse({ error: 'invalid_grant' }, false, 400))
      .mockResolvedValueOnce(jsonResponse({ access_token: 'access-3', refresh_token: 'refresh-3', expires_in: 1800 }));
    const tokenManager = new TokenManager(config, fetchImpl);

    await tokenManager.getAccessToken();
    vi.advanceTimersByTime(31_000);
    const third = await tokenManager.getAccessToken();

    expect(third).toBe('access-3');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const reauthBody = fetchImpl.mock.calls[2][1].body as URLSearchParams;
    expect(reauthBody.get('grant_type')).toBe('password');
  });

  it('throws an AuthError when the initial authentication request fails', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: 'invalid_client' }, false, 401));
    const tokenManager = new TokenManager(config, fetchImpl);

    await expect(tokenManager.getAccessToken()).rejects.toThrow(AuthError);
  });
});
