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

interface ToolSegmentLocations {
  messageIndex: number;
  toolResult: SegmentLocation<ToolResultSegment> | null;
  toolUse: SegmentLocation<ToolUseSegment> | null;
}

function matchesToolRun(
  segment: ToolResultSegment | ToolUseSegment,
  runId: string | null | undefined,
): boolean {
  return runId === undefined || segment.runId === runId;
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

function findToolSegmentLocations(
  messages: readonly SessionLiveState["messages"][number][],
  input: {
    messageId?: string;
    primaryKind: ToolUseSegment["kind"] | ToolResultSegment["kind"];
    runId?: string | null;
    toolCallId: string;
  },
): ToolSegmentLocations {
  let messageIndex = -1;
  let toolResult: SegmentLocation<ToolResultSegment> | null = null;
  let toolUse: SegmentLocation<ToolUseSegment> | null = null;

  for (const [currentMessageIndex, message] of messages.entries()) {
    if (input.messageId !== undefined && message.id === input.messageId) {
      messageIndex = currentMessageIndex;
    }

    for (const [segmentIndex, segment] of message.segments.entries()) {
      if (
        segment.kind === "tool_use" &&
        segment.toolCallId === input.toolCallId &&
        matchesToolRun(segment, input.runId)
      ) {
        const location = { messageIndex: currentMessageIndex, segment, segmentIndex };

        if (input.primaryKind === "tool_use") {
          return { messageIndex, toolResult, toolUse: location };
        }

        toolUse ??= location;
      }

      if (
        segment.kind === "tool_result" &&
        segment.toolCallId === input.toolCallId &&
        matchesToolRun(segment, input.runId)
      ) {
        const location = { messageIndex: currentMessageIndex, segment, segmentIndex };

        if (input.primaryKind === "tool_result") {
          return { messageIndex, toolResult: location, toolUse };
        }

        toolResult ??= location;
      }
    }
  }

  return { messageIndex, toolResult, toolUse };
}

export function appendToolUse(
  state: SessionLiveState,
  input: {
    createdAt?: string;
    parentMessageId: string | null;
    runId?: string | null;
    toolCallId: string;
    toolCallName: string;
  },
): SessionLiveState {
  const messages = [...state.messages];
  const parentMessageId = input.parentMessageId ?? undefined;
  const locations = findToolSegmentLocations(messages, {
    ...(parentMessageId ? { messageId: parentMessageId } : {}),
    primaryKind: "tool_use",
    ...(input.runId === undefined ? {} : { runId: input.runId }),
    toolCallId: input.toolCallId,
  });
  const existingUse = locations.toolUse;

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

  const existingResult = locations.toolResult;

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
      ...(input.runId === undefined ? {} : { runId: input.runId }),
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

  const index = locations.messageIndex;
  const toolSegment: SessionViewSegment = {
    argsText: "",
    kind: "tool_use",
    path: null,
    ...(input.runId === undefined ? {} : { runId: input.runId }),
    tool: input.toolCallName,
    toolCallId: input.toolCallId,
  };

  if (index === -1) {
    messages.push(
      createLiveStateMessage({
        content: "",
        ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt }),
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
        ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt }),
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
  input: {
    content: string;
    createdAt?: string;
    messageId: string;
    runId?: string | null;
    toolCallId: string;
    toolName?: string;
  },
): SessionLiveState {
  const messages = [...state.messages];
  const locations = findToolSegmentLocations(messages, {
    messageId: input.messageId,
    primaryKind: "tool_result",
    ...(input.runId === undefined ? {} : { runId: input.runId }),
    toolCallId: input.toolCallId,
  });
  const existingResult = locations.toolResult;

  if (existingResult !== null) {
    const current = messages[existingResult.messageIndex];

    if (current === undefined) {
      return state;
    }

    const segments = [...current.segments];
    segments[existingResult.segmentIndex] = {
      ...existingResult.segment,
      output: input.content,
      tool: mergeToolName(existingResult.segment.tool, input.toolName ?? "tool"),
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

  const existingUse = locations.toolUse;

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
          ...(input.runId === undefined ? {} : { runId: input.runId }),
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

  const index = locations.messageIndex;
  const current = index === -1 ? undefined : messages[index];

  const toolSegment: SessionViewSegment = {
    kind: "tool_result",
    output: input.content,
    ...(input.runId === undefined ? {} : { runId: input.runId }),
    tool: input.toolName ?? "tool",
    toolCallId: input.toolCallId,
  };

  if (index === -1) {
    messages.push(
      createLiveStateMessage({
        content: "",
        ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt }),
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
        ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt }),
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
  input: { delta: string; runId?: string | null; toolCallId: string },
): SessionLiveState {
  if (input.delta.length === 0) {
    return state;
  }

  const messages = [...state.messages];
  const existingUse = findToolSegmentLocations(messages, {
    primaryKind: "tool_use",
    ...(input.runId === undefined ? {} : { runId: input.runId }),
    toolCallId: input.toolCallId,
  }).toolUse;

  if (existingUse === null) {
    return state;
  }

  const message = messages[existingUse.messageIndex];

  if (!message) {
    return state;
  }

  const segments = message.segments.map((segment) =>
    segment.kind === "tool_use" &&
    segment.toolCallId === input.toolCallId &&
    matchesToolRun(segment, input.runId)
      ? {
          ...segment,
          argsText: `${segment.argsText}${input.delta}`,
        }
      : segment,
  );

  messages[existingUse.messageIndex] = {
    ...message,
    segments,
  };

  return touchSessionLiveState({
    ...state,
    messages,
  });
}

function replaceToolArgs(
  state: SessionLiveState,
  input: { content: string; runId?: string | null; toolCallId: string },
): SessionLiveState {
  const messages = [...state.messages];
  const existingUse = findToolSegmentLocations(messages, {
    primaryKind: "tool_use",
    ...(input.runId === undefined ? {} : { runId: input.runId }),
    toolCallId: input.toolCallId,
  }).toolUse;
  if (existingUse === null) {
    return state;
  }
  const message = messages[existingUse.messageIndex];
  if (message === undefined) {
    return state;
  }

  messages[existingUse.messageIndex] = {
    ...message,
    segments: message.segments.map((segment) =>
      segment.kind === "tool_use" &&
      segment.toolCallId === input.toolCallId &&
      matchesToolRun(segment, input.runId)
        ? Object.assign({}, segment, { argsText: input.content })
        : segment,
    ),
  };
  return touchSessionLiveState({ ...state, messages });
}

function appendToolResultDelta(
  state: SessionLiveState,
  input: {
    createdAt?: string;
    delta: string;
    messageId: string;
    runId?: string | null;
    toolCallId: string;
    toolName?: string;
  },
): SessionLiveState {
  const messages = [...state.messages];
  const existingResult = findToolSegmentLocations(messages, {
    messageId: input.messageId,
    primaryKind: "tool_result",
    ...(input.runId === undefined ? {} : { runId: input.runId }),
    toolCallId: input.toolCallId,
  }).toolResult;
  if (existingResult === null) {
    return appendToolResult(state, {
      content: input.delta,
      ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt }),
      messageId: input.messageId,
      ...(input.runId === undefined ? {} : { runId: input.runId }),
      toolCallId: input.toolCallId,
      ...(input.toolName === undefined ? {} : { toolName: input.toolName }),
    });
  }
  const message = messages[existingResult.messageIndex];
  if (message === undefined) {
    return state;
  }

  messages[existingResult.messageIndex] = {
    ...message,
    segments: message.segments.map((segment) =>
      segment.kind === "tool_result" &&
      segment.toolCallId === input.toolCallId &&
      matchesToolRun(segment, input.runId)
        ? Object.assign({}, segment, {
            output: segment.output + input.delta,
            tool: mergeToolName(segment.tool, input.toolName ?? "tool"),
          })
        : segment,
    ),
  };
  return touchSessionLiveState({ ...state, messages });
}

export function applyToolCallUpdateToSessionLiveState(
  state: SessionLiveState,
  input: {
    createdAt?: string;
    inputDelta: string | null;
    inputSnapshot: string | null;
    outputDelta: string | null;
    outputSnapshot: string | null;
    parentMessageId: string | null;
    resultMessageId: string;
    runId: string | null;
    toolCallId: string;
    toolName: string;
  },
): SessionLiveState {
  let next = appendToolUse(state, {
    ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt }),
    parentMessageId: input.parentMessageId,
    runId: input.runId,
    toolCallId: input.toolCallId,
    toolCallName: input.toolName,
  });
  if (input.inputDelta !== null) {
    next = appendToolArgs(next, {
      delta: input.inputDelta,
      runId: input.runId,
      toolCallId: input.toolCallId,
    });
  } else if (input.inputSnapshot !== null) {
    next = replaceToolArgs(next, {
      content: input.inputSnapshot,
      runId: input.runId,
      toolCallId: input.toolCallId,
    });
  }
  if (input.outputDelta !== null) {
    next = appendToolResultDelta(next, {
      delta: input.outputDelta,
      ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt }),
      messageId: input.resultMessageId,
      runId: input.runId,
      toolCallId: input.toolCallId,
      toolName: input.toolName,
    });
  } else if (input.outputSnapshot !== null) {
    next = appendToolResult(next, {
      content: input.outputSnapshot,
      ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt }),
      messageId: input.resultMessageId,
      runId: input.runId,
      toolCallId: input.toolCallId,
      toolName: input.toolName,
    });
  }

  return next;
}
