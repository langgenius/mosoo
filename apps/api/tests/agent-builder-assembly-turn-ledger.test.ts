import { describe, expect, test } from "bun:test";

import type { AgentBuilderStarterPackResult } from "@mosoo/contracts/agent-builder";

import { createAgentBuilderToolRuntime } from "../src/modules/agent-builder/application/agent-builder-tool-runtime.service";
import { appendAgentBuilderAssemblyTurn } from "../src/modules/agent-builder/application/builder-conversation-turn.service";
import { createDeterministicBuilderWorkflowExecutor } from "../src/modules/agent-builder/application/builder-workflow-executor.service";
import { createAgentBuilderApiFixture } from "./helpers/agent-builder-api-fixture";
import type { AgentBuilderApiFixture } from "./helpers/agent-builder-api-fixture";

const DRAFT_YAML = [
  "version: 1",
  "kind: pet",
  "identity:",
  "  name: Agent Builder Fixture",
  "  description: Draft fixture for Agent Builder API tests.",
  "runtime:",
  "  id: openai-runtime",
  "  provider: openai",
  "  model: gpt-5.4",
  "prompt: Help the user assemble an Agent starter pack.",
  "environment:",
  "  environmentId: null",
  "assets:",
  "  skills: []",
  "  mcpServers: []",
  "  spaces: []",
].join("\n");

interface PlannerRunRow {
  context_json: string;
  error_code: string | null;
  error_message: string | null;
  model: string;
  output_json: string | null;
  provider: string;
  status: string;
  tool_trace_json: string | null;
}

function createStarterPackResult(): AgentBuilderStarterPackResult {
  return {
    assistantText: "我准备了一套可确认的 Agent Starter Pack。",
    intentSummary: "Assemble a starter pack from existing assets.",
    items: [
      {
        action: {
          patchNodeKey: "patch_agent_name",
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
    ],
    mode: "starter_pack",
    plannerRunId: "workflow-run-id",
    version: 1,
  };
}

function createEmptyToolRuntime() {
  return createAgentBuilderToolRuntime({
    now: () => "2026-05-25T00:00:00.000Z",
    tools: [],
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

async function listPlannerRuns(fixture: AgentBuilderApiFixture): Promise<PlannerRunRow[]> {
  const result = await fixture.database
    .prepare(
      `SELECT
        context_json,
        error_code,
        error_message,
        model,
        output_json,
        provider,
        status,
        tool_trace_json
      FROM agent_builder_planner_run
      ORDER BY id ASC`,
    )
    .all<PlannerRunRow>();

  return result.results;
}

describe("Agent Builder Assembly turn ledger bridge", () => {
  test("persists a Starter Pack workflow result as existing Builder messages and planner trace", async () => {
    const fixture = await createAgentBuilderApiFixture();
    const viewer = await login(fixture);
    const executor = createDeterministicBuilderWorkflowExecutor(() => createStarterPackResult());

    const messages = await appendAgentBuilderAssemblyTurn(fixture.bindings, viewer, {
      agentId: fixture.ids.agentId,
      code: "return starterPack",
      draftRevision: "draft-rev-1",
      draftYaml: DRAFT_YAML,
      executor,
      inputText: "我想做一个客服工单 Agent",
      timeoutMs: 1_000,
      tools: createEmptyToolRuntime(),
    });

    expect(messages).toHaveLength(2);
    expect(messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(messages[0]).toMatchObject({
      contentText: "我想做一个客服工单 Agent",
      inputKind: "user_message",
      seq: 1,
    });
    expect(messages[1]).toMatchObject({
      contentText: "我准备了一套可确认的 Agent Starter Pack。",
      seq: 2,
    });

    const cardsJson = messages[1]?.cardsJson;

    if (cardsJson === null || cardsJson === undefined) {
      throw new Error("Expected assistant Starter Pack cards JSON.");
    }

    const cards = JSON.parse(cardsJson) as AgentBuilderStarterPackResult;

    expect(cards).toMatchObject({
      mode: "starter_pack",
      plannerRunId: messages[1]?.plannerRunId,
    });
    expect(cards.items.map((item) => item.nodeKey)).toEqual(["starter_agent_name"]);

    const plannerRuns = await listPlannerRuns(fixture);

    expect(plannerRuns).toHaveLength(1);
    expect(plannerRuns[0]).toMatchObject({
      error_code: null,
      error_message: null,
      model: "assembly-workflow",
      output_json: cardsJson,
      provider: "agent-builder-v3",
      status: "completed",
      tool_trace_json: null,
    });
    const contextJson = JSON.parse(plannerRuns[0]?.context_json ?? "{}") as {
      workflowExecution?: {
        durationMs?: number;
        fallback?: string;
        path?: string;
        status?: string;
      };
    };

    expect(contextJson.workflowExecution).toMatchObject({
      fallback: "none",
      path: "builder_assembly",
      status: "completed",
    });
    expect(typeof contextJson.workflowExecution?.durationMs).toBe("number");
  });

  test("persists a failed workflow as an assistant turn for traceability", async () => {
    const fixture = await createAgentBuilderApiFixture();
    const viewer = await login(fixture);
    const executor = createDeterministicBuilderWorkflowExecutor(() => {
      throw new Error("Workflow planner unavailable.");
    });

    const messages = await appendAgentBuilderAssemblyTurn(fixture.bindings, viewer, {
      agentId: fixture.ids.agentId,
      code: "throw new Error",
      draftRevision: "draft-rev-1",
      draftYaml: DRAFT_YAML,
      executor,
      inputText: "请根据现有资产规划客服工单流程",
      timeoutMs: 1_000,
      tools: createEmptyToolRuntime(),
    });

    expect(messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(messages[1]?.contentText?.length ?? 0).toBeGreaterThan(0);

    const plannerRuns = await listPlannerRuns(fixture);

    expect(plannerRuns).toHaveLength(1);
    expect(plannerRuns[0]).toMatchObject({
      error_code: "assembly_workflow_failed",
      error_message: expect.any(String),
      provider: "agent-builder-v3",
      status: "failed",
      tool_trace_json: "[]",
    });
    expect(plannerRuns[0]?.output_json).toContain("failed_assembly_workflow");

    const contextJson = JSON.parse(plannerRuns[0]?.context_json ?? "{}") as {
      workflowExecution?: {
        errorMessage?: string;
        path?: string;
        status?: string;
      };
    };

    expect(contextJson.workflowExecution).toMatchObject({
      errorMessage: expect.any(String),
      path: "builder_assembly",
      status: "failed",
    });
  });
});
