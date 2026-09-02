import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { listTicketTypes } from '../ticket-types.js';

export function registerListTicketTypesTool(server: McpServer): void {
  server.registerTool(
    'sn-list-ticket-types',
    {
      description: 'List the ServiceNow ticket types configured on this server, with their fields',
      inputSchema: {}
    },
    async () => {
      return { content: [{ type: 'text', text: JSON.stringify(listTicketTypes()) }] };
    }
  );
}
