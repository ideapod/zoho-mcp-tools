import { describe, expect, it, vi } from "vitest";
import { registerEpicTools } from "../src/mcp/tools/epics.js";
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
    listEpics: vi.fn(async () => [{ id: "e1", title: "Epic One" }]),
    listProjects: vi.fn(async () => [{ projectId: "proj-1", owner: "owner-1" }]),
    createEpic: vi.fn(async (_p: string, fields: Record<string, unknown>) => ({
      id: "new-e1",
      title: fields.name,
      ...fields,
    })),
    ...overrides,
  } as unknown as SprintsClient;
}

describe("epic tools", () => {
  it("create_epic defaults owner to the project's owner when not given", async () => {
    const server = fakeServer();
    const client = fakeClient();
    registerEpicTools(server as never, client);

    const result = await server.tools.get("create_epic")!({ projectId: "proj-1", name: "Launch" });
    const epic = JSON.parse(result.content[0]!.text);

    expect(epic).toMatchObject({ id: "new-e1", title: "Launch" });
    expect(client.createEpic).toHaveBeenCalledWith("proj-1", { name: "Launch", owner: "owner-1" });
  });

  it("create_epic uses an explicit owner over the project default", async () => {
    const server = fakeServer();
    const client = fakeClient();
    registerEpicTools(server as never, client);

    await server.tools.get("create_epic")!({ projectId: "proj-1", name: "Launch", owner: "explicit-1" });

    expect(client.createEpic).toHaveBeenCalledWith("proj-1", { name: "Launch", owner: "explicit-1" });
    expect(client.listProjects).not.toHaveBeenCalled();
  });

  it("create_epic errors out when no owner is given and the project has none on record", async () => {
    const server = fakeServer();
    const client = fakeClient({ listProjects: vi.fn(async () => [{ projectId: "proj-1" }]) });
    registerEpicTools(server as never, client);

    const result = await server.tools.get("create_epic")!({ projectId: "proj-1", name: "Launch" });

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/Could not determine an owner/);
  });
});
