import { describe, expect, test } from "bun:test";

import {
  createAgentBuilderSystemAgentChatRequestBody,
  enqueueAgentBuilderSystemAgentChatResult,
  isAgentBuilderRecoveredSdkRenderError,
  isAgentBuilderStreamingMessage,
  isAgentBuilderSystemAgentChatResultPart,
  mapAgentBuilderChatMessagesToStreamingMessages,
} from "../src/domains/agent-builder/api/agent-builder-chat-transport";

describe("Agent Builder useAgentChat transport helpers", () => {
  test("builds the custom request body sent through useAgentChat", () => {
    expect(
      createAgentBuilderSystemAgentChatRequestBody({
        agentId: "agent_1",
        draftRevision: "draft_rev_1",
        draftYaml: "version: 1",
      }),
    ).toEqual({
      agentId: "agent_1",
      draftRevision: "draft_rev_1",
      draftYaml: "version: 1",
    });
  });

  test("recognizes canonical Builder result data parts", () => {
    const part = {
      data: {
        messages: [],
        state: {
          lastPlannerRunId: "planner_1",
        },
      },
      type: "data-builder-result",
    };

    expect(isAgentBuilderSystemAgentChatResultPart(part)).toBe(true);
    expect(isAgentBuilderSystemAgentChatResultPart({ data: {}, type: "data-builder-result" })).toBe(
      false,
    );
  });

  test("defers Builder result dispatch outside the useAgentChat onData callback", () => {
    const queuedCallbacks: (() => void)[] = [];
    const dispatchedResults: unknown[] = [];
    const result = {
      messages: [],
      state: {
        lastPlannerRunId: "planner_1",
      },
    };
    const handled = enqueueAgentBuilderSystemAgentChatResult({
      onResult: (nextResult) => dispatchedResults.push(nextResult),
      part: {
        data: result,
        type: "data-builder-result",
      },
      schedule: (callback) => queuedCallbacks.push(callback),
    });

    expect(handled).toBe(true);
    expect(dispatchedResults).toEqual([]);
    expect(queuedCallbacks).toHaveLength(1);

    queuedCallbacks[0]?.();

    expect(dispatchedResults).toEqual([result]);
  });

  test("maps useAgentChat UI messages into temporary Builder bubbles", () => {
    const messages = mapAgentBuilderChatMessagesToStreamingMessages({
      chatMessages: [
        {
          id: "chat_user",
          parts: [{ text: "创建客服 starter pack", type: "text" }],
          role: "user",
        },
        {
          id: "chat_assistant",
          parts: [
            { text: "正在分析", type: "text" },
            { text: "已有资产", type: "text" },
          ],
          role: "assistant",
        },
      ],
      threadId: "thread_1",
    });

    expect(
      messages.map((message) => ({
        contentText: message.contentText,
        inputKind: message.inputKind,
        role: message.role,
        threadId: message.threadId,
      })),
    ).toEqual([
      {
        contentText: "创建客服 starter pack",
        inputKind: "user_message",
        role: "user",
        threadId: "thread_1",
      },
      {
        contentText: "正在分析已有资产",
        inputKind: null,
        role: "assistant",
        threadId: "thread_1",
      },
    ]);
    expect(messages.every((message) => isAgentBuilderStreamingMessage(message))).toBe(true);
    expect(new Set(messages.map((message) => message.id)).size).toBe(messages.length);
  });

  test("keeps a submitted Builder turn visible before the SDK echoes chat messages", () => {
    const messages = mapAgentBuilderChatMessagesToStreamingMessages({
      chatMessages: [],
      pendingTurn: {
        inputText: "如果没有 linear MCP，你帮我创建一个并绑定。",
        threadId: "thread_1",
        turnId: "1",
      },
      threadId: "thread_1",
    });

    expect(
      messages.map((message) => ({
        contentText: message.contentText,
        role: message.role,
      })),
    ).toEqual([
      {
        contentText: "如果没有 linear MCP，你帮我创建一个并绑定。",
        role: "user",
      },
      {
        contentText: "",
        role: "assistant",
      },
    ]);
    expect(messages.every((message) => isAgentBuilderStreamingMessage(message))).toBe(true);
  });

  test("dedupes the pending user echo once useAgentChat owns the message stream", () => {
    const messages = mapAgentBuilderChatMessagesToStreamingMessages({
      chatMessages: [
        {
          id: "chat_user",
          parts: [{ text: "绑定 linear MCP", type: "text" }],
          role: "user",
        },
      ],
      pendingTurn: {
        inputText: "绑定 linear MCP",
        threadId: "thread_1",
        turnId: "1",
      },
      threadId: "thread_1",
    });

    expect(
      messages.map((message) => ({
        contentText: message.contentText,
        role: message.role,
      })),
    ).toEqual([
      {
        contentText: "绑定 linear MCP",
        role: "user",
      },
      {
        contentText: "",
        role: "assistant",
      },
    ]);
    expect(messages.every((message) => isAgentBuilderStreamingMessage(message))).toBe(true);
  });

  test("only maps the active SDK turn when previous chat messages are already canonical", () => {
    const messages = mapAgentBuilderChatMessagesToStreamingMessages({
      chatMessages: [
        {
          id: "old_chat_user",
          parts: [{ text: "上一轮", type: "text" }],
          role: "user",
        },
        {
          id: "old_chat_assistant",
          parts: [{ text: "上一轮回复", type: "text" }],
          role: "assistant",
        },
        {
          id: "new_chat_user",
          parts: [{ text: "这一轮", type: "text" }],
          role: "user",
        },
      ],
      pendingTurn: {
        chatMessageStartIndex: 2,
        inputText: "这一轮",
        threadId: "thread_1",
        turnId: "2",
      },
      threadId: "thread_1",
    });

    expect(
      messages.map((message) => ({
        contentText: message.contentText,
        role: message.role,
      })),
    ).toEqual([
      {
        contentText: "这一轮",
        role: "user",
      },
      {
        contentText: "",
        role: "assistant",
      },
    ]);
  });

  test("marks CF SDK chat bubbles as streaming Builder messages", () => {
    const [userMessage, assistantMessage] = mapAgentBuilderChatMessagesToStreamingMessages({
      chatMessages: [
        {
          id: "chat_user",
          parts: [{ text: "创建 MCP", type: "text" }],
          role: "user",
        },
        {
          id: "chat_assistant",
          parts: [{ text: "正在处理", type: "text" }],
          role: "assistant",
        },
      ],
      threadId: "thread_1",
    });

    expect(userMessage === undefined ? false : isAgentBuilderStreamingMessage(userMessage)).toBe(
      true,
    );
    expect(
      assistantMessage === undefined ? false : isAgentBuilderStreamingMessage(assistantMessage),
    ).toBe(true);
  });

  test("recognizes recovered SDK render-depth errors without hiding transport errors", () => {
    expect(isAgentBuilderRecoveredSdkRenderError(new Error("Maximum update depth exceeded."))).toBe(
      true,
    );
    expect(isAgentBuilderRecoveredSdkRenderError(new Error("WebSocket closed"))).toBe(false);
    expect(isAgentBuilderRecoveredSdkRenderError(undefined)).toBe(false);
  });
});
