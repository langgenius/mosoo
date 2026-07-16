import { describe, expect, test } from "bun:test";

import type { McpServerWithCredential } from "@mosoo/contracts/mcp";

import { createPoolServerById } from "../src/routes/agent/components/editor/mcp-bindings-field";

function poolServer(id: string, ownerName: string): McpServerWithCredential {
  return {
    appId: "01J000000000000000000000A1" as McpServerWithCredential["appId"],
    authType: "bearer",
    authorizationState: "active",
    createdAt: "2026-07-16T00:00:00.000Z",
    credential: null,
    credentialScope: "app",
    credentialStatus: "none",
    description: null,
    enabled: true,
    hasCredential: false,
    iconUrl: null,
    id: id as McpServerWithCredential["id"],
    name: "Server",
    ownerId: "01J000000000000000000000B1" as McpServerWithCredential["ownerId"],
    ownerName,
    source: "app",
    updatedAt: "2026-07-16T00:00:00.000Z",
    url: "https://mcp.example.com",
  };
}

describe("MCP bindings field projections", () => {
  test("indexes pool servers once while preserving first-match lookup behavior", () => {
    const first = poolServer("server-a", "First owner");
    const duplicate = poolServer("server-a", "Second owner");
    const other = poolServer("server-b", "Other owner");

    const lookup = createPoolServerById([first, duplicate, other]);

    expect(lookup.size).toBe(2);
    expect(lookup.get("server-a")).toBe(first);
    expect(lookup.get("server-b")).toBe(other);
  });
});
