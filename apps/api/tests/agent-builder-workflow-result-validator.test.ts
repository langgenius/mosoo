import { describe, expect, test } from "bun:test";

import type { AgentBuilderStarterPackItem } from "@mosoo/contracts/agent-builder";

import { validateAgentBuilderStarterPackResult } from "../src/modules/agent-builder/application/builder-workflow-result-validator.service";

function createPatchItem(
  overrides: Partial<AgentBuilderStarterPackItem> = {},
): AgentBuilderStarterPackItem {
  return {
    action: {
      patchNodeKey: "patch_name",
      type: "draft_patch",
    },
    approvalMode: "single_or_batch",
    assetType: "agent_field",
    evidenceRefs: ["prepare_draft_patch:patch_name", "dry_run_draft_patch:patch_name"],
    nodeKey: "item_name",
    reason: "Name is part of the initial draft.",
    status: "pending",
    title: "设置 Agent 名称",
    ...overrides,
  };
}

function createBindItem(
  overrides: Partial<AgentBuilderStarterPackItem> = {},
): AgentBuilderStarterPackItem {
  return {
    action: {
      assetId: "skill_1",
      type: "bind_existing_asset",
    },
    approvalMode: "single_or_batch",
    assetId: "skill_1",
    assetName: "Linear triage",
    assetType: "skill",
    evidenceRefs: [
      "resolve_asset_reference:skill_1",
      "prepare_bind_skill_patch:skill_1",
      "dry_run_draft_patch:skill_1",
    ],
    nodeKey: "item_skill",
    reason: "The Skill matches the user's support workflow.",
    status: "pending",
    title: "绑定 Linear triage Skill",
    ...overrides,
  };
}

describe("Agent Builder workflow result validator", () => {
  test("accepts approvable Starter Pack items with prepare and dry-run evidence", () => {
    expect(
      validateAgentBuilderStarterPackResult({
        items: [createPatchItem(), createBindItem()],
      }),
    ).toEqual({
      errors: [],
      valid: true,
    });
  });

  test("requires draft patch items to include prepare and dry-run evidence", () => {
    const result = validateAgentBuilderStarterPackResult({
      items: [
        createPatchItem({
          evidenceRefs: ["prepare_draft_patch:patch_name"],
        }),
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining("dry_run_draft_patch")]),
    );
  });

  test("requires bind items to include resolve, prepare-bind, and dry-run evidence", () => {
    const result = validateAgentBuilderStarterPackResult({
      items: [
        createBindItem({
          evidenceRefs: ["resolve_asset_reference:skill_1", "dry_run_draft_patch:skill_1"],
        }),
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining("prepare_bind_skill_patch")]),
    );
  });

  test("does not require dry-run for external configuration and blocked items", () => {
    expect(
      validateAgentBuilderStarterPackResult({
        items: [
          {
            action: {
              href: "/integrations/mcp",
              type: "open_external_setup",
            },
            approvalMode: "external_config",
            assetType: "mcp",
            evidenceRefs: ["search_assets:mcp"],
            nodeKey: "item_mcp_config",
            reason: "The MCP is missing.",
            status: "needs_config",
            title: "配置 MCP",
          },
          {
            action: {
              type: "none",
            },
            approvalMode: "blocked",
            assetType: "space",
            evidenceRefs: [],
            nodeKey: "item_blocked",
            reason: "Permission changes are out of scope.",
            status: "blocked",
            title: "权限变更不可用",
          },
        ],
      }),
    ).toEqual({
      errors: [],
      valid: true,
    });
  });

  test("rejects impossible existing-asset bind on agent field items", () => {
    const result = validateAgentBuilderStarterPackResult({
      items: [
        createBindItem({
          assetType: "agent_field",
          nodeKey: "item_invalid_bind",
        }),
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([expect.stringContaining("agent_field")]));
  });
});
