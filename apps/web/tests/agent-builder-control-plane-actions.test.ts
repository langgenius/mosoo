import { describe, expect, test } from "bun:test";

import {
  getAgentBuilderActionDispatch,
  handleAgentBuilderSecureUiAction,
} from "../src/routes/agent/components/agent-builder/use-agent-builder-control-plane-actions";

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

  test("leaves non-secure or unsupported secure-UI results as normal action messages", () => {
    expect(
      handleAgentBuilderSecureUiAction({
        result: {
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
