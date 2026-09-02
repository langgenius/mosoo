import { describe, expect, test } from "bun:test";

import { copyProxyRequestHeaders } from "../src/adapters/http/routes/driver-route";
import {
  RUNTIME_MCP_TOOL_CALL_ID_HEADER,
  createRuntimeMcpDelegationToken,
  readRuntimeMcpToolCallId,
  verifyRuntimeMcpDelegationToken,
} from "../src/modules/runtime/application/runtime-mcp-delegation";

const claims = {
  agentId: "01J00000000000000000000009",
  projectId: "01J0000000000000000000000Q",
  runId: "01J0000000000000000000000N",
  threadId: "01J0000000000000000000000B",
  endUserId: "customer-123",
  toolCallId: "tool-call-1",
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
      act: { agent_id: claims.agentId, project_id: claims.projectId },
      aud: "https://tools.example.com/mcp",
      exp: 1_800_000_060,
      run_id: claims.runId,
      sub: "customer-123",
      thread_id: claims.threadId,
      tool_call_id: "tool-call-1",
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
      new Headers({
        Authorization: "Bearer driver-grant",
        "X-Mosoo-Delegation": "forged",
        [RUNTIME_MCP_TOOL_CALL_ID_HEADER]: "tool-call-1",
      }),
      "upstream-token",
      "trusted",
    );
    expect(headers.get("Authorization")).toBe("Bearer upstream-token");
    expect(headers.get("X-Mosoo-Delegation")).toBe("trusted");
    expect(headers.get(RUNTIME_MCP_TOOL_CALL_ID_HEADER)).toBeNull();
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
    ).resolves.toMatchObject({ run_id: null, sub: claims.endUserId });
  });

  test("applies a replayed business effect once by signed tool call ID", async () => {
    let writeCount = 0;
    const storedResults = new Map<string, { recordId: string }>();
    const applyBusinessEffect = async (token: string) => {
      const verified = await verifyRuntimeMcpDelegationToken({
        accessToken: "mcp-upstream-secret",
        audience: "https://tools.example.com/mcp",
        nowMs: 1_800_000_030_000,
        token,
      });
      const key = `${verified.act.project_id}:${verified.tool_call_id}`;
      const stored = storedResults.get(key);

      if (stored !== undefined) {
        return stored;
      }

      writeCount += 1;
      const result = { recordId: `record-${writeCount}` };
      storedResults.set(key, result);
      return result;
    };
    const firstToken = await createRuntimeMcpDelegationToken({
      accessToken: "mcp-upstream-secret",
      audience: "https://tools.example.com/mcp",
      claims,
      nowMs: 1_800_000_000_000,
    });
    const replayToken = await createRuntimeMcpDelegationToken({
      accessToken: "mcp-upstream-secret",
      audience: "https://tools.example.com/mcp",
      claims,
      nowMs: 1_800_000_001_000,
    });

    await applyBusinessEffect(firstToken); // The write commits; its response is lost.
    await expect(applyBusinessEffect(replayToken)).resolves.toEqual({ recordId: "record-1" });
    expect(writeCount).toBe(1);
  });

  test("validates the Driver-only tool call identity header", () => {
    expect(
      readRuntimeMcpToolCallId(new Headers({ [RUNTIME_MCP_TOOL_CALL_ID_HEADER]: " tool-1 " })),
    ).toBe("tool-1");
    expect(() =>
      readRuntimeMcpToolCallId(new Headers({ [RUNTIME_MCP_TOOL_CALL_ID_HEADER]: " " })),
    ).toThrow("invalid");
  });
});
