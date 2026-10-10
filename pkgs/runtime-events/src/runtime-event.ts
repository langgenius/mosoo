import {
  parseRuntimeEventEnvelope as parseDriverRuntimeEventEnvelope,
  RUNTIME_EVENT_SCHEMA_VERSION,
} from "@mosoo/agent-driver/runtime-events";
import type {
  RuntimeEventActor,
  RuntimeEventDelivery,
  RuntimeEventKind,
  RuntimeEventNativeRef,
  RuntimeEventOrigin,
  RuntimeEventVisibility,
} from "@mosoo/agent-driver/runtime-events";
import { parsePlatformId } from "@mosoo/id";
import type { DriverInstanceId, RuntimeEventId, SessionId, SessionRunId } from "@mosoo/id";

import { projectRuntimeEventPayload } from "./runtime-event-payload";

export {
  RUNTIME_EVENT_KINDS,
  RUNTIME_EVENT_SCHEMA_VERSION,
} from "@mosoo/agent-driver/runtime-events";
export type {
  RuntimeEventActor,
  RuntimeEventDelivery,
  RuntimeEventKind,
  RuntimeEventNativeRef,
  RuntimeEventOrigin,
  RuntimeEventVisibility,
} from "@mosoo/agent-driver/runtime-events";

export interface RuntimeEventEnvelope<TPayload = unknown> {
  readonly actor: RuntimeEventActor;
  readonly correlationId?: string | undefined;
  readonly delivery: RuntimeEventDelivery;
  readonly driverInstanceId?: DriverInstanceId | undefined;
  readonly id: RuntimeEventId;
  readonly kind: RuntimeEventKind;
  readonly native?: RuntimeEventNativeRef | undefined;
  readonly occurredAt: string;
  readonly origin: RuntimeEventOrigin;
  readonly payload: TPayload;
  readonly receivedAt?: string | undefined;
  readonly runId?: SessionRunId | undefined;
  readonly runtimeId?: string | undefined;
  readonly schemaVersion: typeof RUNTIME_EVENT_SCHEMA_VERSION;
  readonly sessionId: SessionId;
  readonly sourceEventId?: string | undefined;
  readonly traceId?: string | undefined;
  readonly visibility: RuntimeEventVisibility;
}

export interface RuntimeEventDraft<TPayload = unknown> {
  readonly actor?: RuntimeEventActor | undefined;
  readonly correlationId?: string | undefined;
  readonly delivery?: RuntimeEventDelivery | undefined;
  readonly driverInstanceId?: DriverInstanceId | undefined;
  readonly id: RuntimeEventId;
  readonly kind: RuntimeEventKind;
  readonly native?: RuntimeEventNativeRef | undefined;
  readonly occurredAt: string;
  readonly origin?: RuntimeEventOrigin | undefined;
  readonly payload: TPayload;
  readonly receivedAt?: string | undefined;
  readonly runId?: SessionRunId | undefined;
  readonly runtimeId?: string | undefined;
  readonly sessionId: SessionId;
  readonly sourceEventId?: string | undefined;
  readonly traceId?: string | undefined;
  readonly visibility?: RuntimeEventVisibility | undefined;
}

export function createRuntimeEvent<TPayload>(
  draft: RuntimeEventDraft<TPayload>,
): RuntimeEventEnvelope<TPayload> {
  return {
    actor: draft.actor ?? "driver",
    ...(draft.correlationId === undefined ? {} : { correlationId: draft.correlationId }),
    delivery: draft.delivery ?? "lossless",
    ...(draft.driverInstanceId === undefined ? {} : { driverInstanceId: draft.driverInstanceId }),
    id: draft.id,
    kind: draft.kind,
    ...(draft.native === undefined ? {} : { native: draft.native }),
    occurredAt: draft.occurredAt,
    origin: draft.origin ?? "driver",
    payload: draft.payload,
    ...(draft.receivedAt === undefined ? {} : { receivedAt: draft.receivedAt }),
    ...(draft.runId === undefined ? {} : { runId: draft.runId }),
    ...(draft.runtimeId === undefined ? {} : { runtimeId: draft.runtimeId }),
    schemaVersion: RUNTIME_EVENT_SCHEMA_VERSION,
    sessionId: draft.sessionId,
    ...(draft.sourceEventId === undefined ? {} : { sourceEventId: draft.sourceEventId }),
    ...(draft.traceId === undefined ? {} : { traceId: draft.traceId }),
    visibility:
      draft.visibility ?? (draft.kind === "diagnostic.reported" ? "owner_debug" : "participant"),
  };
}

export function parseRuntimeEventEnvelope(value: unknown): RuntimeEventEnvelope {
  const event = parseDriverRuntimeEventEnvelope(value);
  const id = parsePlatformId<RuntimeEventId>(event.id, "Runtime event id");
  const sessionId = parsePlatformId<SessionId>(event.sessionId, "Runtime event sessionId");
  const runId =
    event.runId === undefined
      ? undefined
      : parsePlatformId<SessionRunId>(event.runId, "Runtime event runId");
  const driverInstanceId =
    event.driverInstanceId === undefined
      ? undefined
      : parsePlatformId<DriverInstanceId>(event.driverInstanceId, "Runtime event driverInstanceId");

  const admitted = { ...event, driverInstanceId, id, runId, sessionId };
  return { ...admitted, payload: projectRuntimeEventPayload(admitted) };
}

export function getRuntimeEventParticipantVisibility(
  event: RuntimeEventEnvelope,
): "all_consumers" | "owner_debug" {
  return event.visibility === "participant" || event.visibility === "public"
    ? "all_consumers"
    : "owner_debug";
}
