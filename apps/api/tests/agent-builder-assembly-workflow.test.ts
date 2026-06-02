import { describe, expect, test } from "bun:test";

import { createAgentBuilderToolRuntime } from "../src/modules/agent-builder/application/agent-builder-tool-runtime.service";
import { runAgentBuilderAssemblyWorkflow } from "../src/modules/agent-builder/application/builder-assembly-workflow.service";
import { createDeterministicBuilderWorkflowExecutor } from "../src/modules/agent-builder/application/builder-workflow-executor.service";

function createStaticNow(): () => string {
  return () => "2026-05-25T00:00:00.000Z";
}

function createEmptyRuntime() {
  return createAgentBuilderToolRuntime({
    now: createStaticNow(),
    tools: [],
  });
}

function createResolvedSpaceRuntime() {
  return createAgentBuilderToolRuntime({
    now: createStaticNow(),
    tools: [
      {
        execute() {
          return {
            mode: "asset_reference",
            resolvedAsset: {
              assetType: "space",
              bindingState: "not_bound",
              id: "space_test",
              name: "test",
            },
            status: "resolved",
          };
        },
        toolId: "resolve_asset_reference",
      },
      {
        execute(input) {
          if (typeof input["assetName"] !== "string" || input["assetName"].trim().length === 0) {
            throw new Error("assetName is required.");
          }

          return {
            appliedCount: 1,
            blockedCount: 0,
            itemCount: 1,
            mode: "draft_patch",
            nodes: [
              {
                draftPatch: {
                  autoApply: true,
                  fieldPath: "spaceIds",
                  resolvedReferences: [
                    {
                      id: input["assetId"],
                      name: input["assetName"],
                      targetType: "space",
                    },
                  ],
                  sectionId: "integrations",
                  value: [input["assetId"]],
                },
                fieldPath: "spaceIds",
                kind: "draft_patch",
                nodeKey: input["nodeKey"],
                operation: "bind",
                requiresConfirmation: false,
                status: "applied",
                summary: `Bind Space ${input["assetName"]} to this Agent Draft.`,
                targetType: "draft",
              },
            ],
            patches: [
              {
                autoApply: true,
                fieldPath: "spaceIds",
                value: [input["assetId"]],
              },
            ],
            status: "ready",
          };
        },
        toolId: "prepare_bind_space_patch",
      },
      {
        execute() {
          return {
            changedFields: ["spaceIds"],
            mode: "draft_patch",
            status: "passed",
          };
        },
        toolId: "dry_run_draft_patch",
      },
    ],
  });
}

function createValidStarterPackResult() {
  return {
    assistantText: "我为这个 Agent 准备了一套初始配置。",
    intentSummary: "Assemble a starter pack from existing assets.",
    items: [
      {
        action: {
          patchNodeKey: "patch_name",
          type: "draft_patch",
        },
        approvalMode: "single_or_batch",
        assetType: "agent_field",
        evidenceRefs: ["prepare_draft_patch:patch_name", "dry_run_draft_patch:patch_name"],
        nodeKey: "item_name",
        reason: "A concrete name makes the Agent draft easier to inspect.",
        status: "pending",
        title: "设置 Agent 名称",
      },
    ],
    mode: "starter_pack",
    plannerRunId: "workflow_run_1",
    version: 1,
  };
}

