import { describe, expect, it, vi } from "vitest";
import { registerAttachmentTools } from "../src/mcp/tools/attachments.js";
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
    addItemAttachment: vi.fn(async () => ({ FILENAME: "repro.png", RESOURCE_ID: "r-1" })),
    ...overrides,
  } as unknown as SprintsClient;
}

describe("add_item_attachment tool", () => {
  it("decodes the base64 body and delegates to the client", async () => {
    const server = fakeServer();
    const client = fakeClient();
    registerAttachmentTools(server as never, client);

    const fileContentBase64 = Buffer.from("hello").toString("base64");
    const result = await server.tools.get("add_item_attachment")!({
      projectId: "proj-1",
      itemId: "item-1",
      fileName: "repro.png",
      fileContentBase64,
      mimeType: "image/png",
    });

    expect(client.addItemAttachment).toHaveBeenCalledWith(
      "proj-1",
      "item-1",
      "repro.png",
      Buffer.from("hello"),
      "image/png",
      undefined,
    );
    expect(JSON.parse(result.content[0]!.text)).toMatchObject({ FILENAME: "repro.png" });
  });

  it("rejects a base64 payload that decodes to an empty file", async () => {
    const server = fakeServer();
    const client = fakeClient();
    registerAttachmentTools(server as never, client);

    const result = await server.tools.get("add_item_attachment")!({
      projectId: "proj-1",
      itemId: "item-1",
      fileName: "empty.png",
      fileContentBase64: "",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/empty file/);
    expect(client.addItemAttachment).not.toHaveBeenCalled();
  });
});
