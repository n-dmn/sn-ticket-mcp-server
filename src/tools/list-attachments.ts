import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getTicketType } from '../ticket-types.js';
import { toToolError } from '../tool-error.js';
import type { AttachmentClient } from '../servicenow/attachments.js';

export function registerListAttachmentsTool(server: McpServer, deps: { attachments: AttachmentClient }): void {
  server.registerTool(
    'sn-list-attachments',
    {
      description: 'List existing attachments on a ServiceNow ticket',
      inputSchema: {
        ticket_type: z.string().describe('Ticket type key: inquiry, issue, service_request, or creq'),
        sys_id: z.string().describe('ServiceNow sys_id of the record')
      }
    },
    async ({ ticket_type, sys_id }) => {
      try {
        const type = getTicketType(ticket_type);
        const attachments = await deps.attachments.list(type.table, sys_id);
        return { content: [{ type: 'text', text: JSON.stringify(attachments) }] };
      } catch (error) {
        return toToolError(error, 'sn-list-attachments');
      }
    }
  );
}
