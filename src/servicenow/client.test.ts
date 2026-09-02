import { describe, it, expect, vi } from 'vitest';
import { ServiceNowClient } from './client.js';
import { ServiceNowApiError } from '../errors.js';
import type { ServiceNowConfig } from '../config.js';
import type { TokenManager } from './auth.js';

const config: ServiceNowConfig = {
  instanceUrl: 'https://dev12345.service-now.com',
  tokenUrl: 'https://dev12345.service-now.com/oauth_token.do',
  clientId: 'client-id',
  clientSecret: 'client-secret',
  username: 'svc-account',
  password: 'svc-password'
};

function fakeTokenManager(): TokenManager {
  return { getAccessToken: vi.fn().mockResolvedValue('test-token') } as unknown as TokenManager;
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, text: async () => JSON.stringify(body) } as Response;
}

describe('ServiceNowClient', () => {
  it('queries a table with sysparm_query, limit, offset, and fields', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ result: [{ sys_id: 'a1' }] }));
    const client = new ServiceNowClient(config, fakeTokenManager(), fetchImpl);

    const records = await client.query('change_request', {
      query: 'active=true',
      limit: 10,
      offset: 5,
      fields: ['number', 'short_description']
    });

    expect(records).toEqual([{ sys_id: 'a1' }]);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(
      'https://dev12345.service-now.com/api/now/table/change_request?sysparm_query=active%3Dtrue&sysparm_limit=10&sysparm_offset=5&sysparm_fields=number%2Cshort_description'
    );
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBe('Bearer test-token');
  });

  it('gets a single record by sys_id', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ result: { sys_id: 'a1', number: 'CHG0001' } }));
    const client = new ServiceNowClient(config, fakeTokenManager(), fetchImpl);

    const record = await client.getRecord('change_request', 'a1');

    expect(record).toEqual({ sys_id: 'a1', number: 'CHG0001' });
    expect(fetchImpl.mock.calls[0][0]).toBe('https://dev12345.service-now.com/api/now/table/change_request/a1');
  });

  it('creates a record with a JSON body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ result: { sys_id: 'new1' } }));
    const client = new ServiceNowClient(config, fakeTokenManager(), fetchImpl);

    const record = await client.createRecord('change_request', { short_description: 'Test' });

    expect(record).toEqual({ sys_id: 'new1' });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://dev12345.service-now.com/api/now/table/change_request');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ short_description: 'Test' }));
  });

  it('updates a record by sys_id with PATCH', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ result: { sys_id: 'a1', state: '2' } }));
    const client = new ServiceNowClient(config, fakeTokenManager(), fetchImpl);

    const record = await client.updateRecord('change_request', 'a1', { state: '2' });

    expect(record).toEqual({ sys_id: 'a1', state: '2' });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://dev12345.service-now.com/api/now/table/change_request/a1');
    expect(init.method).toBe('PATCH');
  });

  it('throws a ServiceNowApiError with status and body on a non-ok response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: { message: 'Not Found' } }, false, 404));
    const client = new ServiceNowClient(config, fakeTokenManager(), fetchImpl);

    await expect(client.getRecord('change_request', 'missing')).rejects.toThrow(ServiceNowApiError);
    try {
      await client.getRecord('change_request', 'missing');
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceNowApiError);
      expect((error as ServiceNowApiError).status).toBe(404);
      expect((error as ServiceNowApiError).body).toEqual({ error: { message: 'Not Found' } });
      expect((error as ServiceNowApiError).message).toBe('ServiceNow API request failed with status 404: Not Found');
    }
  });

  it('falls back to a generic message when the response has no ServiceNow error envelope', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, false, 500));
    const client = new ServiceNowClient(config, fakeTokenManager(), fetchImpl);

    try {
      await client.getRecord('change_request', 'missing');
      throw new Error('expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceNowApiError);
      expect((error as ServiceNowApiError).message).toBe('ServiceNow API request failed with status 500');
    }
  });
});
