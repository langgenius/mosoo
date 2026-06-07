import type { AppendMessage, AssistantRuntime, ThreadMessageLike } from "@assistant-ui/react";
import { useExternalStoreRuntime } from "@assistant-ui/react";

import { isAgentBuilderStreamingMessage } from "@/domains/agent-builder/api/agent-builder-chat-transport";
import type { AgentBuilderMessage } from "@/domains/agent-builder/api/agent-builder-client";

interface AgentBuilderAssistantRuntimeInput {
  readonly isBusy: boolean;
  readonly isSendDisabled: boolean;
  readonly messages: readonly AgentBuilderMessage[];
  readonly onSubmit: (inputText: string) => Promise<void> | void;
}

export function useAgentBuilderAssistantRuntime(
  input: AgentBuilderAssistantRuntimeInput,
): AssistantRuntime {
  return useExternalStoreRuntime<AgentBuilderMessage>({
    convertMessage: createAgentBuilderAssistantMessage,
    isRunning: input.isBusy,
    isSendDisabled: input.isSendDisabled,
    messages: input.messages,
    onNew: async (message) => {
      const inputText = readAgentBuilderAppendMessageText(message).trim();

      if (inputText.length === 0) {
        return;
      }

      await input.onSubmit(inputText);
    },
  });
}

export function createAgentBuilderAssistantMessage(
  message: AgentBuilderMessage,
): ThreadMessageLike {
  const role = message.role === "user" ? "user" : "assistant";
  const isStreaming = isAgentBuilderStreamingMessage(message);
  const assistantStatus =
    role === "assistant"
      ? isStreaming
        ? { type: "running" as const }
        : { reason: "stop" as const, type: "complete" as const }
      : undefined;

  return {
    content: [{ text: message.contentText, type: "text" }],
    createdAt: parseAgentBuilderMessageDate(message.createdAt),
    id: message.id,
    metadata: {
      custom: {
        agentBuilderMessageId: message.id,
        inputKind: message.inputKind,
        plannerRunId: message.plannerRunId,
        seq: message.seq,
        threadId: message.threadId,
      },
      isOptimistic: isStreaming,
    },
    role,
    ...(assistantStatus === undefined ? {} : { status: assistantStatus }),
  };
}

export function readAgentBuilderAppendMessageText(message: AppendMessage): string {
  return message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
}

function parseAgentBuilderMessageDate(value: string): Date {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return new Date(0);
  }

  return date;
}
