import { EventType } from "@ag-ui/core";

import { compactAgUiSessionEvents } from "./ag-ui-session-compaction";
import type { AgUiSessionEvent } from "./ag-ui-session-events";
import type { SessionLiveState, SessionViewMessage } from "./live-state";
import { updateCustomState } from "./live-state-custom.reducer";
import {
  appendReasoningDelta,
  appendTextDelta,
  appendToolArgs,
  appendToolResult,
  appendToolUse,
  createLiveStateMessage,
  startReasoning,
  upsertMessage,
} from "./live-state-message.reducer";
import {
  currentIsoTimestamp,
  defaultInfraState,
  isTerminalRunStatus,
} from "./live-state.reducer-core";

export { createLiveStateMessage };

function isVisibleMessageRole(role: string): role is SessionViewMessage["role"] {
  return role === "assistant" || role === "user";
}

function normalizeSessionLiveStateShape(state: SessionLiveState): SessionLiveState {
  return isTerminalRunStatus(state.run.status) ? { ...state, permissionRequests: [] } : state;
}

function applyEvent(state: SessionLiveState, event: AgUiSessionEvent): SessionLiveState {
  const currentState = normalizeSessionLiveStateShape(state);

  switch (event.type) {
    case EventType.STATE_SNAPSHOT: {
      return normalizeSessionLiveStateShape(event.snapshot);
    }
    case EventType.TEXT_MESSAGE_START: {
      if (!isVisibleMessageRole(event.role)) {
        return currentState;
      }

      return upsertMessage(
        currentState,
        createLiveStateMessage({
          content: "",
          id: event.messageId,
          role: event.role,
        }),
      );
    }
    case EventType.TEXT_MESSAGE_CONTENT: {
      return appendTextDelta(currentState, event.messageId, event.delta);
    }
    case EventType.TEXT_MESSAGE_CHUNK: {
      if (!event.messageId) {
        return currentState;
      }

      const withMessage =
        event.role && isVisibleMessageRole(event.role)
          ? upsertMessage(
              currentState,
              createLiveStateMessage({
                content: "",
                id: event.messageId,
                role: event.role,
              }),
            )
          : currentState;

      return event.delta ? appendTextDelta(withMessage, event.messageId, event.delta) : withMessage;
    }
    case EventType.TOOL_CALL_START: {
      return appendToolUse(currentState, {
        parentMessageId: event.parentMessageId ?? null,
        toolCallId: event.toolCallId,
        toolCallName: event.toolCallName,
      });
    }
    case EventType.TOOL_CALL_ARGS: {
      return appendToolArgs(currentState, {
        delta: event.delta,
        toolCallId: event.toolCallId,
      });
    }
    case EventType.TOOL_CALL_RESULT: {
      return appendToolResult(currentState, {
        content: event.content,
        messageId: event.messageId,
        toolCallId: event.toolCallId,
      });
    }
    case EventType.REASONING_MESSAGE_START: {
      return startReasoning(currentState, { messageId: event.messageId });
    }
    case EventType.REASONING_MESSAGE_CONTENT: {
      return appendReasoningDelta(currentState, {
        delta: event.delta,
        messageId: event.messageId,
      });
    }
    case EventType.REASONING_MESSAGE_END:
    case EventType.TEXT_MESSAGE_END:
    case EventType.TOOL_CALL_END: {
      return currentState;
    }
    case EventType.CUSTOM: {
      return updateCustomState(currentState, event);
    }
  }
}

export function createInitialSessionLiveState(input: {
  sessionId: string;
  title: string | null;
  viewerId: string;
}): SessionLiveState {
  const now = currentIsoTimestamp();

  return {
    commands: [],
    configOptions: [],
    currentModeId: null,
    files: [],
    infra: defaultInfraState(),
    lifecycle: "IDLE",
    messages: [],
    permissionRequests: [],
    plan: [],
    run: {
      completedAt: null,
      error: null,
      id: null,
      startedAt: null,
      status: "idle",
      traceId: null,
    },
    sessionId: input.sessionId,
    title: input.title,
    updatedAt: now,
    usage: null,
    viewerId: input.viewerId,
    visibleModes: [],
  };
}

export function applyAgUiEventToSessionLiveState(
  state: SessionLiveState,
  event: AgUiSessionEvent,
): SessionLiveState {
  return applyEvent(state, event);
}

export function applyAgUiEventsToSessionLiveState(
  state: SessionLiveState,
  events: AgUiSessionEvent[],
): SessionLiveState {
  let next = state;
  const compactedEvents = compactAgUiSessionEvents(events);

  for (const event of compactedEvents) {
    next = applyEvent(next, event);
  }

  return next;
}
