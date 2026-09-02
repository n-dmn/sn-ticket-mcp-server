import { describe, it, expect } from 'vitest';
import { loadConfig } from './config.js';

const baseEnv = {
  SERVICENOW_INSTANCE_URL: 'https://dev12345.service-now.com',
  SERVICENOW_CLIENT_ID: 'client-id',
  SERVICENOW_CLIENT_SECRET: 'client-secret',
  SERVICENOW_USERNAME: 'svc-account',
  SERVICENOW_PASSWORD: 'svc-password'
};

describe('loadConfig', () => {
  it('loads config from environment variables with sensible defaults', () => {
    const config = loadConfig(baseEnv);

    expect(config.port).toBe(3000);
    expect(config.serviceNow.instanceUrl).toBe('https://dev12345.service-now.com');
    expect(config.serviceNow.tokenUrl).toBe('https://dev12345.service-now.com/oauth_token.do');
    expect(config.serviceNow.clientId).toBe('client-id');
    expect(config.serviceNow.clientSecret).toBe('client-secret');
    expect(config.serviceNow.username).toBe('svc-account');
    expect(config.serviceNow.password).toBe('svc-password');
  });

  it('respects an explicit PORT and SERVICENOW_TOKEN_URL override', () => {
    const config = loadConfig({
      ...baseEnv,
      PORT: '8080',
      SERVICENOW_TOKEN_URL: 'https://custom-token-host/token'
    });

    expect(config.port).toBe(8080);
    expect(config.serviceNow.tokenUrl).toBe('https://custom-token-host/token');
  });

  it('strips a trailing slash from SERVICENOW_INSTANCE_URL', () => {
    const config = loadConfig({ ...baseEnv, SERVICENOW_INSTANCE_URL: 'https://dev12345.service-now.com/' });

    expect(config.serviceNow.instanceUrl).toBe('https://dev12345.service-now.com');
  });

  it('throws a descriptive error when a required variable is missing', () => {
    const { SERVICENOW_CLIENT_ID, ...rest } = baseEnv;

    expect(() => loadConfig(rest)).toThrow('Missing required environment variable: SERVICENOW_CLIENT_ID');
  });
});
