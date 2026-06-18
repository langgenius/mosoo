import { parsePlatformId } from "@mosoo/id";
import type {
  AccountId,
  AgentDeploymentVersionId,
  AgentId,
  DriverInstanceId,
  EnvironmentRevisionId,
  PlatformId,
  RuntimeEventId,
  SessionId,
  SessionRunId,
} from "@mosoo/id";

import { admitRuntimeEventPayload } from "./runtime-event-payload";

export const RUNTIME_EVENT_SCHEMA_VERSION = "2026-05-26" as const;

export const RUNTIME_EVENT_KINDS = [
  "account.limits.updated",
  "account.updated",
  "agent.task.updated",
  "auth.methods.updated",
  "auth.session.updated",
  "catalog.updated",
  "context.added",
  "context.compacted",
  "diagnostic.reported",
  "driver.command.updated",
  "driver.connected",
  "driver.disconnected",
  "driver.heartbeat",
  "driver.log.recorded",
  "driver.ready",
  "file.change.updated",
  "file.changed",
  "file.indexed",
  "hook.completed",
  "hook.started",
  "image.updated",
  "item.completed",
  "item.started",
  "item.updated",
  "mcp.oauth.completed",
  "mcp.server.updated",
  "mcp.tool.updated",
  "message.added",
  "message.completed",
  "message.delta",
  "message.started",
  "model.routing.updated",
  "model.verification.updated",
  "oauth.updated",
  "permission.requested",
  "permission.resolved",
  "permission.review.completed",
  "permission.review.started",
  "plan.updated",
  "process.exited",
  "process.output.delta",
  "realtime.audio.delta",
  "realtime.closed",
  "realtime.failed",
  "realtime.sdp.updated",
  "realtime.session.updated",
  "realtime.transcript.completed",
  "realtime.transcript.delta",
  "remote.control.updated",
  "review.updated",
  "run.cancel.requested",
  "run.cancelled",
  "run.completed",
  "run.dispatched",
  "run.failed",
  "run.queued",
  "run.started",
  "run.steered",
  "run.waiting",
  "runtime.capabilities.updated",
  "runtime.config.updated",
  "runtime.driver.updated",
  "runtime.provisioning.updated",
  "runtime.resume.updated",
  "runtime.sandbox.released",
  "runtime.sandbox.updated",
  "runtime.timing.recorded",
  "runtime.transport.updated",
  "search.session.completed",
  "search.session.updated",
  "session.archived",
  "session.capabilities.updated",
  "session.closed",
  "session.commands.updated",
  "session.config.updated",
  "session.created",
  "session.files.updated",
  "session.info.updated",
  "session.lifecycle.updated",
  "session.mode.updated",
  "session.models.updated",
  "session.readiness.updated",
  "session.resumed",
  "session.unarchived",
  "shell.command.updated",
  "terminal.created",
  "terminal.exited",
  "terminal.killed",
  "terminal.output.delta",
  "terminal.released",
  "thought.completed",
  "thought.delta",
  "thought.started",
  "tool.call.updated",
  "tool.dynamic.updated",
  "usage.updated",
  "user.input.requested",
  "user.input.resolved",
  "web.search.updated",
  "workspace.files.changed",
] as const;

export type RuntimeEventKind = (typeof RUNTIME_EVENT_KINDS)[number];
export type RuntimeEventActor = "agent" | "api" | "driver" | "system" | "tool" | "user";
export type RuntimeEventOrigin = "api" | "driver" | "file" | "runtime" | "system" | "viewer";
export type RuntimeEventVisibility = "owner_debug" | "participant" | "public" | "system_internal";
export type RuntimeEventDelivery = "best_effort" | "lossless";
export type RuntimeEventLayer =
  | "owner_diagnostic"
  | "participant_state"
  | "system_internal"
  | "usage";

export interface RuntimeEventContext {
  readonly agentId?: AgentId | undefined;
  readonly callerId?: AccountId | undefined;
  readonly deploymentVersionId?: AgentDeploymentVersionId | undefined;
  readonly environmentRevisionId?: EnvironmentRevisionId | undefined;
  readonly executionActorId?: AccountId | undefined;
  readonly surface?:
    | {
        readonly id?: string | undefined;
        readonly triggerId?: string | undefined;
        readonly type: "api" | "automation" | "system" | "web";
      }
    | undefined;
}

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
  readonly context?: RuntimeEventContext | undefined;
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
  readonly seq?: number | undefined;
  readonly sessionId: SessionId;
  readonly sourceEventId?: string | undefined;
  readonly traceId?: string | undefined;
  readonly visibility: RuntimeEventVisibility;
}

