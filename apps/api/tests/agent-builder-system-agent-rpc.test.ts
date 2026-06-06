import { describe, expect, test } from "bun:test";

import { parseAgentBuilderStarterPackResult } from "@mosoo/contracts/agent-builder";
import type { AgentBuilderStarterPackResult } from "@mosoo/contracts/agent-builder";

import {
  parseAccountId,
  parseAgentBuilderMessageId,
  parseAgentBuilderPlannerRunId,
  parseAgentBuilderThreadId,
  parseAgentId,
} from "../src/modules/agent-builder/application/agent-builder-ids";
import {
  parseAgentBuilderSystemAgentChatBody,
  readLatestUserTextFromChatMessages,
} from "../src/modules/agent-builder/application/agent-builder-system-agent-chat-request.service";
import { createAgentBuilderSystemAgentChatResponse } from "../src/modules/agent-builder/application/agent-builder-system-agent-chat.service";
import {
  approveAgentBuilderSystemAgentStarterPack,
  submitAgentBuilderSystemAgentMessage,
} from "../src/modules/agent-builder/application/agent-builder-system-agent-rpc.service";
import type { AgentBuilderSystemAgentRpcResult } from "../src/modules/agent-builder/application/agent-builder-system-agent-rpc.service";
import { ensureAgentBuilderThread } from "../src/modules/agent-builder/application/agent-builder-thread.service";
import { createAgentBuilderToolRuntime } from "../src/modules/agent-builder/application/agent-builder-tool-runtime.service";
import { createDeterministicBuilderWorkflowExecutor } from "../src/modules/agent-builder/application/builder-workflow-executor.service";
import { createAgentBuilderApiFixture } from "./helpers/agent-builder-api-fixture";
import type { AgentBuilderApiFixture } from "./helpers/agent-builder-api-fixture";

const CHAT_AGENT_ID = parseAgentId("01J000000000000000000000F1");
const CHAT_THREAD_ID = parseAgentBuilderThreadId("01J000000000000000000000F2");
const CHAT_USER_MESSAGE_ID = parseAgentBuilderMessageId("01J000000000000000000000F3");
const CHAT_ASSISTANT_MESSAGE_ID = parseAgentBuilderMessageId("01J000000000000000000000F4");
const CHAT_ACCOUNT_ID = parseAccountId("01J000000000000000000000F5");
const CHAT_PLANNER_RUN_ID = parseAgentBuilderPlannerRunId("01J000000000000000000000F6");
const WORKFLOW_RUN_ID = parseAgentBuilderPlannerRunId("01J000000000000000000000F7");

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
    plannerRunId: WORKFLOW_RUN_ID,
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

async function ensureThread(fixture: AgentBuilderApiFixture) {
  return ensureAgentBuilderThread(fixture.bindings.DB, fixture.viewer, fixture.ids.agentId);
}

function parseChatStreamParts(responseText: string): Record<string, unknown>[] {
  return responseText
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      return trimmed.startsWith("data:") ? trimmed.slice("data:".length).trim() : trimmed;
    })
    .filter((line) => line.startsWith("{"))
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as Record<string, unknown>];
      } catch {
        return [];
      }
    });
}

function readBuilderResultFromStream(responseText: string): AgentBuilderSystemAgentRpcResult {
  const part = parseChatStreamParts(responseText).find(
    (item) => item.type === "data-builder-result",
  );

  if (!part || typeof part.data !== "object" || part.data === null) {
    throw new Error("Expected Agent Builder result data part.");
  }

  return part.data as AgentBuilderSystemAgentRpcResult;
}

function readTextFromStream(responseText: string): string {
  return parseChatStreamParts(responseText)
    .filter((part) => part.type === "text-delta" && typeof part.delta === "string")
    .map((part) => part.delta)
    .join("");
}

