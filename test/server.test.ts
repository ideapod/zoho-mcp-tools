import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { createHttpServer } from "../src/server.js";

describe("createHttpServer", () => {
  let server: ReturnType<typeof createHttpServer>;
  let baseUrl: string;

  beforeEach(async () => {
    server = createHttpServer();
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("answers /health without needing config", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
  });

  it("rejects a standalone GET to /mcp with a fast 405 instead of hanging", async () => {
    // A GET opens the SDK's long-lived SSE notification stream, which this stateless,
    // fresh-transport-per-request server never closes - see the comment in src/server.ts for the
    // Lambda-timeout incident this caused. This must return immediately, not hang.
    const res = await fetch(`${baseUrl}/mcp`, { method: "GET" });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
  });

  it("rejects a DELETE to /mcp with a fast 405", async () => {
    const res = await fetch(`${baseUrl}/mcp`, { method: "DELETE" });
    expect(res.status).toBe(405);
  });
});
