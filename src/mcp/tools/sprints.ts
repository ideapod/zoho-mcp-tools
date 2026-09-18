import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SprintsClient } from "../../zoho/sprintsClient.js";
import { toolErrorResult, toolTextResult } from "./helpers.js";

export function registerSprintTools(server: McpServer, client: SprintsClient): void {
  server.registerTool(
    "list_sprints",
    {
      title: "List sprints",
      description: "Lists the sprints belonging to a project, for grouping/context when triaging the backlog.",
      inputSchema: {
        projectId: z.string().describe("Zoho Sprints project ID (see list_projects)"),
      },
    },
    async ({ projectId }) => {
      try {
        const sprints = await client.listSprints(projectId);
        return toolTextResult(sprints);
      } catch (error) {
        return toolErrorResult(error);
      }
    },
  );
}
