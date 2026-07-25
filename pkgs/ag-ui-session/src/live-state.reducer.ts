import { EventType } from "@ag-ui/core";
import type { Message } from "@ag-ui/core";

import { compactAgUiSessionEvents } from "./ag-ui-session-compaction";
import type { AgUiEvent } from "./ag-ui-session-events";
import type { SessionLiveState, SessionViewMessage } from "./live-state";
import { updateCustomState } from "./live-state-custom.reducer";
import { applyJsonPatch } from "./live-state-json-patch.reducer";
import {
  appendReasoningDelta,
  appendTextDelta,
  appendToolArgs,
  appendToolResult,
  appendToolUse,
  completePendingToolUses,
  completeToolUse,
  createSessionLiveStateMessage,
  startReasoning,
  upsertMessage,
} from "./live-state-message.reducer";
import {
  currentIsoTimestamp,
  defaultInfraState,
  isTerminalRunStatus,
  touchSessionLiveState,
} from "./live-state.reducer-core";

export { createSessionLiveStateMessage };

function agUiMessageText(message: Message): string {
  if (message.role === "user") {
    if (typeof message.content === "string") {
      return message.content;
    }

    return message.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("");
  }

  if (
    message.role === "assistant" ||
    message.role === "developer" ||
    message.role === "system" ||
    message.role === "reasoning" ||
    message.role === "tool"
  ) {
    return message.content ?? "";
  }

  return "";
}

function isVisibleMessageRole(role: Message["role"]): role is SessionViewMessage["role"] {
  return role === "assistant" || role === "user";
}

function toSessionViewMessage(message: Message): SessionViewMessage | null {
  if (!isVisibleMessageRole(message.role)) {
    return null;
  }

  return createSessionLiveStateMessage({
    content: agUiMessageText(message),
    id: message.id,
    role: message.role,
  });
}

function toSessionViewMessages(messages: Message[]): SessionViewMessage[] {
  return messages.flatMap((message) => {
    const viewMessage = toSessionViewMessage(message);
    return viewMessage ? [viewMessage] : [];
  });
}

function normalizeSessionLiveStateShape(state: SessionLiveState): SessionLiveState {
  const { run } = state;
  const terminalState = isTerminalRunStatus(run.status) ? completePendingToolUses(state) : state;

  return {
    ...terminalState,
    infra: terminalState.infra,
    lifecycle: terminalState.lifecycle,
    permissionRequests: isTerminalRunStatus(run.status) ? [] : terminalState.permissionRequests,
    readiness: terminalState.readiness ?? null,
  };
}

function isActiveRunState(state: SessionLiveState): boolean {
  return state.run.status !== "idle" && !isTerminalRunStatus(state.run.status);
}

function shouldApplyRunStarted(state: SessionLiveState, runId: string): boolean {
  return state.run.id === null || state.run.id === runId || !isActiveRunState(state);
}

function shouldApplyRunTerminalEvent(state: SessionLiveState, runId: string): boolean {
  return isActiveRunState(state) && state.run.id === runId;
}

function shouldApplyRunError(state: SessionLiveState): boolean {
  return isActiveRunState(state);
}

