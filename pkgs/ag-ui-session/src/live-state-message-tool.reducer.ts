import type { SessionLiveState, SessionViewSegment } from "./live-state";
import { createLiveStateMessage } from "./live-state-message-core.reducer";
import { touchSessionLiveState } from "./live-state.reducer-core";

type ToolUseSegment = Extract<SessionViewSegment, { kind: "tool_use" }>;
type ToolResultSegment = Extract<SessionViewSegment, { kind: "tool_result" }>;

interface SegmentLocation<TSegment extends SessionViewSegment> {
  messageIndex: number;
  segment: TSegment;
  segmentIndex: number;
}

function isGenericToolName(value: string): boolean {
  return value.trim().toLowerCase() === "tool";
}

function mergeToolName(current: string, next: string): string {
  if (isGenericToolName(next) && !isGenericToolName(current)) {
    return current;
  }

  return next;
}

function findToolUse(
  messages: readonly SessionLiveState["messages"][number][],
  toolCallId: string,
): SegmentLocation<ToolUseSegment> | null {
  for (const [messageIndex, message] of messages.entries()) {
    for (const [segmentIndex, segment] of message.segments.entries()) {
      if (segment.kind === "tool_use" && segment.toolCallId === toolCallId) {
        return { messageIndex, segment, segmentIndex };
      }
    }
  }

  return null;
}

function findToolResult(
  messages: readonly SessionLiveState["messages"][number][],
  toolCallId: string,
): SegmentLocation<ToolResultSegment> | null {
  for (const [messageIndex, message] of messages.entries()) {
    for (const [segmentIndex, segment] of message.segments.entries()) {
      if (segment.kind === "tool_result" && segment.toolCallId === toolCallId) {
        return { messageIndex, segment, segmentIndex };
      }
    }
  }

  return null;
}

export function appendToolUse(
  state: SessionLiveState,
  input: {
    parentMessageId: string | null;
    toolCallId: string;
    toolCallName: string;
  },
): SessionLiveState {
  const messages = [...state.messages];
  const existingUse = findToolUse(messages, input.toolCallId);

  if (existingUse !== null) {
    const current = messages[existingUse.messageIndex];

    if (current === undefined) {
      return state;
    }

    const segments = [...current.segments];
    segments[existingUse.segmentIndex] = {
      ...existingUse.segment,
      tool: mergeToolName(existingUse.segment.tool, input.toolCallName),
    };
    messages[existingUse.messageIndex] = {
      ...current,
      segments,
    };

    return touchSessionLiveState({
      ...state,
      messages,
    });
  }

  if (input.parentMessageId === null || input.parentMessageId === "") {
    return state;
  }

  const existingResult = findToolResult(messages, input.toolCallId);

  if (existingResult !== null) {
    const current = messages[existingResult.messageIndex];

    if (current === undefined) {
      return state;
    }

    const toolName = mergeToolName(existingResult.segment.tool, input.toolCallName);
    const segments = [...current.segments];
    segments.splice(existingResult.segmentIndex, 0, {
      argsText: "",
      kind: "tool_use",
      path: null,
      tool: toolName,
      toolCallId: input.toolCallId,
    });
    segments[existingResult.segmentIndex + 1] = {
      ...existingResult.segment,
      tool: toolName,
    };
    messages[existingResult.messageIndex] = {
      ...current,
      segments,
    };

    return touchSessionLiveState({
      ...state,
      messages,
    });
  }

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
  const existingResult = findToolResult(messages, input.toolCallId);

  if (existingResult !== null) {
    const current = messages[existingResult.messageIndex];

    if (current === undefined) {
      return state;
    }

    const segments = [...current.segments];
    segments[existingResult.segmentIndex] = {
      ...existingResult.segment,
      output: input.content,
    };
    messages[existingResult.messageIndex] = {
      ...current,
      segments,
    };

    return touchSessionLiveState({
      ...state,
      messages,
    });
  }

  const existingUse = findToolUse(messages, input.toolCallId);

  if (existingUse !== null) {
    const current = messages[existingUse.messageIndex];

    if (current === undefined) {
      return state;
    }

    messages[existingUse.messageIndex] = {
      ...current,
      segments: [
        ...current.segments,
        {
          kind: "tool_result",
          output: input.content,
          tool: existingUse.segment.tool,
          toolCallId: input.toolCallId,
        },
      ],
    };

    return touchSessionLiveState({
      ...state,
      messages,
    });
  }

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
