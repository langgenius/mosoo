import type {
  SessionProcessEventStatus,
  SessionProcessEventType,
  SessionRuntimeEventFamily,
  SessionRuntimeEventSource,
  SessionRuntimeEventVisibility,
} from "@mosoo/contracts/session";
import { parseJsonObject } from "@mosoo/contracts/validation";
import type { JsonValue } from "@mosoo/contracts/validation";
import type { SessionRunId } from "@mosoo/id";
import {
  createProcessDraftFromRuntimeEvent,
  getRuntimeEventSessionFamily,
  getRuntimeEventParticipantVisibility,
  getRuntimeEventSource,
  readRuntimeEventPermissionRequest,
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
  toolCallId: string | null;
  toolInputJson: string | null;
  toolName: string | null;
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

function sortJsonValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, entry]) => [key, sortJsonValue(entry)]),
    );
  }

  return value;
}

function toCanonicalToolInputJson(rawInput: string | null): string | null {
  if (rawInput === null || rawInput.length === 0) {
    return null;
  }

  try {
    const input = parseJsonObject(JSON.parse(rawInput), "Runtime tool input");

    return Object.keys(input).length === 0 ? null : JSON.stringify(sortJsonValue(input));
  } catch {
    return null;
  }
}

function readProjectedToolCall(event: RuntimeEventEnvelope): {
  toolCallId: string | null;
  toolInputJson: string | null;
  toolName: string | null;
} {
  if (event.kind === "tool.call.updated") {
    const toolCall = readRuntimeEventToolCallUpdate(event);

    return {
      toolCallId: toolCall.toolCallId,
      // Running input is streamed and may be valid JSON before it is complete.
      toolInputJson:
        toolCall.status === "running" ? null : toCanonicalToolInputJson(toolCall.rawInput),
      // Terminal titles are provider display labels and may differ from the stable start name.
      toolName: toolCall.status === "running" ? toolCall.title || toolCall.kind : null,
    };
  }

  const permission = readRuntimeEventPermissionRequest(event);

  return permission === null
    ? { toolCallId: null, toolInputJson: null, toolName: null }
    : {
        toolCallId: permission.toolCallId,
        toolInputJson: null,
        toolName: null,
      };
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
  const toolCall = readProjectedToolCall(event);

  return {
    contentText: readProjectedContentText(event, draft),
    eventType: event.kind,
    family: getRuntimeEventSessionFamily(event),
    processStatus: readProjectedProcessStatus(event, draft),
    processType: draft.type,
    runId: event.runId ?? null,
    source: isKnownRuntimeEventSource(source) ? source : "system",
    ...toolCall,
    traceId: event.traceId ?? null,
    tokens: draft.tokens ?? null,
    visibility: getRuntimeEventParticipantVisibility(event),
  };
}
