import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from './app.js';
import type { ServiceNowClient } from './servicenow/client.js';
import type { AttachmentClient } from './servicenow/attachments.js';

function testDeps() {
  return {
    client: {} as unknown as ServiceNowClient,
    attachments: {} as unknown as AttachmentClient
  };
}

describe('createApp', () => {
  it('completes an MCP initialize handshake over POST /mcp and returns a session id', async () => {
    const app = createApp(testDeps());

    const response = await request(app)
      .post('/mcp')
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json, text/event-stream')
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'test-client', version: '0.0.1' }
        }
      });

    expect(response.status).toBe(200);
    expect(response.headers['mcp-session-id']).toBeTruthy();
  });

  it('rejects a non-initialize request with no session id', async () => {
    const app = createApp(testDeps());

    const response = await request(app)
      .post('/mcp')
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json, text/event-stream')
      .send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });

    expect(response.status).toBe(400);
  });
});
