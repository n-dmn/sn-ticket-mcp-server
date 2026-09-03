import { ServiceNowApiError, ValidationError, extractServiceNowMessage } from '../errors.js';
import type { ServiceNowConfig } from '../config.js';
import type { TokenManager } from './auth.js';

const SYS_ID_PATTERN = /^[0-9a-f]{32}$/i;

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

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
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

    console.log(`[servicenow-attachments] POST /api/now/attachment/file table=${table} sys_id=${recordSysId} file=${fileName}`);
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
    if (!SYS_ID_PATTERN.test(recordSysId)) {
      throw new ValidationError(`Invalid record sys_id: ${recordSysId}`);
    }

    const token = await this.tokenManager.getAccessToken();
    const params = new URLSearchParams({ sysparm_query: `table_name=${table}^table_sys_id=${recordSysId}` });

    console.log(`[servicenow-attachments] GET sys_attachment table=${table} sys_id=${recordSysId}`);
    const response = await this.fetchImpl(
      `${this.config.instanceUrl}/api/now/table/sys_attachment?${params.toString()}`,
      { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }
    );

    const json = await this.parseJson(response);
    return (json.result as RawAttachmentRecord[]).map(toAttachmentMeta);
  }

  async getContent(attachmentSysId: string): Promise<{ data: Buffer; contentType: string; fileName: string }> {
    const token = await this.tokenManager.getAccessToken();

    console.log(`[servicenow-attachments] GET sys_attachment/${attachmentSysId}`);
    const metaResponse = await this.fetchImpl(
      `${this.config.instanceUrl}/api/now/table/sys_attachment/${attachmentSysId}`,
      { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }
    );
    const metaJson = await this.parseJson(metaResponse);
    const meta = toAttachmentMeta(metaJson.result as RawAttachmentRecord);

    console.log(`[servicenow-attachments] GET attachment/${attachmentSysId}/file`);
    const fileResponse = await this.fetchImpl(`${this.config.instanceUrl}/api/now/attachment/${attachmentSysId}/file`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!fileResponse.ok) {
      const text = await fileResponse.text();
      console.error(
        `[servicenow-attachments] attachment/${attachmentSysId}/file failed status=${fileResponse.status} body=${text}`
      );
      const snMessage = extractServiceNowMessage(safeJsonParse(text));
      const message = snMessage
        ? `ServiceNow attachment download failed with status ${fileResponse.status}: ${snMessage}`
        : `ServiceNow attachment download failed with status ${fileResponse.status}`;
      throw new ServiceNowApiError(message, fileResponse.status, text);
    }

    const arrayBuffer = await fileResponse.arrayBuffer();
    return { data: Buffer.from(arrayBuffer), contentType: meta.contentType, fileName: meta.fileName };
  }

  private async parseJson(response: Response): Promise<{ result: unknown }> {
    const text = await response.text();
    const json = text ? JSON.parse(text) : {};
    if (!response.ok) {
      console.error(`[servicenow-attachments] request failed status=${response.status} body=${text}`);
      const snMessage = extractServiceNowMessage(json);
      const message = snMessage
        ? `ServiceNow API request failed with status ${response.status}: ${snMessage}`
        : `ServiceNow API request failed with status ${response.status}`;
      throw new ServiceNowApiError(message, response.status, json);
    }
    return json as { result: unknown };
  }
}
