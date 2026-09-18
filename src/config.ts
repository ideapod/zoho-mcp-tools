import { loadZohoSecret } from "./secrets.js";
import type { ZohoConfig } from "./zoho/types.js";

/**
 * Builds the Zoho config for this process.
 *
 * - In Lambda, ZOHO_SECRET_ID points at the AWS Secrets Manager secret
 *   holding { clientId, clientSecret, refreshToken, teamId? } and credentials
 *   are fetched at cold start.
 * - Locally, the same fields are read directly from environment variables so
 *   you don't need AWS credentials just to run/test the server.
 */
export async function loadConfig(): Promise<ZohoConfig> {
  const accountsBaseUrl = process.env.ZOHO_ACCOUNTS_BASE_URL ?? "https://accounts.zoho.com";
  const apiBaseUrl = process.env.ZOHO_API_BASE_URL ?? "https://sprintsapi.zoho.com/zsapi";

  const secretId = process.env.ZOHO_SECRET_ID;
  if (secretId) {
    const region = process.env.AWS_REGION ?? "ap-southeast-2";
    const secret = await loadZohoSecret(secretId, region);
    return {
      clientId: secret.clientId,
      clientSecret: secret.clientSecret,
      refreshToken: secret.refreshToken,
      teamId: secret.teamId ?? process.env.ZOHO_TEAM_ID,
      mcpApiKey: secret.mcpApiKey ?? process.env.MCP_API_KEY,
      accountsBaseUrl,
      apiBaseUrl,
    };
  }

  const clientId = process.env.ZOHO_CLIENT_ID;
  const clientSecret = process.env.ZOHO_CLIENT_SECRET;
  const refreshToken = process.env.ZOHO_REFRESH_TOKEN;

  const missing = [
    ["ZOHO_CLIENT_ID", clientId],
    ["ZOHO_CLIENT_SECRET", clientSecret],
    ["ZOHO_REFRESH_TOKEN", refreshToken],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length > 0) {
    throw new Error(
      `Missing Zoho credentials. Set ZOHO_SECRET_ID (AWS Secrets Manager) or ${missing.join(", ")} (local dev).`,
    );
  }

  return {
    clientId: clientId!,
    clientSecret: clientSecret!,
    refreshToken: refreshToken!,
    teamId: process.env.ZOHO_TEAM_ID,
    mcpApiKey: process.env.MCP_API_KEY,
    accountsBaseUrl,
    apiBaseUrl,
  };
}
