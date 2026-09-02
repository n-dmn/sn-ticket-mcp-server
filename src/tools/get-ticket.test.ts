import { describe, it, expect, vi } from 'vitest';
import { createTestClient } from './test-helpers.js';
import type { ServiceNowClient } from '../servicenow/client.js';
import type { AttachmentClient } from '../servicenow/attachments.js';

describe('sn-get-ticket tool', () => {
  it('fetches a record by ticket_type and sys_id', async () => {
    const getRecord = vi.fn().mockResolvedValue({ sys_id: 'a1', short_description: 'Test' });
    const { client, cleanup } = await createTestClient({
      client: { getRecord } as unknown as ServiceNowClient,
      attachments: {} as unknown as AttachmentClient
    });

    try {
      const result = await client.callTool({ name: 'sn-get-ticket', arguments: { ticket_type: 'creq', sys_id: 'a1' } });

      expect(result.isError).toBeFalsy();
      expect(getRecord).toHaveBeenCalledWith('change_request', 'a1');
      const content = result.content as { type: string; text: string }[];
      expect(JSON.parse(content[0].text)).toEqual({ sys_id: 'a1', short_description: 'Test' });
    } finally {
      await cleanup();
    }
  });

  it('returns a validation_error for an unknown ticket_type without calling the client', async () => {
    const getRecord = vi.fn();
    const { client, cleanup } = await createTestClient({
      client: { getRecord } as unknown as ServiceNowClient,
      attachments: {} as unknown as AttachmentClient
    });

    try {
      const result = await client.callTool({ name: 'sn-get-ticket', arguments: { ticket_type: 'bogus', sys_id: 'a1' } });

      expect(result.isError).toBe(true);
      expect(getRecord).not.toHaveBeenCalled();
    } finally {
      await cleanup();
    }
  });
});
