import { describe, expect, test } from "bun:test";

import {
  parseAgentBuilderPlannerOutputJson,
  parseAgentBuilderStarterPackResult,
} from "@mosoo/contracts/agent-builder";
import type {
  AgentBuilderDraftPatchChange,
  AgentBuilderPlanNode,
  AgentBuilderStarterPackResult,
} from "@mosoo/contracts/agent-builder";

import { createAgentBuilderToolRuntime } from "../src/modules/agent-builder/application/agent-builder-tool-runtime.service";
import { appendAgentBuilderAssemblyTurn } from "../src/modules/agent-builder/application/builder-conversation-turn.service";
import { approveAgentBuilderStarterPack } from "../src/modules/agent-builder/application/builder-starter-pack-approval-ledger.service";
import { createDeterministicBuilderWorkflowExecutor } from "../src/modules/agent-builder/application/builder-workflow-executor.service";
import { createAgentBuilderApiFixture } from "./helpers/agent-builder-api-fixture";
import type { AgentBuilderApiFixture } from "./helpers/agent-builder-api-fixture";

const DRAFT_YAML = [
  "version: 1",
  "kind: pet",
  "identity:",
  "  name: Starter Pack Approval Fixture",
  "  description: Draft fixture for Starter Pack approval tests.",
  "runtime:",
  "  id: openai-runtime",
  "  provider: openai",
  "  model: gpt-5.4",
  "prompt: Help the user assemble an Agent starter pack.",
  "environment:",
  "  environmentId: null",
  "assets:",
  "  agentsFileId: null",
  "  skills: []",
  "  mcpServers: []",
  "  spaces: []",
].join("\n");

function createStarterPackResult(
  input: {
    patchNodeKey?: string;
  } = {},
): AgentBuilderStarterPackResult {
  const patchNodeKey = input.patchNodeKey ?? "patch_agent_name";

  return {
    assistantText: "我准备了一套可确认的 Agent Starter Pack。",
    intentSummary: "Assemble existing assets.",
    items: [
      {
        action: {
          patchNodeKey,
          type: "draft_patch",
        },
        approvalMode: "single_or_batch",
        assetType: "agent_field",
        evidenceRefs: [
          "prepare_draft_patch:patch_agent_name",
          "dry_run_draft_patch:patch_agent_name",
        ],
        nodeKey: "starter_agent_name",
        reason: "A concrete name helps the user review the draft.",
        status: "pending",
        title: "设置 Agent 名称",
      },
      {
        action: {
          href: "/integrations/mcp",
          type: "open_external_setup",
        },
        approvalMode: "external_config",
        assetType: "mcp",
        evidenceRefs: [],
        nodeKey: "slack_mcp_missing",
        reason: "Slack MCP is not configured yet.",
        status: "needs_config",
        title: "配置 Slack MCP",
      },
    ],
    mode: "starter_pack",
    plannerRunId: "workflow-run-id",
    version: 1,
  };
}

function createAgentNameDraftPatchNode(): AgentBuilderPlanNode {
  const draftPatch: AgentBuilderDraftPatchChange = {
    autoApply: true,
    baseDraftRevision: "draft-rev-1",
    baseValue: "Starter Pack Approval Fixture",
    fieldPath: "name",
    sectionId: "basics",
    value: "Support Team Agent",
  };

  return {
    actions: [],
    draftPatch,
    fieldPath: "name",
    kind: "draft_patch",
    nodeKey: "patch_agent_name",
    operation: "update",
    requiresConfirmation: false,
    status: "applied",
    summary: "Set Agent name to Support Team Agent.",
    targetType: "draft",
  };
}

function createApprovalToolRuntime() {
  return createAgentBuilderToolRuntime({
    now: () => "2026-05-25T00:00:00.000Z",
    tools: [
      {
        execute() {
          return {
            mode: "draft_patch",
            nodes: [createAgentNameDraftPatchNode()],
            patches: [],
            status: "ready",
          };
        },
        toolId: "prepare_draft_patch",
      },
      {
        execute() {
          return {
            changedFields: ["name"],
            mode: "draft_patch",
            status: "passed",
          };
        },
        toolId: "dry_run_draft_patch",
      },
    ],
  });
}

