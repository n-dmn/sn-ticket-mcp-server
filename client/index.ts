import 'dotenv/config';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { ToolLoopAgent, stepCountIs, type ModelMessage } from 'ai';
import { createAzure } from '@ai-sdk/azure';
import { createMCPClient } from '@ai-sdk/mcp';

const MCP_SERVER_URL = process.env.MCP_SERVER_URL ?? 'http://localhost:3005/mcp';
const OPEN_AI_BASE_URI = requireEnv('OPEN_AI_BASE_URI');
const OPEN_AI_API_VERSION = requireEnv('OPEN_AI_API_VERSION');
const OPENAI_API_KEY = requireEnv('OPENAI_API_KEY');
const OPEN_AI_DEPLOYMENT_ID = requireEnv('OPEN_AI_DEPLOYMENT_ID');
const REASONING_MODEL = (process.env.REASONING_MODEL ?? 'true') !== 'false';
const TEMPERATURE = 0.2;
const MAX_STEPS = 8;
const MAX_OUTPUT_TOKENS = 2048;

const AGENT_INSTRUCTIONS = `You are a helpful assistant for working with ServiceNow tickets via the
sn-ticket-mcp-server MCP tools (list ticket types, search tickets, get/create/update tickets,
and manage attachments). Use the tools whenever a request needs live ServiceNow data or changes.
Be concise and confirm any create/update action you took.`;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const azure = createAzure({
  useDeploymentBasedUrls: true,
  baseURL: `${OPEN_AI_BASE_URI}/v1/responses?api-version=${OPEN_AI_API_VERSION}`,
  apiKey: OPENAI_API_KEY,
  headers: {
    'Ocp-Apim-Subscription-Key': OPENAI_API_KEY
  }
});

async function runTurn(messages: ModelMessage[]): Promise<string> {
  const mcpClient = await createMCPClient({
    transport: { type: 'http', url: MCP_SERVER_URL }
  });

  const agent = new ToolLoopAgent({
    model: azure(OPEN_AI_DEPLOYMENT_ID),
    instructions: AGENT_INSTRUCTIONS,
    tools: await mcpClient.tools(),
    stopWhen: stepCountIs(MAX_STEPS),
    ...(REASONING_MODEL ? {} : { temperature: TEMPERATURE }),
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    allowSystemInMessages: true,
    onFinish: async () => {
      await mcpClient.close();
    }
  });

  const result = await agent.generate({ messages });
  messages.push(...result.responseMessages);
  return result.text;
}

async function main(): Promise<void> {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  const messages: ModelMessage[] = [];

  console.log(`sn-ticket-mcp-server chat client (MCP server: ${MCP_SERVER_URL})`);
  console.log('Type your request, or "exit" to quit.\n');

  try {
    while (true) {
      const input = await rl.question('> ');
      const trimmed = input.trim();
      if (trimmed === '' ) continue;
      if (trimmed.toLowerCase() === 'exit') break;

      messages.push({ role: 'user', content: trimmed });

      try {
        const text = await runTurn(messages);
        console.log(`\n${text}\n`);
      } catch (error) {
        console.error(`\nRequest failed against ${MCP_SERVER_URL}:`);
        console.error(error);
        if (error instanceof Error && error.cause) {
          console.error('Caused by:', error.cause);
        }
        console.error(`Is the MCP server running at ${MCP_SERVER_URL}?\n`);
        messages.pop();
      }
    }
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  console.error('Fatal error:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
