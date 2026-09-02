# sn-ticket-mcp-server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone Node.js + TypeScript MCP server that exposes ServiceNow ticket operations (search / get / create / update, plus attachments) for four ticket types — Inquiry, Issue (CS Ticket), Service Request, CREQ — over Streamable HTTP, for consumption by an existing agent ecosystem.

**Architecture:** A metadata-driven registry maps each ticket type to a ServiceNow table (and optional discriminator field/value). A small, generic set of MCP tools (not one tool per type) reads the registry to resolve `ticket_type` to a table before calling a thin ServiceNow REST client. The client holds an OAuth password-grant token manager with proactive refresh. No LLM or agent logic lives in this server — it validates arguments and executes deterministic ServiceNow calls only.

**Tech Stack:** Node.js (ESM), TypeScript, `@modelcontextprotocol/sdk` (server + Streamable HTTP transport), `zod` for tool input schemas, `express` for the HTTP surface, native `fetch` for the ServiceNow REST calls, `vitest` for tests, `supertest` for HTTP-layer tests.

**Spec:** `docs/superpowers/specs/2026-09-02-sn-ticket-mcp-server-design.md`

## Global Constraints

- No LLM/agent logic inside this server — tools validate arguments and execute ServiceNow operations only (spec: Architecture Decisions).
- Use `@modelcontextprotocol/sdk` for the server; `@ai-sdk/mcp` is a client-only package and is out of scope here (spec: Architecture Decisions).
- Metadata-driven generic tools, not one tool per ticket type and not live schema introspection (spec: Architecture Decisions).
- Transport is Streamable HTTP, not stdio (spec: Architecture Decisions).
- Four ticket types initially: `inquiry`, `issue`, `service_request`, `creq`. Adding a fifth is a registry edit only (spec: Ticket-type registry).
- ServiceNow auth is OAuth password grant (clientId + clientSecret + username + password → access_token + refresh_token), secrets from environment variables / App Service settings — no Key Vault in v1 (spec: Authentication).
- Token cache refreshes proactively ~30s before expiry; falls back to full re-authentication if refresh fails. Secrets are never logged and never appear in tool arguments or responses (spec: Authentication).
- Three distinct error categories surfaced as MCP tool errors: Validation, ServiceNow API errors (4xx/5xx passed through, not wrapped), Auth errors (spec: Error handling).
- `sn-create-ticket` accepts an optional free-form `context` object written verbatim to a work note, unvalidated (spec: Caller/application context on ticket creation).
- Unit tests mock ServiceNow HTTP responses (no network access); a separate integration suite is gated behind an explicit opt-in environment variable and exercises the real dev ServiceNow instance (spec: Testing).
- Out of scope for this project: multi-agent orchestration, the ai-sdk agent app itself, Copilot integration, sensitive-field/security guardrails, Key Vault, sensitive-field masking, and any convenience/per-type tool naming layer (spec: Scope / Non-goals).

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `.env.example`

**Interfaces:**
- Produces: an installable, buildable, testable Node/TypeScript project. No runtime code yet.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "sn-ticket-mcp-server",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "dev": "tsx watch src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:integration": "vitest run tests/integration"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.30.0",
    "zod": "^4.5.4",
    "express": "^5.2.1",
    "cors": "^2.8.6",
    "dotenv": "^17.4.2"
  },
  "devDependencies": {
    "typescript": "^7.0.2",
    "vitest": "^4.1.11",
    "tsx": "^4.23.13",
    "supertest": "^7.2.2",
    "@types/express": "^5.0.6",
    "@types/cors": "^2.8.19",
    "@types/node": "^26.4.1",
    "@types/supertest": "^7.2.1"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "sourceMap": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts", "node_modules", "dist"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node'
  }
});
```

- [ ] **Step 4: Create `.gitignore`**

```
node_modules/
dist/
.env
.env.integration
*.log
```

- [ ] **Step 5: Create `.env.example`**

```
PORT=3000
SERVICENOW_INSTANCE_URL=https://devXXXXX.service-now.com
SERVICENOW_TOKEN_URL=
SERVICENOW_CLIENT_ID=
SERVICENOW_CLIENT_SECRET=
SERVICENOW_USERNAME=
SERVICENOW_PASSWORD=
```

- [ ] **Step 6: Install dependencies and verify the toolchain**

Run: `npm install`
Expected: install completes with no errors.

Run: `npx tsc --version`
Expected: prints a TypeScript version (e.g. `Version 7.0.2`), confirming the compiler is installed and runnable.

Run: `npx vitest --version`
Expected: prints a Vitest version, confirming the test runner is installed and runnable.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore .env.example
git commit -m "chore: scaffold TypeScript project"
```

---

## Task 2: Configuration Loader

**Files:**
- Create: `src/config.ts`
- Test: `src/config.test.ts`

**Interfaces:**
- Produces:
  - `interface ServiceNowConfig { instanceUrl: string; tokenUrl: string; clientId: string; clientSecret: string; username: string; password: string; }`
  - `interface AppConfig { port: number; serviceNow: ServiceNowConfig; }`
  - `function loadConfig(env?: NodeJS.ProcessEnv): AppConfig` — throws a plain `Error` naming the missing variable if a required one is absent.

- [ ] **Step 1: Write the failing test**

Create `src/config.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { loadConfig } from './config.js';

const baseEnv = {
  SERVICENOW_INSTANCE_URL: 'https://dev12345.service-now.com',
  SERVICENOW_CLIENT_ID: 'client-id',
  SERVICENOW_CLIENT_SECRET: 'client-secret',
  SERVICENOW_USERNAME: 'svc-account',
  SERVICENOW_PASSWORD: 'svc-password'
};

describe('loadConfig', () => {
  it('loads config from environment variables with sensible defaults', () => {
    const config = loadConfig(baseEnv);

    expect(config.port).toBe(3000);
    expect(config.serviceNow.instanceUrl).toBe('https://dev12345.service-now.com');
    expect(config.serviceNow.tokenUrl).toBe('https://dev12345.service-now.com/oauth_token.do');
    expect(config.serviceNow.clientId).toBe('client-id');
    expect(config.serviceNow.clientSecret).toBe('client-secret');
    expect(config.serviceNow.username).toBe('svc-account');
    expect(config.serviceNow.password).toBe('svc-password');
  });

  it('respects an explicit PORT and SERVICENOW_TOKEN_URL override', () => {
    const config = loadConfig({
      ...baseEnv,
      PORT: '8080',
      SERVICENOW_TOKEN_URL: 'https://custom-token-host/token'
    });

    expect(config.port).toBe(8080);
    expect(config.serviceNow.tokenUrl).toBe('https://custom-token-host/token');
  });

  it('strips a trailing slash from SERVICENOW_INSTANCE_URL', () => {
    const config = loadConfig({ ...baseEnv, SERVICENOW_INSTANCE_URL: 'https://dev12345.service-now.com/' });

    expect(config.serviceNow.instanceUrl).toBe('https://dev12345.service-now.com');
  });

  it('throws a descriptive error when a required variable is missing', () => {
    const { SERVICENOW_CLIENT_ID, ...rest } = baseEnv;

    expect(() => loadConfig(rest)).toThrow('Missing required environment variable: SERVICENOW_CLIENT_ID');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/config.test.ts`
Expected: FAIL — `src/config.ts` does not exist yet ("Cannot find module './config.js'" or similar).

- [ ] **Step 3: Write minimal implementation**

Create `src/config.ts`:

```ts
export interface ServiceNowConfig {
  instanceUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
}

export interface AppConfig {
  port: number;
  serviceNow: ServiceNowConfig;
}

function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const instanceUrl = requireEnv(env, 'SERVICENOW_INSTANCE_URL').replace(/\/+$/, '');
  const tokenUrl = env.SERVICENOW_TOKEN_URL || `${instanceUrl}/oauth_token.do`;

  return {
    port: env.PORT ? Number.parseInt(env.PORT, 10) : 3000,
    serviceNow: {
      instanceUrl,
      tokenUrl,
      clientId: requireEnv(env, 'SERVICENOW_CLIENT_ID'),
      clientSecret: requireEnv(env, 'SERVICENOW_CLIENT_SECRET'),
      username: requireEnv(env, 'SERVICENOW_USERNAME'),
      password: requireEnv(env, 'SERVICENOW_PASSWORD')
    }
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/config.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/config.ts src/config.test.ts
git commit -m "feat: add environment-variable configuration loader"
```

---

## Task 3: Error Types

**Files:**
- Create: `src/errors.ts`
- Test: `src/errors.test.ts`

**Interfaces:**
- Produces:
  - `class ValidationError extends Error`
  - `class ServiceNowApiError extends Error { status: number; body: unknown; }`
  - `class AuthError extends Error`

- [ ] **Step 1: Write the failing test**

Create `src/errors.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ValidationError, ServiceNowApiError, AuthError } from './errors.js';

describe('error types', () => {
  it('ValidationError carries a message and the correct name', () => {
    const error = new ValidationError('unknown ticket_type: bogus');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ValidationError');
    expect(error.message).toBe('unknown ticket_type: bogus');
  });

  it('ServiceNowApiError carries status and body', () => {
    const error = new ServiceNowApiError('request failed', 404, { error: { message: 'Not Found' } });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ServiceNowApiError');
    expect(error.status).toBe(404);
    expect(error.body).toEqual({ error: { message: 'Not Found' } });
  });

  it('AuthError carries a message and the correct name', () => {
    const error = new AuthError('token refresh failed');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('AuthError');
    expect(error.message).toBe('token refresh failed');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/errors.test.ts`
Expected: FAIL — `src/errors.ts` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `src/errors.ts`:

```ts
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class ServiceNowApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'ServiceNowApiError';
    this.status = status;
    this.body = body;
  }
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/errors.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/errors.ts src/errors.test.ts
git commit -m "feat: add ValidationError, ServiceNowApiError, AuthError types"
```

---

## Task 4: Ticket-Type Registry

**Files:**
- Create: `src/ticket-types.ts`
- Test: `src/ticket-types.test.ts`

