import type {
  SessionLiveState,
  SessionLiveStateMessage,
  SessionViewPlanEntry,
  SessionViewSegment,
} from "./live-state";
import { currentIsoTimestamp, isRecord, touchSessionLiveState } from "./live-state.reducer-core";

export function normalizeMessagePlan(plan: unknown): SessionViewPlanEntry[] {
  if (!Array.isArray(plan)) {
    return [];
  }

  const entries: SessionViewPlanEntry[] = [];

  for (const item of plan) {
    if (!isRecord(item)) {
      continue;
    }

    const content = typeof item["content"] === "string" ? item["content"].trim() : "";

    if (!content) {
      continue;
    }

    entries.push({
      content,
      priority:
        item["priority"] === "high" || item["priority"] === "low" ? item["priority"] : "medium",
      status:
        item["status"] === "in_progress" || item["status"] === "completed"
          ? item["status"]
          : "pending",
    });
  }

  return entries;
}

export function createLiveStateMessage(input: {
  content: string;
  id: string;
  role: "assistant" | "user";
  createdAt?: string;
  plan?: SessionViewPlanEntry[];
  segments?: SessionViewSegment[];
}): SessionLiveStateMessage {
  return {
    content: input.content,
    createdAt: input.createdAt ?? currentIsoTimestamp(),
    id: input.id,
    plan: input.plan ?? [],
    role: input.role,
    segments: input.segments ?? [],
  };
}

export function createSessionLiveStateMessage(input: {
  content: string;
  createdAt?: string;
  id: string;
  role: "assistant" | "user";
}): SessionLiveStateMessage {
  return createLiveStateMessage(input);
}

export function upsertMessage(
  state: SessionLiveState,
  nextMessage: SessionLiveStateMessage,
): SessionLiveState {
  const messages = [...state.messages];
  const index = messages.findIndex((message) => message.id === nextMessage.id);

  if (index === -1) {
    messages.push(nextMessage);
  } else {
    messages[index] = nextMessage;
  }

  return touchSessionLiveState({
    ...state,
    messages,
  });
}