describe("Agent Builder assembly workflow runner", () => {
  test("completes a valid Starter Pack workflow", async () => {
    const result = await runAgentBuilderAssemblyWorkflow({
      code: "workflow",
      executor: createDeterministicBuilderWorkflowExecutor(() => createValidStarterPackResult()),
      timeoutMs: 1_000,
      tools: createEmptyRuntime(),
    });

    expect(result.status).toBe("completed");

    if (result.status !== "completed") {
      throw new Error("Expected completed assembly workflow.");
    }

    expect(result.result).toMatchObject({
      mode: "starter_pack",
      plannerRunId: "workflow_run_1",
    });
    expect(result.result.items.map((item) => item.nodeKey)).toEqual(["item_name"]);
  });

  test("preserves external setup cards for unavailable assets", async () => {
    const result = await runAgentBuilderAssemblyWorkflow({
      code: "workflow",
      executor: createDeterministicBuilderWorkflowExecutor(() => ({
        assistantText: "当前没有可直接绑定的 Notion 或 Slack MCP，请先完成配置后再回到 Builder。",
        intentSummary: "Recommend external setup for missing operations assistant assets.",
        items: [
          {
            action: {
              href: "/integrations/mcp",
              type: "open_external_setup",
            },
            approvalMode: "external_config",
            assetType: "mcp",
            evidenceRefs: [],
            nodeKey: "missing_notion_slack_mcp",
            reason: "当前组织没有可见且已授权的 Notion 或 Slack MCP。",
            status: "needs_config",
            title: "配置 Notion / Slack MCP",
          },
        ],
        mode: "starter_pack",
        plannerRunId: "workflow_run_1",
        version: 1,
      })),
      timeoutMs: 1_000,
      tools: createEmptyRuntime(),
    });

    expect(result.status).toBe("completed");

    if (result.status !== "completed") {
      throw new Error("Expected completed assembly workflow.");
    }

    expect(result.result.items[0]).toMatchObject({
      action: {
        href: "/integrations/mcp",
        type: "open_external_setup",
      },
      approvalMode: "external_config",
      assetType: "mcp",
      status: "needs_config",
    });
  });

  test("fails executor errors and blocks unsafe Starter Pack output", async () => {
    const failed = await runAgentBuilderAssemblyWorkflow({
      code: "workflow",
      executor: createDeterministicBuilderWorkflowExecutor(() => {
        throw new Error("workflow failed");
      }),
      timeoutMs: 1_000,
      tools: createEmptyRuntime(),
    });

    expect(failed.status).toBe("failed");

    if (failed.status !== "failed") {
      throw new Error("Expected failed assembly workflow.");
    }

    expect(failed.errors).toEqual(["workflow failed"]);

    const blocked = await runAgentBuilderAssemblyWorkflow({
      code: "workflow",
      executor: createDeterministicBuilderWorkflowExecutor(() => ({
        ...createValidStarterPackResult(),
        items: [
          {
            ...createValidStarterPackResult().items[0],
            evidenceRefs: [],
          },
        ],
      })),
      timeoutMs: 1_000,
      tools: createEmptyRuntime(),
    });

    expect(blocked.status).toBe("blocked");

    if (blocked.status !== "blocked") {
      throw new Error("Expected blocked assembly workflow.");
    }

    expect(blocked.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("prepare_draft_patch"),
        expect.stringContaining("dry_run_draft_patch"),
      ]),
    );
  });

  test("repairs one resolved existing-asset setup card into a bind action", async () => {
    const result = await runAgentBuilderAssemblyWorkflow({
      code: "workflow",
      executor: createDeterministicBuilderWorkflowExecutor(async (context) => {
        await context.callTool({
          input: { assetType: "space", reference: "test" },
          toolId: "resolve_asset_reference",
        });

        return {
          assistantText:
            "当前未能解析到可绑定的 test 知识空间。请先确认该 Space 仍可见且可绑定，然后再继续。",
          intentSummary: "Bind a visible Space to the Agent Draft.",
          items: [
            {
              action: {
                href: "/spaces",
                type: "open_external_setup",
              },
              approvalMode: "external_config",
              assetType: "space",
              evidenceRefs: ["resolve_space_test"],
              nodeKey: "need_space_test",
              reason: "当前无法从可见资产中解析到名为 test 的 Space，因此不能直接生成绑定补丁。",
              status: "needs_config",
              title: "补充可绑定的 test 知识空间",
            },
          ],
          mode: "starter_pack",
          plannerRunId: "workflow_run_1",
          version: 1,
        };
      }),
      timeoutMs: 1_000,
      tools: createResolvedSpaceRuntime(),
    });

    expect(result.status).toBe("completed");

    if (result.status !== "completed") {
      throw new Error("Expected completed assembly workflow.");
    }

    expect(result.execution.trace.map((record) => record.toolId)).toEqual([
      "resolve_asset_reference",
      "prepare_bind_space_patch",
      "dry_run_draft_patch",
    ]);
    expect(result.result.items[0]).toMatchObject({
      action: {
        assetId: "space_test",
        type: "bind_existing_asset",
      },
      approvalMode: "single_or_batch",
      assetId: "space_test",
      assetName: "test",
      assetType: "space",
      nodeKey: "need_space_test",
      status: "pending",
    });

    const prepareRecord = result.execution.trace.find(
      (record) => record.toolId === "prepare_bind_space_patch",
    );
    const prepareOutput =
      prepareRecord?.output !== null && typeof prepareRecord?.output === "object"
        ? (prepareRecord.output as { nodes?: Array<{ nodeKey?: string }> })
        : null;

    expect(prepareOutput?.nodes?.[0]?.nodeKey).toBe("need_space_test_bind_existing");
  });
});
