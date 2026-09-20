import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { loadConfig } from "./config.js";
import { createMcpServer } from "./mcp/server.js";
import { persistZohoAccessToken } from "./secrets.js";
import { SprintsClient } from "./zoho/sprintsClient.js";
import { ZohoTokenManager } from "./zoho/oauth.js";

const MCP_PATH = process.env.MCP_PATH ?? "/mcp";

interface AppContext {
  client: SprintsClient;
  mcpApiKey: string | undefined;
}

let contextPromise: Promise<AppContext> | undefined;

/**
 * Lazily builds the Zoho client from config on first use, memoizing across
 * requests within a warm process. Deliberately not called at server startup:
 * if Secrets Manager is unreachable or the secret isn't populated yet (e.g.
 * right after a fresh deploy, before the one-time OAuth setup script has
 * run), the HTTP server must still bind its port and answer /health -
 * otherwise the Lambda Web Adapter's readiness check fails and the whole
 * function is reported as broken instead of "up, but not configured yet".
 */
function getContext(): Promise<AppContext> {
  if (!contextPromise) {
    contextPromise = (async () => {
      const config = await loadConfig();
      const seed =
        config.accessToken && config.accessTokenExpiresAt
          ? { accessToken: config.accessToken, expiresAt: config.accessTokenExpiresAt }
          : undefined;
      const tokenManager = new ZohoTokenManager(config, config.accountsBaseUrl, seed, persistZohoAccessToken);
      const client = new SprintsClient(tokenManager, config.apiBaseUrl, config.teamId);
      if (!config.mcpApiKey) {
        console.error(
          "WARNING: no MCP_API_KEY/mcpApiKey configured - the /mcp endpoint will accept unauthenticated requests.",
        );
      }
      return { client, mcpApiKey: config.mcpApiKey };
    })().catch((error: unknown) => {
      // Don't memoize a failure - the next request (e.g. after the secret is
      // populated) should retry loading config rather than stay broken forever.
      contextPromise = undefined;
      throw error;
    });
  }
  return contextPromise;
}

function isAuthorized(req: IncomingMessage, mcpApiKey: string | undefined): boolean {
  if (!mcpApiKey) return true;
  const header = req.headers.authorization;
  return header === `Bearer ${mcpApiKey}`;
}

/**
 * Handles one MCP HTTP request with a fresh McpServer + transport pair.
 *
 * The MCP protocol's streamable-HTTP transport is used in stateless mode
 * (no sessionIdGenerator): every request gets its own server/transport
 * instance rather than sharing state across requests. This matches how the
 * MCP SDK documents serverless deployments, since a Lambda execution
 * environment may be reused for unrelated concurrent requests, or not reused
 * at all - there's no reliable place to keep a long-lived session.
 */
async function handleMcpRequest(client: SprintsClient, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const server = createMcpServer(client);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  res.on("close", () => {
    transport.close().catch(() => undefined);
    server.close().catch(() => undefined);
  });

  await server.connect(transport);
  await transport.handleRequest(req, res);
}

export function createHttpServer() {
  return createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }

    if (url.pathname === MCP_PATH) {
      // Only POST (the actual JSON-RPC request/response cycle) is supported. The transport also
      // accepts a standalone GET to open a long-lived SSE stream for server-initiated
      // notifications, but this server builds a fresh, stateless transport per request and never
      // sends any such notifications - accepting that GET would just hold the connection open
      // until Lambda's hard timeout kills it, since nothing here ever closes it. A well-behaved
      // MCP client opens that stream anyway to listen for async notifications and immediately
      // reconnects when it drops, which turned into an unbounded loop of 30-second-long,
      // never-productive Lambda invocations (confirmed live via CloudWatch Logs - see incident
      // notes). Rejecting fast avoids that entirely.
      if (req.method !== "POST") {
        res.writeHead(405, { "Content-Type": "application/json", Allow: "POST" });
        res.end(JSON.stringify({ error: "Method not allowed - this stateless MCP server only supports POST" }));
        return;
      }

      getContext()
        .then(({ client, mcpApiKey }) => {
          if (!isAuthorized(req, mcpApiKey)) {
            res.writeHead(401, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Unauthorized" }));
            return;
          }
          return handleMcpRequest(client, req, res);
        })
        .catch((error: unknown) => {
          console.error("Error handling MCP request:", error);
          if (!res.headersSent) {
            res.writeHead(503, { "Content-Type": "application/json" });
          }
          res.end(
            JSON.stringify({
              error:
                error instanceof Error
                  ? error.message
                  : "Server not configured yet - has the one-time OAuth setup script been run?",
            }),
          );
        });
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });
}
