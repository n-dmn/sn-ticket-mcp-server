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
