import { describe, it, expect, vi } from 'vitest';
import { createTestClient } from './test-helpers.js';
import type { ServiceNowClient } from '../servicenow/client.js';
import type { AttachmentClient } from '../servicenow/attachments.js';

describe('sn-get-attachment tool', () => {
  it('returns file name, content type, and base64-encoded data', async () => {
    const getContent = vi.fn().mockResolvedValue({
      data: Buffer.from('abc'),
      contentType: 'text/plain',
      fileName: 'log.txt'
    });
    const { client, cleanup } = await createTestClient({
      client: {} as unknown as ServiceNowClient,
      attachments: { getContent } as unknown as AttachmentClient
    });

    try {
      const result = await client.callTool({
        name: 'sn-get-attachment',
        arguments: { attachment_sys_id: 'att1' }
      });

      expect(result.isError).toBeFalsy();
      expect(getContent).toHaveBeenCalledWith('att1');
      const content = result.content as { type: string; text: string }[];
      expect(JSON.parse(content[0].text)).toEqual({
        fileName: 'log.txt',
        contentType: 'text/plain',
        dataBase64: Buffer.from('abc').toString('base64')
      });
    } finally {
      await cleanup();
    }
  });

  it('returns a servicenow_api_error tool result when the download fails', async () => {
    const { ServiceNowApiError } = await import('../errors.js');
    const getContent = vi.fn().mockRejectedValue(new ServiceNowApiError('download failed', 500, {}));
    const { client, cleanup } = await createTestClient({
      client: {} as unknown as ServiceNowClient,
      attachments: { getContent } as unknown as AttachmentClient
    });

    try {
      const result = await client.callTool({
        name: 'sn-get-attachment',
        arguments: { attachment_sys_id: 'att1' }
      });

      expect(result.isError).toBe(true);
      const content = result.content as { type: string; text: string }[];
      expect(content[0].text).toContain('servicenow_api_error');
    } finally {
      await cleanup();
    }
  });
});
