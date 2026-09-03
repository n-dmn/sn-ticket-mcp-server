import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getTicketType } from '../ticket-types.js';
import { toToolError } from '../tool-error.js';
import type { ServiceNowClient } from '../servicenow/client.js';

export function registerGetTicketTool(server: McpServer, deps: { client: ServiceNowClient }): void {
  server.registerTool(
    'sn-get-ticket',
    {
      description: 'Fetch a single ServiceNow ticket by ticket_type and sys_id',
      inputSchema: {
        ticket_type: z.string().describe('Ticket type key: inquiry, issue, service_request, or creq'),
        sys_id: z.string().describe('ServiceNow sys_id of the record')
      }
    },
    async ({ ticket_type, sys_id }) => {
      try {
        const type = getTicketType(ticket_type);
        const record = await deps.client.getRecord(type.table, sys_id);
        return { content: [{ type: 'text', text: JSON.stringify(record) }] };
      } catch (error) {
        return toToolError(error, 'sn-get-ticket');
      }
    }
  );
}
