import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServiceNowClient } from './servicenow/client.js';
import type { AttachmentClient } from './servicenow/attachments.js';
import { registerListTicketTypesTool } from './tools/list-ticket-types.js';
import { registerSearchTicketsTool } from './tools/search-tickets.js';
import { registerGetTicketTool } from './tools/get-ticket.js';

export interface ServerDeps {
  client: ServiceNowClient;
  attachments: AttachmentClient;
}

export function buildServer(deps: ServerDeps): McpServer {
  const server = new McpServer({ name: 'sn-ticket-mcp-server', version: '0.1.0' });

  registerListTicketTypesTool(server);
  registerSearchTicketsTool(server, deps);
  registerGetTicketTool(server, deps);

  return server;
}
