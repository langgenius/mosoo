import { describe, expect, test } from "bun:test";

import { copyProxyRequestHeaders } from "../src/adapters/http/routes/driver-route";
import {
  createRuntimeMcpDelegationToken,
  verifyRuntimeMcpDelegationToken,
} from "../src/modules/runtime/application/runtime-mcp-delegation";

const claims = {
  agentId: "01J00000000000000000000009",
  appId: "01J0000000000000000000000Q",
  runId: "01J0000000000000000000000N",
  threadId: "01J0000000000000000000000B",
  userId: "customer-123",
};

describe("runtime MCP end-user delegation", () => {
  test("binds a short-lived JWT to the MCP credential and target URL", async () => {
    const token = await createRuntimeMcpDelegationToken({
      accessToken: "mcp-upstream-secret",
      audience: "https://tools.example.com/mcp",
      claims,
      nowMs: 1_800_000_000_000,
    });

    await expect(
      verifyRuntimeMcpDelegationToken({
        accessToken: "mcp-upstream-secret",
        audience: "https://tools.example.com/mcp",
        nowMs: 1_800_000_030_000,
        token,
      }),
    ).resolves.toMatchObject({
      act: { agent_id: claims.agentId, app_id: claims.appId },
      aud: "https://tools.example.com/mcp",
      exp: 1_800_000_060,
      run_id: claims.runId,
      sub: "customer-123",
      thread_id: claims.threadId,
    });

    await expect(
      verifyRuntimeMcpDelegationToken({
        accessToken: "wrong-secret",
        audience: "https://tools.example.com/mcp",
        nowMs: 1_800_000_030_000,
        token,
      }),
    ).rejects.toThrow("signature");
  });

  test("strips a driver-supplied identity header and injects the trusted token", () => {
    const headers = copyProxyRequestHeaders(
      new Headers({ Authorization: "Bearer driver-grant", "X-Mosoo-Delegation": "forged" }),
      "upstream-token",
      "trusted",
    );
    expect(headers.get("Authorization")).toBe("Bearer upstream-token");
    expect(headers.get("X-Mosoo-Delegation")).toBe("trusted");
  });

  test("allows a thread-scoped token before a prewarmed driver is bound to a run", async () => {
    const token = await createRuntimeMcpDelegationToken({
      accessToken: "mcp-upstream-secret",
      audience: "https://tools.example.com/mcp",
      claims: { ...claims, runId: null },
      nowMs: 1_800_000_000_000,
    });

    await expect(
      verifyRuntimeMcpDelegationToken({
        accessToken: "mcp-upstream-secret",
        audience: "https://tools.example.com/mcp",
        nowMs: 1_800_000_030_000,
        token,
      }),
    ).resolves.toMatchObject({ run_id: null, sub: claims.userId });
  });
});
