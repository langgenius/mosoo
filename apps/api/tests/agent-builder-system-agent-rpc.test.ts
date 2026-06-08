import { describe, expect, test } from "bun:test";

import {
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
import type { AgentBuilderSystemAgentRpcResult } from "../src/modules/agent-builder/application/agent-builder-system-agent-rpc.service";

const CHAT_AGENT_ID = parseAgentId("01J000000000000000000000F1");
const CHAT_THREAD_ID = parseAgentBuilderThreadId("01J000000000000000000000F2");
const CHAT_USER_MESSAGE_ID = parseAgentBuilderMessageId("01J000000000000000000000F3");
const CHAT_ASSISTANT_MESSAGE_ID = parseAgentBuilderMessageId("01J000000000000000000000F4");
const CHAT_PLANNER_RUN_ID = parseAgentBuilderPlannerRunId("01J000000000000000000000F6");

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
          createdByAccountId: null,
          id: CHAT_USER_MESSAGE_ID,
          inputKind: "user_message",
          plannerRunId: null,
          role: "user",
          seq: 1,
          threadId: CHAT_THREAD_ID,
        },
        {
          cardsJson: JSON.stringify({
            assistantText: "基础 Agent 已经完整；下一步选择 Environment。",
            intentSummary: "Guide Step 2.",
            mode: "plain_text",
            nodes: [],
            plannerRunId: CHAT_PLANNER_RUN_ID,
            version: 1,
          }),
          contentText: "基础 Agent 已经完整；下一步选择 Environment。",
          createdAt: "2026-05-25T00:00:01.000Z",
          createdByAccountId: null,
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
    expect(streamedResult.state).toEqual({
      draftId: CHAT_AGENT_ID,
      lastPlannerRunId: CHAT_PLANNER_RUN_ID,
    });
    expect(streamedResult.terminal.status).toBe("completed");
  });

  test("keeps internal progress events out of the visible chat text", async () => {
    const result: AgentBuilderSystemAgentRpcResult = {
      messages: [
        {
          cardsJson: null,
          contentText: "Ready for preview.",
          createdAt: "2026-05-25T00:00:01.000Z",
          createdByAccountId: null,
          id: CHAT_ASSISTANT_MESSAGE_ID,
          inputKind: null,
          plannerRunId: CHAT_PLANNER_RUN_ID,
          role: "assistant",
          seq: 1,
          threadId: CHAT_THREAD_ID,
        },
      ],
      state: {
        draftId: CHAT_AGENT_ID,
        lastPlannerRunId: CHAT_PLANNER_RUN_ID,
      },
      terminal: {
        failureKind: null,
        message: null,
        status: "completed",
      },
    };
    const responseText = await createAgentBuilderSystemAgentChatResponse({
      run: (progress) => {
        progress({
          message: "正在调用 System Agent 模型规划 Builder 输出",
          stage: "planner:llm",
        });
        return result;
      },
    }).text();

    expect(readTextFromStream(responseText)).toBe("Ready for preview.");
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
});
