import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getTicketType, buildQuery } from '../ticket-types.js';
import { toToolError } from '../tool-error.js';
import type { ServiceNowClient } from '../servicenow/client.js';

export function registerSearchTicketsTool(server: McpServer, deps: { client: ServiceNowClient }): void {
  server.registerTool(
    'sn-search-tickets',
    {
      description: 'Search ServiceNow tickets of a given ticket_type using an encoded query',
      inputSchema: {
        ticket_type: z.string().describe('Ticket type key: inquiry, issue, service_request, or creq'),
        query: z.string().optional().describe('ServiceNow encoded query, e.g. active=true^priority=1'),
        limit: z.number().int().positive().max(100).optional(),
        offset: z.number().int().nonnegative().optional(),
        fields: z.array(z.string()).optional()
      }
    },
    async ({ ticket_type, query, limit, offset, fields }) => {
      try {
        const type = getTicketType(ticket_type);
        const records = await deps.client.query(type.table, {
          query: buildQuery(type, query),
          limit,
          offset,
          fields
        });
        return { content: [{ type: 'text', text: JSON.stringify(records) }] };
      } catch (error) {
        return toToolError(error);
      }
    }
  );
}
