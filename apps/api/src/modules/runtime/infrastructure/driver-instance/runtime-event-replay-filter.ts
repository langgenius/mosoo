import type { DriverEventBatchInput } from "@mosoo/driver-protocol";
import {
  readRuntimeEventMessageKey,
  readRuntimeEventPayload,
  readRuntimeEventString,
  readRuntimeEventToolCallId,
} from "@mosoo/runtime-events";
import type { RuntimeEventEnvelope } from "@mosoo/runtime-events";

export function filterDurablyAcceptedRuntimeStreamReplays(
  events: DriverEventBatchInput["events"],
  durableEventIds: ReadonlySet<string>,
): DriverEventBatchInput["events"] {
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
  events: DriverEventBatchInput["events"],
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
  event: RuntimeEventEnvelope,
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

function isRunBoundRuntimeStreamEvent(event: RuntimeEventEnvelope): boolean {
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

function readRuntimeRunReplayKey(event: RuntimeEventEnvelope): string | null {
  return event.runId === undefined ? null : `${event.sessionId}:${event.runId}`;
}

function readRuntimeMessageReplayKey(event: RuntimeEventEnvelope): string | null {
  if (
    event.kind !== "message.added" &&
    event.kind !== "message.completed" &&
    event.kind !== "message.delta" &&
    event.kind !== "message.started"
  ) {
    return null;
  }

  const messageKey = readRuntimeEventMessageKey(event);
  return messageKey === null ? null : `${event.sessionId}:${event.runId ?? ""}:${messageKey}`;
}

function readRuntimeThoughtReplayKey(event: RuntimeEventEnvelope): string | null {
  if (
    event.kind !== "thought.completed" &&
    event.kind !== "thought.delta" &&
    event.kind !== "thought.started"
  ) {
    return null;
  }

  const thoughtKey = readRuntimeEventMessageKey(event);
  return thoughtKey === null ? null : `${event.sessionId}:${event.runId ?? ""}:${thoughtKey}`;
}

function readRuntimeToolReplayKey(event: RuntimeEventEnvelope): string | null {
  const toolCallId = readRuntimeEventToolCallId(event) ?? readRuntimeToolItemReplayId(event);
  return toolCallId === null ? null : `${event.sessionId}:${event.runId ?? ""}:${toolCallId}`;
}

function readRuntimeToolItemReplayId(event: RuntimeEventEnvelope): string | null {
  if (event.kind !== "item.completed" && event.kind !== "item.started") {
    return null;
  }

  const payload = readRuntimeEventPayload(event);

  if (readRuntimeEventString(payload, "itemType") !== "tool_call") {
    return null;
  }

  return readRuntimeEventString(payload, "itemId") ?? event.id;
}