**Interfaces:**
- Consumes: `ValidationError` from `src/errors.ts` (Task 3).
- Produces:
  - `interface TicketFieldDef { name: string; required: boolean; }`
  - `interface TicketTypeDef { key: string; label: string; table: string; discriminatorField?: string; discriminatorValue?: string; fields: TicketFieldDef[]; }`
  - `const TICKET_TYPES: Record<string, TicketTypeDef>`
  - `function listTicketTypes(): TicketTypeDef[]`
  - `function getTicketType(key: string): TicketTypeDef` — throws `ValidationError` for an unknown key.
  - `function validateRequiredFields(type: TicketTypeDef, data: Record<string, unknown>): void` — throws `ValidationError` naming every missing required field.
  - `function buildQuery(type: TicketTypeDef, extraQuery?: string): string | undefined` — joins the type's discriminator clause (if any) with `extraQuery` using `^`.

**Note on the registry's table names:** the spec leaves it open whether these four types share one ServiceNow table or live in four separate tables. The values below are the best-available default mapping (CREQ is literally the `change_request` table's number prefix; Service Request maps to the standard `sc_request` catalog table; Inquiry and Issue are modeled as two categories of one `sn_customerservice_case` table via a discriminator). Task 18's integration suite validates these against the real dev instance; if any are wrong, only this file's data changes — no tool code changes.

- [ ] **Step 1: Write the failing test**

Create `src/ticket-types.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { TICKET_TYPES, listTicketTypes, getTicketType, validateRequiredFields, buildQuery } from './ticket-types.js';
import { ValidationError } from './errors.js';

describe('ticket-type registry', () => {
  it('lists all four configured ticket types', () => {
    const types = listTicketTypes();
    const keys = types.map(type => type.key).sort();
    expect(keys).toEqual(['creq', 'inquiry', 'issue', 'service_request']);
  });

  it('resolves a known ticket type by key', () => {
    const creq = getTicketType('creq');
    expect(creq.table).toBe('change_request');
  });

  it('throws a ValidationError for an unknown ticket type', () => {
    expect(() => getTicketType('bogus')).toThrow(ValidationError);
    expect(() => getTicketType('bogus')).toThrow('Unknown ticket_type: bogus');
  });

  it('accepts data containing every required field', () => {
    const creq = getTicketType('creq');
    expect(() => validateRequiredFields(creq, { short_description: 'Network outage' })).not.toThrow();
  });

  it('throws a ValidationError naming every missing required field', () => {
    const type = {
      key: 'test_type',
      label: 'Test Type',
      table: 'x_test',
      fields: [
        { name: 'short_description', required: true },
        { name: 'category', required: true },
        { name: 'description', required: false }
      ]
    };

    expect(() => validateRequiredFields(type, {})).toThrow(
      'Missing required field(s) for test_type: short_description, category'
    );
  });

  it('builds a query combining the discriminator clause and an extra query', () => {
    const issue = getTicketType('issue');
    const combined = buildQuery(issue, 'active=true');
    expect(combined).toBe(`${issue.discriminatorField}=${issue.discriminatorValue}^active=true`);
  });

  it('builds a query with only the extra query when there is no discriminator', () => {
    const creq = getTicketType('creq');
    expect(buildQuery(creq, 'active=true')).toBe('active=true');
  });

  it('returns undefined when there is no discriminator and no extra query', () => {
    const creq = getTicketType('creq');
    expect(buildQuery(creq)).toBeUndefined();
  });

  it('exposes the four expected registry entries directly', () => {
    expect(Object.keys(TICKET_TYPES).sort()).toEqual(['creq', 'inquiry', 'issue', 'service_request']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/ticket-types.test.ts`
Expected: FAIL — `src/ticket-types.ts` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `src/ticket-types.ts`:

```ts
import { ValidationError } from './errors.js';

export interface TicketFieldDef {
  name: string;
  required: boolean;
}

export interface TicketTypeDef {
  key: string;
  label: string;
  table: string;
  discriminatorField?: string;
  discriminatorValue?: string;
  fields: TicketFieldDef[];
}

export const TICKET_TYPES: Record<string, TicketTypeDef> = {
  inquiry: {
    key: 'inquiry',
    label: 'Inquiry',
    table: 'sn_customerservice_case',
    discriminatorField: 'contact_type',
    discriminatorValue: 'inquiry',
    fields: [
      { name: 'short_description', required: true },
      { name: 'description', required: false },
      { name: 'priority', required: false },
      { name: 'assignment_group', required: false }
    ]
  },
  issue: {
    key: 'issue',
    label: 'Issue (CS Ticket)',
    table: 'sn_customerservice_case',
    discriminatorField: 'contact_type',
    discriminatorValue: 'issue',
    fields: [
      { name: 'short_description', required: true },
      { name: 'description', required: false },
      { name: 'priority', required: false },
      { name: 'assignment_group', required: false }
    ]
  },
  service_request: {
    key: 'service_request',
    label: 'Service Request',
    table: 'sc_request',
    fields: [
      { name: 'short_description', required: true },
      { name: 'description', required: false },
      { name: 'priority', required: false }
    ]
  },
  creq: {
    key: 'creq',
    label: 'Change Request',
    table: 'change_request',
    fields: [
      { name: 'short_description', required: true },
      { name: 'description', required: false },
      { name: 'priority', required: false },
      { name: 'type', required: false }
    ]
  }
};

export function listTicketTypes(): TicketTypeDef[] {
  return Object.values(TICKET_TYPES);
}

export function getTicketType(key: string): TicketTypeDef {
  const type = TICKET_TYPES[key];
  if (!type) {
    throw new ValidationError(`Unknown ticket_type: ${key}`);
  }
  return type;
}

export function validateRequiredFields(type: TicketTypeDef, data: Record<string, unknown>): void {
  const missing = type.fields
    .filter(field => field.required)
    .map(field => field.name)
    .filter(name => data[name] === undefined || data[name] === null || data[name] === '');

  if (missing.length > 0) {
    throw new ValidationError(`Missing required field(s) for ${type.key}: ${missing.join(', ')}`);
  }
}

export function buildQuery(type: TicketTypeDef, extraQuery?: string): string | undefined {
  const parts: string[] = [];
  if (type.discriminatorField && type.discriminatorValue !== undefined) {
    parts.push(`${type.discriminatorField}=${type.discriminatorValue}`);
  }
  if (extraQuery) {
    parts.push(extraQuery);
  }
  return parts.length > 0 ? parts.join('^') : undefined;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/ticket-types.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add src/ticket-types.ts src/ticket-types.test.ts
git commit -m "feat: add ticket-type registry"
```

---

## Task 5: ServiceNow OAuth Token Manager

**Files:**
- Create: `src/servicenow/auth.ts`
- Test: `src/servicenow/auth.test.ts`

**Interfaces:**
- Consumes: `ServiceNowConfig` from `src/config.ts` (Task 2), `AuthError` from `src/errors.ts` (Task 3).
- Produces: `class TokenManager { constructor(config: ServiceNowConfig, fetchImpl?: typeof fetch); getAccessToken(): Promise<string>; }`

- [ ] **Step 1: Write the failing test**

Create `src/servicenow/auth.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TokenManager } from './auth.js';
import { AuthError } from '../errors.js';
import type { ServiceNowConfig } from '../config.js';

const config: ServiceNowConfig = {
  instanceUrl: 'https://dev12345.service-now.com',
  tokenUrl: 'https://dev12345.service-now.com/oauth_token.do',
  clientId: 'client-id',
  clientSecret: 'client-secret',
  username: 'svc-account',
  password: 'svc-password'
};

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body)
  } as Response;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('TokenManager', () => {
  it('authenticates with a password grant when no token is cached', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 1800 })
    );
    const tokenManager = new TokenManager(config, fetchImpl);

    const token = await tokenManager.getAccessToken();

    expect(token).toBe('access-1');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(config.tokenUrl);
    const body = init.body as URLSearchParams;
    expect(body.get('grant_type')).toBe('password');
    expect(body.get('client_id')).toBe('client-id');
    expect(body.get('client_secret')).toBe('client-secret');
    expect(body.get('username')).toBe('svc-account');
    expect(body.get('password')).toBe('svc-password');
  });

  it('reuses a cached token that is not near expiry', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 1800 })
    );
    const tokenManager = new TokenManager(config, fetchImpl);

    await tokenManager.getAccessToken();
    const second = await tokenManager.getAccessToken();

    expect(second).toBe('access-1');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('refreshes the token via refresh_token grant once it is near expiry', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 60 }))
      .mockResolvedValueOnce(jsonResponse({ access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 1800 }));
    const tokenManager = new TokenManager(config, fetchImpl);

    await tokenManager.getAccessToken();
    vi.advanceTimersByTime(31_000);
    const second = await tokenManager.getAccessToken();

    expect(second).toBe('access-2');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const refreshBody = fetchImpl.mock.calls[1][1].body as URLSearchParams;
    expect(refreshBody.get('grant_type')).toBe('refresh_token');
    expect(refreshBody.get('refresh_token')).toBe('refresh-1');
  });

  it('falls back to a fresh password grant when refresh fails', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 60 }))
      .mockResolvedValueOnce(jsonResponse({ error: 'invalid_grant' }, false, 400))
      .mockResolvedValueOnce(jsonResponse({ access_token: 'access-3', refresh_token: 'refresh-3', expires_in: 1800 }));
    const tokenManager = new TokenManager(config, fetchImpl);

    await tokenManager.getAccessToken();
    vi.advanceTimersByTime(31_000);
    const third = await tokenManager.getAccessToken();

    expect(third).toBe('access-3');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const reauthBody = fetchImpl.mock.calls[2][1].body as URLSearchParams;
    expect(reauthBody.get('grant_type')).toBe('password');
  });

  it('throws an AuthError when the initial authentication request fails', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: 'invalid_client' }, false, 401));
    const tokenManager = new TokenManager(config, fetchImpl);

    await expect(tokenManager.getAccessToken()).rejects.toThrow(AuthError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/servicenow/auth.test.ts`
