import { EventType, MOSOO_CUSTOM_EVENT, parseAgUiSessionEvent } from "@mosoo/ag-ui-session";
import type { AgUiSessionEvent } from "@mosoo/ag-ui-session";

import type { RuntimeEventEnvelope } from "./runtime-event";
import { readRuntimeEventNumber, readRuntimeTimingPayload } from "./runtime-event-payload";

function createRuntimeCustomEvent(name: string, value: unknown): AgUiSessionEvent {
  return parseAgUiSessionEvent({
    name,
    type: EventType.CUSTOM,
    value,
  });
}

export function appRuntimeStatus(event: RuntimeEventEnvelope): AgUiSessionEvent {
  return createRuntimeCustomEvent(MOSOO_CUSTOM_EVENT.sessionRuntimeTimelineUpdated.name, {
    completedAtMs: Date.parse(event.occurredAt),
    durationMs: readRuntimeEventNumber(event.payload, "durationMs") ?? 0,
    path: "unknown",
    runId: event.runId ?? null,
    sessionId: event.sessionId,
    source: event.origin === "api" ? "api" : "driver",
    stage: "driver_backend",
    startedAtMs: Date.parse(event.occurredAt),
    traceId: event.traceId ?? null,
  });
}

export function appRuntimeTimingRecorded(event: RuntimeEventEnvelope): AgUiSessionEvent[] {
  const timing = readRuntimeTimingPayload(event);

  return [
    createRuntimeCustomEvent(MOSOO_CUSTOM_EVENT.sessionRuntimeTimelineUpdated.name, {
      completedAtMs: timing.completedAtMs,
      durationMs: timing.totalMs,
      path: timing.path,
      runId: timing.runId,
      sessionId: timing.sessionId,
      source: timing.source,
      stage: timing.stage,
      startedAtMs: timing.startedAtMs,
      traceId: timing.traceId,
    }),
    createRuntimeCustomEvent(MOSOO_CUSTOM_EVENT.sessionRuntimeTiming.name, timing),
  ];
}
