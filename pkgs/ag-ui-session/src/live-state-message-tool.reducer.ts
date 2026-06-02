import type { SessionLiveState, SessionViewSegment } from "./live-state";
import { createLiveStateMessage } from "./live-state-message-core.reducer";
import { touchSessionLiveState } from "./live-state.reducer-core";

export function appendToolUse(
  state: SessionLiveState,
  input: {
    parentMessageId: string | null;
    toolCallId: string;
    toolCallName: string;
  },
): SessionLiveState {
  if (input.parentMessageId === null || input.parentMessageId === "") {
    return state;
  }

  const messages = [...state.messages];
  const index = messages.findIndex((message) => message.id === input.parentMessageId);
  const toolSegment: SessionViewSegment = {
    argsText: "",
    kind: "tool_use",
    path: null,
    tool: input.toolCallName,
    toolCallId: input.toolCallId,
  };

  if (index === -1) {
    messages.push(
      createLiveStateMessage({
        content: "",
        id: input.parentMessageId,
        role: "assistant",
        segments: [toolSegment],
      }),
    );

    return touchSessionLiveState({
      ...state,
      messages,
    });
  }

  const current = messages[index];

  if (current === undefined) {
    messages.push(
      createLiveStateMessage({
        content: "",
        id: input.parentMessageId,
        role: "assistant",
        segments: [toolSegment],
      }),
    );

    return touchSessionLiveState({
      ...state,
      messages,
    });
  }

  const existingUseIndex = current.segments.findIndex(
    (segment) => segment.kind === "tool_use" && segment.toolCallId === input.toolCallId,
  );

  if (existingUseIndex !== -1) {
    const segments = [...current.segments];
    const existingUse = segments[existingUseIndex];
    segments[existingUseIndex] =
      existingUse?.kind === "tool_use"
        ? {
            ...toolSegment,
            argsText: existingUse.argsText,
          }
        : toolSegment;
    messages[index] = {
      ...current,
      segments,
    };

    return touchSessionLiveState({
      ...state,
      messages,
    });
  }

  const existingResultIndex = current.segments.findIndex(
    (segment) => segment.kind === "tool_result" && segment.toolCallId === input.toolCallId,
  );

  if (existingResultIndex !== -1) {
    const segments = [...current.segments];
    const existingResult = segments[existingResultIndex];
    segments.splice(existingResultIndex, 0, toolSegment);

    if (existingResult?.kind === "tool_result") {
      segments[existingResultIndex + 1] = {
        ...existingResult,
        tool: existingResult.tool === "tool" ? input.toolCallName : existingResult.tool,
      };
    }

    messages[index] = {
      ...current,
      segments,
    };

    return touchSessionLiveState({
      ...state,
      messages,
    });
  }

  messages[index] = {
    ...current,
    segments: [...current.segments, toolSegment],
  };

  return touchSessionLiveState({
    ...state,
    messages,
  });
}

export function appendToolResult(
  state: SessionLiveState,
  input: { content: string; messageId: string; toolCallId: string },
): SessionLiveState {
  const messages = [...state.messages];
  const index = messages.findIndex((message) => message.id === input.messageId);

  const current = index === -1 ? undefined : messages[index];
  const matchingToolUse = current?.segments.find(
    (segment) => segment.kind === "tool_use" && segment.toolCallId === input.toolCallId,
  );
  const toolName = matchingToolUse?.kind === "tool_use" ? matchingToolUse.tool : "tool";

  const toolSegment: SessionViewSegment = {
    kind: "tool_result",
    output: input.content,
    tool: toolName,
    toolCallId: input.toolCallId,
  };

  if (index === -1) {
    messages.push(
      createLiveStateMessage({
        content: "",
        id: input.messageId,
        role: "assistant",
        segments: [toolSegment],
      }),
    );

    return touchSessionLiveState({
      ...state,
      messages,
    });
  }

  if (current === undefined) {
    messages.push(
      createLiveStateMessage({
        content: "",
        id: input.messageId,
        role: "assistant",
        segments: [toolSegment],
      }),
    );

    return touchSessionLiveState({
      ...state,
      messages,
    });
  }

  const existingResultIndex = current.segments.findIndex(
    (segment) => segment.kind === "tool_result" && segment.toolCallId === input.toolCallId,
  );

  if (existingResultIndex !== -1) {
    const segments = [...current.segments];
    segments[existingResultIndex] = toolSegment;
    messages[index] = {
      ...current,
      segments,
    };

    return touchSessionLiveState({
      ...state,
      messages,
    });
  }

  messages[index] = {
    ...current,
    segments: [...current.segments, toolSegment],
  };

  return touchSessionLiveState({
    ...state,
    messages,
  });
}

export function appendToolArgs(
  state: SessionLiveState,
  input: { delta: string; toolCallId: string },
): SessionLiveState {
  if (input.delta.length === 0) {
    return state;
  }

  const messages = [...state.messages];
  const messageIndex = messages.findIndex((message) =>
    message.segments.some(
      (segment) => segment.kind === "tool_use" && segment.toolCallId === input.toolCallId,
    ),
  );

  if (messageIndex === -1) {
    return state;
  }

  const message = messages[messageIndex];

  if (!message) {
    return state;
  }

  const segments = message.segments.map((segment) =>
    segment.kind === "tool_use" && segment.toolCallId === input.toolCallId
      ? {
          ...segment,
          argsText: `${segment.argsText}${input.delta}`,
        }
      : segment,
  );

  messages[messageIndex] = {
    ...message,
    segments,
  };

  return touchSessionLiveState({
    ...state,
    messages,
  });
}
