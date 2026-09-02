import { describe, it, expect, vi } from 'vitest';
import { AttachmentClient } from './attachments.js';
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

describe('AttachmentClient', () => {
  it('uploads a file and returns its attachment metadata', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ result: { sys_id: 'att1', file_name: 'log.txt', content_type: 'text/plain', size_bytes: '3' } })
    );
    const client = new AttachmentClient(config, fakeTokenManager(), fetchImpl);
    const data = Buffer.from('abc');

    const meta = await client.upload('change_request', 'rec1', 'log.txt', 'text/plain', data);

    expect(meta).toEqual({ sysId: 'att1', fileName: 'log.txt', contentType: 'text/plain', sizeBytes: 3 });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(
      'https://dev12345.service-now.com/api/now/attachment/file?table_name=change_request&table_sys_id=rec1&file_name=log.txt'
    );
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('text/plain');
    expect(init.body).toBe(data);
  });

  it('lists attachments for a record', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        result: [{ sys_id: 'att1', file_name: 'log.txt', content_type: 'text/plain', size_bytes: '3' }]
      })
    );
    const client = new AttachmentClient(config, fakeTokenManager(), fetchImpl);

    const list = await client.list('change_request', 'rec1');

    expect(list).toEqual([{ sysId: 'att1', fileName: 'log.txt', contentType: 'text/plain', sizeBytes: 3 }]);
    expect(fetchImpl.mock.calls[0][0]).toBe(
      'https://dev12345.service-now.com/api/now/table/sys_attachment?sysparm_query=table_name%3Dchange_request%5Etable_sys_id%3Drec1'
    );
  });

  it('fetches attachment metadata and binary content together', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ result: { sys_id: 'att1', file_name: 'log.txt', content_type: 'text/plain', size_bytes: '3' } })
      )
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        arrayBuffer: async () => new Uint8Array(Buffer.from('abc')).buffer
      } as unknown as Response);
    const client = new AttachmentClient(config, fakeTokenManager(), fetchImpl);

    const content = await client.getContent('att1');

    expect(content.fileName).toBe('log.txt');
    expect(content.contentType).toBe('text/plain');
    expect(Buffer.from(content.data).toString('utf8')).toBe('abc');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1][0]).toBe('https://dev12345.service-now.com/api/now/attachment/att1/file');
  });

  it('throws a ServiceNowApiError when the file download fails', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ result: { sys_id: 'att1', file_name: 'log.txt', content_type: 'text/plain', size_bytes: '3' } })
      )
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'boom' } as unknown as Response);
    const client = new AttachmentClient(config, fakeTokenManager(), fetchImpl);

    await expect(client.getContent('att1')).rejects.toThrow(ServiceNowApiError);
  });
});
