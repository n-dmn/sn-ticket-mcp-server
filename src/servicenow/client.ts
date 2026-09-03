import { ServiceNowApiError, extractServiceNowMessage } from '../errors.js';
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
    const url = `${this.config.instanceUrl}${path}`;
    console.log(`[servicenow-client] ${method} ${url}`);

    const response = await this.fetchImpl(url, {
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
      console.error(`[servicenow-client] ${method} ${url} failed status=${response.status} body=${text}`);
      const snMessage = extractServiceNowMessage(json);
      const message = snMessage
        ? `ServiceNow API request failed with status ${response.status}: ${snMessage}`
        : `ServiceNow API request failed with status ${response.status}`;
      throw new ServiceNowApiError(message, response.status, json);
    }

    console.log(`[servicenow-client] ${method} ${url} -> ${response.status}`);
    return json.result;
  }
}
