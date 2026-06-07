import { describe, expect, spyOn, test } from "bun:test";

import type { AgentBuilderPlanNode } from "@mosoo/contracts/agent-builder";
import { PRESET_MODEL_CATALOG } from "@mosoo/contracts/models";
import { PUBLIC_RUNTIME_CATALOG } from "@mosoo/runtime-catalog";

import {
  createComparableLookupIndex,
  normalizeAgentBuilderDraftPatchNodes,
  resolveAgentBuilderModelId,
} from "../src/modules/agent-builder/application/agent-builder-draft-patch-normalizer.service";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  NORMALIZER_IDS,
  draftPatchNode,
  normalizerSkillId,
  plannerContext,
  plannerContextWithBoundEnvironment,
  plannerContextWithBoundSpaces,
  plannerContextWithMissingModelSelection,
  plannerContextWithUnsupportedRuntime,
  plannerContextWithVisibleMcpServers,
  plannerContextWithVisibleSkillIndex,
  plannerContextWithVisibleSkills,
} from "./agent-builder-draft-patch-normalizer-fixtures";
import { createAgentBuilderApiFixture } from "./helpers/agent-builder-api-fixture";

describe("Agent Builder draft patch normalizer", () => {
  test("resolves user-facing model labels to canonical preset model IDs", () => {
    expect(resolveAgentBuilderModelId("GPT-5.4")).toBe("gpt-5.4");
    expect(resolveAgentBuilderModelId("gpt5.4")).toBe("gpt-5.4");
    expect(resolveAgentBuilderModelId("gpt 5 4")).toBe("gpt-5.4");
    expect(resolveAgentBuilderModelId("o3")).toBe("o3");
  });

  test("resolves user-facing Runtime labels to canonical runtime IDs", async () => {
    const nodes = await normalizeAgentBuilderDraftPatchNodes({
      actorAccountId: NORMALIZER_IDS.account,
      bindings: { DB: {} as D1Database } as ApiBindings,
      context: plannerContext(),
      mode: "draft_patch",
      nodes: [draftPatchNode("runtime", "runtimeId", "Claude Agent SDK")],
    });

    expect(nodes[0]?.status).toBe("applied");
    expect(nodes[0]?.draftPatch?.value).toBe("claude-agent-sdk");
  });

  test("preserves non-patch action nodes in a mixed draft patch output", async () => {
    const actionNode = {
      actions: [
        {
          actionKey: "create_remote_mcp_server",
          label: "Create remote MCP server",
          style: "primary",
        },
      ],
      kind: "action",
      nodeKey: "show_next_action:create_remote_mcp_server",
      operation: "show",
      requiresConfirmation: false,
      status: "pending",
      summary: "Open the secure remote MCP server creation UI.",
      targetType: "workflow",
    } as const satisfies AgentBuilderPlanNode;
    const nodes = await normalizeAgentBuilderDraftPatchNodes({
      actorAccountId: NORMALIZER_IDS.account,
      bindings: { DB: {} as D1Database } as ApiBindings,
      context: plannerContext(),
      mode: "draft_patch",
      nodes: [draftPatchNode("runtime", "runtimeId", "openai runtime"), actionNode],
    });

    expect(nodes[0]?.status).toBe("blocked");
    expect(nodes[1]).toEqual(actionNode);
  });

  test("uses catalog lookup indexes for repeated model and Runtime aliases", async () => {
    const modelFindSpy = spyOn(PRESET_MODEL_CATALOG, "find");
    const runtimeFindSpy = spyOn(PUBLIC_RUNTIME_CATALOG, "find");

    try {
      expect(resolveAgentBuilderModelId("gpt5.4")).toBe("gpt-5.4");
      expect(resolveAgentBuilderModelId("GPT 5 4")).toBe("gpt-5.4");

      const nodes = await normalizeAgentBuilderDraftPatchNodes({
        actorAccountId: NORMALIZER_IDS.account,
        bindings: { DB: {} as D1Database } as ApiBindings,
        context: plannerContext(),
        mode: "draft_patch",
        nodes: [
          draftPatchNode("runtime_1", "runtimeId", "openai-runtime"),
          draftPatchNode("runtime_2", "runtimeId", "openai runtime"),
        ],
      });

      expect(nodes.map((node) => node.draftPatch?.value)).toEqual([
        "openai-runtime",
        "openai-runtime",
      ]);
      expect(modelFindSpy).not.toHaveBeenCalled();
      expect(runtimeFindSpy).not.toHaveBeenCalled();
    } finally {
      modelFindSpy.mockRestore();
      runtimeFindSpy.mockRestore();
    }
  });

  test("rejects ambiguous normalized catalog aliases", () => {
    expect(() =>
      createComparableLookupIndex(
        [
          { aliases: ["foo-runtime"], runtimeId: "foo-runtime" },
          { aliases: ["Foo Runtime"], runtimeId: "bar-runtime" },
        ],
        (entry) => entry.aliases,
        (entry) => entry.runtimeId,
      ),
    ).toThrow(
      "Catalog aliases foo-runtime and Foo Runtime both normalize to fooruntime but resolve to different canonical values.",
    );
  });

  test("applies first-draft basics as separate safe patch items", async () => {
    const nodes = await normalizeAgentBuilderDraftPatchNodes({
      actorAccountId: NORMALIZER_IDS.account,
      bindings: { DB: {} as D1Database } as ApiBindings,
      context: plannerContext(),
      mode: "draft_patch",
      nodes: [
        draftPatchNode("name", "name", "每周技术变化追踪助手"),
        draftPatchNode(
          "description",
          "description",
          "每周追踪技术领域变化，并总结 AI agent runtime 等重点方向的新进展。",
        ),
        draftPatchNode(
          "prompt",
          "prompt",
          "你是一个技术变化追踪助手。每周围绕用户指定的技术主题收集最近 7 天的新进展，优先总结关键发布、趋势变化、潜在影响和需要继续跟进的问题。输出应清晰、简洁，并标明不确定之处。",
        ),
      ],
    });

    expect(nodes.map((node) => [node.nodeKey, node.status, node.draftPatch?.fieldPath])).toEqual([
      ["name", "applied", "name"],
      ["description", "applied", "description"],
      ["prompt", "applied", "prompt"],
    ]);
    expect(nodes.map((node) => node.requiresConfirmation)).toEqual([false, false, false]);
  });

  test("blocks only the invalid runtime item and still applies unrelated draft fields", async () => {
    const nodes = await normalizeAgentBuilderDraftPatchNodes({
      actorAccountId: NORMALIZER_IDS.account,
      bindings: { DB: {} as D1Database } as ApiBindings,
      context: plannerContext(),
      mode: "draft_patch",
      nodes: [
        draftPatchNode("runtime", "runtimeId", "missing-runtime"),
        draftPatchNode("description", "description", "Updated description."),
      ],
    });

    expect(nodes.map((node) => [node.nodeKey, node.status])).toEqual([
      ["runtime", "blocked"],
      ["description", "applied"],
    ]);
    expect(nodes[1]?.draftPatch?.value).toBe("Updated description.");
  });

  test("blocks model changes against an unsupported current Runtime without dropping other fields", async () => {
    const nodes = await normalizeAgentBuilderDraftPatchNodes({
      actorAccountId: NORMALIZER_IDS.account,
      bindings: { DB: {} as D1Database } as ApiBindings,
      context: plannerContextWithUnsupportedRuntime(),
      mode: "draft_patch",
      nodes: [
        draftPatchNode("model", "model", "claude-opus-4-7"),
        draftPatchNode("description", "description", "Updated description."),
      ],
    });

    expect(nodes.map((node) => [node.nodeKey, node.status])).toEqual([
      ["model", "blocked"],
      ["description", "applied"],
    ]);
    expect(nodes[0]?.summary).toContain("legacy-runtime");
    expect(nodes[1]?.draftPatch?.value).toBe("Updated description.");
  });

  test("blocks Runtime-only changes when the resulting model selection is unavailable", async () => {
    const fixture = await createAgentBuilderApiFixture();
    const nodes = await normalizeAgentBuilderDraftPatchNodes({
      actorAccountId: fixture.viewer.id,
      bindings: fixture.bindings,
      context: plannerContext(),
      mode: "draft_patch",
      nodes: [
        draftPatchNode("runtime", "runtimeId", "openai-runtime"),
        draftPatchNode("description", "description", "Updated description."),
      ],
    });

    expect(nodes.map((node) => [node.nodeKey, node.status])).toEqual([
      ["runtime", "blocked"],
      ["description", "applied"],
    ]);
    expect(nodes[0]?.summary).toContain("not available");
  });

  test("allows visible MCP binding patch even when authorization is not ready", async () => {
    const nodes = await normalizeAgentBuilderDraftPatchNodes({
      actorAccountId: NORMALIZER_IDS.account,
      bindings: { DB: {} as D1Database } as ApiBindings,
      context: plannerContext(),
      mode: "draft_patch",
      nodes: [draftPatchNode("mcp", "mcpServerIds", [NORMALIZER_IDS.mcpNeedsAuth])],
    });

    expect(nodes[0]?.status).toBe("applied");
    expect(nodes[0]?.draftPatch).toMatchObject({
      baseValue: [],
      fieldPath: "mcpServerIds",
      resolvedReferences: [
        {
          bindingState: "not_bound",
          id: NORMALIZER_IDS.mcpNeedsAuth,
          name: "Needs Auth MCP",
          targetType: "mcp_server",
        },
      ],
      sectionId: "integrations",
      value: [NORMALIZER_IDS.mcpNeedsAuth],
    });
  });

  test("applies large skill binding patches without dropping visible IDs", async () => {
    const existingSkillIds = Array.from({ length: 240 }, (_, index) =>
      normalizerSkillId(500 + index),
    );
    const requestedSkillIds = [
      ...Array.from({ length: 240 }, (_, index) => normalizerSkillId(index)),
      normalizerSkillId(510),
      normalizerSkillId(10),
    ];

    const nodes = await normalizeAgentBuilderDraftPatchNodes({
      actorAccountId: NORMALIZER_IDS.account,
      bindings: { DB: {} as D1Database } as ApiBindings,
      context: plannerContextWithVisibleSkills(existingSkillIds),
      mode: "draft_patch",
      nodes: [draftPatchNode("skills", "skillIds", requestedSkillIds)],
    });

    expect(nodes[0]?.status).toBe("applied");
    expect(nodes[0]?.draftPatch?.value).toHaveLength(480);
    expect(nodes[0]?.draftPatch?.value).toContain(normalizerSkillId(510));
    expect(nodes[0]?.draftPatch?.value).toContain(normalizerSkillId(10));
  });

  test("applies same-field binding patches cumulatively", async () => {
    const context = plannerContextWithVisibleSkills([]);

    const nodes = await normalizeAgentBuilderDraftPatchNodes({
      actorAccountId: NORMALIZER_IDS.account,
      bindings: { DB: {} as D1Database } as ApiBindings,
      context,
      mode: "draft_patch",
      nodes: [
        draftPatchNode("skills_1", "skillIds", [normalizerSkillId(1)]),
        draftPatchNode("skills_2", "skillIds", [normalizerSkillId(2)]),
      ],
    });

    expect(nodes.map((node) => node.status)).toEqual(["applied", "applied"]);
    expect(nodes.map((node) => node.draftPatch?.value)).toEqual([
      [normalizerSkillId(1)],
      [normalizerSkillId(1), normalizerSkillId(2)],
    ]);
  });

  test("blocks large incomplete model selection batches", async () => {
    const largeModelPatchNodes = Array.from({ length: 160 }, (_, index) =>
      draftPatchNode(`model_${index.toString().padStart(3, "0")}`, "model", ""),
    );

    const nodes = await normalizeAgentBuilderDraftPatchNodes({
      actorAccountId: NORMALIZER_IDS.account,
      bindings: { DB: {} as D1Database } as ApiBindings,
      context: plannerContextWithMissingModelSelection(),
      mode: "draft_patch",
      nodes: largeModelPatchNodes,
    });

    expect(nodes.every((node) => node.status === "blocked")).toBe(true);
  });

  test("allows replacing a bound Environment with a visible confirmed target", async () => {
    const nodes = await normalizeAgentBuilderDraftPatchNodes({
      actorAccountId: NORMALIZER_IDS.account,
      bindings: { DB: {} as D1Database } as ApiBindings,
      context: plannerContextWithBoundEnvironment(),
      mode: "draft_patch",
      nodes: [
        draftPatchNode(
          "environment",
          "environmentId",
          NORMALIZER_IDS.environmentSystemDefault,
          "update",
        ),
      ],
    });

    expect(nodes[0]?.status).toBe("applied");
    expect(nodes[0]?.draftPatch).toMatchObject({
      baseValue: NORMALIZER_IDS.environmentLinear,
      fieldPath: "environmentId",
      resolvedReferences: [
        {
          bindingState: "not_bound",
          id: NORMALIZER_IDS.environmentSystemDefault,
          name: "System Default",
          targetType: "environment",
        },
      ],
      sectionId: "environment",
      value: NORMALIZER_IDS.environmentSystemDefault,
    });
  });

  test("normalizes Space unmount into remaining Manifest bindings", async () => {
    const nodes = await normalizeAgentBuilderDraftPatchNodes({
      actorAccountId: NORMALIZER_IDS.account,
      bindings: { DB: {} as D1Database } as ApiBindings,
      context: plannerContextWithBoundSpaces(),
      mode: "draft_patch",
      nodes: [draftPatchNode("remove_space", "spaceIds", [NORMALIZER_IDS.spaceRemove], "remove")],
    });

    expect(nodes[0]?.status).toBe("applied");
    expect(nodes[0]?.operation).toBe("update");
    expect(nodes[0]?.draftPatch).toMatchObject({
      baseValue: [NORMALIZER_IDS.spaceKeep, NORMALIZER_IDS.spaceRemove],
      fieldPath: "spaceIds",
      sectionId: "environment",
      value: [NORMALIZER_IDS.spaceKeep],
    });
  });

  test("blocks Space unmount when the requested Space is not currently bound", async () => {
    const nodes = await normalizeAgentBuilderDraftPatchNodes({
      actorAccountId: NORMALIZER_IDS.account,
      bindings: { DB: {} as D1Database } as ApiBindings,
      context: plannerContextWithBoundSpaces(),
      mode: "draft_patch",
      nodes: [
        draftPatchNode(
          "remove_unbound_space",
          "spaceIds",
          [NORMALIZER_IDS.spaceAvailable],
          "remove",
        ),
      ],
    });

    expect(nodes[0]?.status).toBe("blocked");
    expect(nodes[0]?.summary).toContain("currently bound Spaces");
  });

  test("normalizes Skill unmount into remaining Manifest bindings", async () => {
    const keepSkillId = normalizerSkillId(800);
    const removeSkillId = normalizerSkillId(801);
    const nodes = await normalizeAgentBuilderDraftPatchNodes({
      actorAccountId: NORMALIZER_IDS.account,
      bindings: { DB: {} as D1Database } as ApiBindings,
      context: plannerContextWithVisibleSkills([keepSkillId, removeSkillId]),
      mode: "draft_patch",
      nodes: [draftPatchNode("remove_skill", "skillIds", [removeSkillId], "remove")],
    });

    expect(nodes[0]?.status).toBe("applied");
    expect(nodes[0]?.operation).toBe("update");
    expect(nodes[0]?.draftPatch).toMatchObject({
      baseValue: [keepSkillId, removeSkillId],
      fieldPath: "skillIds",
      sectionId: "integrations",
      value: [keepSkillId],
    });
  });

  test("normalizes MCP server unmount into remaining Manifest bindings", async () => {
    const keepMcpServerId = NORMALIZER_IDS.mcpKeep;
    const removeMcpServerId = NORMALIZER_IDS.mcpRemove;
    const nodes = await normalizeAgentBuilderDraftPatchNodes({
      actorAccountId: NORMALIZER_IDS.account,
      bindings: { DB: {} as D1Database } as ApiBindings,
      context: plannerContextWithVisibleMcpServers([keepMcpServerId, removeMcpServerId]),
      mode: "draft_patch",
      nodes: [draftPatchNode("remove_mcp", "mcpServerIds", [removeMcpServerId], "remove")],
    });

    expect(nodes[0]?.status).toBe("applied");
    expect(nodes[0]?.operation).toBe("update");
    expect(nodes[0]?.draftPatch).toMatchObject({
      baseValue: [keepMcpServerId, removeMcpServerId],
      fieldPath: "mcpServerIds",
      sectionId: "integrations",
      value: [keepMcpServerId],
    });
  });

  test("preserves tombstone Skill bindings while unmounting an active Skill", async () => {
    const removeSkillId = normalizerSkillId(810);
    const tombstoneSkillId = normalizerSkillId(811);
    const nodes = await normalizeAgentBuilderDraftPatchNodes({
      actorAccountId: NORMALIZER_IDS.account,
      bindings: { DB: {} as D1Database } as ApiBindings,
      context: plannerContextWithVisibleSkillIndex({
        draftSkillLines: [
          `    - id: ${removeSkillId}`,
          `      name: Skill ${removeSkillId}`,
          `      filename: ${removeSkillId}.md`,
          "      state: active",
          `    - id: ${tombstoneSkillId}`,
          `      name: Skill ${tombstoneSkillId}`,
          `      filename: ${tombstoneSkillId}.md`,
          "      state: tombstone",
        ],
        visibleBoundSkillIds: [removeSkillId],
      }),
      mode: "draft_patch",
      nodes: [draftPatchNode("remove_active_skill", "skillIds", [removeSkillId], "remove")],
    });

    expect(nodes[0]?.status).toBe("applied");
    expect(nodes[0]?.operation).toBe("update");
    expect(nodes[0]?.draftPatch).toMatchObject({
      baseValue: [removeSkillId, tombstoneSkillId],
      fieldPath: "skillIds",
      sectionId: "integrations",
      value: [tombstoneSkillId],
    });
    expect(nodes[0]?.draftPatch?.resolvedReferences).toBeUndefined();
  });

  test("does not block unmount when an unrelated surviving Skill is not visible", async () => {
    const invisibleKeepSkillId = normalizerSkillId(812);
    const removeSkillId = normalizerSkillId(813);
    const nodes = await normalizeAgentBuilderDraftPatchNodes({
      actorAccountId: NORMALIZER_IDS.account,
      bindings: { DB: {} as D1Database } as ApiBindings,
      context: plannerContextWithVisibleSkillIndex({
        draftSkillLines: [
          `    - id: ${invisibleKeepSkillId}`,
          `      name: Skill ${invisibleKeepSkillId}`,
          `      filename: ${invisibleKeepSkillId}.md`,
          `    - id: ${removeSkillId}`,
          `      name: Skill ${removeSkillId}`,
          `      filename: ${removeSkillId}.md`,
        ],
        visibleBoundSkillIds: [removeSkillId],
      }),
      mode: "draft_patch",
      nodes: [draftPatchNode("remove_visible_skill", "skillIds", [removeSkillId], "remove")],
    });

    expect(nodes[0]?.status).toBe("applied");
    expect(nodes[0]?.draftPatch).toMatchObject({
      baseValue: [invisibleKeepSkillId, removeSkillId],
      fieldPath: "skillIds",
      sectionId: "integrations",
      value: [invisibleKeepSkillId],
    });
    expect(nodes[0]?.draftPatch?.resolvedReferences).toBeUndefined();
  });
});
