#!/usr/bin/env node
import { createHttpServer } from "./server.js";

const port = Number(process.env.PORT ?? 3000);

const server = createHttpServer();
server.listen(port, () => {
  console.error(`Zoho Sprints MCP server listening on http://localhost:${port}${process.env.MCP_PATH ?? "/mcp"}`);
});
