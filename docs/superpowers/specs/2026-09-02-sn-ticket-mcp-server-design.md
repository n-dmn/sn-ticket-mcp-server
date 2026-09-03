# sn-ticket-mcp-server — Design

## Purpose

An MCP server (Node.js + TypeScript) that exposes ServiceNow ticket
operations (search, get, create, update, attachments) as MCP tools. It
is consumed by an existing agent ecosystem (and, later, Copilot) that
provides the LLM/reasoning layer. This is a standalone project,
designed from first principles for this agent ecosystem's needs.

## Scope

**In scope (this spec):**
- MCP server exposing tools for four ServiceNow ticket types: Inquiry,
  Issue (CS Ticket), Service Request, CREQ.
- Search / get / create / update per ticket type via a metadata-driven
  generic tool set (not one tool per type).
- Attachment upload and retrieval on tickets.
- ServiceNow REST client with OAuth password-grant auth (access +
  refresh token lifecycle).
- Streamable HTTP transport (always-on Node service, not stdio).

**Explicitly out of scope (future, separate spec):**
- Multi-agent orchestration / handoff logic.
- The ai-sdk agent app itself (this server is what it will call via
  `@ai-sdk/mcp`'s client, not something built here).
- Copilot / chatbot front-end integration.
- Sensitive-field/security guardrails — enforced upstream in the agent
  layer, not inside this server.
- No LLM calls of any kind inside this server. MCP puts the model on
  the client/host side; this server is deterministic tool logic only
  (see Architecture Decisions below).

## Architecture

```
Agent ecosystem / future Copilot integration
  |  MCP over Streamable HTTP
sn-ticket-mcp-server (Node + TypeScript, always-on service)
  |- MCP layer: tool registration, request routing (@modelcontextprotocol/sdk)
  |- Tool handlers: search / get / create / update / list-types / attachments
  |- Ticket-type registry: config map (ticket_type -> table, fields, discriminator)
  \- ServiceNow client: OAuth password-grant token mgmt, REST calls, attachment API
        |  HTTPS
ServiceNow instance (dev, then prod)
```

### Architecture decisions

- **No LLM/agent layer in this server.** MCP's design puts reasoning
  (which tool to call, with what arguments) on the client/host side.
  This server validates arguments and executes ServiceNow operations
  only. If a future tool genuinely needs generation (e.g.
  summarization), that is an additive, tool-scoped decision — not a
  reason to add an agent loop here.
- **`@modelcontextprotocol/sdk` for the server**, not `@ai-sdk/mcp`.
  `@ai-sdk/mcp` is a client-only package (`createMCPClient`) for an
  ai-sdk app to *consume* an MCP server — it has no server-hosting
  API. It is the right tool for the future agent layer that will call
  this server, not for this project.
- **Metadata-driven generic tools**, not one tool per ticket type and
  not live schema introspection. A per-table tool generation approach
  produces an unusably large tool surface as tables grow, and live
  dynamic schema discovery is fragile against real ServiceNow
  instances. A small generic tool set backed by a metadata config
  avoids both problems from the outset.
- **Transport is Streamable HTTP**, since the calling agent ecosystem
  and future Copilot integration connect remotely rather than spawning
  a local subprocess.

## Ticket-type registry

A config map keyed by `ticket_type` (`inquiry`, `issue`,
`service_request`, `creq` initially): each entry declares its
ServiceNow table, required/common fields, and — if multiple types turn
out to share one table — a discriminator field/value.

**Open item:** whether these four types live in one ServiceNow table
(distinguished by a type/category field) or four separate tables is
not yet confirmed. This will be resolved empirically against the real
dev ServiceNow instance early in implementation (see Testing). Either
shape is handled by the same tool contracts — only the registry
config changes.

Adding a fifth ticket type later is a registry edit, not a code change
to any tool.

## Tools

| Tool | Purpose |
|---|---|
| `sn-list-ticket-types` | Returns configured ticket types and their fields (discovery) |
| `sn-search-tickets` | Query by `ticket_type` + structured filters (state, priority, assignee, date range) |
| `sn-get-ticket` | Fetch one record by `ticket_type` + sys_id/number |
| `sn-create-ticket` | Create a record; validates required fields from the type's registry entry |
| `sn-update-ticket` | Update fields on an existing record |
| `sn-upload-attachment` | Attach a file to a ticket |
| `sn-list-attachments` | List existing attachments on a ticket |
| `sn-get-attachment` | Fetch one attachment's content |

All tools except `sn-list-ticket-types` take `ticket_type` as their
first parameter, resolved through the registry to the correct
table/discriminator.

### Data flow (create, representative case)

`tools/call` -> validate `ticket_type` against registry -> validate
required fields -> ServiceNow client ensures a fresh OAuth token
(refresh if near expiry) -> POST to the resolved table -> normalize
response -> return sys_id/number to caller.

### Caller/application context on ticket creation

**Open item, not yet decided:** how the identity of the calling
application/user (from its own existing token) should be captured on
a created ticket. Deferred decision. For v1, `sn-create-ticket`
accepts an optional free-form `context` object that is written
verbatim to a designated field or work note, with no validation. This
keeps the door open without blocking implementation; the real
mechanism will be designed once decided, and only changes the
registry/handler for `sn-create-ticket`, not the wider architecture.

## Authentication

ServiceNow OAuth password grant: `clientId` + `clientSecret` (OAuth
application) plus `username` + `password` (service-principal account)
exchanged for `access_token` + `refresh_token` at a token endpoint,
renewed via a refresh endpoint before expiry.

`ServiceNowClient` holds these values from environment variables /
App Service settings (no Key Vault for v1) and caches
`{ access_token, refresh_token, expiresAt }` in memory per process,
refreshing proactively (e.g. 30s before expiry) via the refresh token,
falling back to a full re-authentication if refresh fails. Secrets are
never logged and never appear in tool arguments or responses.

## Error handling

Three distinct error shapes, surfaced as MCP tool errors:

- **Validation** — unknown `ticket_type`, missing required field.
  Rejected before any HTTP call; message names the specific field/type.
- **ServiceNow API errors** — 4xx/5xx from the REST call. Status and
  ServiceNow's own error message are passed through, not wrapped in a
  generic message.
- **Auth errors** — token/refresh failure. Distinct code so the caller
  can distinguish "your input was fine, but we couldn't reach
  ServiceNow" from a bad request.

## Testing

- **Unit tests**: ServiceNow HTTP responses mocked (e.g. `msw` or
  `nock`); cover tool-handler validation and normal/error paths without
  network access.
- **Integration tests**: a separate suite, gated behind an explicit
  opt-in environment variable so it never runs unintentionally, that
  exercises the real dev ServiceNow instance. This is also how the
  ticket-type table-layout open item gets resolved early in
  implementation.

## Non-goals / explicitly deferred

- Key Vault or other secret-store abstraction (env vars are sufficient
  for v1; revisit if/when hosting moves beyond App Service settings).
- Sensitive-field masking or a separate "secure area" tool path — the
  agent layer is expected to guard what it asks this server to do.
- Any convenience/per-type tool naming layer (e.g. `sn-create-inquiry`)
  — only add this later if the agent layer specifically wants friendlier
  tool names; not needed for v1.
