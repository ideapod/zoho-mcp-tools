import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";

export interface ZohoSecret {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  teamId?: string;
  mcpApiKey?: string;
  /** Data-center-specific hosts, written by scripts/oauth-setup.ts. */
  accountsBaseUrl?: string;
  apiBaseUrl?: string;
}

let cached: ZohoSecret | undefined;

/**
 * Fetches the Zoho OAuth credentials secret from AWS Secrets Manager, once
 * per warm Lambda execution environment.
 */
export async function loadZohoSecret(secretId: string, region: string): Promise<ZohoSecret> {
  if (cached) return cached;

  const client = new SecretsManagerClient({ region });
  const result = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
  if (!result.SecretString) {
    throw new Error(`Secret ${secretId} has no SecretString payload.`);
  }

  const parsed = JSON.parse(result.SecretString) as Partial<ZohoSecret>;
  if (!parsed.clientId || !parsed.clientSecret || !parsed.refreshToken) {
    throw new Error(`Secret ${secretId} is missing one of clientId, clientSecret, refreshToken.`);
  }

  cached = {
    clientId: parsed.clientId,
    clientSecret: parsed.clientSecret,
    refreshToken: parsed.refreshToken,
    teamId: parsed.teamId,
    mcpApiKey: parsed.mcpApiKey,
    accountsBaseUrl: parsed.accountsBaseUrl,
    apiBaseUrl: parsed.apiBaseUrl,
  };
  return cached;
}
