import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getTicketType } from '../ticket-types.js';
import { toToolError } from '../tool-error.js';
import type { AttachmentClient } from '../servicenow/attachments.js';

export function registerUploadAttachmentTool(server: McpServer, deps: { attachments: AttachmentClient }): void {
  server.registerTool(
    'sn-upload-attachment',
    {
      description: 'Upload a file attachment to an existing ServiceNow ticket',
      inputSchema: {
        ticket_type: z.string().describe('Ticket type key: inquiry, issue, service_request, or creq'),
        sys_id: z.string().describe('ServiceNow sys_id of the record to attach to'),
        file_name: z.string(),
        content_type: z.string(),
        data_base64: z.string().describe('Base64-encoded file content')
      }
    },
    async ({ ticket_type, sys_id, file_name, content_type, data_base64 }) => {
      try {
        const type = getTicketType(ticket_type);
        const buffer = Buffer.from(data_base64, 'base64');
        const meta = await deps.attachments.upload(type.table, sys_id, file_name, content_type, buffer);
        return { content: [{ type: 'text', text: JSON.stringify(meta) }] };
      } catch (error) {
        return toToolError(error);
      }
    }
  );
}