describe("Agent Builder System Agent RPC bridge", () => {
  test("parses useAgentChat request body and latest user text", () => {
    expect(
      parseAgentBuilderSystemAgentChatBody({
        agentId: CHAT_AGENT_ID,
        draftRevision: "draft_rev_1",
        draftYaml: "version: 1",
        threadId: CHAT_THREAD_ID,
      }),
    ).toEqual({
      agentId: CHAT_AGENT_ID,
      draftRevision: "draft_rev_1",
      draftYaml: "version: 1",
      threadId: CHAT_THREAD_ID,
    });

    expect(
      readLatestUserTextFromChatMessages([
        {
          id: "msg_1",
          parts: [{ text: "old", type: "text" }],
          role: "user",
        },
        {
          id: "msg_2",
          parts: [{ text: "new request", type: "text" }],
          role: "user",
        },
      ]),
    ).toBe("new request");

    expect(() => parseAgentBuilderSystemAgentChatBody({ agentId: "" })).toThrow();
  });

  test("streams assistant text and canonical Builder result as useAgentChat data", async () => {
    const result: AgentBuilderSystemAgentRpcResult = {
      messages: [
        {
          cardsJson: null,
          contentText: "帮我做一个客服 Agent",
          createdAt: "2026-05-25T00:00:00.000Z",
          createdByAccountId: CHAT_ACCOUNT_ID,
          id: CHAT_USER_MESSAGE_ID,
          inputKind: "user_message",
          plannerRunId: null,
          role: "user",
          seq: 1,
          threadId: CHAT_THREAD_ID,
        },
        {
          cardsJson: JSON.stringify(createStarterPackResult()),
          contentText: "我准备了一套可确认的 Agent Starter Pack。",
          createdAt: "2026-05-25T00:00:01.000Z",
          createdByAccountId: CHAT_ACCOUNT_ID,
          id: CHAT_ASSISTANT_MESSAGE_ID,
          inputKind: null,
          plannerRunId: CHAT_PLANNER_RUN_ID,
          role: "assistant",
          seq: 2,
          threadId: CHAT_THREAD_ID,
        },
      ],
      state: {
        draftId: CHAT_AGENT_ID,
        lastPlannerRunId: CHAT_PLANNER_RUN_ID,
        openApprovalCount: 1,
      },
      terminal: {
        failureKind: null,
        message: null,
        status: "completed",
      },
    };
    const responseText = await createAgentBuilderSystemAgentChatResponse(result).text();
    const streamedResult = readBuilderResultFromStream(responseText);

    expect(readTextFromStream(responseText).length).toBeGreaterThan(0);
    expect(streamedResult.state.openApprovalCount).toBe(1);
    expect(streamedResult.terminal.status).toBe("completed");
  });

  test("streams model failures as a canonical terminal Builder result", async () => {
    const responseText = await createAgentBuilderSystemAgentChatResponse({
      run: async () => {
        throw new Error("model request failed");
      },
    }).text();
    const streamedResult = readBuilderResultFromStream(responseText);

    expect(streamedResult.terminal.failureKind).toBe("model_failure");
    expect(streamedResult.terminal.status).toBe("failed");
  });

  test("streams transport close as a canonical terminal Builder result", async () => {
    const controller = new AbortController();
    const responseText = await createAgentBuilderSystemAgentChatResponse({
      run: async () => {
        controller.abort();
        throw new Error("transport closed");
      },
      signal: controller.signal,
    }).text();
    const streamedResult = readBuilderResultFromStream(responseText);

    expect(streamedResult.terminal.failureKind).toBe("transport_close");
    expect(streamedResult.terminal.status).toBe("failed");
  });

  test("submits an Assembly user message through the existing Builder ledger service", async () => {
    const fixture = await createAgentBuilderApiFixture();
    const viewer = await login(fixture);
    const thread = await ensureThread(fixture);
    const result = await submitAgentBuilderSystemAgentMessage(fixture.bindings, viewer, {
      agentId: fixture.ids.agentId,
      draftRevision: "draft-rev-1",
      draftYaml: DRAFT_YAML,
      inputText: "请根据现有资产规划客服工单流程",
      runtime: {
        code: "return starterPack",
        executor: createDeterministicBuilderWorkflowExecutor(() => createStarterPackResult()),
        timeoutMs: 1_000,
        tools: createEmptyToolRuntime(),
      },
      threadId: thread.id,
    });

    expect(result.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(result.messages[1]?.contentText).toBe(createStarterPackResult().assistantText);
    expect(result.state).toEqual({
      draftId: fixture.ids.agentId,
      lastPlannerRunId: result.messages[1]?.plannerRunId,
      openApprovalCount: 1,
    });
    expect(result.terminal).toEqual({
      failureKind: null,
      message: null,
      status: "completed",
    });
  });

  test("blocks plaintext secret input before workflow code generation", async () => {
    const fixture = await createAgentBuilderApiFixture();
    const viewer = await login(fixture);
    const thread = await ensureThread(fixture);
    let generatedCode = false;
    let executedWorkflow = false;
    const result = await submitAgentBuilderSystemAgentMessage(fixture.bindings, viewer, {
      agentId: fixture.ids.agentId,
      draftRevision: "draft-rev-1",
      draftYaml: DRAFT_YAML,
      inputText: "LINEAR_API_KEY=sk-live-secret",
      runtime: {
        code: () => {
          generatedCode = true;
          return "async () => ({ mode: 'starter_pack' })";
        },
        executor: createDeterministicBuilderWorkflowExecutor(() => {
          executedWorkflow = true;
          return createStarterPackResult();
        }),
        timeoutMs: 1_000,
        tools: createEmptyToolRuntime(),
      },
      threadId: thread.id,
    });
    const assistantMessage = result.messages[1];

    expect(generatedCode).toBe(false);
    expect(executedWorkflow).toBe(false);
    expect(result.state.openApprovalCount).toBe(0);
    expect(assistantMessage?.contentText?.length ?? 0).toBeGreaterThan(0);
    expect(assistantMessage?.contentText).not.toContain("sk-live-secret");

    const starterPack = parseAgentBuilderStarterPackResult(
      JSON.parse(assistantMessage?.cardsJson ?? "null"),
    );

    expect(starterPack?.items[0]).toMatchObject({
      action: { type: "none" },
      approvalMode: "blocked",
      nodeKey: "blocked_plaintext_secret_input",
      status: "blocked",
    });

    const plannerRunId = assistantMessage?.plannerRunId;

    if (plannerRunId === null || plannerRunId === undefined) {
      throw new Error("Expected blocked secret input planner run id.");
    }

    const row = await fixture.bindings.DB.prepare(
      "SELECT output_json, tool_trace_json FROM agent_builder_planner_run WHERE id = ?",
    )
      .bind(plannerRunId)
      .first<{ output_json: string; tool_trace_json: string | null }>();

    expect(row?.tool_trace_json).toBeNull();
    expect(row?.output_json).not.toContain("sk-live-secret");
  });

  test("returns model failure terminal status when workflow code generation fails", async () => {
    const fixture = await createAgentBuilderApiFixture();
    const viewer = await login(fixture);
    const thread = await ensureThread(fixture);
    const result = await submitAgentBuilderSystemAgentMessage(fixture.bindings, viewer, {
      agentId: fixture.ids.agentId,
      draftRevision: "draft-rev-1",
      draftYaml: DRAFT_YAML,
      inputText: "请规划客服工单流程",
      runtime: {
        code: () => {
          throw new Error("model request failed");
        },
        executor: createDeterministicBuilderWorkflowExecutor(() => createStarterPackResult()),
        timeoutMs: 1_000,
        tools: createEmptyToolRuntime(),
      },
      threadId: thread.id,
    });

    expect(result.terminal).toMatchObject({
      failureKind: "model_failure",
      status: "failed",
    });
    expect(result.terminal.message?.length ?? 0).toBeGreaterThan(0);
  });

  test("returns tool failure terminal status when workflow tool execution fails", async () => {
    const fixture = await createAgentBuilderApiFixture();
    const viewer = await login(fixture);
    const thread = await ensureThread(fixture);
    const result = await submitAgentBuilderSystemAgentMessage(fixture.bindings, viewer, {
      agentId: fixture.ids.agentId,
      draftRevision: "draft-rev-1",
      draftYaml: DRAFT_YAML,
      inputText: "请规划客服工单流程",
      runtime: {
        code: "return starterPack",
        executor: createDeterministicBuilderWorkflowExecutor(async (context) => {
          await context.callTool({
            input: {},
            toolId: "prepare_draft_patch",
          });
          return createStarterPackResult();
        }),
        timeoutMs: 1_000,
        tools: createEmptyToolRuntime(),
      },
      threadId: thread.id,
    });

    expect(result.terminal).toMatchObject({
      failureKind: "tool_failure",
      status: "failed",
    });
    expect(result.terminal.message).toContain("prepare_draft_patch");
  });

  test("approves a Starter Pack action through the existing approval service and refreshes open approvals", async () => {
    const fixture = await createAgentBuilderApiFixture();
    const viewer = await login(fixture);
    const thread = await ensureThread(fixture);
    const messageResult = await submitAgentBuilderSystemAgentMessage(fixture.bindings, viewer, {
      agentId: fixture.ids.agentId,
      draftRevision: "draft-rev-1",
      draftYaml: DRAFT_YAML,
      inputText: "我想做一个客服工单 Agent",
      runtime: {
        code: "return starterPack",
        executor: createDeterministicBuilderWorkflowExecutor(() => createStarterPackResult()),
        timeoutMs: 1_000,
        tools: createEmptyToolRuntime(),
      },
      threadId: thread.id,
    });
    const plannerRunId = messageResult.state.lastPlannerRunId;

    if (plannerRunId === null) {
      throw new Error("Expected Starter Pack planner run id.");
    }

    const approvalResult = await approveAgentBuilderSystemAgentStarterPack(
      fixture.bindings,
      viewer,
      {
        agentId: fixture.ids.agentId,
        mode: "batch",
        plannerRunId,
      },
    );

    expect(approvalResult.messages).toHaveLength(1);
    expect(approvalResult.messages[0]?.role).toBe("assistant");
    expect(approvalResult.messages[0]?.contentText?.length ?? 0).toBeGreaterThan(0);
    expect(approvalResult.state).toEqual({
      draftId: fixture.ids.agentId,
      lastPlannerRunId: plannerRunId,
      openApprovalCount: 0,
    });
    expect(approvalResult.terminal).toEqual({
      failureKind: null,
      message: null,
      status: "completed",
    });
  });
});
