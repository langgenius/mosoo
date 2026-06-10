import { describe, expect, test } from "bun:test";

import type { McpServerId } from "@mosoo/contracts/id";

import {
  getAgentBuilderActionDispatch,
  handleAgentBuilderSecureUiAction,
} from "../src/routes/agent/components/agent-builder/use-agent-builder-control-plane-actions";

const MCP_SERVER_ID = "01J00000000000000000000001" as McpServerId;

describe("Agent Builder control-plane actions", () => {
  test("routes secure-UI actions through the control plane before opening local UI", () => {
    expect(getAgentBuilderActionDispatch("create_environment")).toEqual({
      kind: "control_plane",
      toolId: "create_environment",
    });
    expect(getAgentBuilderActionDispatch("create_remote_mcp_server")).toEqual({
      kind: "control_plane",
      toolId: "create_remote_mcp_server",
    });
    expect(getAgentBuilderActionDispatch("open_preview")).toEqual({
      kind: "control_plane",
      toolId: "open_preview",
    });
  });

  test("routes structured secure-UI results to the matching frontend handler", () => {
    const opened: string[] = [];

    const handled = handleAgentBuilderSecureUiAction({
      onCreateEnvironment: () => opened.push("environment"),
      onCreateRemoteMcpServer: () => opened.push("remote_mcp"),
      result: {
        createdEnvironment: null,
        createdMcpServer: null,
        message: "Open secure UI.",
        secureUi: { kind: "create_remote_mcp_server" },
        sessionId: null,
        status: "needs_secure_ui",
        toolId: "create_remote_mcp_server",
      },
    });

    expect(handled).toBe(true);
    expect(opened).toEqual(["remote_mcp"]);
  });

  test("routes connect_mcp_credential to the credential handler with the created server", () => {
    const connected: string[] = [];

    const handled = handleAgentBuilderSecureUiAction({
      onConnectMcpCredential: (server) => connected.push(server.name),
      result: {
        createdEnvironment: null,
        createdMcpServer: {
          authType: "bearer",
          id: MCP_SERVER_ID,
          name: "Linear MCP",
          url: "https://mcp.linear.app/mcp",
        },
        message: "MCP server created.",
        secureUi: { kind: "connect_mcp_credential", mcpServerId: MCP_SERVER_ID },
        sessionId: null,
        status: "applied",
        toolId: "create_remote_mcp_server",
      },
    });

    expect(handled).toBe(true);
    expect(connected).toEqual(["Linear MCP"]);
  });

  test("leaves non-secure or unsupported secure-UI results as normal action messages", () => {
    expect(
      handleAgentBuilderSecureUiAction({
        result: {
          createdEnvironment: null,
          createdMcpServer: null,
          message: "Preview reset.",
          secureUi: null,
          sessionId: null,
          status: "applied",
          toolId: "reset_preview_session",
        },
      }),
    ).toBe(false);

    expect(
      handleAgentBuilderSecureUiAction({
        result: {
          createdEnvironment: null,
          createdMcpServer: null,
          message: "Open secure UI.",
          secureUi: { kind: "create_environment" },
          sessionId: null,
          status: "needs_secure_ui",
          toolId: "create_environment",
        },
      }),
    ).toBe(false);
  });
});
