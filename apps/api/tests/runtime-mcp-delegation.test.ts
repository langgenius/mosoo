import { describe, expect, test } from "bun:test";

import { copyProxyRequestHeaders } from "../src/adapters/http/routes/driver-route";
import {
  RUNTIME_MCP_TOOL_CALL_ID_HEADER,
  createRuntimeMcpDelegationToken,
  readRuntimeMcpToolCallId,
} from "../src/modules/runtime/application/runtime-mcp-delegation";
import { fromBase64Url } from "../src/shared/bytes";

// What a business MCP server does with the shared bearer token to trust the claims.
async function verifyDelegationToken(token: string, accessToken: string) {
  const [header, payload, signature] = token.split(".") as [string, string, string];
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    await crypto.subtle.digest(
      "SHA-256",
      encoder.encode(`mosoo-mcp-delegation-v1\0${accessToken}`),
    ),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["verify"],
  );
  if (
    !(await crypto.subtle.verify(
      "HMAC",
      key,
      fromBase64Url(signature),
      encoder.encode(`${header}.${payload}`),
    ))
  ) {
    throw new Error("MCP delegation token signature is invalid.");
  }
  return JSON.parse(new TextDecoder().decode(fromBase64Url(payload)));
}

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

    await expect(verifyDelegationToken(token, "mcp-upstream-secret")).resolves.toMatchObject({
      act: { agent_id: claims.agentId, app_id: claims.projectId },
      aud: "https://tools.example.com/mcp",
      exp: 1_800_000_060,
      iat: 1_800_000_000,
      iss: "mosoo",
      run_id: claims.runId,
      sub: "customer-123",
      thread_id: claims.threadId,
      tool_call_id: "tool-call-1",
    });

    await expect(verifyDelegationToken(token, "wrong-secret")).rejects.toThrow("signature");
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

    await expect(verifyDelegationToken(token, "mcp-upstream-secret")).resolves.toMatchObject({
      run_id: null,
      sub: claims.endUserId,
    });
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
