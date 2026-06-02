import { describe, expect, test } from "bun:test";

import {
  parseAgentBuilderPlannerRunId,
  parseSkillId,
  parseSpaceId,
} from "../src/modules/agent-builder/application/agent-builder-ids";
import { createAgentBuilderToolRuntime } from "../src/modules/agent-builder/application/agent-builder-tool-runtime.service";
import { admitAgentBuilderStarterPackWorkflowResult } from "../src/modules/agent-builder/application/builder-assembly-workflow-admission.service";
import { createDeterministicBuilderWorkflowExecutor } from "../src/modules/agent-builder/application/builder-workflow-executor.service";

const ADMISSION_IDS = {
  plannerRun: parseAgentBuilderPlannerRunId("01J00000000000000000000601"),
  skillLinear: parseSkillId("01J00000000000000000000602"),
  spaceTest: parseSpaceId("01J00000000000000000000603"),
} as const;

function createStaticNow(): () => string {
  return () => "2026-05-25T00:00:00.000Z";
}

describe("Agent Builder assembly workflow admission", () => {
  test("accepts a deterministic workflow that composes existing tools into a Starter Pack", async () => {
    const runtime = createAgentBuilderToolRuntime({
      now: createStaticNow(),
      tools: [
        {
          execute() {
            return {
              items: [{ id: ADMISSION_IDS.skillLinear, name: "Linear triage" }],
              mode: "asset_search",
            };
          },
          toolId: "search_assets",
        },
        {
          execute() {
            return {
              assetId: ADMISSION_IDS.skillLinear,
              assetName: "Linear triage",
              mode: "resolved",
            };
          },
          toolId: "resolve_asset_reference",
        },
        {
          execute() {
            return {
              mode: "draft_patch",
              nodeKey: "patch_skill",
            };
          },
          toolId: "prepare_bind_skill_patch",
        },
        {
          execute() {
            return {
              mode: "draft_patch",
              nodeKey: "patch_name",
            };
          },
          toolId: "prepare_draft_patch",
        },
        {
          execute(input) {
            return {
              mode: "dry_run",
              nodeKey: input["nodeKey"],
              status: "ready",
            };
          },
          toolId: "dry_run_draft_patch",
        },
      ],
    });
    const executor = createDeterministicBuilderWorkflowExecutor(async (context) => {
      await context.callTool({
        input: { assetType: "skill", query: "Linear" },
        toolId: "search_assets",
      });
      await context.callTool({
        input: { assetType: "skill", reference: "Linear triage" },
        toolId: "resolve_asset_reference",
      });
      await context.callTool({
        input: { assetId: ADMISSION_IDS.skillLinear, assetName: "Linear triage" },
        toolId: "prepare_bind_skill_patch",
      });
      await context.callTool({
        input: { nodeKey: "patch_skill" },
        toolId: "dry_run_draft_patch",
      });
      await context.callTool({
        input: { fieldPath: "name", value: "Linear Support Assistant" },
        toolId: "prepare_draft_patch",
      });
      await context.callTool({
        input: { nodeKey: "patch_name" },
        toolId: "dry_run_draft_patch",
      });

      return {
        assistantText: "我为这个客服 Agent 准备了一套初始配置。",
        intentSummary: "Assemble a Linear support assistant from existing assets.",
        items: [
          {
            action: {
              assetId: ADMISSION_IDS.skillLinear,
              type: "bind_existing_asset",
            },
            approvalMode: "single_or_batch",
            assetId: ADMISSION_IDS.skillLinear,
            assetName: "Linear triage",
            assetType: "skill",
            evidenceRefs: [
              "search_assets:skill",
              `resolve_asset_reference:${ADMISSION_IDS.skillLinear}`,
              "prepare_bind_skill_patch:patch_skill",
              "dry_run_draft_patch:patch_skill",
            ],
            nodeKey: "item_skill",
            reason: "Linear triage matches the requested support workflow.",
            status: "pending",
            title: "绑定 Linear triage Skill",
          },
          {
            action: {
              patchNodeKey: "patch_name",
              type: "draft_patch",
            },
            approvalMode: "single_or_batch",
            assetType: "agent_field",
            evidenceRefs: ["prepare_draft_patch:patch_name", "dry_run_draft_patch:patch_name"],
            nodeKey: "item_name",
            reason: "A concrete name makes the draft immediately usable.",
            status: "pending",
            title: "设置 Agent 名称",
          },
        ],
        mode: "starter_pack",
        plannerRunId: ADMISSION_IDS.plannerRun,
        version: 1,
      };
    });

    const workflowResult = await executor.execute({
      code: "deterministic assembly workflow",
      timeoutMs: 1_000,
      tools: runtime,
    });
    const admission = admitAgentBuilderStarterPackWorkflowResult(workflowResult.result, {
      plannerRunId: ADMISSION_IDS.plannerRun,
    });

    expect(workflowResult.errorMessage).toBeNull();
    expect(workflowResult.trace.map((entry) => entry.requestedToolId)).toEqual([
      "search_assets",
      "resolve_asset_reference",
      "prepare_bind_skill_patch",
      "dry_run_draft_patch",
      "prepare_draft_patch",
      "dry_run_draft_patch",
    ]);
    expect(admission.valid).toBe(true);
    expect(admission.errors).toEqual([]);
    expect(admission.result?.items.map((item) => item.nodeKey)).toEqual([
      "item_skill",
      "item_name",
    ]);
  });

  test("rejects malformed workflow output before UI projection", () => {
    const admission = admitAgentBuilderStarterPackWorkflowResult(
      { mode: "plain_text" },
      { plannerRunId: ADMISSION_IDS.plannerRun },
    );

    expect(admission.valid).toBe(false);
    expect(admission.result).toBeNull();
    expect(admission.errors.length).toBeGreaterThan(0);
  });

  test("derives missing approval node keys from action identity instead of item order", () => {
    const draftPatchItem = {
      action: {
        patchNodeKey: "patch_name",
        type: "draft_patch",
      },
      approvalMode: "single_or_batch",
      assetType: "agent_field",
      evidenceRefs: ["prepare_draft_patch:patch_name", "dry_run_draft_patch:patch_name"],
      reason: "Set a target-side name.",
      status: "pending",
      title: "设置 Agent 名称",
    };
    const bindSkillItem = {
      action: {
        assetId: ADMISSION_IDS.skillLinear,
        type: "bind_existing_asset",
      },
      approvalMode: "single_or_batch",
      assetId: ADMISSION_IDS.skillLinear,
      assetName: "Linear triage",
      assetType: "skill",
      evidenceRefs: [
        `resolve_asset_reference:${ADMISSION_IDS.skillLinear}`,
        `prepare_bind_skill_patch:${ADMISSION_IDS.skillLinear}`,
        `dry_run_draft_patch:${ADMISSION_IDS.skillLinear}`,
      ],
      reason: "Bind the target-visible Skill.",
      status: "pending",
      title: "绑定 Linear triage Skill",
    };
    const createAdmission = (items: readonly unknown[]) =>
      admitAgentBuilderStarterPackWorkflowResult(
        {
          assistantText: "Starter Pack ready.",
          intentSummary: "Prepare target-side assets.",
          items,
          mode: "starter_pack",
          plannerRunId: ADMISSION_IDS.plannerRun,
          version: 1,
        },
        { plannerRunId: ADMISSION_IDS.plannerRun },
      );

    expect(
      createAdmission([draftPatchItem, bindSkillItem]).result?.items.map((item) => item.nodeKey),
    ).toEqual(["patch_name", "bind_skill_01j00000000000000000000602"]);
    expect(
      createAdmission([bindSkillItem, draftPatchItem]).result?.items.map((item) => item.nodeKey),
    ).toEqual(["bind_skill_01j00000000000000000000602", "patch_name"]);
  });

  test("marks pending bind items as applied when the trace resolved an already-bound asset", () => {
    const admission = admitAgentBuilderStarterPackWorkflowResult(
      {
        assistantText: "我找到了一个可复用的 Space。",
        intentSummary: "Bind existing Space.",
        items: [
          {
            action: {
              assetId: ADMISSION_IDS.spaceTest,
              type: "bind_existing_asset",
            },
            approvalMode: "single_or_batch",
            assetId: ADMISSION_IDS.spaceTest,
            assetName: "test",
            assetType: "space",
            evidenceRefs: [
              `resolve_asset_reference:${ADMISSION_IDS.spaceTest}`,
              `prepare_bind_space_patch:${ADMISSION_IDS.spaceTest}`,
              `dry_run_draft_patch:${ADMISSION_IDS.spaceTest}`,
            ],
            nodeKey: "bind_space_test",
            reason: "准备绑定 Space test。",
            status: "pending",
            title: "绑定现有 Space：test",
          },
        ],
        mode: "starter_pack",
        plannerRunId: ADMISSION_IDS.plannerRun,
        version: 1,
      },
      {
        plannerRunId: ADMISSION_IDS.plannerRun,
        trace: [
          {
            completedAt: "2026-05-25T00:00:01.000Z",
            errorMessage: null,
            input: {
              assetType: "space",
              bindingState: ["not_bound"],
              reference: "test",
            },
            output: {
              assetType: "space",
              mode: "asset_reference",
              nextAction: "no_op",
              resolvedAsset: {
                assetType: "space",
                bindingState: "bound",
                id: ADMISSION_IDS.spaceTest,
                name: "test",
              },
              status: "resolved",
            },
            redactedInputSummary: "redacted input",
            redactedOutputSummary: "redacted output",
            requestedToolId: "resolve_asset_reference",
            startedAt: "2026-05-25T00:00:00.000Z",
            status: "completed",
            toolId: "resolve_asset_reference",
          },
        ],
      },
    );

    expect(admission.valid).toBe(true);
    expect(admission.errors).toEqual([]);
    expect(admission.result?.items[0]).toMatchObject({
      action: {
        type: "none",
      },
      approvalMode: "blocked",
      assetId: ADMISSION_IDS.spaceTest,
      assetName: "test",
      assetType: "space",
      status: "applied",
    });
  });
});