export interface RuntimeEventDraft<TPayload = unknown> {
  readonly actor?: RuntimeEventActor | undefined;
  readonly context?: RuntimeEventContext | undefined;
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
const runtimeEventVisibilities = new Set<string>([
  "owner_debug",
  "participant",
  "public",
  "system_internal",
]);
const runtimeEventDeliveries = new Set<string>(["best_effort", "lossless"]);
const runtimeEventSurfaceTypes = new Set<string>(["api", "automation", "system", "web"]);
const ownerDiagnosticRuntimeEventKinds = new Set<RuntimeEventKind>([
  "diagnostic.reported",
  "driver.log.recorded",
  "runtime.config.updated",
  "runtime.driver.updated",
  "runtime.provisioning.updated",
  "runtime.sandbox.released",
  "runtime.sandbox.updated",
  "runtime.transport.updated",
]);
const systemInternalRuntimeEventKinds = new Set<RuntimeEventKind>([
  "driver.command.updated",
  "driver.connected",
  "driver.disconnected",
  "driver.heartbeat",
  "driver.ready",
]);
const usageRuntimeEventKinds = new Set<RuntimeEventKind>(["usage.updated"]);

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

function isRuntimeEventSurfaceType(
  value: unknown,
): value is NonNullable<RuntimeEventContext["surface"]>["type"] {
  return typeof value === "string" && runtimeEventSurfaceTypes.has(value);
}

export function getRuntimeEventLayer(kind: RuntimeEventKind): RuntimeEventLayer {
  if (ownerDiagnosticRuntimeEventKinds.has(kind)) {
    return "owner_diagnostic";
  }

  if (systemInternalRuntimeEventKinds.has(kind)) {
    return "system_internal";
  }

  if (usageRuntimeEventKinds.has(kind)) {
    return "usage";
  }

  return "participant_state";
}

export function getRuntimeEventDefaultVisibility(kind: RuntimeEventKind): RuntimeEventVisibility {
  switch (getRuntimeEventLayer(kind)) {
    case "owner_diagnostic": {
      return "owner_debug";
    }
    case "system_internal": {
      return "system_internal";
    }
    case "participant_state":
    case "usage": {
      return "participant";
    }
  }
}

export function createRuntimeEvent<TPayload>(
  draft: RuntimeEventDraft<TPayload>,
): RuntimeEventEnvelope<TPayload> {
  return {
    actor: draft.actor ?? "driver",
    ...(draft.context === undefined ? {} : { context: draft.context }),
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

  const context =
    value["context"] === undefined ? null : parseRuntimeEventContext(value["context"]);
  const native = value["native"] === undefined ? null : parseRuntimeEventNativeRef(value["native"]);
  const correlationId = readOptionalString(value, "correlationId");
  const driverInstanceId = readOptionalPlatformId(value, "driverInstanceId") as
    | DriverInstanceId
    | undefined;
  const receivedAt = readOptionalString(value, "receivedAt");
  const runId = readOptionalPlatformId(value, "runId") as SessionRunId | undefined;
  const runtimeId = readOptionalString(value, "runtimeId");
  const seq = readOptionalNumber(value, "seq");
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
    ...(context === null ? {} : { context }),
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
    ...(seq === undefined ? {} : { seq }),
    sessionId,
    ...(sourceEventId === undefined ? {} : { sourceEventId }),
    ...(traceId === undefined ? {} : { traceId }),
    visibility,
  };
}

function parseRuntimeEventContext(value: unknown): RuntimeEventContext {
  if (!isRecord(value)) {
    throw new Error("Runtime event context must be an object when provided.");
  }

  if ("organizationId" in value) {
    throw new Error("Runtime event context organizationId is not supported.");
  }

  const surface =
    value["surface"] === undefined ? null : parseRuntimeEventSurfaceContext(value["surface"]);
  const agentId = readOptionalPlatformId(value, "agentId") as AgentId | undefined;
  const callerId = readOptionalPlatformId(value, "callerId") as AccountId | undefined;
  const deploymentVersionId = readOptionalPlatformId(value, "deploymentVersionId") as
    | AgentDeploymentVersionId
    | undefined;
  const environmentRevisionId = readOptionalPlatformId(value, "environmentRevisionId") as
    | EnvironmentRevisionId
    | undefined;
  const executionActorId = readOptionalPlatformId(value, "executionActorId") as
    | AccountId
    | undefined;

  return {
    ...(agentId === undefined ? {} : { agentId }),
    ...(callerId === undefined ? {} : { callerId }),
    ...(deploymentVersionId === undefined ? {} : { deploymentVersionId }),
    ...(environmentRevisionId === undefined ? {} : { environmentRevisionId }),
    ...(executionActorId === undefined ? {} : { executionActorId }),
    ...(surface === null ? {} : { surface }),
  };
}

function parseRuntimeEventSurfaceContext(
  value: unknown,
): NonNullable<RuntimeEventContext["surface"]> {
  if (!isRecord(value)) {
    throw new Error("Runtime event context surface must be an object when provided.");
  }

  const type = value["type"];

  if (!isRuntimeEventSurfaceType(type)) {
    throw new Error("Runtime event context surface type is unsupported.");
  }
  const id = readOptionalString(value, "id");
  const triggerId = readOptionalString(value, "triggerId");

  return {
    ...(id === undefined ? {} : { id }),
    ...(triggerId === undefined ? {} : { triggerId }),
    type,
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

export function isRuntimeEventEnvelope(value: unknown): value is RuntimeEventEnvelope {
  try {
    parseRuntimeEventEnvelope(value);
    return true;
  } catch {
    return false;
  }
}

export function getRuntimeEventFamily(kind: RuntimeEventKind): string {
  const [domain] = kind.split(".");
  return domain ?? "diagnostics";
}

export function getRuntimeEventSource(event: RuntimeEventEnvelope): string {
  if (event.origin === "runtime") {
    return "driver";
  }

  return event.origin;
}

export function getRuntimeEventParticipantVisibility(
  event: RuntimeEventEnvelope,
): "all_consumers" | "owner_debug" {
  return event.visibility === "public" || event.visibility === "participant"
    ? "all_consumers"
    : "owner_debug";
}
