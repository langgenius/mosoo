import { describe, expect, spyOn, test } from "bun:test";

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
  plannerContextWithVisibleSkills,
} from "./agent-builder-draft-patch-normalizer-fixtures";

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
      nodes: [draftPatchNode("runtime", "runtimeId", "openai runtime")],
    });

    expect(nodes[0]?.status).toBe("applied");
    expect(nodes[0]?.draftPatch?.value).toBe("openai-runtime");
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

  test("unmounts a bound Space without deleting the Space asset", async () => {
    const nodes = await normalizeAgentBuilderDraftPatchNodes({
      actorAccountId: NORMALIZER_IDS.account,
      bindings: { DB: {} as D1Database } as ApiBindings,
      context: plannerContextWithBoundSpaces(),
      mode: "draft_patch",
      nodes: [draftPatchNode("remove_space", "spaceIds", [NORMALIZER_IDS.spaceRemove], "remove")],
    });

    expect(nodes[0]?.status).toBe("applied");
    expect(nodes[0]?.operation).toBe("remove");
    expect(nodes[0]?.draftPatch).toMatchObject({
      baseValue: [NORMALIZER_IDS.spaceKeep, NORMALIZER_IDS.spaceRemove],
      fieldPath: "spaceIds",
      resolvedReferences: [
        {
          bindingState: "bound",
          id: NORMALIZER_IDS.spaceKeep,
          name: "Keep Space",
          targetType: "space",
        },
      ],
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
});
