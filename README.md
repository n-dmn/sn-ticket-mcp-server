# sn-ticket-mcp-server

An MCP (Model Context Protocol) server that exposes ServiceNow ticket
operations — search, get, create, update, and attachments — as tools,
over Streamable HTTP. It is a standalone Node.js + TypeScript service
with no LLM/agent logic of its own: every tool validates its arguments
and performs a deterministic ServiceNow REST call.

Four ticket types are supported out of the box: **Inquiry**, **Issue**
(CS Ticket), **Service Request**, and **CREQ** (Change Request). Adding
a new ticket type is a registry edit in `src/ticket-types.ts`, not a
code change to any tool.

See `docs/superpowers/specs/2026-09-02-sn-ticket-mcp-server-design.md`
for the full design rationale and `docs/superpowers/plans/2026-09-02-sn-ticket-mcp-server.md`
for the implementation plan this project was built from.

## Prerequisites

- Node.js >= 20
- A ServiceNow instance with an OAuth application (password grant)
  configured, plus a service account username/password

## Setup

```bash
npm install
cp .env.example .env
```

Fill in `.env` with your ServiceNow OAuth details:

| Variable | Required | Description |
|---|---|---|
| `PORT` | No (default `3000`) | HTTP port the server listens on |
| `SERVICENOW_INSTANCE_URL` | Yes | e.g. `https://devXXXXX.service-now.com` (no trailing slash) |
| `SERVICENOW_TOKEN_URL` | No (default `<instance>/oauth_token.do`) | Override the OAuth token endpoint |
| `SERVICENOW_CLIENT_ID` | Yes | OAuth application client ID |
| `SERVICENOW_CLIENT_SECRET` | Yes | OAuth application client secret |
| `SERVICENOW_USERNAME` | Yes | Service account username |
| `SERVICENOW_PASSWORD` | Yes | Service account password |

The server will fail to start with a clear error naming the first
missing required variable.

## Running the server

Development (auto-restart on change):

```bash
npm run dev
```

Production:

```bash
npm run build
npm start
```

On startup you should see `sn-ticket-mcp-server listening on port
3000` (or your configured `PORT`). The server exposes a single MCP
Streamable HTTP endpoint at `POST/GET/DELETE /mcp`; connect to it with
any MCP-compatible client.

No call is made to ServiceNow until a tool is actually invoked, so the
process starts and listens even with placeholder credentials.

## Testing

Unit tests (mocked ServiceNow responses, no network access):

```bash
npm test          # single run
npm run test:watch
```

Integration tests against a real ServiceNow dev instance are gated
behind an explicit opt-in and are **not** run by `npm test`:

```bash
RUN_SN_INTEGRATION_TESTS=true npm run test:integration
```

This requires real ServiceNow credentials in the environment. It
authenticates, queries each configured ticket-type table, and runs a
full create/read/update cycle against the `change_request` table.

## Tools

| Tool | Purpose |
|---|---|
| `sn-list-ticket-types` | List the configured ticket types and their fields |
| `sn-search-tickets` | Search tickets of a given `ticket_type` by an encoded query |
| `sn-get-ticket` | Fetch one ticket by `ticket_type` + `sys_id` |
| `sn-create-ticket` | Create a ticket, validating required fields for its type |
| `sn-update-ticket` | Update fields on an existing ticket |
| `sn-upload-attachment` | Upload a file attachment to a ticket |
| `sn-list-attachments` | List attachments on a ticket |
| `sn-get-attachment` | Fetch one attachment's content by its `sys_id` |

All tools except `sn-list-ticket-types` and `sn-get-attachment` take
`ticket_type` (`inquiry`, `issue`, `service_request`, or `creq`) as
their first argument, resolved through the registry in
`src/ticket-types.ts` to the underlying ServiceNow table.

## Project layout

```
src/
  config.ts            Environment-variable configuration loader
  errors.ts             ValidationError / ServiceNowApiError / AuthError
  ticket-types.ts        Ticket-type registry
  tool-error.ts          Maps errors to MCP tool error results
  server.ts              MCP server construction and tool registration
  app.ts                  Express app wiring the Streamable HTTP transport
  index.ts                Process entrypoint
  servicenow/
    auth.ts               OAuth password-grant token manager
    client.ts              ServiceNow table REST client
    attachments.ts         ServiceNow attachment REST client
  tools/
    *.ts                    One file per MCP tool
tests/integration/          Gated integration suite against a real ServiceNow instance
```

## Implementation status

All 18 tasks in the implementation plan are complete: project
scaffolding, configuration, error types, the ticket-type registry, the
ServiceNow OAuth/REST/attachment clients, all 8 MCP tools, the
Streamable HTTP app, the process entrypoint, and the gated integration
suite. The full unit test suite (60 tests across 16 files) passes, and
`npm run build` compiles with no TypeScript errors.
