import type { AccessTokenResponse, ZohoCredentials } from "./types.js";

/**
 * Refreshes and caches a Zoho OAuth access token in memory. A single instance
 * is meant to live for the lifetime of one server process (Lambda execution
 * environment or local dev process) and is shared across requests so warm
 * invocations reuse a still-valid token instead of refreshing every call.
 */
export class ZohoTokenManager {
  private accessToken: string | undefined;
  private expiresAt = 0;
  /** Refresh this many ms before actual expiry to avoid races with in-flight requests. */
  private readonly skewMs = 60_000;

  constructor(
    private readonly credentials: ZohoCredentials,
    private readonly accountsBaseUrl: string,
    /**
     * A still-valid access token to start warm with (e.g. persisted from a
     * previous Lambda execution environment), so a cold start doesn't
     * refresh against Zoho when the last token hasn't expired yet.
     */
    seed?: { accessToken: string; expiresAt: number },
    /** Called with a freshly refreshed token, so callers can persist it (e.g. back to Secrets Manager). */
    private readonly onRefresh?: (accessToken: string, expiresAt: number) => void,
  ) {
    if (seed) {
      this.accessToken = seed.accessToken;
      this.expiresAt = seed.expiresAt;
    }
  }

  async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.expiresAt - this.skewMs) {
      return this.accessToken;
    }
    return this.refresh();
  }

  /** Forces a refresh, e.g. after a 401 from the Sprints API. */
  async refresh(): Promise<string> {
    const url = new URL("/oauth/v2/token", this.accountsBaseUrl);
    url.searchParams.set("grant_type", "refresh_token");
    url.searchParams.set("refresh_token", this.credentials.refreshToken);
    url.searchParams.set("client_id", this.credentials.clientId);
    url.searchParams.set("client_secret", this.credentials.clientSecret);

    const res = await fetch(url, { method: "POST" });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Zoho token refresh failed (${res.status}): ${body}`);
    }
    const data = (await res.json()) as AccessTokenResponse;
    if (!data.access_token) {
      throw new Error(`Zoho token refresh response missing access_token: ${JSON.stringify(data)}`);
    }
    this.accessToken = data.access_token;
    this.expiresAt = Date.now() + data.expires_in * 1000;
    this.onRefresh?.(this.accessToken, this.expiresAt);
    return this.accessToken;
  }
}
