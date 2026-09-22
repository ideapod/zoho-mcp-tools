import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SprintsClient } from "../../zoho/sprintsClient.js";
import { toolErrorResult, toolTextResult } from "./helpers.js";

export function registerAttachmentTools(server: McpServer, client: SprintsClient): void {
  server.registerTool(
    "add_item_attachment",
    {
      title: "Attach a file to an item",
      description:
        "Uploads a file (e.g. a screenshot) as an attachment on a backlog/sprint item. The file content must be " +
        "given as base64 - there is no separate upload step.",
      inputSchema: {
        projectId: z.string().describe("Zoho Sprints project ID"),
        itemId: z.string().describe("Item ID"),
        fileName: z.string().describe("File name, including extension, e.g. 'repro.png'"),
        fileContentBase64: z.string().describe("The file's raw bytes, base64-encoded"),
        mimeType: z.string().optional().describe("MIME type, e.g. 'image/png' (default: application/octet-stream)"),
        sprintId: z.string().optional().describe("Sprint/container the item is in, if already known (saves a lookup)"),
      },
    },
    async ({ projectId, itemId, fileName, fileContentBase64, mimeType, sprintId }) => {
      try {
        const fileContent = Buffer.from(fileContentBase64, "base64");
        if (fileContent.length === 0) {
          throw new Error("fileContentBase64 decoded to an empty file.");
        }
        const attachment = await client.addItemAttachment(projectId, itemId, fileName, fileContent, mimeType, sprintId);
        return toolTextResult(attachment);
      } catch (error) {
        return toolErrorResult(error);
      }
    },
  );
}
