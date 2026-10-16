import { describe, expect, it, vi } from "vitest";
import { registerChecklistTools } from "../src/mcp/tools/checklists.js";
import type { SprintsClient } from "../src/zoho/sprintsClient.js";

type ToolCallback = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;

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
    listItemChecklists: vi.fn(async () => [{ groupId: "g-1", name: "Steps", items: [] }]),
    addChecklistGroup: vi.fn(async () => ({ groupId: "g-1", createdBy: "u-1" })),
    addChecklistItems: vi.fn(async () => undefined),
    updateChecklistItem: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as SprintsClient;
}

describe("checklist tools", () => {
  it("add_item_checklist creates a default 'Steps' group and owns steps as the group creator", async () => {
    const server = fakeServer();
    const client = fakeClient();
    registerChecklistTools(server as never, client);

    await server.tools.get("add_item_checklist")!({ projectId: "p", itemId: "i", steps: ["a", "b"] });

    expect(client.addChecklistGroup).toHaveBeenCalledWith("p", "i", "Steps", undefined);
    expect(client.addChecklistItems).toHaveBeenCalledWith("p", "i", "g-1", ["a", "b"], "u-1", undefined);
  });

  it("add_item_checklist appends to an existing group without creating one", async () => {
    const server = fakeServer();
    const client = fakeClient({
      listItemChecklists: vi.fn(async () => [{ groupId: "g-9", name: "X", items: [{ ownerId: "u-7" }] }]),
    });
    registerChecklistTools(server as never, client);

    await server.tools.get("add_item_checklist")!({ projectId: "p", itemId: "i", steps: ["a"], groupId: "g-9" });

    expect(client.addChecklistGroup).not.toHaveBeenCalled();
    expect(client.addChecklistItems).toHaveBeenCalledWith("p", "i", "g-9", ["a"], "u-7", undefined);
  });

  it("update_checklist_item requires done and/or name", async () => {
    const server = fakeServer();
    const client = fakeClient();
    registerChecklistTools(server as never, client);

    const result = await server.tools.get("update_checklist_item")!({
      projectId: "p",
      itemId: "i",
      groupId: "g",
      checklistItemId: "c",
    });

    expect(result.isError).toBe(true);
    expect(client.updateChecklistItem).not.toHaveBeenCalled();
  });
});