async function login(fixture: AgentBuilderApiFixture) {
  await fixture.client.loginAsMosooAiTestAccount();
  const viewer = await fixture.client.readAuthenticatedViewerFromSession();

  if (viewer === null) {
    throw new Error("Expected Agent Builder test viewer session.");
  }

  return viewer;
}

function createDisplayDriftStarterPackResult(
  plannerRunId: AgentBuilderStarterPackResult["plannerRunId"],
): AgentBuilderStarterPackResult {
  const result = createStarterPackResult();
  const agentNameItem = result.items[0];
  const missingMcpItem = result.items[1];

  if (agentNameItem === undefined || missingMcpItem === undefined) {
    throw new Error("Expected Starter Pack fixture items.");
  }

  return {
    ...result,
    items: [
      {
        ...missingMcpItem,
        reason: "The imported package still needs target-side MCP setup.",
        title: "Repair MCP setup after import",
      },
      {
        ...agentNameItem,
        reason: "The forked draft needs a target-side display name.",
        title: "Rename imported Agent draft",
      },
    ],
    plannerRunId,
  };
}

async function replacePlannerRunOutput(input: {
  fixture: AgentBuilderApiFixture;
  plannerRunId: AgentBuilderStarterPackResult["plannerRunId"];
  result: AgentBuilderStarterPackResult;
}): Promise<void> {
  await input.fixture.database
    .prepare("UPDATE agent_builder_planner_run SET output_json = ? WHERE id = ?")
    .bind(JSON.stringify(input.result), input.plannerRunId)
    .run();
}

async function readStoredPlannerRunStarterPack(input: {
  fixture: AgentBuilderApiFixture;
  plannerRunId: AgentBuilderStarterPackResult["plannerRunId"];
}): Promise<AgentBuilderStarterPackResult> {
  const row =
    (await input.fixture.database
      .prepare("SELECT output_json FROM agent_builder_planner_run WHERE id = ?")
      .bind(input.plannerRunId)
      .first<{ output_json: string | null }>()) ?? null;
  const parsed = parseAgentBuilderStarterPackResult(JSON.parse(row?.output_json ?? "null"));

  if (parsed === null) {
    throw new Error("Expected stored Starter Pack output.");
  }

  return parsed;
}

async function createStarterPackTurn(
  fixture: AgentBuilderApiFixture,
  input: {
    patchNodeKey?: string;
  } = {},
) {
  const viewer = await login(fixture);
  const messages = await appendAgentBuilderAssemblyTurn(fixture.bindings, viewer, {
    agentId: fixture.ids.agentId,
    code: "return starterPack",
    draftRevision: "draft-rev-1",
    draftYaml: DRAFT_YAML,
    executor: createDeterministicBuilderWorkflowExecutor(async (context) => {
      const prepared = await context.callTool({
        input: {
          changes: [
            {
              fieldPath: "name",
              nodeKey: "patch_agent_name",
              value: "Support Team Agent",
            },
          ],
        },
        toolId: "prepare_draft_patch",
      });

      await context.callTool({
        input: { nodes: prepared["nodes"] },
        toolId: "dry_run_draft_patch",
      });

      return createStarterPackResult(input);
    }),
    inputText: "我想做一个客服工单 Agent",
    timeoutMs: 1_000,
    tools: createApprovalToolRuntime(),
  });
  const plannerRunId = messages[1]?.plannerRunId;

  if (plannerRunId === null || plannerRunId === undefined) {
    throw new Error("Expected Starter Pack planner run id.");
  }

  return { plannerRunId, viewer };
}

