import { describe, it, expect, vi } from 'vitest';
import { createTestClient } from './test-helpers.js';
import type { ServiceNowClient } from '../servicenow/client.js';
import type { AttachmentClient } from '../servicenow/attachments.js';

describe('sn-search-tickets tool', () => {
  it('resolves ticket_type to a table and passes the discriminator-combined query through', async () => {
    const query = vi.fn().mockResolvedValue([{ sys_id: 'a1' }]);
    const { client, cleanup } = await createTestClient({
      client: { query } as unknown as ServiceNowClient,
      attachments: {} as unknown as AttachmentClient
    });

    try {
      const result = await client.callTool({
        name: 'sn-search-tickets',
        arguments: { ticket_type: 'issue', query: 'active=true', limit: 5 }
      });

      expect(result.isError).toBeFalsy();
      expect(query).toHaveBeenCalledWith('sn_customerservice_case', {
        query: 'contact_type=issue^active=true',
        limit: 5,
        offset: undefined,
        fields: undefined
      });
      const content = result.content as { type: string; text: string }[];
      expect(JSON.parse(content[0].text)).toEqual([{ sys_id: 'a1' }]);
    } finally {
      await cleanup();
    }
  });

  it('returns a validation_error for an unknown ticket_type without calling the client', async () => {
    const query = vi.fn();
    const { client, cleanup } = await createTestClient({
      client: { query } as unknown as ServiceNowClient,
      attachments: {} as unknown as AttachmentClient
    });

    try {
      const result = await client.callTool({ name: 'sn-search-tickets', arguments: { ticket_type: 'bogus' } });

      expect(result.isError).toBe(true);
      const content = result.content as { type: string; text: string }[];
      expect(content[0].text).toContain('validation_error');
      expect(query).not.toHaveBeenCalled();
    } finally {
      await cleanup();
    }
  });
});
