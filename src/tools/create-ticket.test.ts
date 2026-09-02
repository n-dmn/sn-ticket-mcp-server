import { describe, it, expect, vi } from 'vitest';
import { createTestClient } from './test-helpers.js';
import type { ServiceNowClient } from '../servicenow/client.js';
import type { AttachmentClient } from '../servicenow/attachments.js';

describe('sn-create-ticket tool', () => {
  it('creates a record, applying the discriminator field when the type has one', async () => {
    const createRecord = vi.fn().mockResolvedValue({ sys_id: 'new1', number: 'CS0001' });
    const { client, cleanup } = await createTestClient({
      client: { createRecord } as unknown as ServiceNowClient,
      attachments: {} as unknown as AttachmentClient
    });

    try {
      const result = await client.callTool({
        name: 'sn-create-ticket',
        arguments: { ticket_type: 'issue', fields: { short_description: 'Printer broken' } }
      });

      expect(result.isError).toBeFalsy();
      expect(createRecord).toHaveBeenCalledWith('sn_customerservice_case', {
        short_description: 'Printer broken',
        contact_type: 'issue'
      });
      const content = result.content as { type: string; text: string }[];
      expect(JSON.parse(content[0].text)).toEqual({ sys_id: 'new1', number: 'CS0001' });
    } finally {
      await cleanup();
    }
  });

  it('writes an optional context object verbatim to a work note after creation', async () => {
    const createRecord = vi.fn().mockResolvedValue({ sys_id: 'new1' });
    const updateRecord = vi.fn().mockResolvedValue({ sys_id: 'new1' });
    const { client, cleanup } = await createTestClient({
      client: { createRecord, updateRecord } as unknown as ServiceNowClient,
      attachments: {} as unknown as AttachmentClient
    });

    try {
      await client.callTool({
        name: 'sn-create-ticket',
        arguments: {
          ticket_type: 'creq',
          fields: { short_description: 'Deploy new firewall rule' },
          context: { calling_app: 'agent-ecosystem', requested_by: 'jane.doe' }
        }
      });

      expect(updateRecord).toHaveBeenCalledWith('change_request', 'new1', {
        work_notes: 'context: {"calling_app":"agent-ecosystem","requested_by":"jane.doe"}'
      });
    } finally {
      await cleanup();
    }
  });

  it('returns a validation_error when a required field is missing, without calling the client', async () => {
    const createRecord = vi.fn();
    const { client, cleanup } = await createTestClient({
      client: { createRecord } as unknown as ServiceNowClient,
      attachments: {} as unknown as AttachmentClient
    });

    try {
      const result = await client.callTool({
        name: 'sn-create-ticket',
        arguments: { ticket_type: 'creq', fields: {} }
      });

      expect(result.isError).toBe(true);
      const content = result.content as { type: string; text: string }[];
      expect(content[0].text).toContain('validation_error');
      expect(createRecord).not.toHaveBeenCalled();
    } finally {
      await cleanup();
    }
  });
});
