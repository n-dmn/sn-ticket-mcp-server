import 'dotenv/config';
import { loadConfig } from './config.js';
import { TokenManager } from './servicenow/auth.js';
import { ServiceNowClient } from './servicenow/client.js';
import { AttachmentClient } from './servicenow/attachments.js';
import { createApp } from './app.js';

const config = loadConfig();
const tokenManager = new TokenManager(config.serviceNow);
const client = new ServiceNowClient(config.serviceNow, tokenManager);
const attachments = new AttachmentClient(config.serviceNow, tokenManager);

const app = createApp({ client, attachments });

process.on('unhandledRejection', (reason) => {
  console.error('[mcp] unhandled rejection:', reason);
});
process.on('uncaughtException', (error) => {
  console.error('[mcp] uncaught exception:', error);
});

app.listen(config.port, () => {
  console.log(`sn-ticket-mcp-server listening on port ${config.port}, POST/GET/DELETE http://localhost:${config.port}/mcp`);
});
