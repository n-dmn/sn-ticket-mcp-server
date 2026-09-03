import express from 'express';
import cors from 'cors';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { buildServer, type ServerDeps } from './server.js';

export function createApp(deps: ServerDeps): express.Express {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));

  app.use((req, _res, next) => {
    const sessionId = req.header('mcp-session-id') ?? '(none)';
    console.log(`[mcp] ${req.method} ${req.originalUrl} session=${sessionId}`);
    next();
  });

  const transports = new Map<string, StreamableHTTPServerTransport>();

  app.post('/mcp', async (req, res) => {
    try {
      const sessionId = req.header('mcp-session-id');
      let transport = sessionId ? transports.get(sessionId) : undefined;

      if (!transport && isInitializeRequest(req.body)) {
        const server = buildServer(deps);
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (newSessionId: string) => {
            console.log(`[mcp] session initialized: ${newSessionId}`);
            transports.set(newSessionId, transport as StreamableHTTPServerTransport);
          }
        });
        transport.onclose = () => {
          const sid = transport?.sessionId;
          if (sid) {
            console.log(`[mcp] session closed: ${sid}`);
            transports.delete(sid);
          }
        };
        await server.connect(transport);
      }

      if (!transport) {
        console.warn(`[mcp] rejecting POST /mcp: no active session and body is not an initialize request`);
        res.status(400).json({ error: 'No active session and request is not an initialize request' });
        return;
      }

      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error('[mcp] error handling POST /mcp:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
      }
    }
  });

  app.get('/mcp', async (req, res) => {
    try {
      const sessionId = req.header('mcp-session-id');
      const transport = sessionId ? transports.get(sessionId) : undefined;
      if (!transport) {
        console.warn(`[mcp] rejecting GET /mcp: unknown session ${sessionId ?? '(none)'}`);
        res.status(400).json({ error: 'Unknown session' });
        return;
      }
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error('[mcp] error handling GET /mcp:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
      }
    }
  });

  app.delete('/mcp', async (req, res) => {
    try {
      const sessionId = req.header('mcp-session-id');
      const transport = sessionId ? transports.get(sessionId) : undefined;
      if (!transport) {
        console.warn(`[mcp] rejecting DELETE /mcp: unknown session ${sessionId ?? '(none)'}`);
        res.status(400).json({ error: 'Unknown session' });
        return;
      }
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error('[mcp] error handling DELETE /mcp:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
      }
    }
  });

  app.use((req, res) => {
    console.warn(`[mcp] no route matched: ${req.method} ${req.originalUrl}`);
    res.status(404).json({ error: `Not Found: ${req.method} ${req.originalUrl}` });
  });

  return app;
}
