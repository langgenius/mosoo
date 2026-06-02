import type { AgentBuilderThreadId, AgentId } from "@mosoo/id";
import type { UIMessage } from "ai";

import { parseAgentBuilderThreadId, parseAgentId } from "./agent-builder-ids";

export interface AgentBuilderSystemAgentChatBody {
  readonly agentId: AgentId;
  readonly draftRevision: string;
  readonly draftYaml: string;
  readonly threadId: AgentBuilderThreadId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readRequiredString(input: Record<string, unknown>, fieldName: string): string {
  const value = input[fieldName];

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Agent Builder chat field ${fieldName} must be a non-empty string.`);
  }

  return value.trim();
}

export function parseAgentBuilderSystemAgentChatBody(
  value: unknown,
): AgentBuilderSystemAgentChatBody {
  if (!isRecord(value)) {
    throw new Error("Agent Builder chat request body must be an object.");
  }

  return {
    agentId: parseAgentId(readRequiredString(value, "agentId"), "agentId"),
    draftRevision: readRequiredString(value, "draftRevision"),
    draftYaml: readRequiredString(value, "draftYaml"),
    threadId: parseAgentBuilderThreadId(readRequiredString(value, "threadId"), "threadId"),
  };
}

export function readLatestUserTextFromChatMessages(messages: readonly UIMessage[]): string {
  const userMessage = messages.toReversed().find((message) => message.role === "user");

  if (userMessage === undefined) {
    throw new Error("Agent Builder chat request must include a user message.");
  }

  const text = userMessage.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("")
    .trim();

  if (text.length === 0) {
    throw new Error("Agent Builder chat user message must include text.");
  }

  return text;
}
