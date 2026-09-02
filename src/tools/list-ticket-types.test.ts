import { describe, it, expect } from 'vitest';
import { createTestClient } from './test-helpers.js';
import type { ServiceNowClient } from '../servicenow/client.js';
import type { AttachmentClient } from '../servicenow/attachments.js';

describe('sn-list-ticket-types tool', () => {
  it('returns the four configured ticket types', async () => {
    const { client, cleanup } = await createTestClient({
      client: {} as unknown as ServiceNowClient,
      attachments: {} as unknown as AttachmentClient
    });

    try {
      const result = await client.callTool({ name: 'sn-list-ticket-types', arguments: {} });
      expect(result.isError).toBeFalsy();
      const content = result.content as { type: string; text: string }[];
      const types = JSON.parse(content[0].text) as { key: string }[];
      expect(types.map(type => type.key).sort()).toEqual(['creq', 'inquiry', 'issue', 'service_request']);
    } finally {
      await cleanup();
    }
  });
});
