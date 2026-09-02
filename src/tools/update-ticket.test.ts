import { describe, it, expect, vi } from 'vitest';
import { createTestClient } from './test-helpers.js';
import type { ServiceNowClient } from '../servicenow/client.js';
import type { AttachmentClient } from '../servicenow/attachments.js';

describe('sn-update-ticket tool', () => {
  it('updates fields on an existing record', async () => {
    const updateRecord = vi.fn().mockResolvedValue({ sys_id: 'a1', state: '2' });
    const { client, cleanup } = await createTestClient({
      client: { updateRecord } as unknown as ServiceNowClient,
      attachments: {} as unknown as AttachmentClient
    });

    try {
      const result = await client.callTool({
        name: 'sn-update-ticket',
        arguments: { ticket_type: 'creq', sys_id: 'a1', fields: { state: '2' } }
      });

      expect(result.isError).toBeFalsy();
      expect(updateRecord).toHaveBeenCalledWith('change_request', 'a1', { state: '2' });
      const content = result.content as { type: string; text: string }[];
      expect(JSON.parse(content[0].text)).toEqual({ sys_id: 'a1', state: '2' });
    } finally {
      await cleanup();
    }
  });

  it('returns a validation_error for an unknown ticket_type without calling the client', async () => {
    const updateRecord = vi.fn();
    const { client, cleanup } = await createTestClient({
      client: { updateRecord } as unknown as ServiceNowClient,
      attachments: {} as unknown as AttachmentClient
    });

    try {
      const result = await client.callTool({
        name: 'sn-update-ticket',
        arguments: { ticket_type: 'bogus', sys_id: 'a1', fields: { state: '2' } }
      });

      expect(result.isError).toBe(true);
      expect(updateRecord).not.toHaveBeenCalled();
    } finally {
      await cleanup();
    }
  });
});
