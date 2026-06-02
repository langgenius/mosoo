import {
  readRuntimeEventMessageContent,
  readRuntimeEventPayload,
  readRuntimeEventString,
} from "@mosoo/runtime-events";
import type {
  RuntimeEventEnvelope,
  RuntimeEventKind,
  RuntimeEventToolStatus,
} from "@mosoo/runtime-events";

import type { ProjectedRuntimeEventRecord } from "./event-types";

export type RuntimeEventPayloadRecord = Record<string, unknown>;

export type TextStreamKind = "message" | "thought";

export interface StreamAccumulator {
  content: string;
  firstRecord: ProjectedRuntimeEventRecord;
  key: string;
  lastRecord: ProjectedRuntimeEventRecord;
  runId: string | null;
  sessionId: string;
}

export interface TextStreamAccumulator extends StreamAccumulator {
  kind: TextStreamKind;
  role: "agent" | "user";
}

export interface ToolCallAccumulator extends StreamAccumulator {
  itemCompleted: boolean;
  name: string | null;
  payload: RuntimeEventPayloadRecord;
  rawInput: string | null;
  rawOutput: string | null;
  status: RuntimeEventToolStatus;
  toolCallId: string;
}

const terminalRunKinds = new Set<RuntimeEventKind>([
  "run.cancelled",
  "run.completed",
  "run.failed",
]);

export function toStreamKey(input: {
  id: string;
  kind: TextStreamKind | "tool";
  runId: string | null;
  sessionId: string;
}): string {
  return `${input.sessionId}:${input.runId ?? ""}:${input.kind}:${input.id}`;
}

function readRecordOccurredAt(record: ProjectedRuntimeEventRecord): number | null {
  if (record.occurredAt !== null) {
    return record.occurredAt;
  }

  const occurredAt = Date.parse(record.event.occurredAt);
  return Number.isFinite(occurredAt) ? occurredAt : null;
}

export function readPayloadString(
  payload: RuntimeEventPayloadRecord,
  field: string,
): string | null {
  const value = payload[field];
  return typeof value === "string" ? value : null;
}

function appendStreamText(current: string | null, next: string | null): string | null {
  if (next === null || next.length === 0) {
    return current;
  }

  if (current === null || current.length === 0) {
    return next;
  }

  return `${current}${next}`;
}

function mergeSnapshotText(current: string | null, next: string | null): string | null {
  if (next === null || next.length === 0) {
    return current;
  }

  if (current === null || current.length === 0) {
    return next;
  }

  if (next.length > current.length && next.startsWith(current)) {
    return next;
  }

  if (current.length >= next.length && current.startsWith(next)) {
    return current;
  }

  return `${current}${next}`;
}

export function mergeDeliveredText(
  current: string | null,
  next: string | null,
  delivery: RuntimeEventEnvelope["delivery"],
): string | null {
  return delivery === "best_effort"
    ? appendStreamText(current, next)
    : mergeSnapshotText(current, next);
}

export function mergeTextEventContent(
  accumulator: TextStreamAccumulator,
  event: RuntimeEventEnvelope,
): void {
  const delta = readRuntimeEventString(readRuntimeEventPayload(event), "contentDelta");

  if (delta !== null) {
    accumulator.content = appendStreamText(accumulator.content, delta) ?? "";
    return;
  }

  accumulator.content =
    mergeSnapshotText(accumulator.content, readRuntimeEventMessageContent(event)) ?? "";
}

export function readRuntimeEventMessageRoleUpdate(
  event: RuntimeEventEnvelope,
): TextStreamAccumulator["role"] | null {
  const role = readRuntimeEventString(readRuntimeEventPayload(event), "role");

  return role === "agent" || role === "user" ? role : null;
}

function createEventWithPayload(
  source: RuntimeEventEnvelope,
  input: {
    delivery?: RuntimeEventEnvelope["delivery"];
    kind: RuntimeEventKind;
    payload: RuntimeEventPayloadRecord;
    sourceEventId: string | null;
  },
): RuntimeEventEnvelope<RuntimeEventPayloadRecord> {
  const { sourceEventId: _sourceEventId, ...rest } = source;

  return {
    ...rest,
    delivery: input.delivery ?? "lossless",
    kind: input.kind,
    payload: input.payload,
    ...(input.sourceEventId === null ? {} : { sourceEventId: input.sourceEventId }),
  };
}

export function createCompactedRecord(
  accumulator: StreamAccumulator,
  input: {
    kind: RuntimeEventKind;
    payload: RuntimeEventPayloadRecord;
  },
): ProjectedRuntimeEventRecord {
  return {
    event: createEventWithPayload(accumulator.lastRecord.event, {
      kind: input.kind,
      payload: input.payload,
      sourceEventId: accumulator.lastRecord.sourceEventId,
    }),
    occurredAt: readRecordOccurredAt(accumulator.firstRecord),
    sourceEventId: accumulator.lastRecord.sourceEventId,
  };
}

export function readToolItemId(event: RuntimeEventEnvelope): string | null {
  if (event.kind !== "item.completed" && event.kind !== "item.started") {
    return null;
  }

  const payload = readRuntimeEventPayload(event);

  if (readRuntimeEventString(payload, "itemType") !== "tool_call") {
    return null;
  }

  return readRuntimeEventString(payload, "itemId") ?? event.id;
}

export function isTerminalRunEvent(event: RuntimeEventEnvelope): boolean {
  return terminalRunKinds.has(event.kind);
}

export function toTerminalToolStatus(event: RuntimeEventEnvelope): RuntimeEventToolStatus {
  return event.kind === "run.failed" || event.kind === "run.cancelled" ? "failed" : "completed";
}
