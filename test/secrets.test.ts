import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendMock = vi.fn();

vi.mock("@aws-sdk/client-secrets-manager", () => {
  class GetSecretValueCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }
  class PutSecretValueCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }
  class SecretsManagerClient {
    send = sendMock;
  }
  return { GetSecretValueCommand, PutSecretValueCommand, SecretsManagerClient };
});

const baseSecret = {
  clientId: "id",
  clientSecret: "secret",
  refreshToken: "refresh",
  accountsBaseUrl: "https://accounts.zoho.com.au",
  apiBaseUrl: "https://sprintsapi.zoho.com.au/zsapi",
};

beforeEach(() => {
  vi.resetModules();
  sendMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadZohoSecret / persistZohoAccessToken", () => {
  it("caches the secret across calls within a warm process", async () => {
    sendMock.mockResolvedValue({ SecretString: JSON.stringify(baseSecret) });
    const { loadZohoSecret } = await import("../src/secrets.js");

    await loadZohoSecret("secret-id", "ap-southeast-2");
    await loadZohoSecret("secret-id", "ap-southeast-2");

    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces a persisted access token to the caller", async () => {
    sendMock.mockResolvedValue({
      SecretString: JSON.stringify({ ...baseSecret, accessToken: "cached-token", accessTokenExpiresAt: 123 }),
    });
    const { loadZohoSecret } = await import("../src/secrets.js");

    const secret = await loadZohoSecret("secret-id", "ap-southeast-2");

    expect(secret.accessToken).toBe("cached-token");
    expect(secret.accessTokenExpiresAt).toBe(123);
  });

  it("persistZohoAccessToken writes the token back into the same secret, preserving other fields", async () => {
    sendMock.mockResolvedValueOnce({ SecretString: JSON.stringify(baseSecret) });
    const { loadZohoSecret, persistZohoAccessToken } = await import("../src/secrets.js");

    await loadZohoSecret("secret-id", "ap-southeast-2");
    sendMock.mockResolvedValueOnce({});
    await persistZohoAccessToken("new-token", 999);

    expect(sendMock).toHaveBeenCalledTimes(2);
    const putCommand = sendMock.mock.calls[1]![0] as { input: { SecretId: string; SecretString: string } };
    expect(putCommand.input.SecretId).toBe("secret-id");
    const written = JSON.parse(putCommand.input.SecretString);
    expect(written).toMatchObject({ ...baseSecret, accessToken: "new-token", accessTokenExpiresAt: 999 });
  });

  it("persistZohoAccessToken is a no-op if the secret was never loaded", async () => {
    const { persistZohoAccessToken } = await import("../src/secrets.js");

    await persistZohoAccessToken("new-token", 999);

    expect(sendMock).not.toHaveBeenCalled();
  });
});
