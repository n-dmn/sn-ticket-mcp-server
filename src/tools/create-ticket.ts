import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getTicketType, validateRequiredFields } from '../ticket-types.js';
import { toToolError } from '../tool-error.js';
import type { ServiceNowClient } from '../servicenow/client.js';

export function registerCreateTicketTool(server: McpServer, deps: { client: ServiceNowClient }): void {
  server.registerTool(
    'sn-create-ticket',
    {
      description: 'Create a new ServiceNow ticket for the given ticket_type',
      inputSchema: {
        ticket_type: z.string().describe('Ticket type key: inquiry, issue, service_request, or creq'),
        fields: z.record(z.string(), z.unknown()).describe('Field name/value pairs to set on the new record'),
        context: z
          .record(z.string(), z.unknown())
          .optional()
          .describe('Optional free-form caller/application context, written verbatim to a work note')
      }
    },
    async ({ ticket_type, fields, context }) => {
      try {
        const type = getTicketType(ticket_type);
        validateRequiredFields(type, fields);

        const payload: Record<string, unknown> = { ...fields };
        if (type.discriminatorField && type.discriminatorValue !== undefined) {
          payload[type.discriminatorField] = type.discriminatorValue;
        }

        const created = await deps.client.createRecord(type.table, payload);

        if (context) {
          await deps.client.updateRecord(type.table, created.sys_id as string, {
            work_notes: `context: ${JSON.stringify(context)}`
          });
        }

        return { content: [{ type: 'text', text: JSON.stringify(created) }] };
      } catch (error) {
        return toToolError(error);
      }
    }
  );
}