Expected: FAIL — `src/servicenow/auth.ts` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `src/servicenow/auth.ts`:

```ts
import { AuthError } from '../errors.js';
import type { ServiceNowConfig } from '../config.js';

interface TokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

const REFRESH_BUFFER_MS = 30_000;

export class TokenManager {
  private tokenSet: TokenSet | undefined;

  constructor(
    private readonly config: ServiceNowConfig,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async getAccessToken(): Promise<string> {
    if (this.tokenSet && Date.now() < this.tokenSet.expiresAt - REFRESH_BUFFER_MS) {
      return this.tokenSet.accessToken;
    }

    if (this.tokenSet) {
      try {
        this.tokenSet = await this.requestToken({
          grant_type: 'refresh_token',
          refresh_token: this.tokenSet.refreshToken
        });
        return this.tokenSet.accessToken;
      } catch {
        this.tokenSet = undefined;
      }
    }

    this.tokenSet = await this.requestToken({
      grant_type: 'password',
      username: this.config.username,
      password: this.config.password
    });
    return this.tokenSet.accessToken;
  }

  private async requestToken(grantParams: Record<string, string>): Promise<TokenSet> {
    const body = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      ...grantParams
    });

    const response = await this.fetchImpl(this.config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });

    if (!response.ok) {
      const text = await response.text();
      throw new AuthError(`ServiceNow token request failed with status ${response.status}: ${text}`);
    }

    const json = (await response.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresAt: Date.now() + json.expires_in * 1000
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/servicenow/auth.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/servicenow/auth.ts src/servicenow/auth.test.ts
git commit -m "feat: add ServiceNow OAuth password-grant token manager"
```

---

## Task 6: ServiceNow REST Client

**Files:**
- Create: `src/servicenow/client.ts`
- Test: `src/servicenow/client.test.ts`

**Interfaces:**
- Consumes: `TokenManager.getAccessToken(): Promise<string>` (Task 5), `ServiceNowApiError` from `src/errors.ts` (Task 3).
- Produces:
  - `interface QueryOptions { query?: string; limit?: number; offset?: number; fields?: string[]; }`
  - `class ServiceNowClient { constructor(config: ServiceNowConfig, tokenManager: TokenManager, fetchImpl?: typeof fetch); query(table: string, options？: QueryOptions): Promise<Record<string, unknown>[]>; getRecord(table: string, sysId: string): Promise<Record<string, unknown>>; createRecord(table: string, data: Record<string, unknown>): Promise<Record<string, unknown>>; updateRecord(table: string, sysId: string, data: Record<string, unknown>): Promise<Record<string, unknown>>; }`

- [ ] **Step 1: Write the failing test**

Create `src/servicenow/client.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { ServiceNowClient } from './client.js';
import { ServiceNowApiError } from '../errors.js';
import type { ServiceNowConfig } from '../config.js';
import type { TokenManager } from './auth.js';

const config: ServiceNowConfig = {
  instanceUrl: 'https://dev12345.service-now.com',
  tokenUrl: 'https://dev12345.service-now.com/oauth_token.do',
  clientId: 'client-id',
  clientSecret: 'client-secret',
  username: 'svc-account',
  password: 'svc-password'
};

function fakeTokenManager(): TokenManager {
  return { getAccessToken: vi.fn().mockResolvedValue('test-token') } as unknown as TokenManager;
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, text: async () => JSON.stringify(body) } as Response;
}

describe('ServiceNowClient', () => {
  it('queries a table with sysparm_query, limit, offset, and fields', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ result: [{ sys_id: 'a1' }] }));
    const client = new ServiceNowClient(config, fakeTokenManager(), fetchImpl);

    const records = await client.query('change_request', {
      query: 'active=true',
      limit: 10,
      offset: 5,
      fields: ['number', 'short_description']
    });

    expect(records).toEqual([{ sys_id: 'a1' }]);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(
      'https://dev12345.service-now.com/api/now/table/change_request?sysparm_query=active%3Dtrue&sysparm_limit=10&sysparm_offset=5&sysparm_fields=number%2Cshort_description'
    );
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBe('Bearer test-token');
  });

  it('gets a single record by sys_id', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ result: { sys_id: 'a1', number: 'CHG0001' } }));
    const client = new ServiceNowClient(config, fakeTokenManager(), fetchImpl);

    const record = await client.getRecord('change_request', 'a1');

    expect(record).toEqual({ sys_id: 'a1', number: 'CHG0001' });
    expect(fetchImpl.mock.calls[0][0]).toBe('https://dev12345.service-now.com/api/now/table/change_request/a1');
  });

  it('creates a record with a JSON body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ result: { sys_id: 'new1' } }));
    const client = new ServiceNowClient(config, fakeTokenManager(), fetchImpl);

    const record = await client.createRecord('change_request', { short_description: 'Test' });

    expect(record).toEqual({ sys_id: 'new1' });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://dev12345.service-now.com/api/now/table/change_request');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ short_description: 'Test' }));
  });

  it('updates a record by sys_id with PATCH', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ result: { sys_id: 'a1', state: '2' } }));
    const client = new ServiceNowClient(config, fakeTokenManager(), fetchImpl);

    const record = await client.updateRecord('change_request', 'a1', { state: '2' });

    expect(record).toEqual({ sys_id: 'a1', state: '2' });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://dev12345.service-now.com/api/now/table/change_request/a1');
    expect(init.method).toBe('PATCH');
  });

  it('throws a ServiceNowApiError with status and body on a non-ok response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: { message: 'Not Found' } }, false, 404));
    const client = new ServiceNowClient(config, fakeTokenManager(), fetchImpl);

    await expect(client.getRecord('change_request', 'missing')).rejects.toThrow(ServiceNowApiError);
    try {
      await client.getRecord('change_request', 'missing');
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceNowApiError);
      expect((error as ServiceNowApiError).status).toBe(404);
      expect((error as ServiceNowApiError).body).toEqual({ error: { message: 'Not Found' } });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/servicenow/client.test.ts`
Expected: FAIL — `src/servicenow/client.ts` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `src/servicenow/client.ts`:

```ts
import { ServiceNowApiError } from '../errors.js';
import type { ServiceNowConfig } from '../config.js';
import type { TokenManager } from './auth.js';

export interface QueryOptions {
  query?: string;
  limit?: number;
  offset?: number;
  fields?: string[];
}

export class ServiceNowClient {
  constructor(
    private readonly config: ServiceNowConfig,
    private readonly tokenManager: TokenManager,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async query(table: string, options: QueryOptions = {}): Promise<Record<string, unknown>[]> {
    const params = new URLSearchParams();
    if (options.query) params.set('sysparm_query', options.query);
    if (options.limit !== undefined) params.set('sysparm_limit', String(options.limit));
    if (options.offset !== undefined) params.set('sysparm_offset', String(options.offset));
    if (options.fields) params.set('sysparm_fields', options.fields.join(','));

    const result = await this.request('GET', `/api/now/table/${table}?${params.toString()}`);
    return result as Record<string, unknown>[];
  }

  async getRecord(table: string, sysId: string): Promise<Record<string, unknown>> {
    const result = await this.request('GET', `/api/now/table/${table}/${sysId}`);
    return result as Record<string, unknown>;
  }

  async createRecord(table: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const result = await this.request('POST', `/api/now/table/${table}`, data);
    return result as Record<string, unknown>;
  }

  async updateRecord(table: string, sysId: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const result = await this.request('PATCH', `/api/now/table/${table}/${sysId}`, data);
    return result as Record<string, unknown>;
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const token = await this.tokenManager.getAccessToken();
    const response = await this.fetchImpl(`${this.config.instanceUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });

    const text = await response.text();
    const json = text ? JSON.parse(text) : {};

    if (!response.ok) {
      throw new ServiceNowApiError(`ServiceNow API request failed with status ${response.status}`, response.status, json);
    }

    return json.result;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/servicenow/client.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/servicenow/client.ts src/servicenow/client.test.ts
git commit -m "feat: add ServiceNow table REST client"
```

---

## Task 7: ServiceNow Attachment Client

**Files:**
- Create: `src/servicenow/attachments.ts`
- Test: `src/servicenow/attachments.test.ts`

**Interfaces:**
- Consumes: `TokenManager.getAccessToken(): Promise<string>` (Task 5), `ServiceNowApiError` from `src/errors.ts` (Task 3).
- Produces:
  - `interface AttachmentMeta { sysId: string; fileName: string; contentType: string; sizeBytes: number; }`
  - `class AttachmentClient { constructor(config: ServiceNowConfig, tokenManager: TokenManager, fetchImpl?: typeof fetch); upload(table: string, recordSysId: string, fileName: string, contentType: string, data: Buffer): Promise<AttachmentMeta>; list(table: string, recordSysId: string): Promise<AttachmentMeta[]>; getContent(attachmentSysId: string): Promise<{ data: Buffer; contentType: string; fileName: string }>; }`

- [ ] **Step 1: Write the failing test**

Create `src/servicenow/attachments.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { AttachmentClient } from './attachments.js';
import { ServiceNowApiError } from '../errors.js';
import type { ServiceNowConfig } from '../config.js';
import type { TokenManager } from './auth.js';

const config: ServiceNowConfig = {
  instanceUrl: 'https://dev12345.service-now.com',
  tokenUrl: 'https://dev12345.service-now.com/oauth_token.do',
  clientId: 'client-id',
  clientSecret: 'client-secret',
  username: 'svc-account',
  password: 'svc-password'
};

function fakeTokenManager(): TokenManager {
  return { getAccessToken: vi.fn().mockResolvedValue('test-token') } as unknown as TokenManager;
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, text: async () => JSON.stringify(body) } as Response;
}

