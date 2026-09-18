import { describe, expect, it, vi } from "vitest";
import { registerBacklogTools } from "../src/mcp/tools/backlog.js";
import type { SprintsClient } from "../src/zoho/sprintsClient.js";

type ToolCallback = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;

/** Minimal fake of McpServer that just captures registered tool callbacks by name. */
function fakeServer() {
  const tools = new Map<string, ToolCallback>();
  return {
    registerTool: (name: string, _config: unknown, cb: ToolCallback) => {
      tools.set(name, cb);
    },
    tools,
  };
}

function fakeClient(overrides: Partial<Record<keyof SprintsClient, unknown>> = {}): SprintsClient {
  return {
    getProjectBacklogId: vi.fn(async () => "backlog-1"),
    listItems: vi.fn(async () => [
      { id: "1", title: "Item A", status: { id: "s1", name: "To Do" } },
      { id: "2", title: "Item B", status: { id: "s2", name: "Done" } },
    ]),
    getItemStatuses: vi.fn(async () => [
      { id: "s1", name: "To Do" },
      { id: "s2", name: "Done" },
    ]),
    listEpics: vi.fn(async () => [{ id: "e1", title: "Epic One" }]),
    getPriorities: vi.fn(async () => [{ id: "p1", name: "High" }]),
    getItemTypes: vi.fn(async () => [{ id: "t1", name: "Bug" }]),
    getItem: vi.fn(async () => ({ id: "1", title: "Item A" })),
    listItemComments: vi.fn(async () => []),
    updateItem: vi.fn(async (_p: string, _s: string, id: string, fields: Record<string, unknown>) => ({
      id,
      ...fields,
    })),
    createItem: vi.fn(async (_p: string, _s: string, fields: Record<string, unknown>) => ({
      id: "new-1",
      ...fields,
    })),
    ...overrides,
  } as unknown as SprintsClient;
}

describe("backlog tools", () => {
  it("list_backlog_items filters by status name", async () => {
    const server = fakeServer();
    const client = fakeClient();
    registerBacklogTools(server as never, client);

    const result = await server.tools.get("list_backlog_items")!({ projectId: "proj-1", status: "Done" });
    const items = JSON.parse(result.content[0]!.text);

    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("2");
  });

  it("move_item_status resolves a status name to an ID and calls updateItem", async () => {
    const server = fakeServer();
    const client = fakeClient();
    registerBacklogTools(server as never, client);

    const result = await server.tools.get("move_item_status")!({
      projectId: "proj-1",
      itemId: "1",
      status: "Done",
    });

    expect(client.updateItem).toHaveBeenCalledWith("proj-1", "backlog-1", "1", { statusid: "s2" });
    expect(JSON.parse(result.content[0]!.text)).toMatchObject({ id: "1", statusid: "s2" });
  });

  it("move_item_status returns an error result for an unknown status", async () => {
    const server = fakeServer();
    const client = fakeClient();
    registerBacklogTools(server as never, client);

    const result = await server.tools.get("move_item_status")!({
      projectId: "proj-1",
      itemId: "1",
      status: "Nonexistent",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/No statuses found/);
  });

  it("create_item resolves item type, priority, and epic names to IDs", async () => {
    const server = fakeServer();
    const client = fakeClient();
    registerBacklogTools(server as never, client);

    await server.tools.get("create_item")!({
      projectId: "proj-1",
      title: "New bug",
      itemType: "Bug",
      priority: "High",
      epic: "Epic One",
    });

    expect(client.createItem).toHaveBeenCalledWith("proj-1", "backlog-1", {
      name: "New bug",
      projitemtypeid: "t1",
      projpriorityid: "p1",
      epicid: "e1",
    });
  });

  it("update_item only sends fields that were provided", async () => {
    const server = fakeServer();
    const client = fakeClient();
    registerBacklogTools(server as never, client);

    await server.tools.get("update_item")!({ projectId: "proj-1", itemId: "1", title: "Renamed" });

    expect(client.updateItem).toHaveBeenCalledWith("proj-1", "backlog-1", "1", { name: "Renamed" });
  });

  it("update_item errors when no fields are provided", async () => {
    const server = fakeServer();
    const client = fakeClient();
    registerBacklogTools(server as never, client);

    const result = await server.tools.get("update_item")!({ projectId: "proj-1", itemId: "1" });

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/No fields to update/);
  });
});
