import { describe, expect, test } from "bun:test";

import {
  AGENT_BUILDER_ASK_USER_MODE_VALUES,
  AGENT_BUILDER_CONTROL_PLANE_TOOL_ID_VALUES,
  AGENT_BUILDER_EXECUTABLE_ACTION_TOOL_ID_VALUES,
  AGENT_BUILDER_NEXT_ACTION_KIND_VALUES,
  AGENT_BUILDER_PLAN_NODE_ACTION_KEY_VALUES,
  AGENT_BUILDER_SECURE_UI_ACTION_KIND_VALUES,
  parseAgentBuilderPlannerOutput,
} from "@mosoo/contracts/agent-builder";

describe("Agent Builder control-plane contract", () => {
  test("locks the LLM-facing Builder tool surface to the lightweight set", () => {
    expect(AGENT_BUILDER_CONTROL_PLANE_TOOL_ID_VALUES).toEqual([
      "inspect_builder_context",
      "search_builder_assets",
      "patch_manifest_draft",
      "ask_user",
      "show_next_action",
      "create_agent",
      "apply_agent_config",
      "create_environment",
      "create_remote_mcp_server",
      "reset_preview_session",
    ]);
  });

  test("supports structured user input and next-action buttons", () => {
    expect(AGENT_BUILDER_ASK_USER_MODE_VALUES).toEqual([
      "single_select",
      "multi_select",
      "free_text",
    ]);
    expect(AGENT_BUILDER_NEXT_ACTION_KIND_VALUES).toEqual([
      "create_agent",
      "configure_environment",
      "open_preview",
      "keep_refining",
    ]);
    expect(AGENT_BUILDER_EXECUTABLE_ACTION_TOOL_ID_VALUES).toEqual([
      "create_agent",
      "apply_agent_config",
      "open_preview",
      "create_environment",
      "create_remote_mcp_server",
      "reset_preview_session",
    ]);
    expect(AGENT_BUILDER_PLAN_NODE_ACTION_KEY_VALUES).toEqual([
      "create_agent",
      "configure_environment",
      "open_preview",
      "keep_refining",
      "apply_agent_config",
      "create_environment",
      "create_remote_mcp_server",
      "reset_preview_session",
    ]);
    expect(AGENT_BUILDER_SECURE_UI_ACTION_KIND_VALUES).toEqual([
      "create_environment",
      "create_remote_mcp_server",
      "connect_mcp_credential",
    ]);
  });

  test("parses ask-user planner nodes as structured input", () => {
    const output = parseAgentBuilderPlannerOutput({
      assistantText: "Choose an environment.",
      intentSummary: "Ask for environment selection.",
      mode: "question",
      nodes: [
        {
          actions: [],
          askUser: {
            allowCustomText: true,
            allowSkip: true,
            mode: "single_select",
            options: [
              {
                description: "Reuse the existing analysis environment.",
                label: "x-analyst-env",
                optionKey: "environment_analyst",
                value: "01J00000000000000000000001",
              },
            ],
            prompt: "Would you like to reuse an existing environment or create a new one?",
          },
          kind: "question",
          nodeKey: "ask_environment",
          operation: "ask",
          requiresConfirmation: false,
          status: "pending",
          summary: "Choose the environment path.",
          targetType: "environment",
        },
      ],
      plannerRunId: "01J00000000000000000000002",
      version: 1,
    });

    expect(output?.nodes[0]?.askUser?.mode).toBe("single_select");
    expect(output?.nodes[0]?.askUser?.options[0]?.optionKey).toBe("environment_analyst");
  });

  test("parses strict-schema-shaped ask-user nodes with nullable optional fields", () => {
    const output = parseAgentBuilderPlannerOutput({
      assistantText: "Choose an environment.",
      intentSummary: "Ask for environment selection.",
      mode: "question",
      nodes: [
        {
          actions: [],
          askUser: {
            allowCustomText: true,
            allowSkip: true,
            mode: "single_select",
            options: [
              {
                description: null,
                label: "x-analyst-env",
                optionKey: "environment_analyst",
                value: null,
              },
            ],
            prompt: "Would you like to reuse an existing environment or create a new one?",
            submitLabel: null,
          },
          draftPatch: null,
          fieldPath: null,
          kind: "question",
          nodeKey: "ask_environment",
          operation: "ask",
          requiresConfirmation: false,
          status: "pending",
          summary: "Choose the environment path.",
          targetType: "environment",
        },
      ],
      plannerRunId: "01J00000000000000000000002",
      version: 1,
    });

    expect(output?.nodes[0]?.askUser?.submitLabel).toBeUndefined();
    expect(output?.nodes[0]?.askUser?.options[0]).toEqual({
      label: "x-analyst-env",
      optionKey: "environment_analyst",
    });
  });

  test("parses strict-schema-shaped draft patch nodes with nullable optional fields", () => {
    const output = parseAgentBuilderPlannerOutput({
      assistantText: "Bind the environment.",
      intentSummary: "Apply an environment patch.",
      mode: "draft_patch",
      nodes: [
        {
          actions: [],
          askUser: null,
          draftPatch: {
            autoApply: null,
            baseDraftRevision: null,
            baseValue: null,
            fieldPath: "environmentId",
            resolvedReferences: [
              {
                bindingState: "not_bound",
                filename: null,
                id: "01J00000000000000000000003",
                name: "x-analyst-env",
                targetType: "environment",
                url: null,
              },
            ],
            sectionId: null,
            value: "01J00000000000000000000003",
          },
          fieldPath: null,
          kind: "draft_patch",
          nodeKey: "patch_environment",
          operation: "bind",
          requiresConfirmation: false,
          status: "pending",
          summary: "Bind the selected Environment.",
          targetType: "draft",
        },
      ],
      plannerRunId: "01J00000000000000000000002",
      version: 1,
    });

    expect(output?.nodes[0]?.draftPatch).toEqual({
      baseValue: null,
      fieldPath: "environmentId",
      resolvedReferences: [
        {
          bindingState: "not_bound",
          id: "01J00000000000000000000003",
          name: "x-analyst-env",
          targetType: "environment",
        },
      ],
      value: "01J00000000000000000000003",
    });
  });

  test("parses next-action planner nodes as workflow actions", () => {
    const output = parseAgentBuilderPlannerOutput({
      assistantText: "Configuration is ready for Preview.",
      intentSummary: "Show the next Quickstart action.",
      mode: "action",
      nodes: [
        {
          actions: [
            {
              actionKey: "open_preview",
              label: "Test in Chat",
              style: "primary",
            },
          ],
          kind: "action",
          nodeKey: "show_next_action:open_preview",
          operation: "show",
          requiresConfirmation: false,
          status: "pending",
          summary: "Open Preview and reuse the Builder preview session.",
          targetType: "workflow",
        },
      ],
      plannerRunId: "01J00000000000000000000002",
      version: 1,
    });

    expect(output?.mode).toBe("action");
    expect(output?.nodes[0]?.targetType).toBe("workflow");
    expect(output?.nodes[0]?.actions[0]).toEqual({
      actionKey: "open_preview",
      label: "Test in Chat",
      style: "primary",
    });
  });

  test("rejects planner action buttons outside the locked action key set", () => {
    expect(
      parseAgentBuilderPlannerOutput({
        assistantText: "Run this action.",
        intentSummary: "Bad planner action.",
        mode: "action",
        nodes: [
          {
            actions: [
              {
                actionKey: "commit_channel_setup",
                label: "Wire channel",
                style: "primary",
              },
            ],
            kind: "action",
            nodeKey: "show_next_action:commit_channel_setup",
            operation: "show",
            requiresConfirmation: false,
            status: "pending",
            summary: "Should be rejected.",
            targetType: "workflow",
          },
        ],
        plannerRunId: "01J00000000000000000000002",
        version: 1,
      }),
    ).toBeNull();
  });

  test("parses creation action payloads and rejects credential-shaped or invalid payloads", () => {
    const output = parseAgentBuilderPlannerOutput({
      assistantText: "Create the environment and MCP server.",
      intentSummary: "Create components directly.",
      mode: "action",
      nodes: [
        {
          actions: [
            {
              actionKey: "create_environment",
              createEnvironmentPayload: {
                description: null,
                name: "Slack Bot Environment",
              },
              createRemoteMcpServerPayload: null,
              label: "Create environment",
              style: "primary",
            },
            {
              actionKey: "create_remote_mcp_server",
              createEnvironmentPayload: null,
              createRemoteMcpServerPayload: {
                authType: "oauth",
                description: "Linear workspace access.",
                name: "Linear MCP",
                url: "https://mcp.linear.app/mcp",
              },
              label: "Create MCP server",
              style: "primary",
            },
          ],
          kind: "action",
          nodeKey: "show_next_action:create_components",
          operation: "show",
          requiresConfirmation: false,
          status: "pending",
          summary: "Create the missing components.",
          targetType: "workflow",
        },
      ],
      plannerRunId: "01J00000000000000000000002",
      version: 1,
    });

    expect(output?.nodes[0]?.actions[0]?.createEnvironmentPayload).toEqual({
      name: "Slack Bot Environment",
    });
    expect(output?.nodes[0]?.actions[1]?.createRemoteMcpServerPayload).toEqual({
      authType: "oauth",
      description: "Linear workspace access.",
      name: "Linear MCP",
      url: "https://mcp.linear.app/mcp",
    });

    const invalidUrlOutput = parseAgentBuilderPlannerOutput({
      assistantText: "Create the MCP server.",
      intentSummary: "Create an MCP server with a non-https url.",
      mode: "action",
      nodes: [
        {
          actions: [
            {
              actionKey: "create_remote_mcp_server",
              createRemoteMcpServerPayload: {
                authType: "bearer",
                name: "Insecure MCP",
                url: "http://mcp.example.com/mcp",
              },
              label: "Create MCP server",
              style: "primary",
            },
          ],
          kind: "action",
          nodeKey: "show_next_action:create_remote_mcp_server",
          operation: "show",
          requiresConfirmation: false,
          status: "pending",
          summary: "Should be rejected.",
          targetType: "workflow",
        },
      ],
      plannerRunId: "01J00000000000000000000002",
      version: 1,
    });

    expect(invalidUrlOutput).toBeNull();
  });
});
