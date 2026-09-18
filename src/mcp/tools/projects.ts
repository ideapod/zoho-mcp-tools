import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SprintsClient } from "../../zoho/sprintsClient.js";
import { toolErrorResult, toolTextResult } from "./helpers.js";

export function registerProjectTools(server: McpServer, client: SprintsClient): void {
  server.registerTool(
    "list_projects",
    {
      title: "List Zoho Sprints projects",
      description:
        "Lists the projects you're a member of in the Zoho Sprints workspace. Use this to find the projectId " +
        "for a project (e.g. StoryTrail) before calling other tools.",
      inputSchema: {},
    },
    async () => {
      try {
        const projects = await client.listProjects();
        return toolTextResult(projects);
      } catch (error) {
        return toolErrorResult(error);
      }
    },
  );

  server.registerTool(
    "get_project_metadata",
    {
      title: "Get project metadata (statuses, item types, priorities)",
      description:
        "Fetches the available item statuses (kanban columns), item types, and priority levels configured for a " +
        "project. Call this before create_item or move_item_status if you don't already know the valid names/IDs.",
      inputSchema: {
        projectId: z.string().describe("Zoho Sprints project ID (see list_projects)"),
      },
    },
    async ({ projectId }) => {
      try {
        const [statuses, itemTypes, priorities] = await Promise.all([
          client.getItemStatuses(projectId),
          client.getItemTypes(projectId),
          client.getPriorities(projectId),
        ]);
        return toolTextResult({ statuses, itemTypes, priorities });
      } catch (error) {
        return toolErrorResult(error);
      }
    },
  );
}
