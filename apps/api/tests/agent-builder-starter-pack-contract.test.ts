import { describe, expect, test } from "bun:test";

import {
  normalizeAgentBuilderExternalSetupHref,
  isAgentBuilderStarterPackItemBatchApprovable,
  listAgentBuilderStarterPackBatchApprovableItems,
  parseAgentBuilderStarterPackResult,
} from "@mosoo/contracts/agent-builder";

function createValidStarterPackResult() {
  return {
    assistantText: "我为这个客服 Agent 准备了一套初始配置。",
    intentSummary: "Create a support assistant starter pack.",
    items: [
      {
        action: {
          patchNodeKey: "patch_name",
          type: "draft_patch",
        },
        approvalMode: "single_or_batch",
        assetType: "agent_field",
        evidenceRefs: ["dry_run_draft_patch:patch_name"],
        nodeKey: "item_name",
        reason: "A concrete name helps users understand the draft.",
        status: "pending",
        title: "设置 Agent 名称",
      },
      {
        action: {
          assetId: "skill_1",
          type: "bind_existing_asset",
        },
        approvalMode: "single_or_batch",
        assetId: "skill_1",
        assetName: "Linear triage",
        assetType: "skill",
        evidenceRefs: ["search_assets:skills", "resolve_asset_reference:skill_1"],
        nodeKey: "item_skill",
        reason: "Linear triage matches the support workflow.",
        status: "pending",
        title: "绑定 Linear triage Skill",
      },
      {
        action: {
          href: "/mcp",
          type: "open_external_setup",
        },
        approvalMode: "external_config",
        assetType: "mcp",
        evidenceRefs: ["search_assets:mcp"],
        nodeKey: "item_mcp_missing",
        reason: "Linear MCP is not configured yet.",
        status: "needs_config",
        title: "配置 Linear MCP",
      },
    ],
    mode: "starter_pack",
    plannerRunId: "planner_run_1",
    version: 1,
  };
}

describe("Agent Builder Starter Pack contract", () => {
  test("parses a valid Starter Pack result", () => {
    const parsed = parseAgentBuilderStarterPackResult(createValidStarterPackResult());

    expect(parsed?.mode).toBe("starter_pack");
    expect(parsed?.items).toHaveLength(3);
    expect(parsed?.items[1]?.assetId).toBe("skill_1");
    expect(parsed?.items[2]?.approvalMode).toBe("external_config");
    expect(parsed?.items[2]?.action).toEqual({
      href: "/integrations/mcp",
      type: "open_external_setup",
    });
  });

  test("normalizes external setup links to routed frontend pages", () => {
    expect(normalizeAgentBuilderExternalSetupHref({ assetType: "mcp", href: "/mcp" })).toBe(
      "/integrations/mcp",
    );
    expect(normalizeAgentBuilderExternalSetupHref({ assetType: "skill", href: "/skills" })).toBe(
      "/integrations/skills",
    );
    expect(normalizeAgentBuilderExternalSetupHref({ assetType: "space", href: "/spaces" })).toBe(
      "/space",
    );
    expect(
      normalizeAgentBuilderExternalSetupHref({
        assetType: "environment",
        href: "/environments/env_1",
      }),
    ).toBe("/environment/env_1");
    expect(
      normalizeAgentBuilderExternalSetupHref({
        assetType: "mcp",
        href: "https://example.com/unknown",
      }),
    ).toBe("/integrations/mcp");
  });

  test("rejects unknown actions instead of allowing create operations into Starter Pack", () => {
    const invalid = createValidStarterPackResult();
    invalid.items[0] = {
      ...invalid.items[0],
      action: {
        type: "create_asset",
      },
    } as (typeof invalid.items)[number];

    expect(parseAgentBuilderStarterPackResult(invalid)).toBeNull();
  });

  test("admits only pending single_or_batch patch or existing-asset bind items into Approve all", () => {
    const parsed = parseAgentBuilderStarterPackResult(createValidStarterPackResult());

    expect(parsed).not.toBeNull();

    const batchItems = listAgentBuilderStarterPackBatchApprovableItems(parsed!);

    expect(batchItems.map((item) => item.nodeKey)).toEqual(["item_name", "item_skill"]);
    expect(batchItems.every(isAgentBuilderStarterPackItemBatchApprovable)).toBe(true);
  });

  test("excludes single-only, external-config, blocked, and already-applied items from Approve all", () => {
    const parsed = parseAgentBuilderStarterPackResult({
      ...createValidStarterPackResult(),
      items: [
        {
          action: {
            patchNodeKey: "patch_prompt",
            type: "draft_patch",
          },
          approvalMode: "single_only",
          assetType: "agent_field",
          evidenceRefs: ["dry_run_draft_patch:patch_prompt"],
          nodeKey: "single_only",
          reason: "Prompt replacement should be reviewed separately.",
          status: "pending",
          title: "替换 Prompt",
        },
        {
          action: {
            href: "/environment/env_1",
            type: "open_external_setup",
          },
          approvalMode: "external_config",
          assetType: "environment",
          evidenceRefs: ["search_assets:environment"],
          nodeKey: "external_config",
          reason: "Secret value must be configured outside Composer.",
          status: "needs_config",
          title: "配置 Environment secret",
        },
        {
          action: {
            type: "none",
          },
          approvalMode: "blocked",
          assetType: "mcp",
          evidenceRefs: ["search_assets:mcp"],
          nodeKey: "blocked",
          reason: "Permission changes are not supported by Builder Assembly.",
          status: "blocked",
          title: "变更 MCP 权限",
        },
        {
          action: {
            assetId: "space_1",
            type: "bind_existing_asset",
          },
          approvalMode: "single_or_batch",
          assetId: "space_1",
          assetType: "space",
          evidenceRefs: ["resolve_asset_reference:space_1"],
          nodeKey: "applied",
          reason: "Already applied.",
          status: "applied",
          title: "绑定 Space",
        },
      ],
    });

    expect(parsed).not.toBeNull();
    expect(listAgentBuilderStarterPackBatchApprovableItems(parsed!)).toEqual([]);
  });
});
