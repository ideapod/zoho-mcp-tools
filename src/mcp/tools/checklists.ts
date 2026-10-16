import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SprintsClient } from "../../zoho/sprintsClient.js";
import { toolErrorResult, toolTextResult } from "./helpers.js";

export function registerChecklistTools(server: McpServer, client: SprintsClient): void {
  server.registerTool(
    "get_item_checklists",
    {
      title: "Get an item's checklists",
      description:
        "Lists the checklist groups on an item and each group's steps (id, name, done). Use the returned " +
        "ids with update_checklist_item.",
      inputSchema: {
        projectId: z.string().describe("Zoho Sprints project ID"),
        itemId: z.string().describe("Item ID"),
        sprintId: z.string().optional().describe("Sprint/container the item is in, if already known"),
      },
    },
    async ({ projectId, itemId, sprintId }) => {
      try {
        return toolTextResult(await client.listItemChecklists(projectId, itemId, sprintId));
      } catch (error) {
        return toolErrorResult(error);
      }
    },
  );

  server.registerTool(
    "add_item_checklist",
    {
      title: "Add checklist steps to an item",
      description:
        "Adds steps to an item's checklist. Use this on items that have multiple steps, so progress is visible " +
        "on the card rather than buried in the description. Pass groupId to append to an existing group, or " +
        "groupName to create a new one (default 'Steps').",
      inputSchema: {
        projectId: z.string().describe("Zoho Sprints project ID"),
        itemId: z.string().describe("Item ID"),
        steps: z.array(z.string().min(1)).min(1).describe("Step names, in order"),
        groupId: z.string().optional().describe("Existing checklist group ID to append to"),
        groupName: z.string().optional().describe("Name for a new checklist group (ignored if groupId is given)"),
        ownerId: z.string().optional().describe("User ID to assign the steps to (default: the authenticated user)"),
        sprintId: z.string().optional().describe("Sprint/container the item is in, if already known"),
      },
    },
    async ({ projectId, itemId, steps, groupId, groupName, ownerId, sprintId }) => {
      try {
        let targetGroupId = groupId;
        let owner = ownerId;
        if (!targetGroupId) {
          const group = await client.addChecklistGroup(projectId, itemId, groupName ?? "Steps", sprintId);
          targetGroupId = group.groupId;
          owner ??= group.createdBy;
        }
        if (!owner) {
          // Appending to an existing group with no explicit owner: borrow the group's creator.
          const existing = (await client.listItemChecklists(projectId, itemId, sprintId)).find(
            (g) => g.groupId === targetGroupId,
          );
          owner = existing?.items[0] ? String(existing.items[0].ownerId) : undefined;
          if (!owner) throw new Error("Could not determine an owner for the new steps; pass ownerId.");
        }
        await client.addChecklistItems(projectId, itemId, targetGroupId, steps, owner, sprintId);
        return toolTextResult(await client.listItemChecklists(projectId, itemId, sprintId));
      } catch (error) {
        return toolErrorResult(error);
      }
    },
  );

  server.registerTool(
    "update_checklist_item",
    {
      title: "Tick, untick or rename a checklist step",
      description: "Marks a checklist step done/not done and/or renames it. Get ids from get_item_checklists.",
      inputSchema: {
        projectId: z.string().describe("Zoho Sprints project ID"),
        itemId: z.string().describe("Item ID"),
        groupId: z.string().describe("Checklist group ID"),
        checklistItemId: z.string().describe("Checklist step ID"),
        done: z.boolean().optional().describe("true = complete, false = reopen"),
        name: z.string().min(1).optional().describe("New step name"),
        sprintId: z.string().optional().describe("Sprint/container the item is in, if already known"),
      },
    },
    async ({ projectId, itemId, groupId, checklistItemId, done, name, sprintId }) => {
      try {
        if (done === undefined && name === undefined) throw new Error("Pass done and/or name.");
        await client.updateChecklistItem(projectId, itemId, groupId, checklistItemId, { name, done }, sprintId);
        return toolTextResult(await client.listItemChecklists(projectId, itemId, sprintId));
      } catch (error) {
        return toolErrorResult(error);
      }
    },
  );
}
