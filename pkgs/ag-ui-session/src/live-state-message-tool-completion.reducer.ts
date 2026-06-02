import type { SessionLiveState, SessionLiveStateMessage, SessionViewSegment } from "./live-state";
import { touchSessionLiveState } from "./live-state.reducer-core";

interface MessageCompletionResult {
  changed: boolean;
  message: SessionLiveStateMessage;
}

export function completeToolUse(state: SessionLiveState, toolCallId: string): SessionLiveState {
  const results = state.messages.map((message) => completeToolUseInMessage(message, toolCallId));
  const changed = results.some((result) => result.changed);

  if (changed) {
    return touchSessionLiveState({
      ...state,
      messages: results.map((result) => result.message),
    });
  }

  return state;
}

function completeToolUseInMessage(
  message: SessionLiveStateMessage,
  toolCallId: string,
): MessageCompletionResult {
  const toolUse = message.segments.find(
    (segment) => segment.kind === "tool_use" && segment.toolCallId === toolCallId,
  );

  if (toolUse?.kind !== "tool_use") {
    return { changed: false, message };
  }

  const hasResult = message.segments.some(
    (segment) => segment.kind === "tool_result" && segment.toolCallId === toolCallId,
  );

  if (hasResult) {
    return { changed: false, message };
  }

  const completionSegment: SessionViewSegment = {
    kind: "tool_result",
    output: "",
    tool: toolUse.tool,
    toolCallId,
  };

  return {
    changed: true,
    message: {
      ...message,
      segments: [...message.segments, completionSegment],
    },
  };
}

export function completePendingToolUses(state: SessionLiveState): SessionLiveState {
  const results = state.messages.map(completePendingToolUsesInMessage);
  const changed = results.some((result) => result.changed);

  if (changed) {
    return {
      ...state,
      messages: results.map((result) => result.message),
    };
  }

  return state;
}

function completePendingToolUsesInMessage(
  message: SessionLiveStateMessage,
): MessageCompletionResult {
  const completedCallIds = new Set(
    message.segments.flatMap((segment) =>
      segment.kind === "tool_result" ? [segment.toolCallId] : [],
    ),
  );
  const pendingByCallId = new Map<string, { tool: string }>();

  for (const segment of message.segments) {
    if (segment.kind === "tool_use") {
      if (completedCallIds.has(segment.toolCallId)) {
        continue;
      }

      pendingByCallId.set(segment.toolCallId, { tool: segment.tool });
      continue;
    }

    if (segment.kind === "tool_result") {
      pendingByCallId.delete(segment.toolCallId);
    }
  }

  if (pendingByCallId.size === 0) {
    return { changed: false, message };
  }

  const terminalSegments: SessionViewSegment[] = Array.from(
    pendingByCallId.entries(),
    ([toolCallId, pending]) => ({
      kind: "tool_result",
      output: "",
      tool: pending.tool,
      toolCallId,
    }),
  );

  return {
    changed: true,
    message: {
      ...message,
      segments: [...message.segments, ...terminalSegments],
    },
  };
}
