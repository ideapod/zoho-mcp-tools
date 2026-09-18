import { afterEach, describe, expect, it, vi } from "vitest";
import { SprintsApiError, SprintsClient } from "../src/zoho/sprintsClient.js";
import type { ZohoTokenManager } from "../src/zoho/oauth.js";

function fakeTokenManager(tokens: string[] = ["token-1"]): ZohoTokenManager {
  let i = 0;
  return {
    getAccessToken: vi.fn(async () => tokens[Math.min(i, tokens.length - 1)]),
    refresh: vi.fn(async () => tokens[Math.min(++i, tokens.length - 1)]),
  } as unknown as ZohoTokenManager;
}

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SprintsClient", () => {
  it("auto-selects the team ID when exactly one workspace is accessible", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ status: "success", portals: [{ zsoid: "111", teamName: "Acme" }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new SprintsClient(fakeTokenManager(), "https://sprintsapi.zoho.com/zsapi");
    const teamId = await client.ensureTeamId();

    expect(teamId).toBe("111");
  });

  it("throws when multiple workspaces are accessible and no team ID was configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        status: "success",
        portals: [
          { zsoid: "111", teamName: "Acme" },
          { zsoid: "222", teamName: "Other" },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new SprintsClient(fakeTokenManager(), "https://sprintsapi.zoho.com/zsapi");
    await expect(client.ensureTeamId()).rejects.toThrow(/Multiple Zoho Sprints workspaces/);
  });

  it("skips the workspace lookup when a team ID is already configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const client = new SprintsClient(fakeTokenManager(), "https://sprintsapi.zoho.com/zsapi", "999");
    const teamId = await client.ensureTeamId();

    expect(teamId).toBe("999");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("retries once with a refreshed token after a 401", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ status: "failure" }, 401))
      .mockResolvedValueOnce(jsonResponse({ status: "success", item: { id: "1", title: "Retried" } }));
    vi.stubGlobal("fetch", fetchMock);

    const tokenManager = fakeTokenManager(["expired", "fresh"]);
    const client = new SprintsClient(tokenManager, "https://sprintsapi.zoho.com/zsapi", "111");
    const item = await client.getItem("proj-1", "backlog-1", "1");

    expect(item).toEqual({ id: "1", title: "Retried" });
    expect(tokenManager.refresh).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws a SprintsApiError when the API reports failure", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: "failure", errorCode: 7600 }, 200));
    vi.stubGlobal("fetch", fetchMock);

    const client = new SprintsClient(fakeTokenManager(), "https://sprintsapi.zoho.com/zsapi", "111");
    await expect(client.getItem("proj-1", "backlog-1", "1")).rejects.toBeInstanceOf(SprintsApiError);
  });

  it("builds listItems query params with sensible defaults", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: "success", item: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new SprintsClient(fakeTokenManager(), "https://sprintsapi.zoho.com/zsapi", "111");
    await client.listItems("proj-1", "backlog-1");

    const url = fetchMock.mock.calls[0]![0] as URL;
    expect(url.pathname).toBe("/zsapi/team/111/projects/proj-1/sprints/backlog-1/item/");
    expect(url.searchParams.get("action")).toBe("data");
    expect(url.searchParams.get("index")).toBe("1");
    expect(url.searchParams.get("range")).toBe("100");
  });

  it("sends update fields as a JSON POST body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: "success", item: { id: "1" } }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new SprintsClient(fakeTokenManager(), "https://sprintsapi.zoho.com/zsapi", "111");
    await client.updateItem("proj-1", "backlog-1", "item-1", { statusid: "42" });

    const init = fetchMock.mock.calls[0]![1] as { method: string; body: string };
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ statusid: "42" });
  });
});
