import { describe, expect, test } from "bun:test";

import {
  getAgentBuilderControlPlaneToolDescriptor,
  listAgentBuilderControlPlaneToolDescriptors,
} from "../src/modules/agent-builder/application/agent-builder-control-plane-tool-descriptor.service";

describe("Agent Builder control-plane tool descriptors", () => {
  test("exposes only the lightweight Builder control-plane tools to the planner", () => {
    const descriptors = listAgentBuilderControlPlaneToolDescriptors();

    expect(descriptors.map((descriptor) => descriptor.toolId)).toEqual([
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
    expect(descriptors.some((descriptor) => descriptor.toolId === "open_preview")).toBe(false);
    expect(descriptors.some((descriptor) => descriptor.toolId.includes("channel"))).toBe(false);
    expect(descriptors.some((descriptor) => descriptor.toolId.includes("terminal"))).toBe(false);
  });

  test("allows direct record creation but keeps credentials behind the secure UI", () => {
    const createRemoteMcp = getAgentBuilderControlPlaneToolDescriptor("create_remote_mcp_server");

    expect(createRemoteMcp.description).toContain("createRemoteMcpServerPayload");
    expect(createRemoteMcp.description).toContain("secure UI");
    expect(createRemoteMcp.description).not.toContain("Create and bind");

    const createEnvironment = getAgentBuilderControlPlaneToolDescriptor("create_environment");

    expect(createEnvironment.description).toContain("createEnvironmentPayload");
    expect(createEnvironment.description).toContain(
      "Never include env var values, secrets, or setup scripts",
    );
  });

  test("describes next-action buttons without narrowing them to Quickstart only", () => {
    const descriptor = getAgentBuilderControlPlaneToolDescriptor("show_next_action");

    expect(descriptor.description).toContain("workflow and control-plane actions");
  });
});
