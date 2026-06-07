import { describe, expect, test } from "bun:test";

import type { AppendMessage } from "@assistant-ui/react";

import type { AgentBuilderMessage } from "../src/domains/agent-builder/api/agent-builder-client";
import {
  createAgentBuilderAssistantMessage,
  readAgentBuilderAppendMessageText,
} from "../src/routes/agent/components/agent-builder/agent-builder-assistant-runtime";

function message(overrides: Partial<AgentBuilderMessage>): AgentBuilderMessage {
  return {
    cardsJson: null,
    contentText: "Hello from Builder.",
    createdAt: "2026-06-07T09:00:00.000Z",
    createdByAccountId: null,
    id: "message_1",
    inputKind: null,
    plannerRunId: null,
    role: "assistant",
    seq: 1,
    threadId: "thread_1",
    ...overrides,
  };
}

describe("Agent Builder assistant-ui runtime adapter", () => {
  test("converts canonical Builder messages into assistant-ui message-like records", () => {
    const converted = createAgentBuilderAssistantMessage(
      message({
        inputKind: "user_message",
        role: "user",
      }),
    );

    expect(converted).toEqual({
      content: [{ text: "Hello from Builder.", type: "text" }],
      createdAt: new Date("2026-06-07T09:00:00.000Z"),
      id: "message_1",
      metadata: {
        custom: {
          agentBuilderMessageId: "message_1",
          inputKind: "user_message",
          plannerRunId: null,
          seq: 1,
          threadId: "thread_1",
        },
        isOptimistic: false,
      },
      role: "user",
    });
  });

  test("does not attach assistant-only status to user messages", () => {
    const converted = createAgentBuilderAssistantMessage(
      message({
        role: "user",
      }),
    );

    expect(converted.status).toBeUndefined();
  });

  test("marks streaming assistant placeholders as running optimistic messages", () => {
    const converted = createAgentBuilderAssistantMessage(
      message({
        contentText: "",
        id: "optimistic:cf-agent:1:assistant",
        role: "assistant",
        seq: 9_007_199_254_730_000,
      }),
    );

    expect(converted.role).toBe("assistant");
    expect(converted.status).toEqual({ type: "running" });
    expect(converted.metadata?.isOptimistic).toBe(true);
  });

  test("extracts text submitted through assistant-ui append messages", () => {
    const appendMessage = {
      attachments: [],
      content: [
        { text: "Create a docs agent", type: "text" },
        { data: { ignored: true }, name: "structured", type: "data" },
        { text: " with Mintlify", type: "text" },
      ],
      createdAt: new Date("2026-06-07T09:00:00.000Z"),
      metadata: {
        custom: {},
      },
      parentId: null,
      role: "user",
      runConfig: undefined,
      sourceId: null,
    } satisfies AppendMessage;

    expect(readAgentBuilderAppendMessageText(appendMessage)).toBe(
      "Create a docs agent with Mintlify",
    );
  });
});
