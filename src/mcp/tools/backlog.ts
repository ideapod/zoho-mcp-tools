import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SprintsClient } from "../../zoho/sprintsClient.js";
import { resolveEntityId, toolErrorResult, toolTextResult } from "./helpers.js";

async function resolveSprintOrBacklogId(
  client: SprintsClient,
  projectId: string,
  sprintId: string | undefined,
): Promise<string> {
  return sprintId ?? client.getProjectBacklogId(projectId);
}

export function registerBacklogTools(server: McpServer, client: SprintsClient): void {
  server.registerTool(
    "list_backlog_items",
    {
      title: "List backlog/kanban items",
      description:
        "Lists work items in a project's backlog (or a specific sprint if sprintId is given), optionally " +
        "filtered by status, epic, and/or priority. Status/epic/priority may be given as either their exact " +
        "name or numeric ID.",
      inputSchema: {
        projectId: z.string().describe("Zoho Sprints project ID (see list_projects)"),
        sprintId: z.string().optional().describe("Sprint ID to list from instead of the backlog"),
        status: z.string().optional().describe("Filter by item status name or ID"),
        epic: z.string().optional().describe("Filter by epic name or ID"),
        priority: z.string().optional().describe("Filter by priority name or ID"),
        search: z.string().optional().describe("Free-text search against item name"),
        index: z.number().int().min(1).optional().describe("Pagination start index (default 1)"),
        range: z.number().int().min(1).max(250).optional().describe("Page size, max 250 (default 100)"),
      },
    },
    async ({ projectId, sprintId, status, epic, priority, search, index, range }) => {
      try {
        const listId = await resolveSprintOrBacklogId(client, projectId, sprintId);
        let items = await client.listItems(projectId, listId, {
          index,
          range,
          searchby: search ? "name" : undefined,
          searchvalue: search,
        });

        if (status) {
          const statuses = await client.getItemStatuses(projectId);
          const statusId = resolveEntityId(statuses, status, "statuses");
          items = items.filter((item) => item.status?.id === statusId);
        }
        if (epic) {
          const epics = await client.listEpics(projectId);
          const epicId = resolveEntityId(
            epics.map((e) => ({ id: e.id, name: e.title })),
            epic,
            "epics",
          );
          items = items.filter((item) => item.epic?.id === epicId);
        }
        if (priority) {
          const priorities = await client.getPriorities(projectId);
          const priorityId = resolveEntityId(priorities, priority, "priorities");
          items = items.filter((item) => item.priority?.id === priorityId);
        }

        return toolTextResult(items);
      } catch (error) {
        return toolErrorResult(error);
      }
    },
  );

  server.registerTool(
    "get_item",
    {
      title: "Get item details",
      description: "Fetches full detail for a single backlog/sprint item, including its comments.",
      inputSchema: {
        projectId: z.string().describe("Zoho Sprints project ID"),
        itemId: z.string().describe("Item ID"),
        sprintId: z.string().optional().describe("Sprint the item belongs to (omit if it's in the backlog)"),
      },
    },
    async ({ projectId, itemId, sprintId }) => {
      try {
        const listId = await resolveSprintOrBacklogId(client, projectId, sprintId);
        const [item, comments, tagIds, allTags] = await Promise.all([
          client.getItem(projectId, listId, itemId),
          client.listItemComments(projectId, itemId).catch(() => []),
          client.getItemTagIds(projectId, listId, itemId).catch(() => []),
          client.listTags().catch(() => []),
        ]);
        const tagsById = new Map(allTags.map((t) => [t.id, t.name]));
        const tags = tagIds.map((id) => ({ id, name: tagsById.get(id) ?? id }));
        return toolTextResult({ ...item, comments, tags });
      } catch (error) {
        return toolErrorResult(error);
      }
    },
  );

  server.registerTool(
    "create_item",
    {
      title: "Create a backlog item",
      description:
        "Creates a new work item in a project's backlog (or a specific sprint if sprintId is given). itemType " +
        "and priority may be given as either their exact name (see get_project_metadata) or numeric ID.",
      inputSchema: {
        projectId: z.string().describe("Zoho Sprints project ID"),
        title: z.string().describe("Item title"),
        itemType: z.string().describe("Item type name or ID, e.g. 'Story', 'Bug', 'Task'"),
        priority: z.string().describe("Priority name or ID, e.g. 'High'"),
        description: z.string().optional(),
        epic: z.string().optional().describe("Epic name or ID to associate this item with"),
        status: z.string().optional().describe("Initial status name or ID"),
        sprintId: z.string().optional().describe("Sprint to add the item to (omit to add to the backlog)"),
      },
    },
    async ({ projectId, title, itemType, priority, description, epic, status, sprintId }) => {
      try {
        const listId = await resolveSprintOrBacklogId(client, projectId, sprintId);

        const [itemTypes, priorities] = await Promise.all([
          client.getItemTypes(projectId),
          client.getPriorities(projectId),
        ]);
        const fields: Record<string, unknown> = {
          name: title,
          projitemtypeid: resolveEntityId(itemTypes, itemType, "item types"),
          projpriorityid: resolveEntityId(priorities, priority, "priorities"),
        };
        if (description) fields.description = description;
        if (epic) {
          const epics = await client.listEpics(projectId);
          fields.epicid = resolveEntityId(
            epics.map((e) => ({ id: e.id, name: e.title })),
            epic,
            "epics",
          );
        }
        if (status) {
          const statuses = await client.getItemStatuses(projectId);
          fields.statusid = resolveEntityId(statuses, status, "statuses");
        }

        const item = await client.createItem(projectId, listId, fields);
        return toolTextResult(item);
      } catch (error) {
        return toolErrorResult(error);
      }
    },
  );

  server.registerTool(
    "update_item",
    {
      title: "Update a backlog item",
      description: "Updates fields on an existing item. Only the fields you pass are changed.",
      inputSchema: {
        projectId: z.string().describe("Zoho Sprints project ID"),
        itemId: z.string().describe("Item ID"),
        sprintId: z.string().optional().describe("Sprint the item belongs to (omit if it's in the backlog)"),
        title: z.string().optional(),
        description: z.string().optional(),
        itemType: z.string().optional().describe("Item type name or ID"),
        priority: z.string().optional().describe("Priority name or ID"),
        epic: z.string().optional().describe("Epic name or ID"),
        status: z.string().optional().describe("Status name or ID"),
      },
    },
    async ({ projectId, itemId, sprintId, title, description, itemType, priority, epic, status }) => {
      try {
        const listId = await resolveSprintOrBacklogId(client, projectId, sprintId);
        const fields: Record<string, unknown> = {};
        if (title) fields.name = title;
        if (description !== undefined) fields.description = description;
        if (itemType) fields.projitemtypeid = resolveEntityId(await client.getItemTypes(projectId), itemType, "item types");
        if (priority) fields.projpriorityid = resolveEntityId(await client.getPriorities(projectId), priority, "priorities");
        if (epic) {
          const epics = await client.listEpics(projectId);
          fields.epicid = resolveEntityId(
            epics.map((e) => ({ id: e.id, name: e.title })),
            epic,
            "epics",
          );
        }
        if (status) fields.statusid = resolveEntityId(await client.getItemStatuses(projectId), status, "statuses");

        if (Object.keys(fields).length === 0) {
          throw new Error("No fields to update were provided.");
        }

        const item = await client.updateItem(projectId, listId, itemId, fields);
        return toolTextResult(item);
      } catch (error) {
        return toolErrorResult(error);
      }
    },
  );

  server.registerTool(
    "update_item_tags",
    {
      title: "Set tags on a backlog item",
      description:
        "Associates custom tags with an item. By default replaces the item's existing tags with the given " +
        "list; pass mode 'add' to add tags without removing existing ones. Tags may be given by exact name or " +
        "numeric ID.",
      inputSchema: {
        projectId: z.string().describe("Zoho Sprints project ID"),
        itemId: z.string().describe("Item ID"),
        sprintId: z.string().optional().describe("Sprint the item belongs to (omit if it's in the backlog)"),
        tags: z.array(z.string()).min(1).describe("Tag names or IDs to associate with the item"),
        mode: z
          .enum(["replace", "add"])
          .optional()
          .describe("'replace' (default) removes the item's existing tags first; 'add' keeps them"),
      },
    },
    async ({ projectId, itemId, sprintId, tags, mode }) => {
      try {
        const listId = await resolveSprintOrBacklogId(client, projectId, sprintId);
        const allTags = await client.listTags();
        const resolvedTags = tags.map((t) => {
          const id = resolveEntityId(allTags, t, "tags");
          return { id, name: allTags.find((tag) => tag.id === id)!.name };
        });
        await client.updateItemTags(
          projectId,
          listId,
          itemId,
          resolvedTags.map((t) => t.id),
          mode !== "add",
        );
        return toolTextResult({ itemId, tags: resolvedTags });
      } catch (error) {
        return toolErrorResult(error);
      }
    },
  );

  server.registerTool(
    "move_item_status",
    {
      title: "Move item to a different status/column",
      description:
        "Drives the kanban board by moving an item to a different status (column). Status may be given as its " +
        "exact name (see get_project_metadata) or numeric ID.",
      inputSchema: {
        projectId: z.string().describe("Zoho Sprints project ID"),
        itemId: z.string().describe("Item ID"),
        status: z.string().describe("Target status name or ID, e.g. 'In Progress', 'Done'"),
        sprintId: z.string().optional().describe("Sprint the item belongs to (omit if it's in the backlog)"),
      },
    },
    async ({ projectId, itemId, status, sprintId }) => {
      try {
        const statuses = await client.getItemStatuses(projectId);
        const statusId = resolveEntityId(statuses, status, "statuses");
        const item = await client.moveItemStatus(projectId, itemId, statusId, sprintId);
        return toolTextResult(item);
      } catch (error) {
        return toolErrorResult(error);
      }
    },
  );
}
