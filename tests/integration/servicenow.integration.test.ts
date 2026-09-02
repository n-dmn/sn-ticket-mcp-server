import { describe, it, expect, beforeAll } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { TokenManager } from '../../src/servicenow/auth.js';
import { ServiceNowClient } from '../../src/servicenow/client.js';
import { TICKET_TYPES } from '../../src/ticket-types.js';

const shouldRun = process.env.RUN_SN_INTEGRATION_TESTS === 'true';

describe.skipIf(!shouldRun)('ServiceNow dev instance integration', () => {
  let client: ServiceNowClient;

  beforeAll(() => {
    const config = loadConfig();
    const tokenManager = new TokenManager(config.serviceNow);
    client = new ServiceNowClient(config.serviceNow, tokenManager);
  });

  it('authenticates and queries each configured ticket-type table without error', async () => {
    for (const type of Object.values(TICKET_TYPES)) {
      const records = await client.query(type.table, { limit: 1 });
      expect(Array.isArray(records)).toBe(true);
    }
  });

  it('creates, reads, and updates a change_request end-to-end for the creq type', async () => {
    const creq = TICKET_TYPES.creq;

    const created = await client.createRecord(creq.table, {
      short_description: 'sn-ticket-mcp-server integration test'
    });
    expect(created.sys_id).toBeTruthy();

    const fetched = await client.getRecord(creq.table, created.sys_id as string);
    expect(fetched.short_description).toBe('sn-ticket-mcp-server integration test');

    const updated = await client.updateRecord(creq.table, created.sys_id as string, {
      short_description: 'sn-ticket-mcp-server integration test (updated)'
    });
    expect(updated.short_description).toBe('sn-ticket-mcp-server integration test (updated)');
  });
});
