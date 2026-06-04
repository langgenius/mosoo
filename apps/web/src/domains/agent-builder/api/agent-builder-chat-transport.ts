import type { AgentBuilderPlannerRunId, AgentBuilderThreadId, AgentId } from "@mosoo/contracts/id";
import type { UIMessage } from "ai";

import type { AgentBuilderMessage } from "./agent-builder-client";

export interface AgentBuilderSystemAgentChatResult {
  readonly messages: readonly AgentBuilderMessage[];
  readonly state?: {
    readonly draftId?: string | null;
    readonly lastPlannerRunId?: AgentBuilderPlannerRunId | null;
    readonly openApprovalCount?: number | null;
  };
  readonly terminal?: {
    readonly failureKind?: "model_failure" | "tool_failure" | "transport_close" | null;
    readonly message?: string | null;
    readonly status: "completed" | "failed";
  };
}

export type AgentBuilderSystemAgentChatDataParts = {
  "builder-result": AgentBuilderSystemAgentChatResult;
};

export type AgentBuilderSystemAgentChatMessage = UIMessage<
  unknown,
  AgentBuilderSystemAgentChatDataParts
>;

export interface AgentBuilderPendingChatTurn {
  readonly chatMessageStartIndex?: number;
  readonly inputText: string;
  readonly threadId: AgentBuilderThreadId;
  readonly turnId: string;
}

const STREAMING_MESSAGE_SEQ_BASE = Number.MAX_SAFE_INTEGER - 10_000;

export function createAgentBuilderSystemAgentChatRequestBody(input: {
  agentId: AgentId;
  draftRevision: string;
  draftYaml: string;
  threadId: AgentBuilderThreadId;
}): Record<string, unknown> {
  return {
    agentId: input.agentId,
    draftRevision: input.draftRevision,
    draftYaml: input.draftYaml,
    threadId: input.threadId,
  };
}

export function isAgentBuilderSystemAgentChatResultPart(part: {
  readonly data?: unknown;
  readonly type: string;
}): part is {
  readonly data: AgentBuilderSystemAgentChatResult;
  readonly type: "data-builder-result";
} {
  return (
    part.type === "data-builder-result" &&
    part.data !== null &&
    typeof part.data === "object" &&
    "messages" in part.data &&
    Array.isArray(part.data.messages)
  );
}

export function createAgentBuilderSystemAgentChatResultKey(
  result: AgentBuilderSystemAgentChatResult,
): string {
  const plannerRunId = result.state?.lastPlannerRunId ?? null;

  if (plannerRunId !== null && plannerRunId.length > 0) {
    return `planner:${plannerRunId}`;
  }

  return `messages:${result.messages.map((message) => message.id).join(":")}`;
}

export function enqueueAgentBuilderSystemAgentChatResult(input: {
  readonly onResult: (result: AgentBuilderSystemAgentChatResult) => void;
  readonly part: {
    readonly data?: unknown;
    readonly type: string;
  };
  readonly schedule?: (callback: () => void) => void;
}): boolean {
  if (!isAgentBuilderSystemAgentChatResultPart(input.part)) {
    return false;
  }

  const result = input.part.data;
  const schedule = input.schedule ?? scheduleAgentBuilderChatResult;

  schedule(() => input.onResult(result));

  return true;
}

function scheduleAgentBuilderChatResult(callback: () => void): void {
  globalThis.setTimeout(callback, 0);
}

function readChatMessageText(message: AgentBuilderSystemAgentChatMessage): string {
  return message.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
}

function isRenderableChatMessage(
  message: AgentBuilderSystemAgentChatMessage,
): message is AgentBuilderSystemAgentChatMessage & { readonly role: "assistant" | "user" } {
  return message.role === "user" || message.role === "assistant";
}

function createStreamingBuilderMessage(input: {
  contentText: string;
  id: string;
  role: "assistant" | "user";
  seq: number;
  threadId: AgentBuilderThreadId;
}): AgentBuilderMessage {
  return {
    cardsJson: null,
    contentText: input.contentText,
    createdAt: new Date(0).toISOString(),
    createdByAccountId: null,
    id: input.id,
    inputKind: input.role === "user" ? "user_message" : null,
    plannerRunId: null,
    role: input.role,
    seq: input.seq,
    threadId: input.threadId,
  };
}

