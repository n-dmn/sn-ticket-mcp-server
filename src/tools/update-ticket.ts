import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getTicketType } from '../ticket-types.js';
import { toToolError } from '../tool-error.js';
import type { ServiceNowClient } from '../servicenow/client.js';

export function registerUpdateTicketTool(server: McpServer, deps: { client: ServiceNowClient }): void {
  server.registerTool(
    'sn-update-ticket',
    {
      description: 'Update fields on an existing ServiceNow ticket',
      inputSchema: {
        ticket_type: z.string().describe('Ticket type key: inquiry, issue, service_request, or creq'),
        sys_id: z.string().describe('ServiceNow sys_id of the record'),
        fields: z.record(z.string(), z.unknown()).describe('Field name/value pairs to update')
      }
    },
    async ({ ticket_type, sys_id, fields }) => {
      try {
        const type = getTicketType(ticket_type);
        const updated = await deps.client.updateRecord(type.table, sys_id, fields);
        return { content: [{ type: 'text', text: JSON.stringify(updated) }] };
      } catch (error) {
        return toToolError(error);
      }
    }
  );
}
