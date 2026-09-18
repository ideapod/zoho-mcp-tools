import { afterEach, describe, expect, it, vi } from "vitest";
import { ZohoTokenManager } from "../src/zoho/oauth.js";

const credentials = { clientId: "id", clientSecret: "secret", refreshToken: "refresh" };

function mockFetchOnce(response: Record<string, unknown>, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => response,
    text: async () => JSON.stringify(response),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ZohoTokenManager", () => {
  it("fetches a new access token on first use", async () => {
    const fetchMock = mockFetchOnce({ access_token: "token-1", expires_in: 3600 });
    vi.stubGlobal("fetch", fetchMock);

    const manager = new ZohoTokenManager(credentials, "https://accounts.zoho.com");
    const token = await manager.getAccessToken();

    expect(token).toBe("token-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = fetchMock.mock.calls[0]![0] as URL;
    expect(calledUrl.pathname).toBe("/oauth/v2/token");
    expect(calledUrl.searchParams.get("grant_type")).toBe("refresh_token");
    expect(calledUrl.searchParams.get("refresh_token")).toBe("refresh");
  });

  it("reuses a cached token that hasn't expired", async () => {
    const fetchMock = mockFetchOnce({ access_token: "token-1", expires_in: 3600 });
    vi.stubGlobal("fetch", fetchMock);

    const manager = new ZohoTokenManager(credentials, "https://accounts.zoho.com");
    await manager.getAccessToken();
    await manager.getAccessToken();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws when the refresh response has no access_token", async () => {
    const fetchMock = mockFetchOnce({});
    vi.stubGlobal("fetch", fetchMock);

    const manager = new ZohoTokenManager(credentials, "https://accounts.zoho.com");
    await expect(manager.getAccessToken()).rejects.toThrow(/missing access_token/);
  });

  it("throws with the response body when the HTTP call fails", async () => {
    const fetchMock = mockFetchOnce({ error: "invalid_client" }, false, 400);
    vi.stubGlobal("fetch", fetchMock);

    const manager = new ZohoTokenManager(credentials, "https://accounts.zoho.com");
    await expect(manager.getAccessToken()).rejects.toThrow(/400/);
  });

  it("reuses a seeded token instead of refreshing when it hasn't expired", async () => {
    const fetchMock = mockFetchOnce({ access_token: "should-not-be-used", expires_in: 3600 });
    vi.stubGlobal("fetch", fetchMock);

    const manager = new ZohoTokenManager(credentials, "https://accounts.zoho.com", {
      accessToken: "seeded-token",
      expiresAt: Date.now() + 3600_000,
    });
    const token = await manager.getAccessToken();

    expect(token).toBe("seeded-token");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refreshes when the seeded token is already expired", async () => {
    const fetchMock = mockFetchOnce({ access_token: "fresh-token", expires_in: 3600 });
    vi.stubGlobal("fetch", fetchMock);

    const manager = new ZohoTokenManager(credentials, "https://accounts.zoho.com", {
      accessToken: "stale-token",
      expiresAt: Date.now() - 1,
    });
    const token = await manager.getAccessToken();

    expect(token).toBe("fresh-token");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("calls onRefresh with the new token and expiry after a real refresh", async () => {
    const fetchMock = mockFetchOnce({ access_token: "token-1", expires_in: 3600 });
    vi.stubGlobal("fetch", fetchMock);
    const onRefresh = vi.fn();

    const manager = new ZohoTokenManager(credentials, "https://accounts.zoho.com", undefined, onRefresh);
    const before = Date.now();
    await manager.getAccessToken();

    expect(onRefresh).toHaveBeenCalledTimes(1);
    const [token, expiresAt] = onRefresh.mock.calls[0]!;
    expect(token).toBe("token-1");
    expect(expiresAt).toBeGreaterThanOrEqual(before + 3600_000);
  });
});
