import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildServer, type ServerDeps } from '../server.js';

export async function createTestClient(deps: ServerDeps): Promise<{ client: Client; cleanup: () => Promise<void> }> {
  const server = buildServer(deps);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.1' });

  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

  return {
    client,
    cleanup: async () => {
      await client.close();
      await server.close();
    }
  };
}
