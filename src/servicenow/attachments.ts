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