describe("Agent Builder Starter Pack approval ledger", () => {
  test("approves eligible Starter Pack items and emits draft patch output when trace evidence exists", async () => {
    const fixture = await createAgentBuilderApiFixture();
    const { plannerRunId, viewer } = await createStarterPackTurn(fixture);
    const approvalMessages = await approveAgentBuilderStarterPack(fixture.bindings, viewer, {
      agentId: fixture.ids.agentId,
      mode: "batch",
      plannerRunId,
    });

    expect(approvalMessages).toHaveLength(1);
    expect(approvalMessages[0]?.contentText.length ?? 0).toBeGreaterThan(0);

    const output = parseAgentBuilderPlannerOutputJson(approvalMessages[0]?.cardsJson ?? null);

    expect(output?.mode).toBe("draft_patch");

    if (output?.mode !== "draft_patch") {
      throw new Error("Expected approval output to contain a draft patch.");
    }

    expect(output.nodes.map((node) => node.nodeKey)).toEqual(["patch_agent_name"]);
  });

  test("requires nodeKey for single-item approval", async () => {
    const fixture = await createAgentBuilderApiFixture();
    const { plannerRunId, viewer } = await createStarterPackTurn(fixture);

    await expect(
      approveAgentBuilderStarterPack(fixture.bindings, viewer, {
        agentId: fixture.ids.agentId,
        mode: "single",
        plannerRunId,
      }),
    ).rejects.toThrow();
  });

  test("rejects display text as a single-item approval identity", async () => {
    const fixture = await createAgentBuilderApiFixture();
    const { plannerRunId, viewer } = await createStarterPackTurn(fixture);

    await expect(
      approveAgentBuilderStarterPack(fixture.bindings, viewer, {
        agentId: fixture.ids.agentId,
        mode: "single",
        nodeKey: "设置 Agent 名称",
        plannerRunId,
      }),
    ).rejects.toThrow();
  });

  test("matches single approval by stable node key after display text and order drift", async () => {
    const fixture = await createAgentBuilderApiFixture();
    const { plannerRunId, viewer } = await createStarterPackTurn(fixture);

    await replacePlannerRunOutput({
      fixture,
      plannerRunId,
      result: createDisplayDriftStarterPackResult(plannerRunId),
    });

    const approvalMessages = await approveAgentBuilderStarterPack(fixture.bindings, viewer, {
      agentId: fixture.ids.agentId,
      mode: "single",
      nodeKey: "starter_agent_name",
      plannerRunId,
    });
    const output = parseAgentBuilderPlannerOutputJson(approvalMessages[0]?.cardsJson ?? null);

    expect(output?.mode).toBe("draft_patch");

    if (output?.mode !== "draft_patch") {
      throw new Error("Expected approval output to contain a draft patch.");
    }

    expect(output.nodes.map((node) => node.nodeKey)).toEqual(["patch_agent_name"]);

    const storedStarterPack = await readStoredPlannerRunStarterPack({ fixture, plannerRunId });

    expect(storedStarterPack.items.map((item) => [item.nodeKey, item.status, item.title])).toEqual([
      ["slack_mcp_missing", "needs_config", "Repair MCP setup after import"],
      ["starter_agent_name", "approved", "Rename imported Agent draft"],
    ]);
  });

  test("updates approval status without emitting a Draft Patch when trace lacks the exact node", async () => {
    const fixture = await createAgentBuilderApiFixture();
    const { plannerRunId, viewer } = await createStarterPackTurn(fixture, {
      patchNodeKey: "patch_agent_name_from_result",
    });

    const approvalMessages = await approveAgentBuilderStarterPack(fixture.bindings, viewer, {
      agentId: fixture.ids.agentId,
      mode: "batch",
      plannerRunId,
    });

    expect(approvalMessages[0]?.contentText.length ?? 0).toBeGreaterThan(0);
    expect(parseAgentBuilderPlannerOutputJson(approvalMessages[0]?.cardsJson ?? null)).toBeNull();

    const starterPack = parseAgentBuilderStarterPackResult(
      JSON.parse(approvalMessages[0]?.cardsJson ?? "null"),
    );

    expect(starterPack?.items.map((item) => [item.nodeKey, item.status])).toEqual([
      ["starter_agent_name", "approved"],
      ["slack_mcp_missing", "needs_config"],
    ]);
  });
});
