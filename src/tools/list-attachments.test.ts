import { describe, it, expect, vi } from 'vitest';
import { createTestClient } from './test-helpers.js';
import type { ServiceNowClient } from '../servicenow/client.js';
import type { AttachmentClient } from '../servicenow/attachments.js';

describe('sn-list-attachments tool', () => {
  it('lists attachments for a resolved table and sys_id', async () => {
    const list = vi.fn().mockResolvedValue([
      { sysId: 'att1', fileName: 'log.txt', contentType: 'text/plain', sizeBytes: 3 }
    ]);
    const { client, cleanup } = await createTestClient({
      client: {} as unknown as ServiceNowClient,
      attachments: { list } as unknown as AttachmentClient
    });

    try {
      const result = await client.callTool({
        name: 'sn-list-attachments',
        arguments: { ticket_type: 'service_request', sys_id: 'rec1' }
      });

      expect(result.isError).toBeFalsy();
      expect(list).toHaveBeenCalledWith('sc_request', 'rec1');
      const content = result.content as { type: string; text: string }[];
      expect(JSON.parse(content[0].text)).toEqual([
        { sysId: 'att1', fileName: 'log.txt', contentType: 'text/plain', sizeBytes: 3 }
      ]);
    } finally {
      await cleanup();
    }
  });

  it('returns a validation_error for an unknown ticket_type without calling the client', async () => {
    const list = vi.fn();
    const { client, cleanup } = await createTestClient({
      client: {} as unknown as ServiceNowClient,
      attachments: { list } as unknown as AttachmentClient
    });

    try {
      const result = await client.callTool({
        name: 'sn-list-attachments',
        arguments: { ticket_type: 'bogus', sys_id: 'rec1' }
      });

      expect(result.isError).toBe(true);
      expect(list).not.toHaveBeenCalled();
    } finally {
      await cleanup();
    }
  });
});
