import type { AgUiSessionEvent } from "./ag-ui-session-events";
import { REPLACEABLE_CUSTOM_EVENT_NAMES } from "./custom-event-registry";

type ReplaceableCustomEvent = Extract<AgUiSessionEvent, { type: "CUSTOM" }>;

const replaceableCustomEventNames = new Set<string>(REPLACEABLE_CUSTOM_EVENT_NAMES);

function isReplaceableCustomEvent(event: AgUiSessionEvent): event is ReplaceableCustomEvent {
  return (
    event.type === "CUSTOM" &&
    typeof event.name === "string" &&
    replaceableCustomEventNames.has(event.name)
  );
}

function mergeTextContentEvent(
  previous: AgUiSessionEvent,
  next: AgUiSessionEvent,
): AgUiSessionEvent | null {
  if (
    previous.type !== "TEXT_MESSAGE_CONTENT" ||
    next.type !== "TEXT_MESSAGE_CONTENT" ||
    previous.messageId !== next.messageId
  ) {
    return null;
  }

  return {
    ...previous,
    delta: `${previous.delta}${next.delta}`,
  };
}

function mergeReasoningContentEvent(
  previous: AgUiSessionEvent,
  next: AgUiSessionEvent,
): AgUiSessionEvent | null {
  if (
    previous.type !== "REASONING_MESSAGE_CONTENT" ||
    next.type !== "REASONING_MESSAGE_CONTENT" ||
    previous.messageId !== next.messageId
  ) {
    return null;
  }

  return {
    ...previous,
    delta: `${previous.delta}${next.delta}`,
  };
}

function mergeTextChunkEvent(
  previous: AgUiSessionEvent,
  next: AgUiSessionEvent,
): AgUiSessionEvent | null {
  if (
    previous.type !== "TEXT_MESSAGE_CHUNK" ||
    next.type !== "TEXT_MESSAGE_CHUNK" ||
    previous.messageId === undefined ||
    previous.messageId !== next.messageId ||
    previous.delta === undefined ||
    next.delta === undefined
  ) {
    return null;
  }

  return {
    ...previous,
    delta: `${previous.delta}${next.delta}`,
  };
}

function mergeToolCallArgsEvent(
  previous: AgUiSessionEvent,
  next: AgUiSessionEvent,
): AgUiSessionEvent | null {
  if (
    previous.type !== "TOOL_CALL_ARGS" ||
    next.type !== "TOOL_CALL_ARGS" ||
    previous.toolCallId !== next.toolCallId
  ) {
    return null;
  }

  return {
    ...previous,
    delta: `${previous.delta}${next.delta}`,
  };
}

function mergeAdjacentSessionEvents(
  previous: AgUiSessionEvent,
  next: AgUiSessionEvent,
): AgUiSessionEvent | null {
  return (
    mergeTextContentEvent(previous, next) ??
    mergeTextChunkEvent(previous, next) ??
    mergeReasoningContentEvent(previous, next) ??
    mergeToolCallArgsEvent(previous, next)
  );
}

function appendEventToCompactedEvents(
  compacted: AgUiSessionEvent[],
  event: AgUiSessionEvent,
): void {
  const previous = compacted.at(-1);

  if (previous) {
    const merged = mergeAdjacentSessionEvents(previous, event);

    if (merged) {
      compacted[compacted.length - 1] = merged;
      return;
    }
  }

  compacted.push(event);
}

function findLatestReplaceableEventIndexes(events: AgUiSessionEvent[]): Set<number> {
  const indexesByName = new Map<string, number>();

  events.forEach((event, index) => {
    if (isReplaceableCustomEvent(event)) {
      indexesByName.set(event.name, index);
    }
  });

  return new Set(indexesByName.values());
}

export function compactAgUiSessionEvents(events: AgUiSessionEvent[]): AgUiSessionEvent[] {
  const compacted: AgUiSessionEvent[] = [];
  const latestReplaceableEventIndexes = findLatestReplaceableEventIndexes(events);

  for (const [index, event] of events.entries()) {
    if (event.type === "TEXT_MESSAGE_CONTENT" && event.delta.length === 0) {
      continue;
    }

    if (event.type === "REASONING_MESSAGE_CONTENT" && event.delta.length === 0) {
      continue;
    }

    if (isReplaceableCustomEvent(event) && !latestReplaceableEventIndexes.has(index)) {
      continue;
    }

    appendEventToCompactedEvents(compacted, event);
  }

  return compacted;
}
