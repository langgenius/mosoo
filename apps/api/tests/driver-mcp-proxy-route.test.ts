import { describe, expect, spyOn, test } from "bun:test";

import { parsePlatformId } from "@mosoo/id";
import type { DriverInstanceId, McpServerId } from "@mosoo/id";
import { Hono } from "hono";

import { registerDriverRoute } from "../src/adapters/http/routes/driver-route";
import { createRuntimeActionToken } from "../src/modules/runtime/infrastructure/runtime-boot-token";
import type { ApiGatewayEnvironment } from "../src/platform/cloudflare/worker-types";
import {
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  createTestExecutionContext,
} from "./helpers/public-api-http-test-fixture";

const SERVER_ID = "01J0000000000000000000000S";

// 初始化测试环境与路由实例
async function setupTestApp() {
  const database = await createPublicHttpContractDatabase();
  const bindings = createPublicHttpTestBindings(database);
  const app = new Hono<ApiGatewayEnvironment>();
  registerDriverRoute(app);
  return { app, bindings };
}

// 快速签发合法的 MCP 代理授权凭证
async function createTestGrant(bindings: ReturnType<typeof createPublicHttpTestBindings>) {
  return createRuntimeActionToken(bindings, {
    action: "mcp_proxy",
    driverInstanceId: parsePlatformId<DriverInstanceId>("01J0000000000000000000000D", "driver ID"),
    expiresAt: Date.now() + 60_000,
    resourceId: parsePlatformId<McpServerId>(SERVER_ID, "server ID"),
  });
}

// 拦截并记录发往 upstream 的 HTTP 请求
function captureFetch(mockResponse: Response) {
  const captured: Array<{ body: string | null; headers: Headers; method: string; url: string }> =
    [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    captured.push({
      body: request.method === "GET" ? null : await request.text(),
      headers: request.headers,
      method: request.method,
      url: request.url,
    });
    return mockResponse.clone();
  }) as typeof fetch;

  return {
    captured,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

describe("driver MCP proxy route", () => {
  test("matches base route and rejects missing authorization grant with 401", async () => {
    const { app, bindings } = await setupTestApp();

    const response = await app.request(
      `https://api.example.com/api/driver/mcp/proxy/${SERVER_ID}`,
      { method: "POST" },
      bindings,
      createTestExecutionContext(),
    );

    expect(response.status).toBe(401);
  });

  test("matches subpath route and reaches handler instead of 404", async () => {
    const { app, bindings } = await setupTestApp();

    const response = await app.request(
      `https://api.example.com/api/driver/mcp/proxy/${SERVER_ID}/messages`,
      { method: "POST" },
      bindings,
      createTestExecutionContext(),
    );

    expect(response.status).toBe(401);
  });

  test("rejects path traversal attempts with 400 when authorized", async () => {
    const { app, bindings } = await setupTestApp();
    const grant = await createTestGrant(bindings);
    const headers = { Authorization: `Bearer ${grant}` };

    for (const badSubpath of ["/v1/%zz/messages", "/v1/%5csecret"]) {
      const response = await app.request(
        `https://api.example.com/api/driver/mcp/proxy/${SERVER_ID}${badSubpath}`,
        { headers, method: "POST" },
        bindings,
        createTestExecutionContext(),
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "MCP proxy path is invalid." });
    }
  });

  test("successfully proxies requests with subpath and query parameters end-to-end", async () => {
    const { app, bindings } = await setupTestApp();
    const grant = await createTestGrant(bindings);
    const { captured, restore } = captureFetch(
      new Response(JSON.stringify({ result: "mcp-tool-executed" }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    );

    const mcpProxyService =
      await import("../src/modules/runtime/application/runtime-mcp-proxy.service");
    const targetSpy = spyOn(mcpProxyService, "resolveRuntimeMcpProxyTarget").mockResolvedValue({
      delegationToken: null,
      serverId: parsePlatformId<McpServerId>(SERVER_ID, "server id"),
      upstreamAccessToken: "upstream-secret-token",
      url: "https://mcp.upstream.org/base",
    });

    try {
      const response = await app.request(
        `https://api.example.com/api/driver/mcp/proxy/${SERVER_ID}/messages?apiVersion=2026&grant=internal-grant`,
        {
          body: JSON.stringify({ jsonrpc: "2.0", method: "tools/call" }),
          headers: {
            Authorization: `Bearer ${grant}`,
            "Content-Type": "application/json",
          },
          method: "POST",
        },
        bindings,
        createTestExecutionContext(),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ result: "mcp-tool-executed" });

      expect(captured).toHaveLength(1);
      const upstream = captured[0];
      expect(upstream?.url).toBe("https://mcp.upstream.org/base/messages?apiVersion=2026");
      expect(upstream?.headers.get("authorization")).toBe("Bearer upstream-secret-token");
      expect(upstream?.body).toBe(JSON.stringify({ jsonrpc: "2.0", method: "tools/call" }));
    } finally {
      targetSpy.mockRestore();
      restore();
    }
  });

  test("handles upstream trailing slashes cleanly for base route and subpaths", async () => {
    const { app, bindings } = await setupTestApp();
    const grant = await createTestGrant(bindings);
    const { captured, restore } = captureFetch(
      new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    );

    const mcpProxyService =
      await import("../src/modules/runtime/application/runtime-mcp-proxy.service");
    const targetSpy = spyOn(mcpProxyService, "resolveRuntimeMcpProxyTarget").mockResolvedValue({
      delegationToken: null,
      serverId: parsePlatformId<McpServerId>(SERVER_ID, "server id"),
      upstreamAccessToken: "upstream-secret-token",
      url: "https://mcp.upstream.org/base/",
    });

    try {
      const baseResponse = await app.request(
        `https://api.example.com/api/driver/mcp/proxy/${SERVER_ID}?tag=stable`,
        {
          headers: { Authorization: `Bearer ${grant}` },
          method: "POST",
        },
        bindings,
        createTestExecutionContext(),
      );

      expect(baseResponse.status).toBe(200);
      expect(captured[0]?.url).toBe("https://mcp.upstream.org/base/?tag=stable");

      const subpathResponse = await app.request(
        `https://api.example.com/api/driver/mcp/proxy/${SERVER_ID}/sse`,
        {
          headers: { Authorization: `Bearer ${grant}` },
          method: "GET",
        },
        bindings,
        createTestExecutionContext(),
      );

      expect(subpathResponse.status).toBe(200);
      expect(captured[1]?.url).toBe("https://mcp.upstream.org/base/sse");
      expect(captured[1]?.body).toBeNull();
    } finally {
      targetSpy.mockRestore();
      restore();
    }
  });
});
