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
