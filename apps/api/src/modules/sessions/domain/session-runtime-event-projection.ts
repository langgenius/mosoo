import type {
  SessionProcessEventStatus,
  SessionProcessEventType,
  SessionRuntimeEventFamily,
  SessionRuntimeEventSource,
  SessionRuntimeEventVisibility,
} from "@mosoo/contracts/session";
import type { SessionRunId } from "@mosoo/id";
import {
  createProcessDraftFromRuntimeEvent,
  getRuntimeEventSessionFamily,
  getRuntimeEventParticipantVisibility,
  getRuntimeEventSource,
  readRuntimeEventToolCallUpdate,
} from "@mosoo/runtime-events";
import type { RuntimeEventEnvelope } from "@mosoo/runtime-events";

export interface SessionRuntimeEventProjection {
  contentText: string;
  eventType: string;
  family: SessionRuntimeEventFamily;
  processStatus: SessionProcessEventStatus;
  processType: SessionProcessEventType;
  runId: SessionRunId | null;
  source: SessionRuntimeEventSource;
  traceId: string | null;
  tokens: number | null;
  visibility: SessionRuntimeEventVisibility;
}

const knownRuntimeEventSources = new Set<string>(["api", "driver", "file", "system", "viewer"]);

function isKnownRuntimeEventSource(value: unknown): value is SessionRuntimeEventSource {
  return typeof value === "string" && knownRuntimeEventSources.has(value);
}

function normalizeContentText(value: string): string {
  const normalized = value.replaceAll(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : value;
}

function readProjectedContentText(
  event: RuntimeEventEnvelope,
  draft: ReturnType<typeof createProcessDraftFromRuntimeEvent>,
): string {
  if (event.kind !== "tool.call.updated") {
    return draft.content;
  }

  const toolCall = readRuntimeEventToolCallUpdate(event);

  if (toolCall.status !== "completed" && toolCall.status !== "failed") {
    return draft.content;
  }

  const name = toolCall.title ?? toolCall.kind ?? "Tool";
  const result = toolCall.rawOutput ?? toolCall.content;

  if (result === null) {
    return toolCall.status === "failed" ? `${name} failed.` : `${name} completed.`;
  }

  return `${name} result: ${normalizeContentText(result)}`;
}

function readProjectedProcessStatus(
  event: RuntimeEventEnvelope,
  draft: ReturnType<typeof createProcessDraftFromRuntimeEvent>,
): SessionProcessEventStatus {
  if (
    event.kind === "tool.call.updated" &&
    readRuntimeEventToolCallUpdate(event).status === "failed"
  ) {
    return "error";
  }

  return draft.status ?? "available";
}

export function createSessionRuntimeEventProjection(
  event: RuntimeEventEnvelope,
): SessionRuntimeEventProjection {
  const draft = createProcessDraftFromRuntimeEvent(event);
  const source = getRuntimeEventSource(event);

  return {
    contentText: readProjectedContentText(event, draft),
    eventType: event.kind,
    family: getRuntimeEventSessionFamily(event),
    processStatus: readProjectedProcessStatus(event, draft),
    processType: draft.type,
    runId: event.runId ?? null,
    source: isKnownRuntimeEventSource(source) ? source : "system",
    traceId: event.traceId ?? null,
    tokens: draft.tokens ?? null,
    visibility: getRuntimeEventParticipantVisibility(event),
  };
}
