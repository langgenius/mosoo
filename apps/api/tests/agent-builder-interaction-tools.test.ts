import { describe, expect, test } from "bun:test";

import type { AgentBuilderPlannerContext } from "@mosoo/contracts/agent-builder";

import { createAgentBuilderToolRuntime } from "../src/modules/agent-builder/application/agent-builder-tool-runtime.service";
import {
  createAskUserTool,
  createReturnBlockedTool,
} from "../src/modules/agent-builder/application/tools/interaction-tools.tool";

function plannerContext(): AgentBuilderPlannerContext {
  return {
    agent: {
      agentId: "agent_1",
      kind: "pet",
      organizationId: "org_1",
      status: "draft",
    },
    assets: {
      changesSinceLastTurn: {
        channels: { added: [], removed: [], updated: [] },
        environments: { added: [], removed: [], updated: [] },
        mcpServers: { added: [], removed: [], updated: [] },
        selectedSpaceFiles: { added: [], removed: [], updated: [] },
        skills: { added: [], removed: [], updated: [] },
        spaces: { added: [], removed: [], updated: [] },
      },
      currentIndex: {
        channels: [],
        environments: [],
        mcpServers: [],
        selectedSpaceFiles: [],
        skills: [],
        spaces: [],
      },
      draftBindings: {
        channelIds: [],
        environmentId: null,
        mcpServerIds: [],
        parseError: null,
        parseStatus: "parsed",
        skillIds: [],
        spaceIds: [],
      },
      observedAt: "2026-05-21T00:00:00.000Z",
      snapshotHash: "asset_hash",
    },
    boundaryPolicy: {
      allowedModes: ["plain_text", "draft_patch", "question", "blocked"],
      forbiddenWrites: [],
      requiresLlmPlanner: true,
    },
    conversation: { recentMessages: [] },
    draft: {
      revision: "draft_hash",
      yaml: [
        "version: 1",
        "kind: pet",
        "identity:",
        "  name: Test Agent",
        "  description: Test description.",
        "runtime:",
        "  id: openai-runtime",
        "  provider: openai",
        "  model: gpt-5.4",
        "prompt: Test prompt.",
        "environment:",
        "  environmentId: null",
        "assets:",
        "  skills: []",
        "  mcpServers: []",
        "  spaces: []",
      ].join("\n"),
    },
    historicalOpenNodes: [],
    plannerRunId: "planner_run_1",
    readiness: {
      checkedAt: "2026-05-21T00:00:00.000Z",
      errorCount: 0,
      issues: [],
      ready: true,
      warningCount: 0,
    },
    systemAgent: {
      credentialSource: "provider_database",
      model: {
        modelId: "gpt-5.4",
        provider: "openai",
      },
    },
    threadId: "thread_1",
    turn: {
      inputKind: "user_message",
      inputText: "create a Space",
      triggerMessageId: "message_1",
    },
    version: 1,
  };
}

function createRuntime(context = plannerContext()) {
  return createAgentBuilderToolRuntime({
    tools: [createAskUserTool({ context }), createReturnBlockedTool({ context })],
  });
}

describe("Agent Builder interaction tools", () => {
  test("ask_user prepares a structured Question Card with choices", async () => {
    const record = await createRuntime().execute({
      input: {
        allowFreeText: true,
        choices: [
          {
            actionKey: "use_support_kb",
            assetId: "space_support_kb",
            label: "使用 support-kb",
            targetType: "space",
            value: "use_existing:space_support_kb",
          },
          {
            actionKey: "create_new",
            label: "仍然新建",
            value: "create_new",
          },
        ],
        nodeKey: "choose_support_kb_space",
        question: "发现相似 Space，你想复用已有的还是新建？",
        reason: "similar_space_name",
        summary: "Choose whether to reuse a similar Space or create a new one.",
        targetType: "space",
      },
      toolId: "ask_user",
    });

    expect(record.status).toBe("completed");
    expect(record.output).toMatchObject({
      allowFreeText: true,
      choiceCount: 2,
      mode: "question",
      question: "发现相似 Space，你想复用已有的还是新建？",
      reason: "similar_space_name",
      status: "ready",
    });
    expect(record.output?.["nodes"]).toMatchObject([
      {
        actions: [
          {
            actionKey: "use_support_kb",
            label: "使用 support-kb",
            style: "secondary",
          },
          {
            actionKey: "create_new",
            label: "仍然新建",
            style: "secondary",
          },
        ],
        kind: "question",
        operation: "ask",
        status: "pending",
        targetType: "space",
      },
    ]);
  });

  test("ask_user creates unique action keys for non-ASCII choices", async () => {
    const record = await createRuntime().execute({
      input: {
        choices: [
          {
            label: "使用现有",
            value: "使用现有",
          },
          {
            label: "新建",
            value: "新建",
          },
        ],
        question: "选择处理方式",
        targetType: " draft ",
      },
      toolId: "ask_user",
    });

    expect(record.status).toBe("completed");
    expect(record.output?.["choices"]).toMatchObject([
      {
        actionKey: "choice_1",
        value: "使用现有",
      },
      {
        actionKey: "choice_2",
        value: "新建",
      },
    ]);
  });

  test("return_blocked prepares a structured Blocked Card with reason code", async () => {
    const record = await createRuntime().execute({
      input: {
        message: "我不能读取 provider key 明文或发布这个 Agent。",
        nextSteps: ["到 Providers 页面管理 key", "发布请使用 Agent 发布入口"],
        nodeKey: "blocked_provider_key_publish",
        reasonCode: "forbidden_provider_key_publish",
        summary: "Provider key reads and publishing are outside Builder boundary.",
        targetType: "draft",
      },
      toolId: "return_blocked",
    });

    expect(record.status).toBe("completed");
    expect(record.output).toMatchObject({
      message: "我不能读取 provider key 明文或发布这个 Agent。",
      mode: "blocked",
      reasonCode: "forbidden_provider_key_publish",
      status: "ready",
    });
    expect(record.output?.["nodes"]).toMatchObject([
      {
        actions: [],
        kind: "blocked",
        nodeKey: "blocked_provider_key_publish",
        operation: "blocked",
        status: "blocked",
        targetType: "draft",
      },
    ]);
  });
});
