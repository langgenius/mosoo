import type { DriverEventEnvelope } from "@mosoo/agent-driver/events";

type ReplayRuntimeEvent = DriverEventEnvelope["event"];
type ReplayRuntimeEventPayload = Record<string, unknown>;

export function filterDurablyAcceptedRuntimeStreamReplays(
  events: readonly DriverEventEnvelope[],
  durableEventIds: ReadonlySet<string>,
): DriverEventEnvelope[] {
  const durableStreams = createDurableRuntimeStreamReplayIndex(events, durableEventIds);

  return events.filter((envelope) => {
    if (envelope.eventId.length > 0 && durableEventIds.has(envelope.eventId)) {
      return false;
    }

    return !isDurablyAcceptedRuntimeStreamReplay(envelope.event, durableStreams);
  });
}

interface DurableRuntimeStreamReplayIndex {
  messageKeys: Set<string>;
  runKeys: Set<string>;
  thoughtKeys: Set<string>;
  toolKeys: Set<string>;
}

function createDurableRuntimeStreamReplayIndex(
  events: readonly DriverEventEnvelope[],
  durableEventIds: ReadonlySet<string>,
): DurableRuntimeStreamReplayIndex {
  const index: DurableRuntimeStreamReplayIndex = {
    messageKeys: new Set(),
    runKeys: new Set(),
    thoughtKeys: new Set(),
    toolKeys: new Set(),
  };

  for (const envelope of events) {
    if (envelope.eventId.length === 0 || !durableEventIds.has(envelope.eventId)) {
      continue;
    }

    const event = envelope.event;

    if (event.kind === "message.added" || event.kind === "message.completed") {
      const key = readRuntimeMessageReplayKey(event);

      if (key !== null) {
        index.messageKeys.add(key);
      }
      continue;
    }

    if (event.kind === "thought.completed") {
      const key = readRuntimeThoughtReplayKey(event);

      if (key !== null) {
        index.thoughtKeys.add(key);
      }
      continue;
    }

    if (event.kind === "item.completed" || event.kind === "tool.call.updated") {
      const key = readRuntimeToolReplayKey(event);

      if (key !== null) {
        index.toolKeys.add(key);
      }
      continue;
    }

    if (
      event.kind === "run.cancelled" ||
      event.kind === "run.completed" ||
      event.kind === "run.failed"
    ) {
      const key = readRuntimeRunReplayKey(event);

      if (key !== null) {
        index.runKeys.add(key);
      }
    }
  }

  return index;
}

function isDurablyAcceptedRuntimeStreamReplay(
  event: ReplayRuntimeEvent,
  index: DurableRuntimeStreamReplayIndex,
): boolean {
  if (isRunBoundRuntimeStreamEvent(event)) {
    const runKey = readRuntimeRunReplayKey(event);

    if (runKey !== null && index.runKeys.has(runKey)) {
      return true;
    }
  }

  const messageKey = readRuntimeMessageReplayKey(event);

  if (messageKey !== null && index.messageKeys.has(messageKey)) {
    return true;
  }

  const thoughtKey = readRuntimeThoughtReplayKey(event);

  if (thoughtKey !== null && index.thoughtKeys.has(thoughtKey)) {
    return true;
  }

  const toolKey = readRuntimeToolReplayKey(event);

  return toolKey !== null && index.toolKeys.has(toolKey);
}

function isRunBoundRuntimeStreamEvent(event: ReplayRuntimeEvent): boolean {
  return (
    event.kind === "item.completed" ||
    event.kind === "item.started" ||
    event.kind === "message.added" ||
    event.kind === "message.completed" ||
    event.kind === "message.delta" ||
    event.kind === "message.started" ||
    event.kind === "thought.completed" ||
    event.kind === "thought.delta" ||
    event.kind === "thought.started" ||
    event.kind === "tool.call.updated"
  );
}

function readRuntimeRunReplayKey(event: ReplayRuntimeEvent): string | null {
  return event.runId === undefined ? null : `${event.sessionId}:${event.runId}`;
}

function readRuntimeMessageReplayKey(event: ReplayRuntimeEvent): string | null {
  if (
    event.kind !== "message.added" &&
    event.kind !== "message.completed" &&
    event.kind !== "message.delta" &&
    event.kind !== "message.started"
  ) {
    return null;
  }

  const payload = readRuntimeEventPayload(event);
  const messageKey = readRuntimeEventString(payload, "messageId") ?? event.id;
  return messageKey === null ? null : `${event.sessionId}:${event.runId ?? ""}:${messageKey}`;
}

function readRuntimeThoughtReplayKey(event: ReplayRuntimeEvent): string | null {
  if (
    event.kind !== "thought.completed" &&
    event.kind !== "thought.delta" &&
    event.kind !== "thought.started"
  ) {
    return null;
  }

  const payload = readRuntimeEventPayload(event);
  const thoughtKey = readRuntimeEventString(payload, "thoughtId") ?? event.id;
  return thoughtKey === null ? null : `${event.sessionId}:${event.runId ?? ""}:${thoughtKey}`;
}

function readRuntimeToolReplayKey(event: ReplayRuntimeEvent): string | null {
  const toolCallId = readRuntimeEventToolCallId(event) ?? readRuntimeToolItemReplayId(event);
  return toolCallId === null ? null : `${event.sessionId}:${event.runId ?? ""}:${toolCallId}`;
}

function readRuntimeToolItemReplayId(event: ReplayRuntimeEvent): string | null {
  if (event.kind !== "item.completed" && event.kind !== "item.started") {
    return null;
  }

  const payload = readRuntimeEventPayload(event);

  if (readRuntimeEventString(payload, "itemType") !== "tool_call") {
    return null;
  }

  return readRuntimeEventString(payload, "itemId") ?? event.id;
}

function readRuntimeEventToolCallId(event: ReplayRuntimeEvent): string | null {
  if (event.kind !== "tool.call.updated") {
    return null;
  }

  return readRuntimeEventString(readRuntimeEventPayload(event), "toolCallId") ?? event.id;
}

function readRuntimeEventPayload(event: ReplayRuntimeEvent): ReplayRuntimeEventPayload {
  return isRuntimeEventPayload(event.payload) ? event.payload : {};
}

function isRuntimeEventPayload(value: unknown): value is ReplayRuntimeEventPayload {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRuntimeEventString(value: unknown, field: string): string | null {
  if (!isRuntimeEventPayload(value)) {
    return null;
  }

  const entry = value[field];
  return typeof entry === "string" && entry.length > 0 ? entry : null;
}
