import { GetSecretValueCommand, PutSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";

export interface ZohoSecret {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  teamId?: string;
  mcpApiKey?: string;
  /** Data-center-specific hosts, written by scripts/oauth-setup.ts. */
  accountsBaseUrl?: string;
  apiBaseUrl?: string;
  /**
   * A still-valid Zoho access token and its expiry (ms epoch), persisted
   * here by persistZohoAccessToken() so a cold start can reuse it instead of
   * refreshing against Zoho every time - see that function for why this
   * matters.
   */
  accessToken?: string;
  accessTokenExpiresAt?: number;
}

let cached: ZohoSecret | undefined;
let cachedSecretId: string | undefined;
let cachedRegion: string | undefined;

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
    accessToken: parsed.accessToken,
    accessTokenExpiresAt: parsed.accessTokenExpiresAt,
  };
  cachedSecretId = secretId;
  cachedRegion = region;
  return cached;
}

/**
 * Writes a freshly refreshed Zoho access token back into the same secret so
 * the next cold start can reuse it instead of hitting Zoho's refresh
 * endpoint again. Without this, a container that churns roughly every 30s
 * (e.g. an MCP client's keep-alive reconnects, which don't share in-memory
 * state across Lambda execution environments) re-refreshes continuously
 * even though Zoho's tokens last an hour - which Zoho's own abuse
 * protection responds to with invalid_client. No-ops if the config wasn't
 * loaded from Secrets Manager (e.g. local dev via plain env vars).
 */
export async function persistZohoAccessToken(accessToken: string, expiresAt: number): Promise<void> {
  if (!cached || !cachedSecretId || !cachedRegion) return;

  cached = { ...cached, accessToken, accessTokenExpiresAt: expiresAt };
  const client = new SecretsManagerClient({ region: cachedRegion });
  await client.send(new PutSecretValueCommand({ SecretId: cachedSecretId, SecretString: JSON.stringify(cached) }));
}