function applyEvent(state: SessionLiveState, event: AgUiEvent): SessionLiveState {
  const currentState = normalizeSessionLiveStateShape(state);

  switch (event.type) {
    case EventType.MESSAGES_SNAPSHOT: {
      return touchSessionLiveState({
        ...currentState,
        messages: toSessionViewMessages(event.messages),
      });
    }
    case EventType.STATE_SNAPSHOT: {
      return normalizeSessionLiveStateShape(event.snapshot);
    }
    case EventType.STATE_DELTA: {
      return normalizeSessionLiveStateShape(applyJsonPatch(currentState, event.delta));
    }
    case EventType.TEXT_MESSAGE_START: {
      if (!isVisibleMessageRole(event.role)) {
        return currentState;
      }

      return upsertMessage(
        currentState,
        createSessionLiveStateMessage({
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
              createSessionLiveStateMessage({
                content: "",
                id: event.messageId,
                role: event.role,
              }),
            )
          : currentState;

      return event.delta ? appendTextDelta(withMessage, event.messageId, event.delta) : withMessage;
    }
    case EventType.TEXT_MESSAGE_END: {
      return currentState;
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
    case EventType.TOOL_CALL_CHUNK: {
      if (!event.toolCallId) {
        return currentState;
      }

      const withTool = event.toolCallName
        ? appendToolUse(currentState, {
            parentMessageId: event.parentMessageId ?? null,
            toolCallId: event.toolCallId,
            toolCallName: event.toolCallName,
          })
        : currentState;

      return event.delta
        ? appendToolArgs(withTool, {
            delta: event.delta,
            toolCallId: event.toolCallId,
          })
        : withTool;
    }
    case EventType.TOOL_CALL_END: {
      return completeToolUse(currentState, event.toolCallId);
    }
    case EventType.TOOL_CALL_RESULT: {
      return appendToolResult(currentState, {
        content: event.content,
        messageId: event.messageId,
        toolCallId: event.toolCallId,
      });
    }
    case EventType.RUN_STARTED: {
      if (!shouldApplyRunStarted(currentState, event.runId)) {
        return currentState;
      }

      return touchSessionLiveState({
        ...currentState,
        infra: {
          ...currentState.infra,
          lastFailureMessage: null,
          lastFailureReason: null,
          reconnecting: false,
        },
        lifecycle: "RUNNING",
        permissionRequests: [],
        run: {
          ...state.run,
          completedAt: null,
          error: null,
          id: event.runId,
          startedAt: currentIsoTimestamp(),
          status: "running",
        },
      });
    }
    case EventType.RUN_FINISHED: {
      if (!shouldApplyRunTerminalEvent(currentState, event.runId)) {
        return currentState;
      }

      const finishedState = completePendingToolUses(currentState);
      return touchSessionLiveState({
        ...finishedState,
        infra: {
          ...finishedState.infra,
          lastFailureMessage: null,
          lastFailureReason: null,
          reconnecting: false,
        },
        lifecycle: "IDLE",
        permissionRequests: [],
        run: {
          ...finishedState.run,
          completedAt: currentIsoTimestamp(),
          error: null,
          id: event.runId,
          status: "completed",
        },
      });
    }
    case EventType.RUN_ERROR: {
      if (!shouldApplyRunError(currentState)) {
        return currentState;
      }

      const failedState = completePendingToolUses(currentState);
      return touchSessionLiveState({
        ...failedState,
        infra: {
          ...failedState.infra,
          lastFailureMessage: event.message,
          lastFailureReason: event.code ?? "runtime.error",
          reconnecting: false,
        },
        lifecycle: "IDLE",
        permissionRequests: [],
        run: {
          ...failedState.run,
          completedAt: currentIsoTimestamp(),
          error: {
            code: event.code ?? "runtime.error",
            details: {},
            message: event.message,
            retryable: false,
          },
          status: "failed",
        },
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
    case EventType.ACTIVITY_DELTA:
    case EventType.ACTIVITY_SNAPSHOT:
    case EventType.REASONING_ENCRYPTED_VALUE:
    case EventType.REASONING_END:
    case EventType.REASONING_MESSAGE_CHUNK:
    case EventType.REASONING_MESSAGE_END:
    case EventType.REASONING_START:
    case EventType.STEP_FINISHED:
    case EventType.STEP_STARTED:
    case EventType.THINKING_END:
    case EventType.THINKING_START:
    case EventType.THINKING_TEXT_MESSAGE_CONTENT:
    case EventType.THINKING_TEXT_MESSAGE_END:
    case EventType.THINKING_TEXT_MESSAGE_START: {
      return currentState;
    }
    case EventType.CUSTOM: {
      return updateCustomState(currentState, event);
    }
    case EventType.RAW: {
      return currentState;
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
    readiness: null,
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
  event: AgUiEvent,
): SessionLiveState {
  return applyEvent(state, event);
}

export function applyAgUiEventsToSessionLiveState(
  state: SessionLiveState,
  events: AgUiEvent[],
): SessionLiveState {
  let next = state;
  const compactedEvents = compactAgUiSessionEvents(events);

  for (const event of compactedEvents) {
    next = applyEvent(next, event);
  }

  return next;
}
