import { describe, expect, test } from "bun:test";

import type {
  AgentBuilderStarterPackItem,
  AgentBuilderStarterPackResult,
} from "@mosoo/contracts/agent-builder";

import { prepareAgentBuilderStarterPackApproval } from "../src/modules/agent-builder/application/builder-starter-pack-approval.service";

function item(
  overrides: Partial<AgentBuilderStarterPackItem> & Pick<AgentBuilderStarterPackItem, "nodeKey">,
): AgentBuilderStarterPackItem {
  return {
    action: {
      patchNodeKey: `patch_${overrides.nodeKey}`,
      type: "draft_patch",
    },
    approvalMode: "single_or_batch",
    assetType: "agent_field",
    evidenceRefs: [
      `prepare_draft_patch:${overrides.nodeKey}`,
      `dry_run_draft_patch:${overrides.nodeKey}`,
    ],
    reason: `Reason for ${overrides.nodeKey}.`,
    status: "pending",
    title: `Title ${overrides.nodeKey}`,
    ...overrides,
  };
}

function starterPack(): AgentBuilderStarterPackResult {
  return {
    assistantText: "Starter Pack ready.",
    intentSummary: "Assemble existing assets.",
    items: [
      item({ nodeKey: "draft_name" }),
      item({
        action: {
          assetId: "skill_linear",
          type: "bind_existing_asset",
        },
        approvalMode: "single_only",
        assetId: "skill_linear",
        assetName: "Linear Skill",
        assetType: "skill",
        nodeKey: "skill_linear",
      }),
      item({
        action: {
          href: "/integrations/mcp",
          type: "open_external_setup",
        },
        approvalMode: "external_config",
        assetType: "mcp",
        nodeKey: "mcp_slack_missing",
        status: "needs_config",
      }),
      item({
        approvalMode: "blocked",
        nodeKey: "blocked_secret",
        status: "blocked",
      }),
      item({
        nodeKey: "already_applied",
        status: "applied",
      }),
    ],
    mode: "starter_pack",
    plannerRunId: "planner-run-1",
    version: 1,
  };
}

function environmentChoiceStarterPack(): AgentBuilderStarterPackResult {
  return {
    assistantText: "Choose one Environment.",
    intentSummary: "Bind one Environment.",
    items: [
      item({
        action: {
          assetId: "env_linear",
          type: "bind_existing_asset",
        },
        approvalMode: "single_only",
        assetId: "env_linear",
        assetName: "Linear Limited Environment",
        assetType: "environment",
        nodeKey: "bind_env_linear",
      }),
      item({
        action: {
          assetId: "env_default",
          type: "bind_existing_asset",
        },
        approvalMode: "single_only",
        assetId: "env_default",
        assetName: "System Default",
        assetType: "environment",
        nodeKey: "bind_env_default",
      }),
      item({
        action: {
          assetId: "space_support_kb",
          type: "bind_existing_asset",
        },
        approvalMode: "single_only",
        assetId: "space_support_kb",
        assetName: "Support KB",
        assetType: "space",
        nodeKey: "bind_space_support_kb",
      }),
      item({
        action: {
          assetId: "space_faq",
          type: "bind_existing_asset",
        },
        approvalMode: "single_only",
        assetId: "space_faq",
        assetName: "FAQ",
        assetType: "space",
        nodeKey: "bind_space_faq",
      }),
    ],
    mode: "starter_pack",
    plannerRunId: "planner-run-env-choice",
    version: 1,
  };
}

describe("Agent Builder Starter Pack approval admission", () => {
  test("approves a single executable item even when it is single-only", () => {
    const plan = prepareAgentBuilderStarterPackApproval(starterPack(), {
      mode: "single",
      nodeKey: "skill_linear",
    });

    expect(plan.approvedItems.map((approved) => approved.nodeKey)).toEqual(["skill_linear"]);
    expect(plan.skippedItems).toEqual([]);
  });

  test("single Environment approval skips other pending Environment candidates", () => {
    const plan = prepareAgentBuilderStarterPackApproval(environmentChoiceStarterPack(), {
      mode: "single",
      nodeKey: "bind_env_linear",
    });

    expect(plan.approvedItems.map((approved) => approved.nodeKey)).toEqual(["bind_env_linear"]);
    expect(plan.skippedItems.map((skipped) => skipped.nodeKey)).toEqual(["bind_env_default"]);
    expect(plan.skippedItems[0]?.reason.length ?? 0).toBeGreaterThan(0);
  });

  test("single Space approval does not skip other pending Space choices", () => {
    const result = environmentChoiceStarterPack();
    const plan = prepareAgentBuilderStarterPackApproval(
      {
        ...result,
        items: result.items.filter((starterPackItem) => starterPackItem.assetType === "space"),
      },
      {
        mode: "single",
        nodeKey: "bind_space_support_kb",
      },
    );

    expect(plan.approvedItems.map((approved) => approved.nodeKey)).toEqual([
      "bind_space_support_kb",
    ]);
    expect(plan.skippedItems).toEqual([]);
  });

  test("Approve all admits only pending single_or_batch executable items", () => {
    const plan = prepareAgentBuilderStarterPackApproval(starterPack(), {
      mode: "batch",
    });

    expect(plan.approvedItems.map((approved) => approved.nodeKey)).toEqual(["draft_name"]);
    expect(plan.skippedItems.map((skipped) => skipped.nodeKey)).toEqual([
      "skill_linear",
      "mcp_slack_missing",
      "blocked_secret",
      "already_applied",
    ]);
  });

  test("does not approve external setup items through the server executor", () => {
    const plan = prepareAgentBuilderStarterPackApproval(starterPack(), {
      mode: "single",
      nodeKey: "mcp_slack_missing",
    });

    expect(plan.approvedItems).toEqual([]);
    expect(plan.skippedItems.map((skipped) => skipped.nodeKey)).toEqual(["mcp_slack_missing"]);
  });

  test("throws when a single approval references an unknown item", () => {
    expect(() =>
      prepareAgentBuilderStarterPackApproval(starterPack(), {
        mode: "single",
        nodeKey: "missing",
      }),
    ).toThrow("missing");
  });

  test("rejects display text as a single approval identity", () => {
    expect(() =>
      prepareAgentBuilderStarterPackApproval(starterPack(), {
        mode: "single",
        nodeKey: "Title draft_name",
      }),
    ).toThrow();
  });
});
