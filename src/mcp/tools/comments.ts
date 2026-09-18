import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SprintsClient } from "../../zoho/sprintsClient.js";
import { toolErrorResult, toolTextResult } from "./helpers.js";

export function registerCommentTools(server: McpServer, client: SprintsClient): void {
  server.registerTool(
    "add_comment",
    {
      title: "Add a comment to an item",
      description: "Adds a comment to a backlog/sprint item.",
      inputSchema: {
        projectId: z.string().describe("Zoho Sprints project ID"),
        itemId: z.string().describe("Item ID"),
        text: z.string().describe("Comment text"),
      },
    },
    async ({ projectId, itemId, text }) => {
      try {
        const comment = await client.addItemComment(projectId, itemId, text);
        return toolTextResult(comment);
      } catch (error) {
        return toolErrorResult(error);
      }
    },
  );
}
