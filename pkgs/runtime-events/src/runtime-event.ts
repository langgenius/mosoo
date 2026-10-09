import { parsePlatformId } from "@mosoo/id";
import type {
  DriverInstanceId,
  PlatformId,
  RuntimeEventId,
  SessionId,
  SessionRunId,
} from "@mosoo/id";

import { admitRuntimeEventPayload } from "./runtime-event-payload";

export const RUNTIME_EVENT_SCHEMA_VERSION = "2026-05-26" as const;

export const RUNTIME_EVENT_KINDS = [
  "agent.task.updated",
  "auth.methods.updated",
  "auth.session.updated",
  "context.compacted",
  "diagnostic.reported",
  "file.change.updated",
  "file.changed",
  "item.completed",
  "item.started",
  "message.added",
  "message.completed",
  "message.delta",
  "message.started",
  "permission.requested",
  "permission.resolved",
  "plan.updated",
  "run.cancel.requested",
  "run.cancelled",
  "run.completed",
  "run.dispatched",
  "run.failed",
  "run.queued",
  "run.started",
  "runtime.capabilities.updated",
  "runtime.resume.updated",
  "runtime.timing.recorded",
  "session.capabilities.updated",
  "session.commands.updated",
  "session.config.updated",
  "session.created",
  "session.files.updated",
  "session.info.updated",
  "session.lifecycle.updated",
  "session.mode.updated",
  "session.models.updated",
  "session.resumed",
  "terminal.created",
  "terminal.exited",
  "terminal.killed",
  "terminal.output.delta",
  "terminal.released",
  "thought.completed",
  "thought.delta",
  "thought.started",
  "tool.call.updated",
  "usage.updated",
] as const;

export type RuntimeEventKind = (typeof RUNTIME_EVENT_KINDS)[number];
export type RuntimeEventActor = "agent" | "api" | "driver" | "system" | "tool" | "user";
export type RuntimeEventOrigin = "api" | "driver" | "file" | "runtime" | "system" | "viewer";
export type RuntimeEventVisibility = "owner_debug" | "participant";
export type RuntimeEventDelivery = "best_effort" | "lossless";

export interface RuntimeEventNativeRef {
  readonly eventName?: string | undefined;
  readonly itemId?: string | undefined;
  readonly protocolVersion?: string | undefined;
  readonly provider: string;
  readonly requestId?: string | undefined;
  readonly sequence?: number | undefined;
  readonly threadId?: string | undefined;
  readonly turnId?: string | undefined;
}

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

const runtimeEventKindSet = new Set<string>(RUNTIME_EVENT_KINDS);
const runtimeEventActors = new Set<string>(["agent", "api", "driver", "system", "tool", "user"]);
const runtimeEventOrigins = new Set<string>([
  "api",
  "driver",
  "file",
  "runtime",
  "system",
  "viewer",
]);
const runtimeEventVisibilities = new Set<string>(["owner_debug", "participant"]);
const runtimeEventDeliveries = new Set<string>(["best_effort", "lossless"]);
const ownerDiagnosticRuntimeEventKinds = new Set<RuntimeEventKind>(["diagnostic.reported"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: Record<string, unknown>, field: string): string | undefined {
  const entry = value[field];
  return typeof entry === "string" && entry.length > 0 ? entry : undefined;
}

function readOptionalString(value: Record<string, unknown>, field: string): string | undefined {
  if (!(field in value) || value[field] === undefined) {
    return undefined;
  }

  const entry = readString(value, field);

  if (entry === undefined) {
    throw new Error(`Runtime event ${field} must be a non-empty string when provided.`);
  }

  return entry;
}

function readPlatformId(value: Record<string, unknown>, field: string): PlatformId {
  return parsePlatformId(value[field], `Runtime event ${field}`);
}

function readOptionalPlatformId(
  value: Record<string, unknown>,
  field: string,
): PlatformId | undefined {
  if (!(field in value) || value[field] === undefined) {
    return undefined;
  }

  return parsePlatformId(value[field], `Runtime event ${field}`);
}

function readNumber(value: Record<string, unknown>, field: string): number | undefined {
  const entry = value[field];
  return typeof entry === "number" && Number.isFinite(entry) ? entry : undefined;
}

function readOptionalNumber(value: Record<string, unknown>, field: string): number | undefined {
  if (!(field in value) || value[field] === undefined) {
    return undefined;
  }

  const entry = readNumber(value, field);

  if (entry === undefined) {
    throw new Error(`Runtime event ${field} must be a finite number when provided.`);
  }

  return entry;
}

function assertRuntimeEventTimestamp(value: string, label: string): void {
  if (!Number.isFinite(Date.parse(value))) {
    throw new Error(`Runtime event ${label} must be a valid timestamp.`);
  }
}

function isRuntimeEventKind(value: unknown): value is RuntimeEventKind {
  return typeof value === "string" && runtimeEventKindSet.has(value);
}

function isRuntimeEventActor(value: unknown): value is RuntimeEventActor {
  return typeof value === "string" && runtimeEventActors.has(value);
}

function isRuntimeEventOrigin(value: unknown): value is RuntimeEventOrigin {
  return typeof value === "string" && runtimeEventOrigins.has(value);
}

function isRuntimeEventVisibility(value: unknown): value is RuntimeEventVisibility {
  return typeof value === "string" && runtimeEventVisibilities.has(value);
}

function isRuntimeEventDelivery(value: unknown): value is RuntimeEventDelivery {
  return typeof value === "string" && runtimeEventDeliveries.has(value);
}

function getRuntimeEventDefaultVisibility(kind: RuntimeEventKind): RuntimeEventVisibility {
  return ownerDiagnosticRuntimeEventKinds.has(kind) ? "owner_debug" : "participant";
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
    visibility: draft.visibility ?? getRuntimeEventDefaultVisibility(draft.kind),
  };
}

