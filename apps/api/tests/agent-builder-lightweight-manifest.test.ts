import { describe, expect, test } from "bun:test";

import { parseAgentBuilderLightweightManifestYaml } from "../src/modules/agent-builder/application/agent-builder-lightweight-manifest";
import { toAgentBuilderPlannerDraftContext } from "../src/modules/agent-builder/application/agent-builder-lightweight-manifest-projections";

const MCP_ACTIVE_ID = "01J000000000000000000000M1";
const MCP_DELETED_ID = "01J000000000000000000000M2";
const SKILL_ACTIVE_ID = "01J000000000000000000000F1";
const SKILL_DELETED_ID = "01J000000000000000000000F2";

describe("Agent Builder lightweight Manifest reader", () => {
  test("rejects non-object Draft YAML roots", () => {
    expect(toAgentBuilderPlannerDraftContext("[]")).toMatchObject({
      parseError: expect.any(String),
      parseStatus: "failed",
    });
    expect(toAgentBuilderPlannerDraftContext("draft")).toMatchObject({
      parseError: expect.any(String),
      parseStatus: "failed",
    });
  });

  test("preserves tombstone Skill references in planner binding IDs", () => {
    const draft = toAgentBuilderPlannerDraftContext(
      [
        "version: 1",
        "kind: pet",
        "assets:",
        "  skills:",
        `    - id: ${SKILL_ACTIVE_ID}`,
        "      name: Active Skill",
        "      filename: active.md",
        "      state: active",
        `    - id: ${SKILL_DELETED_ID}`,
        "      name: Deleted Skill",
        "      filename: deleted.md",
        "      state: tombstone",
      ].join("\n"),
    );

    expect(draft.skillIds).toEqual([SKILL_ACTIVE_ID, SKILL_DELETED_ID]);
  });

  test("preserves tombstone MCP references in planner binding IDs", () => {
    const draft = toAgentBuilderPlannerDraftContext(
      [
        "version: 1",
        "kind: pet",
        "assets:",
        "  mcpServers:",
        `    - id: ${MCP_ACTIVE_ID}`,
        "      name: Active MCP",
        "      state: active",
        `    - id: ${MCP_DELETED_ID}`,
        "      name: Deleted MCP",
        "      state: tombstone",
      ].join("\n"),
    );

    expect(draft.mcpServerIds).toEqual([MCP_ACTIVE_ID, MCP_DELETED_ID]);
  });

  test("keeps only Environment and agent type as durable Builder component decisions", () => {
    const draft = toAgentBuilderPlannerDraftContext(
      [
        "version: 1",
        "kind: pet",
        "builder:",
        "  componentDecisions:",
        "    agentType: decided",
        "    environment: skipped",
        "    mcpServers: skipped",
        "    skills: skipped",
      ].join("\n"),
    );

    expect(draft.componentDecisions).toEqual({ agentType: "decided", environment: "skipped" });
  });

  test("keeps the agent type decision in the persisted builder metadata projection", () => {
    const result = parseAgentBuilderLightweightManifestYaml(
      [
        "version: 1",
        "kind: pet",
        "builder:",
        "  componentDecisions:",
        "    agentType: decided",
        "    environment: skipped",
      ].join("\n"),
    );

    if (result.status !== "parsed") {
      throw new Error(`expected parsed manifest, got: ${result.error}`);
    }

    // manifest.builder feeds updateAgentConfig — dropping agentType here means
    // the decision is silently lost on every apply_agent_config save.
    expect(result.manifest.builder.componentDecisions).toEqual({
      agentType: "decided",
      environment: "skipped",
    });
  });

  test("rejects malformed platform IDs in Draft asset bindings", () => {
    expect(
      toAgentBuilderPlannerDraftContext(
        ["version: 1", "kind: pet", "assets:", "  skills:", "    - skill_not_a_platform_id"].join(
          "\n",
        ),
      ),
    ).toMatchObject({
      parseError: expect.stringContaining("assets.skills"),
      parseStatus: "failed",
    });
  });

  test("rejects malformed asset binding objects before they can be silently dropped", () => {
    expect(
      toAgentBuilderPlannerDraftContext(
        ["version: 1", "kind: pet", "assets:", "  skills:", "    - name: PDF"].join("\n"),
      ),
    ).toMatchObject({
      parseError: expect.stringContaining("assets.skills[0]"),
      parseStatus: "failed",
    });

    expect(
      toAgentBuilderPlannerDraftContext(
        [
          "version: 1",
          "kind: pet",
          "assets:",
          "  skills:",
          `    - serverId: ${SKILL_ACTIVE_ID}`,
        ].join("\n"),
      ),
    ).toMatchObject({
      parseError: expect.stringContaining("assets.skills[0] must be a string ID or object with id"),
      parseStatus: "failed",
    });

    expect(
      toAgentBuilderPlannerDraftContext(
        [
          "version: 1",
          "kind: pet",
          "assets:",
          "  mcpServers:",
          `    - serverId: ${SKILL_ACTIVE_ID}`,
        ].join("\n"),
      ),
    ).toMatchObject({
      parseError: expect.stringContaining(
        "assets.mcpServers[0] must be a string ID or object with id",
      ),
      parseStatus: "failed",
    });
  });

  test("rejects malformed explicit Manifest sections before treating them as empty", () => {
    expect(
      toAgentBuilderPlannerDraftContext(["version: 1", "kind: pet", "assets: []"].join("\n")),
    ).toMatchObject({
      parseError: expect.stringContaining("assets must be an object"),
      parseStatus: "failed",
    });

    expect(
      toAgentBuilderPlannerDraftContext(["version: 1", "kind: pet", "runtime: nope"].join("\n")),
    ).toMatchObject({
      parseError: expect.stringContaining("runtime must be an object"),
      parseStatus: "failed",
    });

    expect(
      toAgentBuilderPlannerDraftContext(
        ["version: 1", "kind: pet", "builder:", "  componentDecisions: []"].join("\n"),
      ),
    ).toMatchObject({
      parseError: expect.stringContaining("builder.componentDecisions must be an object"),
      parseStatus: "failed",
    });
  });

  test("rejects malformed explicit Manifest fields before treating them as missing", () => {
    expect(
      toAgentBuilderPlannerDraftContext(
        ["version: 1", "kind: pet", "environment:", "  environmentId: []"].join("\n"),
      ),
    ).toMatchObject({
      parseError: expect.stringContaining("environment.environmentId must be a string or null"),
      parseStatus: "failed",
    });

    expect(
      toAgentBuilderPlannerDraftContext(
        [
          "version: 1",
          "kind: pet",
          "builder:",
          "  componentDecisions:",
          "    environment: banana",
        ].join("\n"),
      ),
    ).toMatchObject({
      parseError: expect.stringContaining(
        "builder.componentDecisions.environment must be one of: bound, created, skipped",
      ),
      parseStatus: "failed",
    });

    expect(
      toAgentBuilderPlannerDraftContext(
        ["version: 1", "kind: pet", "identity:", "  name: []"].join("\n"),
      ),
    ).toMatchObject({
      parseError: expect.stringContaining("identity.name must be a string or null"),
      parseStatus: "failed",
    });
  });

  test("rejects malformed explicit asset object fields before treating them as defaults", () => {
    expect(
      toAgentBuilderPlannerDraftContext(
        [
          "version: 1",
          "kind: pet",
          "assets:",
          "  skills:",
          `    - id: ${SKILL_ACTIVE_ID}`,
          "      state: banana",
        ].join("\n"),
      ),
    ).toMatchObject({
      parseError: expect.stringContaining("assets.skills[0].state must be one of"),
      parseStatus: "failed",
    });

    expect(
      toAgentBuilderPlannerDraftContext(
        [
          "version: 1",
          "kind: pet",
          "assets:",
          "  mcpServers:",
          `    - id: ${SKILL_ACTIVE_ID}`,
          "      state: banana",
        ].join("\n"),
      ),
    ).toMatchObject({
      parseError: expect.stringContaining("assets.mcpServers[0].state must be one of"),
      parseStatus: "failed",
    });
  });
});
