import { describe, it, expect, vi } from 'vitest';
import { createTestClient } from './test-helpers.js';
import type { ServiceNowClient } from '../servicenow/client.js';
import type { AttachmentClient } from '../servicenow/attachments.js';

describe('sn-upload-attachment tool', () => {
  it('decodes base64 data and uploads it against the resolved table', async () => {
    const upload = vi.fn().mockResolvedValue({ sysId: 'att1', fileName: 'log.txt', contentType: 'text/plain', sizeBytes: 3 });
    const { client, cleanup } = await createTestClient({
      client: {} as unknown as ServiceNowClient,
      attachments: { upload } as unknown as AttachmentClient
    });

    try {
      const result = await client.callTool({
        name: 'sn-upload-attachment',
        arguments: {
          ticket_type: 'creq',
          sys_id: 'rec1',
          file_name: 'log.txt',
          content_type: 'text/plain',
          data_base64: Buffer.from('abc').toString('base64')
        }
      });

      expect(result.isError).toBeFalsy();
      expect(upload).toHaveBeenCalledWith('change_request', 'rec1', 'log.txt', 'text/plain', Buffer.from('abc'));
      const content = result.content as { type: string; text: string }[];
      expect(JSON.parse(content[0].text)).toEqual({
        sysId: 'att1',
        fileName: 'log.txt',
        contentType: 'text/plain',
        sizeBytes: 3
      });
    } finally {
      await cleanup();
    }
  });

  it('returns a validation_error for an unknown ticket_type without calling the client', async () => {
    const upload = vi.fn();
    const { client, cleanup } = await createTestClient({
      client: {} as unknown as ServiceNowClient,
      attachments: { upload } as unknown as AttachmentClient
    });

    try {
      const result = await client.callTool({
        name: 'sn-upload-attachment',
        arguments: {
          ticket_type: 'bogus',
          sys_id: 'rec1',
          file_name: 'log.txt',
          content_type: 'text/plain',
          data_base64: 'YWJj'
        }
      });

      expect(result.isError).toBe(true);
      expect(upload).not.toHaveBeenCalled();
    } finally {
      await cleanup();
    }
  });
});