export function parseRuntimeEventEnvelope(value: unknown): RuntimeEventEnvelope {
  if (!isRecord(value)) {
    throw new Error("Runtime event must be an object.");
  }

  if (value["schemaVersion"] !== RUNTIME_EVENT_SCHEMA_VERSION) {
    throw new Error("Runtime event schema version is unsupported.");
  }

  const id = readPlatformId(value, "id") as RuntimeEventId;
  const sessionId = readPlatformId(value, "sessionId") as SessionId;

  const kind = value["kind"];
  const actor = value["actor"];
  const origin = value["origin"];
  const visibility = value["visibility"];
  const delivery = value["delivery"];

  if (!isRuntimeEventKind(kind)) {
    throw new Error("Runtime event kind is unsupported.");
  }

  if (!isRuntimeEventActor(actor)) {
    throw new Error("Runtime event actor is unsupported.");
  }

  if (!isRuntimeEventOrigin(origin)) {
    throw new Error("Runtime event origin is unsupported.");
  }

  if (!isRuntimeEventVisibility(visibility)) {
    throw new Error("Runtime event visibility is unsupported.");
  }

  if (!isRuntimeEventDelivery(delivery)) {
    throw new Error("Runtime event delivery mode is unsupported.");
  }

  const occurredAt = readString(value, "occurredAt");

  if (occurredAt === undefined) {
    throw new Error("Runtime event occurrence time is required.");
  }

  assertRuntimeEventTimestamp(occurredAt, "occurrence time");

  if (!("payload" in value)) {
    throw new Error("Runtime event payload is required.");
  }

  const native = value["native"] === undefined ? null : parseRuntimeEventNativeRef(value["native"]);
  const correlationId = readOptionalString(value, "correlationId");
  const driverInstanceId = readOptionalPlatformId(value, "driverInstanceId") as
    | DriverInstanceId
    | undefined;
  const receivedAt = readOptionalString(value, "receivedAt");
  const runId = readOptionalPlatformId(value, "runId") as SessionRunId | undefined;
  const runtimeId = readOptionalString(value, "runtimeId");
  const sourceEventId = readOptionalString(value, "sourceEventId");
  const traceId = readOptionalString(value, "traceId");

  if (receivedAt !== undefined) {
    assertRuntimeEventTimestamp(receivedAt, "received time");
  }

  const payload = admitRuntimeEventPayload(
    {
      ...(driverInstanceId === undefined ? {} : { driverInstanceId }),
      kind,
      ...(runId === undefined ? {} : { runId }),
      ...(runtimeId === undefined ? {} : { runtimeId }),
      sessionId,
      ...(traceId === undefined ? {} : { traceId }),
    },
    value["payload"],
  );

  return {
    actor,
    ...(correlationId === undefined ? {} : { correlationId }),
    delivery,
    ...(driverInstanceId === undefined ? {} : { driverInstanceId }),
    id,
    kind,
    ...(native === null ? {} : { native }),
    occurredAt,
    origin,
    payload,
    ...(receivedAt === undefined ? {} : { receivedAt }),
    ...(runId === undefined ? {} : { runId }),
    ...(runtimeId === undefined ? {} : { runtimeId }),
    schemaVersion: RUNTIME_EVENT_SCHEMA_VERSION,
    sessionId,
    ...(sourceEventId === undefined ? {} : { sourceEventId }),
    ...(traceId === undefined ? {} : { traceId }),
    visibility,
  };
}

function parseRuntimeEventNativeRef(value: unknown): RuntimeEventNativeRef {
  if (!isRecord(value)) {
    throw new Error("Runtime event native reference must be an object when provided.");
  }

  const provider = readString(value, "provider");

  if (provider === undefined) {
    throw new Error("Runtime event native reference provider is required.");
  }
  const eventName = readOptionalString(value, "eventName");
  const itemId = readOptionalString(value, "itemId");
  const protocolVersion = readOptionalString(value, "protocolVersion");
  const requestId = readOptionalString(value, "requestId");
  const sequence = readOptionalNumber(value, "sequence");
  const threadId = readOptionalString(value, "threadId");
  const turnId = readOptionalString(value, "turnId");

  return {
    ...(eventName === undefined ? {} : { eventName }),
    ...(itemId === undefined ? {} : { itemId }),
    ...(protocolVersion === undefined ? {} : { protocolVersion }),
    provider,
    ...(requestId === undefined ? {} : { requestId }),
    ...(sequence === undefined ? {} : { sequence }),
    ...(threadId === undefined ? {} : { threadId }),
    ...(turnId === undefined ? {} : { turnId }),
  };
}

export function getRuntimeEventParticipantVisibility(
  event: RuntimeEventEnvelope,
): "all_consumers" | "owner_debug" {
  return event.visibility === "participant" ? "all_consumers" : "owner_debug";
}
