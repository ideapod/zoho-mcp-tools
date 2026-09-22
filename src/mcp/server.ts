import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SprintsClient } from "../zoho/sprintsClient.js";
import { registerAttachmentTools } from "./tools/attachments.js";
import { registerBacklogTools } from "./tools/backlog.js";
import { registerCommentTools } from "./tools/comments.js";
import { registerEpicTools } from "./tools/epics.js";
import { registerProjectTools } from "./tools/projects.js";
import { registerSprintTools } from "./tools/sprints.js";

export function createMcpServer(client: SprintsClient): McpServer {
  const server = new McpServer({
    name: "zoho-sprints-mcp",
    version: "1.0.0",
  });

  registerProjectTools(server, client);
  registerSprintTools(server, client);
  registerEpicTools(server, client);
  registerBacklogTools(server, client);
  registerCommentTools(server, client);
  registerAttachmentTools(server, client);

  return server;
}
