import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SprintsClient } from "../../zoho/sprintsClient.js";
import { toolErrorResult, toolTextResult } from "./helpers.js";

export function registerEpicTools(server: McpServer, client: SprintsClient): void {
  server.registerTool(
    "list_epics",
    {
      title: "List epics",
      description: "Lists the epics defined in a project, for grouping/context when triaging the backlog.",
      inputSchema: {
        projectId: z.string().describe("Zoho Sprints project ID (see list_projects)"),
      },
    },
    async ({ projectId }) => {
      try {
        const epics = await client.listEpics(projectId);
        return toolTextResult(epics);
      } catch (error) {
        return toolErrorResult(error);
      }
    },
  );
}
