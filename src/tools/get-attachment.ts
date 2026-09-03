import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { toToolError } from '../tool-error.js';
import type { AttachmentClient } from '../servicenow/attachments.js';

export function registerGetAttachmentTool(server: McpServer, deps: { attachments: AttachmentClient }): void {
  server.registerTool(
    'sn-get-attachment',
    {
      description: "Fetch one attachment's content by its sys_id",
      inputSchema: {
        attachment_sys_id: z.string().describe('sys_id of the sys_attachment record')
      }
    },
    async ({ attachment_sys_id }) => {
      try {
        const content = await deps.attachments.getContent(attachment_sys_id);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                fileName: content.fileName,
                contentType: content.contentType,
                dataBase64: content.data.toString('base64')
              })
            }
          ]
        };
      } catch (error) {
        return toToolError(error, 'sn-get-attachment');
      }
    }
  );
}
