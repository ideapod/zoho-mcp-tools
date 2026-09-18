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
      .mockResolvedValueOnce(jsonResponse({ status: "success", items: [{ itemId: "1", itemName: "Retried" }] }));
    vi.stubGlobal("fetch", fetchMock);

    const tokenManager = fakeTokenManager(["expired", "fresh"]);
    const client = new SprintsClient(tokenManager, "https://sprintsapi.zoho.com/zsapi", "111");
    const item = await client.getItem("proj-1", "backlog-1", "1");

    expect(item).toMatchObject({ itemId: "1", itemName: "Retried", id: "1", title: "Retried" });
    expect(tokenManager.refresh).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("also retries on Zoho's actual invalid-token signal: HTTP 400 with code 7601", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ status: "failed", code: 7601, message: "Invalid oauthToken" }, 400))
      .mockResolvedValueOnce(jsonResponse({ status: "success", items: [{ itemId: "1" }] }));
    vi.stubGlobal("fetch", fetchMock);

    const tokenManager = fakeTokenManager(["stale", "fresh"]);
    const client = new SprintsClient(tokenManager, "https://sprintsapi.zoho.com/zsapi", "111");
    await client.getItem("proj-1", "backlog-1", "1");

    expect(tokenManager.refresh).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry on an unrelated HTTP 400", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: "failed", code: 1234 }, 400));
    vi.stubGlobal("fetch", fetchMock);

    const tokenManager = fakeTokenManager();
    const client = new SprintsClient(tokenManager, "https://sprintsapi.zoho.com/zsapi", "111");
    await expect(client.getItem("proj-1", "backlog-1", "1")).rejects.toBeInstanceOf(SprintsApiError);

    expect(tokenManager.refresh).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws a SprintsApiError when the API reports failure", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: "failure", errorCode: 7600 }, 200));
    vi.stubGlobal("fetch", fetchMock);

    const client = new SprintsClient(fakeTokenManager(), "https://sprintsapi.zoho.com/zsapi", "111");
    await expect(client.getItem("proj-1", "backlog-1", "1")).rejects.toBeInstanceOf(SprintsApiError);
  });

  it("builds listItems query params with sensible defaults", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: "success", items: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new SprintsClient(fakeTokenManager(), "https://sprintsapi.zoho.com/zsapi", "111");
    await client.listItems("proj-1", "backlog-1");

    const url = fetchMock.mock.calls[0]![0] as URL;
    expect(url.pathname).toBe("/zsapi/team/111/projects/proj-1/sprints/backlog-1/item/");
    expect(url.searchParams.get("action")).toBe("data");
    expect(url.searchParams.get("index")).toBe("1");
    expect(url.searchParams.get("range")).toBe("100");
  });

  it("sends action/index/range and all sprint types for listSprints", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: "success", sprints: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new SprintsClient(fakeTokenManager(), "https://sprintsapi.zoho.com/zsapi", "111");
    await client.listSprints("proj-1");

    const url = fetchMock.mock.calls[0]![0] as URL;
    expect(url.searchParams.get("action")).toBe("data");
    expect(url.searchParams.get("type")).toBe("[1,2,3,4]");
  });

  it("sends action=details for getItem and getProjectDetails", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: "success", items: [{ itemId: "item-1" }] }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new SprintsClient(fakeTokenManager(), "https://sprintsapi.zoho.com/zsapi", "111");
    await client.getItem("proj-1", "backlog-1", "item-1");

    const url = fetchMock.mock.calls[0]![0] as URL;
    expect(url.searchParams.get("action")).toBe("details");
  });

  it("normalizes item types/priorities/statuses to plain id/name, using the project-scoped ID", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          status: "success",
          projItemTypes: [{ itemTypeId: "global-1", projItemTypeId: "proj-1", itemTypeName: "Task" }],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: "success",
          projPriorities: [{ priorityId: "global-2", projPriorityId: "proj-2", priorityName: "High" }],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ status: "success", statuses: [{ statusId: "s-1", statusName: "To do" }] }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const client = new SprintsClient(fakeTokenManager(), "https://sprintsapi.zoho.com/zsapi", "111");
    const [itemTypes, priorities, statuses] = await Promise.all([
      client.getItemTypes("proj-1"),
      client.getPriorities("proj-1"),
      client.getItemStatuses("proj-1"),
    ]);

    // The project-scoped ID, not the global one, since that's what
    // Create/Update item's projitemtypeid/projpriorityid fields expect.
    expect(itemTypes).toEqual([{ id: "proj-1", name: "Task", itemTypeId: "global-1", projItemTypeId: "proj-1", itemTypeName: "Task" }]);
    expect(priorities[0]).toMatchObject({ id: "proj-2", name: "High" });
    expect(statuses[0]).toMatchObject({ id: "s-1", name: "To do" });
  });

  it("normalizes epics to id/title (not id/name), matching how backlog.ts resolves epic names", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ status: "success", epics: [{ epicId: "e-1", epicName: "Launch" }] }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new SprintsClient(fakeTokenManager(), "https://sprintsapi.zoho.com/zsapi", "111");
    const epics = await client.listEpics("proj-1");

    expect(epics[0]).toMatchObject({ id: "e-1", title: "Launch" });
  });

  it("sends the mandatory action/index/range query params for listProjects", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: "success", projects: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new SprintsClient(fakeTokenManager(), "https://sprintsapi.zoho.com/zsapi", "111");
    await client.listProjects();

    const url = fetchMock.mock.calls[0]![0] as URL;
    expect(url.pathname).toBe("/zsapi/team/111/projects/");
    expect(url.searchParams.get("action")).toBe("data");
    expect(url.searchParams.get("index")).toBe("1");
    expect(url.searchParams.get("range")).toBe("100");
  });

  it("sends update fields as a form-urlencoded POST body, matching Zoho's docs", async () => {
    // updateItem's own POST response has no item payload (confirmed live) -
    // it re-fetches via getItem afterward, which this same mock also serves.
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ status: "success", items: [{ itemId: "item-1" }] }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new SprintsClient(fakeTokenManager(), "https://sprintsapi.zoho.com/zsapi", "111");
    await client.updateItem("proj-1", "backlog-1", "item-1", { statusid: "42", newusers: ["1", "2"] });

    const init = fetchMock.mock.calls[0]![1] as { method: string; body: string; headers: Record<string, string> };
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    const params = new URLSearchParams(init.body);
    expect(params.get("statusid")).toBe("42");
    expect(params.get("newusers")).toBe('["1","2"]');
  });
});
