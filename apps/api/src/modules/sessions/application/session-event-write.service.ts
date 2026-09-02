import { createPlatformId } from "@mosoo/id";
import type { DriverCommandId, RuntimeEventId, SessionId, SessionRunId } from "@mosoo/id";
import { createRuntimeEvent } from "@mosoo/runtime-events";
import type {
  RuntimeEventActor,
  RuntimeEventDelivery,
  RuntimeEventEnvelope,
  RuntimeEventKind,
  RuntimeEventOrigin,
  RuntimeEventVisibility,
} from "@mosoo/runtime-events";

import { createErrorLogContext, logWarn } from "../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { currentTimestampMs } from "../../../time";
import {
  persistOneRuntimeEventPerSession,
  persistSessionRuntimeEvents,
} from "../infrastructure/session-runtime-event-store.repository";
import type { PersistSessionRuntimeEventsResult } from "../infrastructure/session-runtime-event-store.repository";
import { syncSessionViewerState } from "./session-viewer-events.service";

export interface AppendOneSessionEventPerSessionResult {
  readonly persistedCount: number;
  readonly skippedSessionIds: readonly string[];
}

export interface CreateSessionRuntimeEventInput {
  actor?: RuntimeEventActor;
  delivery?: RuntimeEventDelivery;
  id?: RuntimeEventId;
  kind: RuntimeEventKind;
  occurredAtMs?: number;
  origin?: RuntimeEventOrigin;
  payload: unknown;
  runId?: SessionRunId | null;
  sessionId: SessionId;
  sourceEventId?: string | null;
  traceId?: string | null;
  visibility?: RuntimeEventVisibility;
}

async function syncSessionViewerStateSafely(
  bindings: ApiBindings,
  sessionId: SessionId,
): Promise<void> {
  try {
    await syncSessionViewerState(bindings, sessionId);
  } catch (error) {
    logWarn("session.runtime_event.live_sync_failed", {
      ...createErrorLogContext(error),
      sessionId,
    });
  }
}

export async function publishPersistedSessionRuntimeEvents(input: {
  bindings: ApiBindings;
  events: readonly RuntimeEventEnvelope[];
  sessionId: SessionId;
}): Promise<void> {
  if (input.events.length > 0) {
    await syncSessionViewerStateSafely(input.bindings, input.sessionId);
  }
}

export interface AppendSessionRuntimeEventsInput {
  bindings: ApiBindings;
  deliver?: boolean;
  events: RuntimeEventEnvelope[];
  provenMcpCommandId?: DriverCommandId | null;
  sessionId: SessionId;
  sourceEventId?: string | null;
}

export interface OneSessionRuntimeEventInput {
  event: RuntimeEventEnvelope;
  sessionId: SessionId;
}

function toRuntimeEventOccurredAtMs(event: RuntimeEventEnvelope): number | null {
  const occurredAtMs = Date.parse(event.occurredAt);

  return Number.isFinite(occurredAtMs) ? occurredAtMs : null;
}

export function createSessionRuntimeEvent(
  input: CreateSessionRuntimeEventInput,
): RuntimeEventEnvelope {
  const occurredAtMs = input.occurredAtMs ?? currentTimestampMs();

  return createRuntimeEvent({
    actor: input.actor ?? "api",
    delivery: input.delivery,
    id: input.id ?? createPlatformId<RuntimeEventId>(),
    kind: input.kind,
    occurredAt: new Date(occurredAtMs).toISOString(),
    origin: input.origin ?? "api",
    payload: input.payload,
    ...(input.runId === null || input.runId === undefined ? {} : { runId: input.runId }),
    sessionId: input.sessionId,
    ...(input.sourceEventId === null || input.sourceEventId === undefined
      ? {}
      : { sourceEventId: input.sourceEventId }),
    ...(input.traceId === null || input.traceId === undefined ? {} : { traceId: input.traceId }),
    visibility: input.visibility,
  });
}

export async function appendSessionRuntimeEvents(
  input: AppendSessionRuntimeEventsInput,
): Promise<PersistSessionRuntimeEventsResult> {
  if (input.events.length === 0) {
    return {
      persistedCount: 0,
      persistedEvents: [],
      persistedSourceEventIds: [],
    };
  }
  if (input.provenMcpCommandId != null && input.events.length !== 1) {
    throw new Error("Proven MCP command provenance requires exactly one runtime event.");
  }

  const result = await persistSessionRuntimeEvents(input.bindings.DB, {
    records: input.events.map((event, index) => ({
      event,
      occurredAt: toRuntimeEventOccurredAtMs(event),
      provenMcpCommandId: index === 0 ? (input.provenMcpCommandId ?? null) : null,
      sourceEventId: event.sourceEventId ?? (index === 0 ? (input.sourceEventId ?? null) : null),
    })),
    sessionId: input.sessionId,
  });

  if (input.deliver !== false) {
    await publishPersistedSessionRuntimeEvents({
      bindings: input.bindings,
      events: input.events,
      sessionId: input.sessionId,
    });
  }

  return result;
}

export async function appendOneSessionRuntimeEventPerSession(input: {
  bindings: ApiBindings;
  deliver?: boolean;
  records: readonly OneSessionRuntimeEventInput[];
}): Promise<AppendOneSessionEventPerSessionResult> {
  if (input.records.length === 0) {
    return {
      persistedCount: 0,
      skippedSessionIds: [],
    };
  }

  const result = await persistOneRuntimeEventPerSession(input.bindings.DB, {
    records: input.records.map((record) => ({
      event: record.event,
      occurredAt: toRuntimeEventOccurredAtMs(record.event),
      sessionId: record.sessionId,
    })),
  });

  if (input.deliver === false) {
    return result;
  }

  await Promise.all(
    [...new Set(input.records.map((record) => record.sessionId))].map((sessionId) =>
      syncSessionViewerStateSafely(input.bindings, sessionId),
    ),
  );

  return result;
}
