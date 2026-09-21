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

  server.registerTool(
    "create_epic",
    {
      title: "Create an epic",
      description: "Creates a new epic in a project, for grouping related backlog items.",
      inputSchema: {
        projectId: z.string().describe("Zoho Sprints project ID (see list_projects)"),
        name: z.string().describe("Epic name"),
        description: z.string().optional(),
        owner: z
          .string()
          .optional()
          .describe(
            "Zoho user ID to set as the epic's owner. Defaults to the project owner - this is a single-user " +
              "integration, so that's normally the only sensible value.",
          ),
        color: z.string().optional().describe("Hex color code for the epic, e.g. '#3CB371'"),
      },
    },
    async ({ projectId, name, description, owner, color }) => {
      try {
        const fields: Record<string, unknown> = { name };
        if (description) fields.desc = description;
        if (color) fields.color = color;

        if (owner) {
          fields.owner = owner;
        } else {
          const projects = (await client.listProjects()) as Array<Record<string, unknown>>;
          const project = projects.find((p) => String(p.projectId) === projectId);
          if (!project?.owner) {
            throw new Error(
              `Could not determine an owner for project ${projectId} - pass the "owner" argument with a Zoho user ID.`,
            );
          }
          fields.owner = project.owner;
        }

        const epic = await client.createEpic(projectId, fields);
        return toolTextResult(epic);
      } catch (error) {
        return toolErrorResult(error);
      }
    },
  );

  server.registerTool(
    "delete_epic",
    {
      title: "Delete an epic",
      description: "Deletes an epic from a project. This does not delete the items associated with it.",
      inputSchema: {
        projectId: z.string().describe("Zoho Sprints project ID (see list_projects)"),
        epicId: z.string().describe("Epic ID to delete (see list_epics)"),
      },
    },
    async ({ projectId, epicId }) => {
      try {
        await client.deleteEpic(projectId, epicId);
        return toolTextResult({ deleted: epicId });
      } catch (error) {
        return toolErrorResult(error);
      }
    },
  );
}