describe('AttachmentClient', () => {
  it('uploads a file and returns its attachment metadata', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ result: { sys_id: 'att1', file_name: 'log.txt', content_type: 'text/plain', size_bytes: '3' } })
    );
    const client = new AttachmentClient(config, fakeTokenManager(), fetchImpl);
    const data = Buffer.from('abc');

    const meta = await client.upload('change_request', 'rec1', 'log.txt', 'text/plain', data);

    expect(meta).toEqual({ sysId: 'att1', fileName: 'log.txt', contentType: 'text/plain', sizeBytes: 3 });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(
      'https://dev12345.service-now.com/api/now/attachment/file?table_name=change_request&table_sys_id=rec1&file_name=log.txt'
    );
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('text/plain');
    expect(init.body).toBe(data);
  });

  it('lists attachments for a record', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        result: [{ sys_id: 'att1', file_name: 'log.txt', content_type: 'text/plain', size_bytes: '3' }]
      })
    );
    const client = new AttachmentClient(config, fakeTokenManager(), fetchImpl);

    const list = await client.list('change_request', 'rec1');

    expect(list).toEqual([{ sysId: 'att1', fileName: 'log.txt', contentType: 'text/plain', sizeBytes: 3 }]);
    expect(fetchImpl.mock.calls[0][0]).toBe(
      'https://dev12345.service-now.com/api/now/table/sys_attachment?sysparm_query=table_name%3Dchange_request%5Etable_sys_id%3Drec1'
    );
  });

  it('fetches attachment metadata and binary content together', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ result: { sys_id: 'att1', file_name: 'log.txt', content_type: 'text/plain', size_bytes: '3' } })
      )
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        arrayBuffer: async () => Buffer.from('abc').buffer
      } as unknown as Response);
    const client = new AttachmentClient(config, fakeTokenManager(), fetchImpl);

    const content = await client.getContent('att1');

    expect(content.fileName).toBe('log.txt');
    expect(content.contentType).toBe('text/plain');
    expect(Buffer.from(content.data).toString('utf8')).toBe('abc');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1][0]).toBe('https://dev12345.service-now.com/api/now/attachment/att1/file');
  });

  it('throws a ServiceNowApiError when the file download fails', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ result: { sys_id: 'att1', file_name: 'log.txt', content_type: 'text/plain', size_bytes: '3' } })
      )
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'boom' } as unknown as Response);
    const client = new AttachmentClient(config, fakeTokenManager(), fetchImpl);

    await expect(client.getContent('att1')).rejects.toThrow(ServiceNowApiError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/servicenow/attachments.test.ts`
Expected: FAIL — `src/servicenow/attachments.ts` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `src/servicenow/attachments.ts`:

```ts
import { ServiceNowApiError } from '../errors.js';
import type { ServiceNowConfig } from '../config.js';
import type { TokenManager } from './auth.js';

export interface AttachmentMeta {
  sysId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
}

interface RawAttachmentRecord {
  sys_id: string;
  file_name: string;
  content_type: string;
  size_bytes: string;
}

function toAttachmentMeta(raw: RawAttachmentRecord): AttachmentMeta {
  return {
    sysId: raw.sys_id,
    fileName: raw.file_name,
    contentType: raw.content_type,
    sizeBytes: Number.parseInt(raw.size_bytes, 10)
  };
}

export class AttachmentClient {
  constructor(
    private readonly config: ServiceNowConfig,
    private readonly tokenManager: TokenManager,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async upload(
    table: string,
    recordSysId: string,
    fileName: string,
    contentType: string,
    data: Buffer
  ): Promise<AttachmentMeta> {
    const token = await this.tokenManager.getAccessToken();
    const params = new URLSearchParams({ table_name: table, table_sys_id: recordSysId, file_name: fileName });

    const response = await this.fetchImpl(`${this.config.instanceUrl}/api/now/attachment/file?${params.toString()}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': contentType,
        Accept: 'application/json'
      },
      body: data
    });

    const json = await this.parseJson(response);
    return toAttachmentMeta(json.result as RawAttachmentRecord);
  }

  async list(table: string, recordSysId: string): Promise<AttachmentMeta[]> {
    const token = await this.tokenManager.getAccessToken();
    const params = new URLSearchParams({ sysparm_query: `table_name=${table}^table_sys_id=${recordSysId}` });

    const response = await this.fetchImpl(
      `${this.config.instanceUrl}/api/now/table/sys_attachment?${params.toString()}`,
      { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }
    );

    const json = await this.parseJson(response);
    return (json.result as RawAttachmentRecord[]).map(toAttachmentMeta);
  }

  async getContent(attachmentSysId: string): Promise<{ data: Buffer; contentType: string; fileName: string }> {
    const token = await this.tokenManager.getAccessToken();

    const metaResponse = await this.fetchImpl(
      `${this.config.instanceUrl}/api/now/table/sys_attachment/${attachmentSysId}`,
      { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }
    );
    const metaJson = await this.parseJson(metaResponse);
    const meta = toAttachmentMeta(metaJson.result as RawAttachmentRecord);

    const fileResponse = await this.fetchImpl(`${this.config.instanceUrl}/api/now/attachment/${attachmentSysId}/file`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!fileResponse.ok) {
      const text = await fileResponse.text();
      throw new ServiceNowApiError(
        `ServiceNow attachment download failed with status ${fileResponse.status}`,
        fileResponse.status,
        text
      );
    }

    const arrayBuffer = await fileResponse.arrayBuffer();
    return { data: Buffer.from(arrayBuffer), contentType: meta.contentType, fileName: meta.fileName };
  }

  private async parseJson(response: Response): Promise<{ result: unknown }> {
    const text = await response.text();
    const json = text ? JSON.parse(text) : {};
    if (!response.ok) {
      throw new ServiceNowApiError(`ServiceNow API request failed with status ${response.status}`, response.status, json);
    }
    return json as { result: unknown };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/servicenow/attachments.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/servicenow/attachments.ts src/servicenow/attachments.test.ts
git commit -m "feat: add ServiceNow attachment client"
```

---

## Task 8: MCP Server Shell, Test Harness, and `sn-list-ticket-types`

**Files:**
- Create: `src/server.ts`
- Create: `src/tools/test-helpers.ts`
- Create: `src/tools/list-ticket-types.ts`
- Test: `src/tools/list-ticket-types.test.ts`

**Interfaces:**
- Consumes: `listTicketTypes()` from `src/ticket-types.ts` (Task 4), `ServiceNowClient` (Task 6), `AttachmentClient` (Task 7).
- Produces:
  - `interface ServerDeps { client: ServiceNowClient; attachments: AttachmentClient; }`
  - `function buildServer(deps: ServerDeps): McpServer`
  - `function createTestClient(deps: ServerDeps): Promise<{ client: Client; cleanup: () => Promise<void> }>` — wires an in-memory MCP `Client` to a server built from `deps`, for use by every tool test file.
  - `function registerListTicketTypesTool(server: McpServer): void`

- [ ] **Step 1: Write the failing test**

Create `src/tools/test-helpers.ts` (not a test file itself — a shared helper consumed by tool tests):

```ts
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
```

Create `src/tools/list-ticket-types.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createTestClient } from './test-helpers.js';
import type { ServiceNowClient } from '../servicenow/client.js';
import type { AttachmentClient } from '../servicenow/attachments.js';

describe('sn-list-ticket-types tool', () => {
  it('returns the four configured ticket types', async () => {
    const { client, cleanup } = await createTestClient({
      client: {} as unknown as ServiceNowClient,
      attachments: {} as unknown as AttachmentClient
    });

    try {
      const result = await client.callTool({ name: 'sn-list-ticket-types', arguments: {} });
      expect(result.isError).toBeFalsy();
      const content = result.content as { type: string; text: string }[];
      const types = JSON.parse(content[0].text) as { key: string }[];
      expect(types.map(type => type.key).sort()).toEqual(['creq', 'inquiry', 'issue', 'service_request']);
    } finally {
      await cleanup();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/tools/list-ticket-types.test.ts`
Expected: FAIL — `src/server.ts` and `src/tools/list-ticket-types.ts` do not exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `src/tools/list-ticket-types.ts`:

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { listTicketTypes } from '../ticket-types.js';

export function registerListTicketTypesTool(server: McpServer): void {
  server.registerTool(
    'sn-list-ticket-types',
    {
      description: 'List the ServiceNow ticket types configured on this server, with their fields',
      inputSchema: {}
    },
    async () => {
      return { content: [{ type: 'text', text: JSON.stringify(listTicketTypes()) }] };
    }
  );
}
```

Create `src/server.ts`:

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServiceNowClient } from './servicenow/client.js';
import type { AttachmentClient } from './servicenow/attachments.js';
import { registerListTicketTypesTool } from './tools/list-ticket-types.js';

export interface ServerDeps {
  client: ServiceNowClient;
  attachments: AttachmentClient;
}

export function buildServer(deps: ServerDeps): McpServer {
  const server = new McpServer({ name: 'sn-ticket-mcp-server', version: '0.1.0' });

  registerListTicketTypesTool(server);

  return server;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/tools/list-ticket-types.test.ts`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add src/server.ts src/tools/test-helpers.ts src/tools/list-ticket-types.ts src/tools/list-ticket-types.test.ts
git commit -m "feat: add MCP server shell and sn-list-ticket-types tool"
```

---

## Task 9: Shared Tool-Error Mapper and `sn-search-tickets`

**Files:**
- Create: `src/tool-error.ts`
- Test: `src/tool-error.test.ts`
- Create: `src/tools/search-tickets.ts`
- Test: `src/tools/search-tickets.test.ts`
- Modify: `src/server.ts` (register the new tool)

**Interfaces:**
- Consumes: `ValidationError`, `ServiceNowApiError`, `AuthError` from `src/errors.ts` (Task 3); `getTicketType`, `buildQuery` from `src/ticket-types.ts` (Task 4); `ServiceNowClient.query` (Task 6); `createTestClient` from `src/tools/test-helpers.ts` (Task 8).
- Produces:
  - `interface ToolErrorResult { content: { type: 'text'; text: string }[]; isError: true; }`
  - `function toToolError(error: unknown): ToolErrorResult`
  - `function registerSearchTicketsTool(server: McpServer, deps: { client: ServiceNowClient }): void`

- [ ] **Step 1: Write the failing test for the error mapper**

Create `src/tool-error.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { toToolError } from './tool-error.js';
import { ValidationError, ServiceNowApiError, AuthError } from './errors.js';

describe('toToolError', () => {
  it('maps a ValidationError to a validation_error tool result', () => {
    const result = toToolError(new ValidationError('unknown ticket_type: bogus'));
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('validation_error: unknown ticket_type: bogus');
  });

  it('maps a ServiceNowApiError to a servicenow_api_error tool result including the status', () => {
    const result = toToolError(new ServiceNowApiError('request failed', 404, {}));
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('servicenow_api_error (404): request failed');
  });

  it('maps an AuthError to an auth_error tool result', () => {
    const result = toToolError(new AuthError('token refresh failed'));
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('auth_error: token refresh failed');
  });

  it('maps an unrecognized error to an internal_error tool result', () => {
    const result = toToolError(new Error('unexpected'));
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('internal_error: unexpected');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/tool-error.test.ts`
Expected: FAIL — `src/tool-error.ts` does not exist yet.

- [ ] **Step 3: Write minimal implementation for the error mapper**

Create `src/tool-error.ts`:

```ts
import { ValidationError, ServiceNowApiError, AuthError } from './errors.js';

export interface ToolErrorResult {
  content: { type: 'text'; text: string }[];
  isError: true;
}

export function toToolError(error: unknown): ToolErrorResult {
  if (error instanceof ValidationError) {
    return { content: [{ type: 'text', text: `validation_error: ${error.message}` }], isError: true };
  }
  if (error instanceof ServiceNowApiError) {
    return {
      content: [{ type: 'text', text: `servicenow_api_error (${error.status}): ${error.message}` }],
      isError: true
    };
  }
  if (error instanceof AuthError) {
    return { content: [{ type: 'text', text: `auth_error: ${error.message}` }], isError: true };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: 'text', text: `internal_error: ${message}` }], isError: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/tool-error.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Write the failing test for `sn-search-tickets`**

Create `src/tools/search-tickets.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createTestClient } from './test-helpers.js';
import type { ServiceNowClient } from '../servicenow/client.js';
import type { AttachmentClient } from '../servicenow/attachments.js';

describe('sn-search-tickets tool', () => {
  it('resolves ticket_type to a table and passes the discriminator-combined query through', async () => {
    const query = vi.fn().mockResolvedValue([{ sys_id: 'a1' }]);
    const { client, cleanup } = await createTestClient({
      client: { query } as unknown as ServiceNowClient,
      attachments: {} as unknown as AttachmentClient
    });

    try {
      const result = await client.callTool({
        name: 'sn-search-tickets',
        arguments: { ticket_type: 'issue', query: 'active=true', limit: 5 }
      });

      expect(result.isError).toBeFalsy();
      expect(query).toHaveBeenCalledWith('sn_customerservice_case', {
        query: 'contact_type=issue^active=true',
        limit: 5,
        offset: undefined,
        fields: undefined
      });
      const content = result.content as { type: string; text: string }[];
      expect(JSON.parse(content[0].text)).toEqual([{ sys_id: 'a1' }]);
    } finally {
      await cleanup();
    }
  });

  it('returns a validation_error for an unknown ticket_type without calling the client', async () => {
    const query = vi.fn();
    const { client, cleanup } = await createTestClient({
      client: { query } as unknown as ServiceNowClient,
      attachments: {} as unknown as AttachmentClient
    });

    try {
      const result = await client.callTool({ name: 'sn-search-tickets', arguments: { ticket_type: 'bogus' } });

      expect(result.isError).toBe(true);
      const content = result.content as { type: string; text: string }[];
      expect(content[0].text).toContain('validation_error');
      expect(query).not.toHaveBeenCalled();
    } finally {
      await cleanup();
    }
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run src/tools/search-tickets.test.ts`
Expected: FAIL — `src/tools/search-tickets.ts` does not exist yet.

- [ ] **Step 7: Write minimal implementation for `sn-search-tickets`**

Create `src/tools/search-tickets.ts`:

```ts
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
```

Modify `src/server.ts`:

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServiceNowClient } from './servicenow/client.js';
import type { AttachmentClient } from './servicenow/attachments.js';
import { registerListTicketTypesTool } from './tools/list-ticket-types.js';
import { registerSearchTicketsTool } from './tools/search-tickets.js';

export interface ServerDeps {
  client: ServiceNowClient;
  attachments: AttachmentClient;
}

export function buildServer(deps: ServerDeps): McpServer {
  const server = new McpServer({ name: 'sn-ticket-mcp-server', version: '0.1.0' });

  registerListTicketTypesTool(server);
  registerSearchTicketsTool(server, deps);

  return server;
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run src/tools/search-tickets.test.ts src/tools/list-ticket-types.test.ts`
Expected: PASS (4 tests total)

- [ ] **Step 9: Commit**

```bash
git add src/tool-error.ts src/tool-error.test.ts src/tools/search-tickets.ts src/tools/search-tickets.test.ts src/server.ts
git commit -m "feat: add shared tool-error mapper and sn-search-tickets tool"
```

---

## Task 10: `sn-get-ticket` Tool

**Files:**
- Create: `src/tools/get-ticket.ts`
- Test: `src/tools/get-ticket.test.ts`
- Modify: `src/server.ts` (register the new tool)

**Interfaces:**
- Consumes: `getTicketType` (Task 4), `toToolError` (Task 9), `ServiceNowClient.getRecord` (Task 6).
- Produces: `function registerGetTicketTool(server: McpServer, deps: { client: ServiceNowClient }): void`

- [ ] **Step 1: Write the failing test**

Create `src/tools/get-ticket.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createTestClient } from './test-helpers.js';
import type { ServiceNowClient } from '../servicenow/client.js';
import type { AttachmentClient } from '../servicenow/attachments.js';

describe('sn-get-ticket tool', () => {
  it('fetches a record by ticket_type and sys_id', async () => {
    const getRecord = vi.fn().mockResolvedValue({ sys_id: 'a1', short_description: 'Test' });
    const { client, cleanup } = await createTestClient({
      client: { getRecord } as unknown as ServiceNowClient,
      attachments: {} as unknown as AttachmentClient
    });

    try {
      const result = await client.callTool({ name: 'sn-get-ticket', arguments: { ticket_type: 'creq', sys_id: 'a1' } });

      expect(result.isError).toBeFalsy();
      expect(getRecord).toHaveBeenCalledWith('change_request', 'a1');
      const content = result.content as { type: string; text: string }[];
      expect(JSON.parse(content[0].text)).toEqual({ sys_id: 'a1', short_description: 'Test' });
    } finally {
      await cleanup();
    }
  });

  it('returns a validation_error for an unknown ticket_type without calling the client', async () => {
    const getRecord = vi.fn();
    const { client, cleanup } = await createTestClient({
      client: { getRecord } as unknown as ServiceNowClient,
      attachments: {} as unknown as AttachmentClient
    });

    try {
      const result = await client.callTool({ name: 'sn-get-ticket', arguments: { ticket_type: 'bogus', sys_id: 'a1' } });

      expect(result.isError).toBe(true);
      expect(getRecord).not.toHaveBeenCalled();
    } finally {
      await cleanup();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/tools/get-ticket.test.ts`
Expected: FAIL — `src/tools/get-ticket.ts` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `src/tools/get-ticket.ts`:

```ts
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getTicketType } from '../ticket-types.js';
import { toToolError } from '../tool-error.js';
import type { ServiceNowClient } from '../servicenow/client.js';

export function registerGetTicketTool(server: McpServer, deps: { client: ServiceNowClient }): void {
  server.registerTool(
    'sn-get-ticket',
    {
      description: 'Fetch a single ServiceNow ticket by ticket_type and sys_id',
      inputSchema: {
        ticket_type: z.string().describe('Ticket type key: inquiry, issue, service_request, or creq'),
        sys_id: z.string().describe('ServiceNow sys_id of the record')
      }
    },
    async ({ ticket_type, sys_id }) => {
      try {
        const type = getTicketType(ticket_type);
        const record = await deps.client.getRecord(type.table, sys_id);
        return { content: [{ type: 'text', text: JSON.stringify(record) }] };
      } catch (error) {
        return toToolError(error);
      }
    }
  );
}
```

Modify `src/server.ts` — add the import and one registration line:

```ts
import { registerGetTicketTool } from './tools/get-ticket.js';
```

```ts
  registerSearchTicketsTool(server, deps);
  registerGetTicketTool(server, deps);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/tools/get-ticket.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/tools/get-ticket.ts src/tools/get-ticket.test.ts src/server.ts
git commit -m "feat: add sn-get-ticket tool"
```

---

## Task 11: `sn-create-ticket` Tool

**Files:**
- Create: `src/tools/create-ticket.ts`
- Test: `src/tools/create-ticket.test.ts`
- Modify: `src/server.ts` (register the new tool)

**Interfaces:**
- Consumes: `getTicketType`, `validateRequiredFields` (Task 4), `toToolError` (Task 9), `ServiceNowClient.createRecord` / `updateRecord` (Task 6).
- Produces: `function registerCreateTicketTool(server: McpServer, deps: { client: ServiceNowClient }): void`

- [ ] **Step 1: Write the failing test**

Create `src/tools/create-ticket.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createTestClient } from './test-helpers.js';
import type { ServiceNowClient } from '../servicenow/client.js';
import type { AttachmentClient } from '../servicenow/attachments.js';

describe('sn-create-ticket tool', () => {
  it('creates a record, applying the discriminator field when the type has one', async () => {
    const createRecord = vi.fn().mockResolvedValue({ sys_id: 'new1', number: 'CS0001' });
    const { client, cleanup } = await createTestClient({
      client: { createRecord } as unknown as ServiceNowClient,
      attachments: {} as unknown as AttachmentClient
    });

    try {
      const result = await client.callTool({
        name: 'sn-create-ticket',
        arguments: { ticket_type: 'issue', fields: { short_description: 'Printer broken' } }
      });

      expect(result.isError).toBeFalsy();
      expect(createRecord).toHaveBeenCalledWith('sn_customerservice_case', {
        short_description: 'Printer broken',
        contact_type: 'issue'
      });
      const content = result.content as { type: string; text: string }[];
      expect(JSON.parse(content[0].text)).toEqual({ sys_id: 'new1', number: 'CS0001' });
    } finally {
      await cleanup();
    }
  });

  it('writes an optional context object verbatim to a work note after creation', async () => {
    const createRecord = vi.fn().mockResolvedValue({ sys_id: 'new1' });
    const updateRecord = vi.fn().mockResolvedValue({ sys_id: 'new1' });
    const { client, cleanup } = await createTestClient({
      client: { createRecord, updateRecord } as unknown as ServiceNowClient,
      attachments: {} as unknown as AttachmentClient
    });

    try {
      await client.callTool({
        name: 'sn-create-ticket',
        arguments: {
          ticket_type: 'creq',
          fields: { short_description: 'Deploy new firewall rule' },
          context: { calling_app: 'agent-ecosystem', requested_by: 'jane.doe' }
        }
      });

      expect(updateRecord).toHaveBeenCalledWith('change_request', 'new1', {
        work_notes: 'context: {"calling_app":"agent-ecosystem","requested_by":"jane.doe"}'
      });
    } finally {
      await cleanup();
    }
  });

  it('returns a validation_error when a required field is missing, without calling the client', async () => {
    const createRecord = vi.fn();
    const { client, cleanup } = await createTestClient({
      client: { createRecord } as unknown as ServiceNowClient,
      attachments: {} as unknown as AttachmentClient
    });

    try {
      const result = await client.callTool({
        name: 'sn-create-ticket',
        arguments: { ticket_type: 'creq', fields: {} }
      });

      expect(result.isError).toBe(true);
      const content = result.content as { type: string; text: string }[];
      expect(content[0].text).toContain('validation_error');
      expect(createRecord).not.toHaveBeenCalled();
    } finally {
      await cleanup();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/tools/create-ticket.test.ts`
Expected: FAIL — `src/tools/create-ticket.ts` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `src/tools/create-ticket.ts`:

```ts
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getTicketType, validateRequiredFields } from '../ticket-types.js';
import { toToolError } from '../tool-error.js';
import type { ServiceNowClient } from '../servicenow/client.js';

export function registerCreateTicketTool(server: McpServer, deps: { client: ServiceNowClient }): void {
  server.registerTool(
    'sn-create-ticket',
    {
      description: 'Create a new ServiceNow ticket for the given ticket_type',
      inputSchema: {
        ticket_type: z.string().describe('Ticket type key: inquiry, issue, service_request, or creq'),
        fields: z.record(z.string(), z.unknown()).describe('Field name/value pairs to set on the new record'),
        context: z
          .record(z.string(), z.unknown())
          .optional()
          .describe('Optional free-form caller/application context, written verbatim to a work note')
      }
    },
    async ({ ticket_type, fields, context }) => {
      try {
        const type = getTicketType(ticket_type);
        validateRequiredFields(type, fields);

        const payload: Record<string, unknown> = { ...fields };
        if (type.discriminatorField && type.discriminatorValue !== undefined) {
          payload[type.discriminatorField] = type.discriminatorValue;
        }

        const created = await deps.client.createRecord(type.table, payload);

        if (context) {
          await deps.client.updateRecord(type.table, created.sys_id as string, {
            work_notes: `context: ${JSON.stringify(context)}`
          });
        }

        return { content: [{ type: 'text', text: JSON.stringify(created) }] };
      } catch (error) {
        return toToolError(error);
      }
    }
  );
}
```

Modify `src/server.ts` — add the import and one registration line:

```ts
import { registerCreateTicketTool } from './tools/create-ticket.js';
```

```ts
  registerGetTicketTool(server, deps);
  registerCreateTicketTool(server, deps);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/tools/create-ticket.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/tools/create-ticket.ts src/tools/create-ticket.test.ts src/server.ts
git commit -m "feat: add sn-create-ticket tool"
```

---

## Task 12: `sn-update-ticket` Tool

**Files:**
- Create: `src/tools/update-ticket.ts`
- Test: `src/tools/update-ticket.test.ts`
- Modify: `src/server.ts` (register the new tool)

**Interfaces:**
- Consumes: `getTicketType` (Task 4), `toToolError` (Task 9), `ServiceNowClient.updateRecord` (Task 6).
- Produces: `function registerUpdateTicketTool(server: McpServer, deps: { client: ServiceNowClient }): void`

- [ ] **Step 1: Write the failing test**

Create `src/tools/update-ticket.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createTestClient } from './test-helpers.js';
import type { ServiceNowClient } from '../servicenow/client.js';
import type { AttachmentClient } from '../servicenow/attachments.js';

describe('sn-update-ticket tool', () => {
  it('updates fields on an existing record', async () => {
    const updateRecord = vi.fn().mockResolvedValue({ sys_id: 'a1', state: '2' });
    const { client, cleanup } = await createTestClient({
      client: { updateRecord } as unknown as ServiceNowClient,
      attachments: {} as unknown as AttachmentClient
    });

    try {
      const result = await client.callTool({
        name: 'sn-update-ticket',
        arguments: { ticket_type: 'creq', sys_id: 'a1', fields: { state: '2' } }
      });

      expect(result.isError).toBeFalsy();
      expect(updateRecord).toHaveBeenCalledWith('change_request', 'a1', { state: '2' });
      const content = result.content as { type: string; text: string }[];
      expect(JSON.parse(content[0].text)).toEqual({ sys_id: 'a1', state: '2' });
    } finally {
      await cleanup();
    }
  });

  it('returns a validation_error for an unknown ticket_type without calling the client', async () => {
    const updateRecord = vi.fn();
    const { client, cleanup } = await createTestClient({
      client: { updateRecord } as unknown as ServiceNowClient,
      attachments: {} as unknown as AttachmentClient
    });

    try {
      const result = await client.callTool({
        name: 'sn-update-ticket',
        arguments: { ticket_type: 'bogus', sys_id: 'a1', fields: { state: '2' } }
      });

      expect(result.isError).toBe(true);
      expect(updateRecord).not.toHaveBeenCalled();
    } finally {
      await cleanup();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/tools/update-ticket.test.ts`
Expected: FAIL — `src/tools/update-ticket.ts` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `src/tools/update-ticket.ts`:

```ts
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getTicketType } from '../ticket-types.js';
import { toToolError } from '../tool-error.js';
import type { ServiceNowClient } from '../servicenow/client.js';

export function registerUpdateTicketTool(server: McpServer, deps: { client: ServiceNowClient }): void {
  server.registerTool(
    'sn-update-ticket',
    {
      description: 'Update fields on an existing ServiceNow ticket',
      inputSchema: {
        ticket_type: z.string().describe('Ticket type key: inquiry, issue, service_request, or creq'),
        sys_id: z.string().describe('ServiceNow sys_id of the record'),
        fields: z.record(z.string(), z.unknown()).describe('Field name/value pairs to update')
      }
    },
    async ({ ticket_type, sys_id, fields }) => {
      try {
        const type = getTicketType(ticket_type);
        const updated = await deps.client.updateRecord(type.table, sys_id, fields);
        return { content: [{ type: 'text', text: JSON.stringify(updated) }] };
      } catch (error) {
        return toToolError(error);
      }
    }
  );
}
```

Modify `src/server.ts` — add the import and one registration line:

```ts
import { registerUpdateTicketTool } from './tools/update-ticket.js';
```

```ts
  registerCreateTicketTool(server, deps);
  registerUpdateTicketTool(server, deps);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/tools/update-ticket.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/tools/update-ticket.ts src/tools/update-ticket.test.ts src/server.ts
git commit -m "feat: add sn-update-ticket tool"
```

---

## Task 13: `sn-upload-attachment` Tool

**Files:**
- Create: `src/tools/upload-attachment.ts`
- Test: `src/tools/upload-attachment.test.ts`
- Modify: `src/server.ts` (register the new tool)

**Interfaces:**
- Consumes: `getTicketType` (Task 4), `toToolError` (Task 9), `AttachmentClient.upload` (Task 7).
- Produces: `function registerUploadAttachmentTool(server: McpServer, deps: { attachments: AttachmentClient }): void`

- [ ] **Step 1: Write the failing test**

Create `src/tools/upload-attachment.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createTestClient } from './test-helpers.js';
import type { ServiceNowClient } from '../servicenow/client.js';
import type { AttachmentClient } from '../servicenow/attachments.js';

describe('sn-upload-attachment tool', () => {
  it('decodes base64 data and uploads it against the resolved table', async () => {
    const upload = vi.fn().mockResolvedValue({ sysId: 'att1', fileName: 'log.txt', contentType: 'text/plain', sizeBytes: 3 });
    const { client, cleanup } = await createTestClient({
      client: {} as unknown as ServiceNowClient,
      attachments: { upload } as unknown as AttachmentClient
    });

    try {
      const result = await client.callTool({
        name: 'sn-upload-attachment',
        arguments: {
          ticket_type: 'creq',
          sys_id: 'rec1',
          file_name: 'log.txt',
          content_type: 'text/plain',
          data_base64: Buffer.from('abc').toString('base64')
        }
      });

      expect(result.isError).toBeFalsy();
      expect(upload).toHaveBeenCalledWith('change_request', 'rec1', 'log.txt', 'text/plain', Buffer.from('abc'));
      const content = result.content as { type: string; text: string }[];
      expect(JSON.parse(content[0].text)).toEqual({
        sysId: 'att1',
        fileName: 'log.txt',
        contentType: 'text/plain',
        sizeBytes: 3
      });
    } finally {
      await cleanup();
    }
  });

  it('returns a validation_error for an unknown ticket_type without calling the client', async () => {
    const upload = vi.fn();
    const { client, cleanup } = await createTestClient({
      client: {} as unknown as ServiceNowClient,
      attachments: { upload } as unknown as AttachmentClient
    });

    try {
      const result = await client.callTool({
        name: 'sn-upload-attachment',
        arguments: {
          ticket_type: 'bogus',
          sys_id: 'rec1',
          file_name: 'log.txt',
          content_type: 'text/plain',
          data_base64: 'YWJj'
        }
      });

      expect(result.isError).toBe(true);
      expect(upload).not.toHaveBeenCalled();
    } finally {
      await cleanup();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/tools/upload-attachment.test.ts`
Expected: FAIL — `src/tools/upload-attachment.ts` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `src/tools/upload-attachment.ts`:

```ts
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getTicketType } from '../ticket-types.js';
import { toToolError } from '../tool-error.js';
import type { AttachmentClient } from '../servicenow/attachments.js';

export function registerUploadAttachmentTool(server: McpServer, deps: { attachments: AttachmentClient }): void {
  server.registerTool(
    'sn-upload-attachment',
    {
      description: 'Upload a file attachment to an existing ServiceNow ticket',
      inputSchema: {
        ticket_type: z.string().describe('Ticket type key: inquiry, issue, service_request, or creq'),
        sys_id: z.string().describe('ServiceNow sys_id of the record to attach to'),
        file_name: z.string(),
        content_type: z.string(),
        data_base64: z.string().describe('Base64-encoded file content')
      }
    },
    async ({ ticket_type, sys_id, file_name, content_type, data_base64 }) => {
      try {
        const type = getTicketType(ticket_type);
        const buffer = Buffer.from(data_base64, 'base64');
        const meta = await deps.attachments.upload(type.table, sys_id, file_name, content_type, buffer);
        return { content: [{ type: 'text', text: JSON.stringify(meta) }] };
      } catch (error) {
        return toToolError(error);
      }
    }
  );
}
```

Modify `src/server.ts` — add the import and one registration line:

```ts
import { registerUploadAttachmentTool } from './tools/upload-attachment.js';
```

```ts
  registerUpdateTicketTool(server, deps);
  registerUploadAttachmentTool(server, deps);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/tools/upload-attachment.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/tools/upload-attachment.ts src/tools/upload-attachment.test.ts src/server.ts
git commit -m "feat: add sn-upload-attachment tool"
```

---

## Task 14: `sn-list-attachments` Tool

**Files:**
- Create: `src/tools/list-attachments.ts`
- Test: `src/tools/list-attachments.test.ts`
- Modify: `src/server.ts` (register the new tool)

**Interfaces:**
- Consumes: `getTicketType` (Task 4), `toToolError` (Task 9), `AttachmentClient.list` (Task 7).
- Produces: `function registerListAttachmentsTool(server: McpServer, deps: { attachments: AttachmentClient }): void`

- [ ] **Step 1: Write the failing test**

Create `src/tools/list-attachments.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createTestClient } from './test-helpers.js';
import type { ServiceNowClient } from '../servicenow/client.js';
import type { AttachmentClient } from '../servicenow/attachments.js';

describe('sn-list-attachments tool', () => {
  it('lists attachments for a resolved table and sys_id', async () => {
    const list = vi.fn().mockResolvedValue([
      { sysId: 'att1', fileName: 'log.txt', contentType: 'text/plain', sizeBytes: 3 }
    ]);
    const { client, cleanup } = await createTestClient({
      client: {} as unknown as ServiceNowClient,
      attachments: { list } as unknown as AttachmentClient
    });

    try {
      const result = await client.callTool({
        name: 'sn-list-attachments',
        arguments: { ticket_type: 'service_request', sys_id: 'rec1' }
      });

      expect(result.isError).toBeFalsy();
      expect(list).toHaveBeenCalledWith('sc_request', 'rec1');
      const content = result.content as { type: string; text: string }[];
      expect(JSON.parse(content[0].text)).toEqual([
        { sysId: 'att1', fileName: 'log.txt', contentType: 'text/plain', sizeBytes: 3 }
      ]);
    } finally {
      await cleanup();
    }
  });

  it('returns a validation_error for an unknown ticket_type without calling the client', async () => {
    const list = vi.fn();
    const { client, cleanup } = await createTestClient({
      client: {} as unknown as ServiceNowClient,
      attachments: { list } as unknown as AttachmentClient
    });

    try {
      const result = await client.callTool({
        name: 'sn-list-attachments',
        arguments: { ticket_type: 'bogus', sys_id: 'rec1' }
      });

      expect(result.isError).toBe(true);
      expect(list).not.toHaveBeenCalled();
    } finally {
      await cleanup();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/tools/list-attachments.test.ts`
Expected: FAIL — `src/tools/list-attachments.ts` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `src/tools/list-attachments.ts`:

```ts
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getTicketType } from '../ticket-types.js';
import { toToolError } from '../tool-error.js';
import type { AttachmentClient } from '../servicenow/attachments.js';

export function registerListAttachmentsTool(server: McpServer, deps: { attachments: AttachmentClient }): void {
  server.registerTool(
    'sn-list-attachments',
    {
      description: 'List existing attachments on a ServiceNow ticket',
      inputSchema: {
        ticket_type: z.string().describe('Ticket type key: inquiry, issue, service_request, or creq'),
        sys_id: z.string().describe('ServiceNow sys_id of the record')
      }
    },
    async ({ ticket_type, sys_id }) => {
      try {
        const type = getTicketType(ticket_type);
        const attachments = await deps.attachments.list(type.table, sys_id);
        return { content: [{ type: 'text', text: JSON.stringify(attachments) }] };
      } catch (error) {
        return toToolError(error);
      }
    }
  );
}
```

Modify `src/server.ts` — add the import and one registration line:

```ts
import { registerListAttachmentsTool } from './tools/list-attachments.js';
```

```ts
  registerUploadAttachmentTool(server, deps);
  registerListAttachmentsTool(server, deps);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/tools/list-attachments.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/tools/list-attachments.ts src/tools/list-attachments.test.ts src/server.ts
git commit -m "feat: add sn-list-attachments tool"
```

---

## Task 15: `sn-get-attachment` Tool

**Files:**
- Create: `src/tools/get-attachment.ts`
- Test: `src/tools/get-attachment.test.ts`
- Modify: `src/server.ts` (register the new tool)

**Interfaces:**
- Consumes: `toToolError` (Task 9), `AttachmentClient.getContent` (Task 7).
- Produces: `function registerGetAttachmentTool(server: McpServer, deps: { attachments: AttachmentClient }): void`

- [ ] **Step 1: Write the failing test**

Create `src/tools/get-attachment.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createTestClient } from './test-helpers.js';
import type { ServiceNowClient } from '../servicenow/client.js';
import type { AttachmentClient } from '../servicenow/attachments.js';

describe('sn-get-attachment tool', () => {
  it('returns file name, content type, and base64-encoded data', async () => {
    const getContent = vi.fn().mockResolvedValue({
      data: Buffer.from('abc'),
      contentType: 'text/plain',
      fileName: 'log.txt'
    });
    const { client, cleanup } = await createTestClient({
      client: {} as unknown as ServiceNowClient,
      attachments: { getContent } as unknown as AttachmentClient
    });

    try {
      const result = await client.callTool({
        name: 'sn-get-attachment',
        arguments: { attachment_sys_id: 'att1' }
      });

      expect(result.isError).toBeFalsy();
      expect(getContent).toHaveBeenCalledWith('att1');
      const content = result.content as { type: string; text: string }[];
      expect(JSON.parse(content[0].text)).toEqual({
        fileName: 'log.txt',
        contentType: 'text/plain',
        dataBase64: Buffer.from('abc').toString('base64')
      });
    } finally {
      await cleanup();
    }
  });

  it('returns a servicenow_api_error tool result when the download fails', async () => {
    const { ServiceNowApiError } = await import('../errors.js');
    const getContent = vi.fn().mockRejectedValue(new ServiceNowApiError('download failed', 500, {}));
    const { client, cleanup } = await createTestClient({
      client: {} as unknown as ServiceNowClient,
      attachments: { getContent } as unknown as AttachmentClient
    });

    try {
      const result = await client.callTool({
        name: 'sn-get-attachment',
        arguments: { attachment_sys_id: 'att1' }
      });

      expect(result.isError).toBe(true);
      const content = result.content as { type: string; text: string }[];
      expect(content[0].text).toContain('servicenow_api_error');
    } finally {
      await cleanup();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/tools/get-attachment.test.ts`
Expected: FAIL — `src/tools/get-attachment.ts` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `src/tools/get-attachment.ts`:

```ts
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { toToolError } from '../tool-error.js';
import type { AttachmentClient } from '../servicenow/attachments.js';

export function registerGetAttachmentTool(server: McpServer, deps: { attachments: AttachmentClient }): void {
  server.registerTool(
    'sn-get-attachment',
    {
      description: "Fetch one attachment's content by its sys_id",
      inputSchema: {
        attachment_sys_id: z.string().describe('sys_id of the sys_attachment record')
      }
    },
    async ({ attachment_sys_id }) => {
      try {
        const content = await deps.attachments.getContent(attachment_sys_id);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                fileName: content.fileName,
                contentType: content.contentType,
                dataBase64: content.data.toString('base64')
              })
            }
          ]
        };
      } catch (error) {
        return toToolError(error);
      }
    }
  );
}
```

Modify `src/server.ts` — add the import and one registration line:

```ts
import { registerGetAttachmentTool } from './tools/get-attachment.js';
```

```ts
  registerListAttachmentsTool(server, deps);
  registerGetAttachmentTool(server, deps);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/tools/get-attachment.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Run the full unit suite to confirm all 8 tools are wired together correctly**

Run: `npx vitest run`
Expected: PASS — every test file created so far passes (config, errors, ticket-types, auth, client, attachments, tool-error, and all 8 tool test files).

- [ ] **Step 6: Commit**

```bash
git add src/tools/get-attachment.ts src/tools/get-attachment.test.ts src/server.ts
git commit -m "feat: add sn-get-attachment tool"
```

---

## Task 16: Streamable HTTP Express App

**Files:**
- Create: `src/app.ts`
- Test: `src/app.test.ts`

**Interfaces:**
- Consumes: `buildServer`, `ServerDeps` from `src/server.ts` (Tasks 8-15).
- Produces: `function createApp(deps: ServerDeps): express.Express` — an Express app with `POST /mcp`, `GET /mcp`, and `DELETE /mcp` wired to the MCP Streamable HTTP transport, in stateful (session-tracked) mode. `src/index.ts` (Task 17) calls `.listen()` on the result; this task only builds and tests the app itself.

- [ ] **Step 1: Write the failing test**

Create `src/app.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app.test.ts`
Expected: FAIL — `src/app.ts` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `src/app.ts`:

```ts
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

  const transports = new Map<string, StreamableHTTPServerTransport>();

  app.post('/mcp', async (req, res) => {
    const sessionId = req.header('mcp-session-id');
    let transport = sessionId ? transports.get(sessionId) : undefined;

    if (!transport && isInitializeRequest(req.body)) {
      const server = buildServer(deps);
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (newSessionId: string) => {
          transports.set(newSessionId, transport as StreamableHTTPServerTransport);
        }
      });
      transport.onclose = () => {
        const sid = transport?.sessionId;
        if (sid) transports.delete(sid);
      };
      await server.connect(transport);
    }

    if (!transport) {
      res.status(400).json({ error: 'No active session and request is not an initialize request' });
      return;
    }

    await transport.handleRequest(req, res, req.body);
  });

  app.get('/mcp', async (req, res) => {
    const sessionId = req.header('mcp-session-id');
    const transport = sessionId ? transports.get(sessionId) : undefined;
    if (!transport) {
      res.status(400).json({ error: 'Unknown session' });
      return;
    }
    await transport.handleRequest(req, res);
  });

  app.delete('/mcp', async (req, res) => {
    const sessionId = req.header('mcp-session-id');
    const transport = sessionId ? transports.get(sessionId) : undefined;
    if (!transport) {
      res.status(400).json({ error: 'Unknown session' });
      return;
    }
    await transport.handleRequest(req, res);
  });

  return app;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/app.ts src/app.test.ts
git commit -m "feat: add Streamable HTTP express app"
```

---

## Task 17: Process Entrypoint

**Files:**
- Create: `src/index.ts`

**Interfaces:**
- Consumes: `loadConfig` (Task 2), `TokenManager` (Task 5), `ServiceNowClient` (Task 6), `AttachmentClient` (Task 7), `createApp` (Task 16).
- Produces: the runnable process entrypoint. No new exported interfaces — this is the wiring root.

This task has no automated test: it starts a real process and, without a real ServiceNow instance, cannot meaningfully call out. Verification is a manual smoke run showing the process starts cleanly and shuts down cleanly, using placeholder-shaped (not necessarily real) credentials — startup and listening do not require ServiceNow itself to be reachable, since no ServiceNow call happens until a tool is invoked.

- [ ] **Step 1: Write the entrypoint**

Create `src/index.ts`:

```ts
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

app.listen(config.port, () => {
  console.log(`sn-ticket-mcp-server listening on port ${config.port}`);
});
```

- [ ] **Step 2: Build the project**

Run: `npm run build`
Expected: compiles with no TypeScript errors; `dist/index.js` and every other `dist/**/*.js` file exist.

- [ ] **Step 3: Manually verify the process starts and listens**

Create a temporary `.env` (not committed — `.gitignore` already excludes it) with placeholder values:

```
PORT=3000
SERVICENOW_INSTANCE_URL=https://dev00000.service-now.com
SERVICENOW_CLIENT_ID=placeholder-client-id
SERVICENOW_CLIENT_SECRET=placeholder-client-secret
SERVICENOW_USERNAME=placeholder-user
SERVICENOW_PASSWORD=placeholder-password
```

Run: `npm run build && npm start`
Expected: the process prints `sn-ticket-mcp-server listening on port 3000` and keeps running (no crash) — since no tool has been invoked yet, no ServiceNow call is made and the placeholder credentials never get used. Stop the process with Ctrl+C once this is confirmed; expected: clean exit.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: add process entrypoint wiring config, ServiceNow client, and the HTTP app"
```

---

## Task 18: Gated Integration Test Suite

**Files:**
- Create: `tests/integration/servicenow.integration.test.ts`

**Interfaces:**
- Consumes: `loadConfig` (Task 2), `TokenManager` (Task 5), `ServiceNowClient` (Task 6), `TICKET_TYPES` (Task 4).
- Produces: nothing new — this is the empirical validation harness the spec calls for, plus the mechanism for resolving the ticket-type table-layout open item against the real dev instance.

This suite is excluded from the default `npm test` run because `vitest.config.ts` (Task 1) only includes `src/**/*.test.ts`; `tests/integration/**` is reached only via the dedicated `npm run test:integration` script, and even then it self-skips unless `RUN_SN_INTEGRATION_TESTS=true` is set — an explicit double opt-in, matching the spec's "gated behind an explicit opt-in environment variable so it never runs unintentionally."

- [ ] **Step 1: Write the integration suite**

Create `tests/integration/servicenow.integration.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { TokenManager } from '../../src/servicenow/auth.js';
import { ServiceNowClient } from '../../src/servicenow/client.js';
import { TICKET_TYPES } from '../../src/ticket-types.js';

const shouldRun = process.env.RUN_SN_INTEGRATION_TESTS === 'true';

describe.skipIf(!shouldRun)('ServiceNow dev instance integration', () => {
  const config = loadConfig();
  const tokenManager = new TokenManager(config.serviceNow);
  const client = new ServiceNowClient(config.serviceNow, tokenManager);

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
```

- [ ] **Step 2: Confirm the suite is skipped by default**

Run: `npm test`
Expected: PASS — this file is not picked up at all (it lives outside `src/`, which is the only directory `vitest.config.ts` includes).

Run: `npx vitest run tests/integration`
Expected: both tests report as **skipped**, not passed or failed, because `RUN_SN_INTEGRATION_TESTS` is unset.

- [ ] **Step 3: Run it against the real dev ServiceNow instance and resolve the ticket-type registry open item**

Set the real dev instance's credentials as environment variables (`SERVICENOW_INSTANCE_URL`, `SERVICENOW_CLIENT_ID`, `SERVICENOW_CLIENT_SECRET`, `SERVICENOW_USERNAME`, `SERVICENOW_PASSWORD`) plus `RUN_SN_INTEGRATION_TESTS=true`, then run:

`npm run test:integration`

Expected: both tests PASS against the real instance. If the first test fails for a given ticket type (e.g. a 404 `ServiceNowApiError` because `sn_customerservice_case` or `sc_request` doesn't exist or isn't queryable on that instance), that is the empirical signal the spec's open item calls for — update that entry's `table` (and `discriminatorField`/`discriminatorValue`, if the real layout differs) in `src/ticket-types.ts`, then re-run `npm run test:integration` until all four tables resolve. This is a registry data change only; no tool code changes.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/servicenow.integration.test.ts
git commit -m "test: add gated integration suite against the real ServiceNow dev instance"
```

If Step 3 required registry changes, commit those separately:

```bash
git add src/ticket-types.ts
git commit -m "fix: correct ticket-type table mapping based on dev instance validation"
```

---

## Self-Review

**Spec coverage:**
- Purpose/Scope (four ticket types, search/get/create/update, attachments, OAuth password grant, Streamable HTTP, no LLM in server) — Tasks 1-18 collectively.
- Architecture Decisions — no LLM layer (every tool handler is deterministic; Tasks 8-15), `@modelcontextprotocol/sdk` not `@ai-sdk/mcp` (Task 8's imports, confirmed against the published `@modelcontextprotocol/sdk@1.30.0` package contents), metadata-driven generic tools (Task 4's registry + 8 generic tools rather than per-type tools), Streamable HTTP transport (Task 16).
- Ticket-type registry + open item — Task 4 (registry with concrete defaults) + Task 18 (empirical validation against the real dev instance, with the exact resolution mechanism).
- 8 tools table — `sn-list-ticket-types` (Task 8), `sn-search-tickets` (Task 9), `sn-get-ticket` (Task 10), `sn-create-ticket` (Task 11), `sn-update-ticket` (Task 12), `sn-upload-attachment` (Task 13), `sn-list-attachments` (Task 14), `sn-get-attachment` (Task 15) — all present, all take `ticket_type` first except `sn-list-ticket-types` and `sn-get-attachment` (which takes `attachment_sys_id` directly, matching the spec's own attachment tool shape).
- Caller/application context open item — Task 11's `context` field, written verbatim to a work note, unvalidated.
- Authentication — Task 5 (password grant, refresh, 30s proactive buffer, fallback to full re-auth, no secret logging — secrets never appear in any log statement in this plan).
- Error handling (3 categories) — Task 3 (types) + Task 9 (mapper) + every tool task's try/catch.
- Testing — unit tests with mocked `fetch` throughout (Tasks 2-16); gated integration suite (Task 18).
- Non-goals — no Key Vault, no sensitive-field masking, no convenience-tool-naming layer anywhere in this plan; confirmed absent by design.

**Placeholder scan:** no "TBD"/"TODO" markers; the one open item called out in the spec (ticket-table layout) has a concrete default implementation (Task 4) plus a concrete, runnable resolution mechanism (Task 18) rather than a deferred marker.

**Type consistency:** `ServerDeps { client: ServiceNowClient; attachments: AttachmentClient }` is defined once in Task 8 and reused verbatim by every subsequent task; `TicketTypeDef`, `ToolErrorResult`, `AttachmentMeta`, `AppConfig`/`ServiceNowConfig` are each defined exactly once and referenced by type-only imports everywhere else. Every `registerXTool(server, deps)` function signature follows the same `(server: McpServer, deps: <subset of ServerDeps>) => void` shape.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-02-sn-ticket-mcp-server.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