function createPendingTurnMessages(input: {
  includeAssistantPlaceholder: boolean;
  includeUserMessage: boolean;
  pendingTurn: AgentBuilderPendingChatTurn;
}): AgentBuilderMessage[] {
  const messages: AgentBuilderMessage[] = [];

  if (input.includeUserMessage) {
    messages.push(
      createStreamingBuilderMessage({
        contentText: input.pendingTurn.inputText,
        id: `optimistic:cf-agent:${input.pendingTurn.turnId}:user`,
        role: "user",
        seq: STREAMING_MESSAGE_SEQ_BASE,
        threadId: input.pendingTurn.threadId,
      }),
    );
  }

  if (input.includeAssistantPlaceholder) {
    messages.push(
      createStreamingBuilderMessage({
        contentText: "",
        id: `optimistic:cf-agent:${input.pendingTurn.turnId}:assistant`,
        role: "assistant",
        seq: input.includeUserMessage
          ? STREAMING_MESSAGE_SEQ_BASE + 1
          : STREAMING_MESSAGE_SEQ_BASE + 200,
        threadId: input.pendingTurn.threadId,
      }),
    );
  }

  return messages;
}

function hasUserEcho(input: {
  messages: readonly AgentBuilderMessage[];
  pendingTurn: AgentBuilderPendingChatTurn;
}): boolean {
  const pendingText = input.pendingTurn.inputText.trim();

  return input.messages.some(
    (message) => message.role === "user" && message.contentText.trim() === pendingText,
  );
}

function hasAssistantStream(messages: readonly AgentBuilderMessage[]): boolean {
  return messages.some((message) => message.role === "assistant");
}

function sortStreamingMessages(messages: readonly AgentBuilderMessage[]): AgentBuilderMessage[] {
  return [...messages].toSorted((left, right) => left.seq - right.seq);
}

export function mapAgentBuilderChatMessagesToStreamingMessages(input: {
  chatMessages: readonly AgentBuilderSystemAgentChatMessage[];
  pendingTurn?: AgentBuilderPendingChatTurn | null;
  threadId: AgentBuilderThreadId;
}): AgentBuilderMessage[] {
  const activeChatMessages =
    input.pendingTurn === null || input.pendingTurn === undefined
      ? input.chatMessages
      : input.chatMessages.slice(input.pendingTurn.chatMessageStartIndex ?? 0);
  const chatMessages: AgentBuilderMessage[] = [];

  for (const message of activeChatMessages) {
    if (!isRenderableChatMessage(message)) {
      continue;
    }

    chatMessages.push(
      createStreamingBuilderMessage({
        contentText: readChatMessageText(message),
        id: `streaming:${message.id}`,
        role: message.role,
        seq: STREAMING_MESSAGE_SEQ_BASE + 100 + chatMessages.length,
        threadId: input.threadId,
      }),
    );
  }

  if (input.pendingTurn === null || input.pendingTurn === undefined) {
    return chatMessages;
  }

  return sortStreamingMessages([
    ...createPendingTurnMessages({
      includeAssistantPlaceholder: !hasAssistantStream(chatMessages),
      includeUserMessage: !hasUserEcho({
        messages: chatMessages,
        pendingTurn: input.pendingTurn,
      }),
      pendingTurn: input.pendingTurn,
    }),
    ...chatMessages,
  ]);
}

export function isAgentBuilderStreamingMessage(message: AgentBuilderMessage): boolean {
  return (
    message.id.startsWith("streaming:") ||
    message.id.startsWith("optimistic:cf-agent:") ||
    message.id.startsWith("optimistic:turn:")
  );
}

export function isAgentBuilderRecoveredSdkRenderError(error: Error | undefined): boolean {
  return error?.message.startsWith("Maximum update depth exceeded.") ?? false;
}
