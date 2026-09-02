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

// ServiceNow's REST API error envelope: { error: { message, detail }, status }
export function extractServiceNowMessage(body: unknown): string | undefined {
  if (!body || typeof body !== 'object' || !('error' in body)) return undefined;
  const err = (body as { error?: unknown }).error;
  if (!err || typeof err !== 'object' || !('message' in err)) return undefined;
  const message = (err as { message?: unknown }).message;
  return typeof message === 'string' && message.length > 0 ? message : undefined;
}
