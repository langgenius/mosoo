import type { AgUiSessionEvent } from "@mosoo/ag-ui-session";
import { createPlatformId } from "@mosoo/id";
import type { RuntimeEventId, SessionId, SessionRunId } from "@mosoo/id";
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
import { projectRuntimeEventsToSessionDeliveryEvents } from "./session-live-state.service";
import { publishSessionViewerEvents } from "./session-viewer-events.service";

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

async function publishSessionViewerEventsSafely(
  bindings: ApiBindings,
  sessionId: SessionId,
  events: AgUiSessionEvent[],
): Promise<void> {
  try {
    await publishSessionViewerEvents(bindings, sessionId, events);
  } catch (error) {
    logWarn("session.runtime_event.live_delivery_failed", {
      ...createErrorLogContext(error),
      eventCount: events.length,
      sessionId,
    });
  }
}

export interface AppendSessionRuntimeEventsInput {
  bindings: ApiBindings;
  deliver?: boolean;
  events: RuntimeEventEnvelope[];
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

  const result = await persistSessionRuntimeEvents(input.bindings.DB, {
    records: input.events.map((event, index) => ({
      event,
      occurredAt: toRuntimeEventOccurredAtMs(event),
      sourceEventId: event.sourceEventId ?? (index === 0 ? (input.sourceEventId ?? null) : null),
    })),
    sessionId: input.sessionId,
  });

  const deliveryEvents = projectRuntimeEventsToSessionDeliveryEvents(result.persistedEvents);

  if (input.deliver !== false && deliveryEvents.length > 0) {
    await publishSessionViewerEventsSafely(input.bindings, input.sessionId, deliveryEvents);
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

  const skippedSessionIds = new Set(result.skippedSessionIds);
  await Promise.all(
    input.records.flatMap((record) => {
      if (skippedSessionIds.has(record.sessionId)) {
        return [];
      }

      const deliveryEvents = projectRuntimeEventsToSessionDeliveryEvents([record.event]);

      return deliveryEvents.length === 0
        ? []
        : [publishSessionViewerEventsSafely(input.bindings, record.sessionId, deliveryEvents)];
    }),
  );

  return result;
}
