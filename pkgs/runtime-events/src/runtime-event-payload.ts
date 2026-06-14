import type { DriverInstanceId, SessionId, SessionRunId } from "@mosoo/id";

import type { RuntimeEventEnvelope, RuntimeEventKind } from "./runtime-event";

export type RuntimeEventRecord = Record<string, unknown>;
export type RuntimeEventToolStatus = "completed" | "failed" | "running";
export type RuntimeEventMessageRole = "agent" | "user";
export type RuntimeRunLifecycleStatus = "IDLE" | "RESCHEDULING" | "RUNNING" | "TERMINATED";
export type RuntimeRunStatus =
  | "booting"
  | "cancelled"
  | "completed"
  | "expired"
  | "failed"
  | "idle"
  | "queued"
  | "running"
  | "waiting_input";
export type RuntimeTimingPath = "cold" | "prewarm" | "unknown" | "warm";
export type RuntimeTimingSource = "api" | "driver";
export type RuntimeTimingStage =
  | "context_hydration"
  | "driver_backend"
  | "driver_turn"
  | "prepare_run"
  | "prewarm";

export interface RuntimeEventFileChange {
  readonly change: "delete" | "upsert";
  readonly metadata?: RuntimeEventRecord;
  readonly path: string;
}

export interface RuntimeEventPermissionRequest {
  readonly driverInstanceId: DriverInstanceId;
  readonly rawInput: string | null;
  readonly requestId: string;
  readonly runId: SessionRunId;
  readonly title: string;
  readonly toolCallId: string | null;
  readonly toolKind: string | null;
}

export interface RuntimeEventToolCallUpdate {
  readonly content: string | null;
  readonly kind: string | null;
  readonly messageId: string | null;
  readonly parentMessageId: string | null;
  readonly rawInput: string | null;
  readonly rawOutput: string | null;
  readonly status: RuntimeEventToolStatus;
  readonly title: string | null;
  readonly toolCallId: string;
}

export interface RuntimeRunError {
  readonly code: string;
  readonly details: Record<string, string | number | boolean | null>;
  readonly message: string;
  readonly retryable: boolean;
}

export interface RuntimeRunView {
  readonly completedAt: string | null;
  readonly error: RuntimeRunError | null;
  readonly id: SessionRunId | null;
  readonly startedAt: string | null;
  readonly status: RuntimeRunStatus;
  readonly traceId: string | null;
}

export interface RuntimeRunPayload {
  readonly lifecycle: RuntimeRunLifecycleStatus | null;
  readonly run: RuntimeRunView | null;
}

export interface RuntimeTimingPhase {
  readonly durationMs: number;
  readonly name: string;
}

export interface RuntimeTimingPayload {
  readonly completedAtMs: number;
  readonly path: RuntimeTimingPath;
  readonly phases: readonly RuntimeTimingPhase[];
  readonly runId: SessionRunId | null;
  readonly sessionId: SessionId;
  readonly source: RuntimeTimingSource;
  readonly stage: RuntimeTimingStage;
  readonly startedAtMs: number;
  readonly totalMs: number;
  readonly traceId: string | null;
}

export interface RuntimeEventPayloadAdmissionContext {
  readonly driverInstanceId?: DriverInstanceId | undefined;
  readonly kind: RuntimeEventKind;
  readonly runId?: SessionRunId | undefined;
  readonly runtimeId?: string | undefined;
  readonly sessionId: SessionId;
  readonly traceId?: string | undefined;
}

const runtimeTimingPaths = new Set<string>(["cold", "prewarm", "unknown", "warm"]);
const runtimeTimingSources = new Set<string>(["api", "driver"]);
const runtimeTimingStages = new Set<string>([
  "context_hydration",
  "driver_backend",
  "driver_turn",
  "prepare_run",
  "prewarm",
]);
const fileChangeKinds = new Set<string>(["delete", "upsert"]);
const messageRoles = new Set<string>(["agent", "user"]);
const runLifecycleStatuses = new Set<string>(["IDLE", "RESCHEDULING", "RUNNING", "TERMINATED"]);
const runStatuses = new Set<string>([
  "booting",
  "cancelled",
  "completed",
  "expired",
  "failed",
  "idle",
  "queued",
  "running",
  "waiting_input",
]);
const toolStatuses = new Set<string>(["completed", "failed", "running"]);
const payloadIdentityFields = new Set<string>([
  "occurredAt",
  "receivedAt",
  "runId",
  "runtimeId",
  "sessionId",
  "traceId",
]);

export function isRuntimeEventRecord(value: unknown): value is RuntimeEventRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function omitRuntimeEventPayloadIdentity(payload: RuntimeEventRecord): RuntimeEventRecord {
  const result: RuntimeEventRecord = {};

  for (const [key, value] of Object.entries(payload)) {
    if (!payloadIdentityFields.has(key)) {
      result[key] = value;
    }
  }

  return result;
}

export function admitRuntimeEventPayload(
  context: RuntimeEventPayloadAdmissionContext,
  payload: unknown,
): unknown {
  const kind = context.kind;

  switch (kind) {
    case "diagnostic.reported": {
      const record = requireRuntimeEventPayloadRecord(kind, payload);
      requireOptionalString(record, "code", kind);
      requireOptionalString(record, "message", kind);
      requireOptionalString(record, "severity", kind);
      return omitRuntimeEventPayloadIdentity(record);
    }
    case "file.change.updated":
    case "file.changed": {
      const changes = readStrictRuntimeEventFileChanges(kind, payload);

      if (changes.length === 0) {
        throw new Error(`Runtime event ${kind} payload must include at least one file change.`);
      }
      return omitRuntimeEventPayloadIdentity(requireRuntimeEventPayloadRecord(kind, payload));
    }
    case "message.added":
    case "message.completed":
    case "message.started":
    case "thought.completed":
    case "thought.started": {
      const record = requireRuntimeEventPayloadRecord(kind, payload);
      requireOptionalMessageRole(record, kind);
      requireOptionalString(record, "messageId", kind);
      requireOptionalString(record, "thoughtId", kind);

      if (kind === "message.added" && !hasRuntimeEventTextContent(record)) {
        throw new Error("Runtime event message.added payload must include text content.");
      }

      return omitRuntimeEventPayloadIdentity(record);
    }
    case "message.delta": {
      const record = requireRuntimeEventPayloadRecord(kind, payload);

      if (!hasRuntimeEventTextContent(record)) {
        throw new Error("Runtime event message.delta payload must include text content.");
      }
      requireOptionalMessageRole(record, kind);
      requireOptionalString(record, "messageId", kind);
      return omitRuntimeEventPayloadIdentity(record);
    }
    case "thought.delta": {
      const record = requireRuntimeEventPayloadRecord(kind, payload);

      if (!hasRuntimeEventTextContent(record)) {
        throw new Error("Runtime event thought.delta payload must include text content.");
      }
      requireOptionalString(record, "thoughtId", kind);
      return omitRuntimeEventPayloadIdentity(record);
    }
    case "tool.call.updated": {
      const record = requireRuntimeEventPayloadRecord(kind, payload);
      readStrictRuntimeToolCallUpdatePayload(record);
      return omitRuntimeEventPayloadIdentity(record);
    }
    case "permission.requested": {
      return readStrictRuntimePermissionRequestPayload(context, payload);
    }
    case "permission.resolved": {
      const record = requireRuntimeEventPayloadRecord(kind, payload);
      requireRuntimeEventString(record, "requestId", kind);
      requireRuntimeEventString(record, "outcome", kind);
      requireOptionalString(record, "optionId", kind);
      requireOptionalString(record, "optionKind", kind);

      if (
        "permissionRequests" in record &&
        record["permissionRequests"] !== undefined &&
        !Array.isArray(record["permissionRequests"])
      ) {
        throw new Error(
          "Runtime event permission.resolved payload permissionRequests must be an array.",
        );
      }

      return omitRuntimeEventPayloadIdentity(record);
    }
    case "run.cancel.requested":
    case "run.cancelled":
    case "run.completed":
    case "run.dispatched":
    case "run.failed":
    case "run.queued":
    case "run.started":
    case "run.steered":
    case "run.waiting": {
      return readStrictRuntimeRunPayload(context, payload);
    }
    case "runtime.config.updated":
    case "runtime.driver.updated":
    case "runtime.provisioning.updated":
    case "runtime.sandbox.updated":
    case "runtime.transport.updated": {
      const record = requireRuntimeEventPayloadRecord(kind, payload);
      requireRuntimeEventString(record, "status", kind);

      if (kind === "runtime.transport.updated") {
        requireRuntimeEventString(record, "channel", kind);
      } else {
        requireRuntimeEventString(record, "phase", kind);
      }

      return omitRuntimeEventPayloadIdentity(record);
    }
    case "runtime.timing.recorded": {
      return readStrictRuntimeTimingPayload(context, payload);
    }
    default: {
      return isRuntimeEventRecord(payload) ? omitRuntimeEventPayloadIdentity(payload) : payload;
    }
  }
}

export function readRuntimeEventPayload(event: RuntimeEventEnvelope): RuntimeEventRecord {
  return isRuntimeEventRecord(event.payload) ? event.payload : {};
}

export function readRuntimeTimingPayload(event: RuntimeEventEnvelope): RuntimeTimingPayload {
  if (event.kind !== "runtime.timing.recorded") {
    throw new Error("Runtime timing payload can only be read from runtime.timing.recorded.");
  }

  return readStrictRuntimeTimingPayload(
    {
      ...(event.driverInstanceId === undefined ? {} : { driverInstanceId: event.driverInstanceId }),
      kind: event.kind,
      ...(event.runId === undefined ? {} : { runId: event.runId }),
      ...(event.runtimeId === undefined ? {} : { runtimeId: event.runtimeId }),
      sessionId: event.sessionId,
      ...(event.traceId === undefined ? {} : { traceId: event.traceId }),
    },
    event.payload,
  );
}

export function readRuntimeEventString(value: unknown, field: string): string | null {
  if (!isRuntimeEventRecord(value)) {
    return null;
  }

  const entry = value[field];
  return typeof entry === "string" && entry.length > 0 ? entry : null;
}

export function readRuntimeEventNullableString(
  value: RuntimeEventRecord,
  field: string,
): string | null | undefined {
  const entry = value[field];

  if (entry === null) {
    return null;
  }

  return typeof entry === "string" ? entry : undefined;
}

export function readRuntimeEventNumber(value: unknown, field: string): number | null {
  if (!isRuntimeEventRecord(value)) {
    return null;
  }

  const entry = value[field];
  return typeof entry === "number" && Number.isFinite(entry) ? entry : null;
}

export function readRuntimeEventPrimitiveRecord(
  value: unknown,
): Record<string, string | number | boolean | null> {
  if (!isRuntimeEventRecord(value)) {
    return {};
  }

  const result: Record<string, string | number | boolean | null> = {};

  for (const [key, entry] of Object.entries(value)) {
    if (
      entry === null ||
      typeof entry === "string" ||
      typeof entry === "number" ||
      typeof entry === "boolean"
    ) {
      result[key] = entry;
    }
  }

  return result;
}

export function readRuntimeEventToolStatus(status: unknown): RuntimeEventToolStatus {
  return status === "failed" ? "failed" : status === "completed" ? "completed" : "running";
}

export function readRuntimeEventToolStatusFromEvent(
  event: RuntimeEventEnvelope,
): RuntimeEventToolStatus {
  return readRuntimeEventToolStatus(readRuntimeEventPayload(event)["status"]);
}

export function readRuntimeEventToolCallUpdate(
  event: RuntimeEventEnvelope,
): RuntimeEventToolCallUpdate {
  if (event.kind !== "tool.call.updated") {
    throw new Error("Runtime tool call update payload can only be read from tool.call.updated.");
  }

  return readStrictRuntimeToolCallUpdatePayload(event.payload);
}

export function readRuntimeRunPayload(event: RuntimeEventEnvelope): RuntimeRunPayload {
  if (!isRuntimeRunPayloadKind(event.kind)) {
    throw new Error("Runtime run payload can only be read from run events.");
  }

  const payload = readStrictRuntimeRunPayload(
    {
      ...(event.driverInstanceId === undefined ? {} : { driverInstanceId: event.driverInstanceId }),
      kind: event.kind,
      ...(event.runId === undefined ? {} : { runId: event.runId }),
      ...(event.runtimeId === undefined ? {} : { runtimeId: event.runtimeId }),
      sessionId: event.sessionId,
      ...(event.traceId === undefined ? {} : { traceId: event.traceId }),
    },
    event.payload,
  );
  const run = readAdmittedRuntimeRunView(payload["run"]) ?? appRuntimeRunView(event, payload);

  return {
    lifecycle: readRuntimeRunLifecycleStatus(payload["lifecycle"]),
    run,
  };
}

export function toRuntimeRunLifecycleStatus(status: RuntimeRunStatus): RuntimeRunLifecycleStatus {
  switch (status) {
    case "booting":
    case "queued":
    case "running":
    case "waiting_input": {
      return "RUNNING";
    }
    case "cancelled":
    case "completed":
    case "expired":
    case "failed":
    case "idle": {
      return "IDLE";
    }
  }
}

export function readRuntimeEventMessageKey(event: RuntimeEventEnvelope): string | null {
  const payload = readRuntimeEventPayload(event);

  switch (event.kind) {
    case "message.added":
    case "message.completed":
    case "message.delta":
    case "message.started": {
      return readRuntimeEventString(payload, "messageId") ?? event.id;
    }
    case "thought.completed":
    case "thought.delta":
    case "thought.started": {
      return readRuntimeEventString(payload, "thoughtId") ?? event.id;
    }
    default: {
      return null;
    }
  }
}

export function readRuntimeEventMessageRole(event: RuntimeEventEnvelope): RuntimeEventMessageRole {
  return readRuntimeEventString(readRuntimeEventPayload(event), "role") === "user"
    ? "user"
    : "agent";
}

function readRuntimeEventTextBlocks(value: unknown): string | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const text = value
    .flatMap((entry) => {
      if (!isRuntimeEventRecord(entry)) {
        return [];
      }

      const blockText = readRuntimeEventString(entry, "text");
      return blockText === null ? [] : [blockText];
    })
    .join("");

  return text.length > 0 ? text : null;
}

function hasRuntimeEventTextContent(payload: RuntimeEventRecord): boolean {
  return (
    readRuntimeEventString(payload, "contentDelta") !== null ||
    readRuntimeEventString(payload, "content") !== null ||
    readRuntimeEventTextBlocks(payload["content"]) !== null
  );
}

export function readRuntimeEventMessageContent(event: RuntimeEventEnvelope): string | null {
  const payload = readRuntimeEventPayload(event);

  return (
    readRuntimeEventString(payload, "content") ?? readRuntimeEventTextBlocks(payload["content"])
  );
}

export function readRuntimeEventMessageDelta(event: RuntimeEventEnvelope): string {
  const payload = readRuntimeEventPayload(event);

  return (
    readRuntimeEventString(payload, "contentDelta") ?? readRuntimeEventMessageContent(event) ?? ""
  );
}

export function readRuntimeEventToolCallId(event: RuntimeEventEnvelope): string | null {
  if (event.kind !== "tool.call.updated") {
    return null;
  }

  return readRuntimeEventString(readRuntimeEventPayload(event), "toolCallId") ?? event.id;
}

export function readRuntimeEventToolName(event: RuntimeEventEnvelope): string | null {
  const payload = readRuntimeEventPayload(event);

  return readRuntimeEventString(payload, "title") ?? readRuntimeEventString(payload, "kind");
}

export function readRuntimeEventToolResult(event: RuntimeEventEnvelope): string | null {
  const payload = readRuntimeEventPayload(event);

  return readRuntimeEventString(payload, "rawOutput") ?? readRuntimeEventString(payload, "content");
}

function readStrictRuntimeToolCallUpdatePayload(payload: unknown): RuntimeEventToolCallUpdate {
  const kind = "tool.call.updated";
  const record = requireRuntimeEventPayloadRecord(kind, payload);
  const status = requireEnumValue(record, "status", toolStatuses, kind);

  return {
    content: readOptionalRuntimeEventContentString(record, "content", kind),
    kind: readOptionalRuntimeEventString(record, "kind", kind),
    messageId: readOptionalRuntimeEventString(record, "messageId", kind),
    parentMessageId: readOptionalRuntimeEventString(record, "parentMessageId", kind),
    rawInput: readOptionalRuntimeEventString(record, "rawInput", kind),
    rawOutput: readOptionalRuntimeEventString(record, "rawOutput", kind),
    status: status as RuntimeEventToolStatus,
    title: readOptionalRuntimeEventNullableString(record, "title", kind),
    toolCallId: requireRuntimeEventString(record, "toolCallId", kind),
  };
}

export function readRuntimeEventFileChangePath(payload: RuntimeEventRecord): string | null {
  const directPath = readRuntimeEventString(payload, "path");

  if (directPath !== null) {
    return directPath;
  }

  const changes = payload["changes"];

  if (!Array.isArray(changes)) {
    return null;
  }

  for (const change of changes) {
    if (!isRuntimeEventRecord(change)) {
      continue;
    }

    const path = readRuntimeEventString(change, "path");

    if (path !== null) {
      return path;
    }
  }

  return null;
}

export function readRuntimeEventFileChanges(event: RuntimeEventEnvelope): RuntimeEventFileChange[] {
  const payload = readRuntimeEventPayload(event);
  const changes = Array.isArray(payload["changes"]) ? payload["changes"] : [payload];

  return changes.flatMap((change): RuntimeEventFileChange[] => {
    if (!isRuntimeEventRecord(change)) {
      return [];
    }

    const path = readRuntimeEventString(change, "path");

    if (path === null) {
      return [];
    }

    const changeKind = change["change"];

    if (changeKind !== "delete" && changeKind !== "upsert") {
      return [];
    }

    return [
      {
        change: changeKind,
        ...(isRuntimeEventRecord(change["metadata"]) ? { metadata: change["metadata"] } : {}),
        path,
      },
    ];
  });
}

function readStrictRuntimeEventFileChanges(
  kind: RuntimeEventKind,
  payload: unknown,
): RuntimeEventFileChange[] {
  const record = requireRuntimeEventPayloadRecord(kind, payload);
  const changes = Array.isArray(record["changes"]) ? record["changes"] : [record];

  return changes.map((change) => {
    const changeRecord = requireRuntimeEventPayloadRecord(kind, change, "file change");
    const path = requireRuntimeEventString(changeRecord, "path", kind);
    const changeKind = changeRecord["change"];

    if (typeof changeKind !== "string" || !fileChangeKinds.has(changeKind)) {
      throw new Error(`Runtime event ${kind} file change must be delete or upsert.`);
    }

    const metadata = changeRecord["metadata"];

    if (isRuntimeEventRecord(metadata)) {
      return {
        change: changeKind as RuntimeEventFileChange["change"],
        metadata,
        path,
      };
    }

    return {
      change: changeKind as RuntimeEventFileChange["change"],
      path,
    };
  });
}

export function readRuntimeEventPermissionRequest(
  event: RuntimeEventEnvelope,
): RuntimeEventPermissionRequest | null {
  if (event.kind !== "permission.requested") {
    return null;
  }

  const payload = readStrictRuntimePermissionRequestPayload(
    {
      ...(event.driverInstanceId === undefined ? {} : { driverInstanceId: event.driverInstanceId }),
      kind: event.kind,
      ...(event.runId === undefined ? {} : { runId: event.runId }),
      sessionId: event.sessionId,
    },
    event.payload,
  );
  const toolCall = isRuntimeEventRecord(payload["toolCall"]) ? payload["toolCall"] : {};
  const driverInstanceId = event.driverInstanceId;

  if (driverInstanceId === undefined) {
    throw new Error("Runtime event permission.requested requires a driver instance ID.");
  }
  if (event.runId === undefined) {
    throw new Error("Runtime event permission.requested requires a run ID.");
  }

  return {
    driverInstanceId,
    rawInput: readRuntimeEventString(payload, "details"),
    requestId: requireRuntimeEventString(payload, "requestId", event.kind),
    runId: event.runId,
    title: requireRuntimeEventString(payload, "title", event.kind),
    toolCallId:
      readRuntimeEventString(payload, "targetItemId") ??
      readRuntimeEventString(toolCall, "toolCallId"),
    toolKind: readRuntimeEventString(toolCall, "kind"),
  };
}

function readStrictRuntimePermissionRequestPayload(
  context: RuntimeEventPayloadAdmissionContext,
  payload: unknown,
): RuntimeEventRecord {
  const kind = "permission.requested";

  if (context.driverInstanceId === undefined) {
    throw new Error("Runtime event permission.requested requires a driver instance ID.");
  }
  if (context.runId === undefined) {
    throw new Error("Runtime event permission.requested requires a run ID.");
  }

  const record = requireRuntimeEventPayloadRecord(kind, payload);
  requireRuntimeEventString(record, "requestId", kind);
  requireRuntimeEventString(record, "title", kind);
  requireOptionalNullableString(record, "details", kind);
  requireOptionalNullableString(record, "targetItemId", kind);

  if ("options" in record && record["options"] !== undefined && !Array.isArray(record["options"])) {
    throw new Error("Runtime event permission.requested payload options must be an array.");
  }

  if ("toolCall" in record && record["toolCall"] !== undefined && record["toolCall"] !== null) {
    const toolCall = requireRuntimeEventPayloadRecord(kind, record["toolCall"], "toolCall");
    requireOptionalString(toolCall, "kind", kind);
    requireOptionalString(toolCall, "toolCallId", kind);
  }

  return omitRuntimeEventPayloadIdentity(record);
}

function readStrictRuntimeTimingPayload(
  context: RuntimeEventPayloadAdmissionContext,
  payload: unknown,
): RuntimeTimingPayload {
  const record = requireRuntimeEventPayloadRecord("runtime.timing.recorded", payload);
  const completedAtMs = requireNonNegativeNumber(record, "completedAtMs");
  const path = requireEnumValue(record, "path", runtimeTimingPaths, "runtime.timing.recorded");
  const source = requireEnumValue(
    record,
    "source",
    runtimeTimingSources,
    "runtime.timing.recorded",
  );
  const stage = requireEnumValue(record, "stage", runtimeTimingStages, "runtime.timing.recorded");
  const startedAtMs = requireNonNegativeNumber(record, "startedAtMs");
  const totalMs = requireNonNegativeNumber(record, "totalMs");
  const phases = readStrictRuntimeTimingPhases(record["phases"]);

  if (completedAtMs < startedAtMs) {
    throw new Error(
      "Runtime event runtime.timing.recorded payload completedAtMs must not precede startedAtMs.",
    );
  }

  return {
    completedAtMs,
    path: path as RuntimeTimingPath,
    phases,
    runId: context.runId ?? null,
    sessionId: context.sessionId,
    source: source as RuntimeTimingSource,
    stage: stage as RuntimeTimingStage,
    startedAtMs,
    totalMs,
    traceId: context.traceId ?? null,
  };
}

function readStrictRuntimeTimingPhases(value: unknown): RuntimeTimingPhase[] {
  if (!Array.isArray(value)) {
    throw new Error("Runtime event runtime.timing.recorded phases must be an array.");
  }

  return value.map((phase) => {
    const record = requireRuntimeEventPayloadRecord("runtime.timing.recorded", phase, "phase");

    return {
      durationMs: requireNonNegativeNumber(record, "durationMs"),
      name: requireRuntimeEventString(record, "name", "runtime.timing.recorded"),
    };
  });
}

function readStrictRuntimeRunPayload(
  context: RuntimeEventPayloadAdmissionContext,
  payload: unknown,
): RuntimeEventRecord {
  const kind = context.kind;
  const record = requireRuntimeEventPayloadRecord(kind, payload);

  if (context.runId === undefined) {
    throw new Error(`Runtime event ${kind} requires a run ID.`);
  }

  requireOptionalEnumValue(record, "lifecycle", runLifecycleStatuses, kind);
  requireOptionalEnumValue(record, "status", runStatuses, kind);
  requireOptionalString(record, "inputSummary", kind);
  requireOptionalString(record, "reason", kind);
  requireOptionalString(record, "requestedBy", kind);
  requireOptionalString(record, "stopReason", kind);
  requireOptionalString(record, "targetRunId", kind);
  requireOptionalString(record, "userMessageId", kind);
  requireOptionalStringArray(record, "inputItemIds", kind);
  requireOptionalTimestampString(record, "completedAt", kind);
  requireOptionalTimestampString(record, "startedAt", kind);

  const admitted = omitRuntimeEventPayloadIdentity(record);

  if ("run" in record && record["run"] !== undefined) {
    admitted["run"] = readStrictRuntimeRunView(context, record["run"]);
  }

  if ("error" in record && record["error"] !== undefined && record["error"] !== null) {
    admitted["error"] = readStrictRuntimeRunError(kind, record["error"], "error");
  }

  if (kind === "run.started" && !hasRuntimeRunStartedAt(admitted)) {
    throw new Error("Runtime event run.started payload must include a start time.");
  }

  if (kind === "run.failed" && !isRuntimeEventRecord(admitted["error"])) {
    throw new Error("Runtime event run.failed payload must include an error.");
  }

  return admitted;
}

function hasRuntimeRunStartedAt(record: RuntimeEventRecord): boolean {
  if (readRuntimeEventString(record, "startedAt") !== null) {
    return true;
  }

  const run = record["run"];
  return isRuntimeEventRecord(run) && readRuntimeEventString(run, "startedAt") !== null;
}

function readStrictRuntimeRunView(
  context: RuntimeEventPayloadAdmissionContext,
  value: unknown,
): RuntimeRunView {
  const kind = context.kind;
  const record = requireRuntimeEventPayloadRecord(kind, value, "run");
  const status = requireEnumValue(record, "status", runStatuses, kind);

  if (!isRuntimeRunStatusAllowedForKind(kind, status)) {
    throw new Error(`Runtime event ${kind} payload run.status is inconsistent.`);
  }

  return {
    completedAt: requireNullableTimestampString(record, "completedAt", kind, "run.completedAt"),
    error:
      record["error"] === null
        ? null
        : readStrictRuntimeRunError(kind, record["error"], "run.error"),
    id: context.runId ?? null,
    startedAt: requireNullableTimestampString(record, "startedAt", kind, "run.startedAt"),
    status: status as RuntimeRunStatus,
    traceId: context.traceId ?? null,
  };
}

function isRuntimeRunStatusAllowedForKind(kind: RuntimeEventKind, status: string): boolean {
  switch (kind) {
    case "run.cancel.requested":
    case "run.dispatched":
    case "run.started":
    case "run.steered":
    case "run.waiting": {
      return status === "booting" || status === "running" || status === "waiting_input";
    }
    case "run.cancelled": {
      return status === "cancelled" || status === "expired";
    }
    case "run.completed": {
      return status === "completed";
    }
    case "run.failed": {
      return status === "failed";
    }
    case "run.queued": {
      return status === "queued";
    }
    default: {
      return false;
    }
  }
}

function readStrictRuntimeRunError(
  kind: RuntimeEventKind,
  value: unknown,
  label: string,
): RuntimeRunError {
  const record = requireRuntimeEventPayloadRecord(kind, value, label);
  const details = record["details"];
  const recoverable = record["recoverable"];
  const retryable = record["retryable"];

  if (details !== undefined && !isRuntimeEventRecord(details)) {
    throw new Error(`Runtime event ${kind} payload ${label}.details must be an object.`);
  }

  if (recoverable !== undefined && typeof recoverable !== "boolean") {
    throw new Error(`Runtime event ${kind} payload ${label}.recoverable must be a boolean.`);
  }

  if (retryable !== undefined && typeof retryable !== "boolean") {
    throw new Error(`Runtime event ${kind} payload ${label}.retryable must be a boolean.`);
  }

  return {
    code: requireRuntimeEventString(record, "code", kind),
    details: readStrictRuntimeEventPrimitiveRecord(kind, details, `${label}.details`),
    message: requireRuntimeEventString(record, "message", kind),
    retryable: retryable === true || recoverable === true,
  };
}

function isRuntimeRunPayloadKind(kind: RuntimeEventKind): boolean {
  switch (kind) {
    case "run.cancel.requested":
    case "run.cancelled":
    case "run.completed":
    case "run.dispatched":
    case "run.failed":
    case "run.queued":
    case "run.started":
    case "run.steered":
    case "run.waiting": {
      return true;
    }
    default: {
      return false;
    }
  }
}

function readRuntimeRunLifecycleStatus(value: unknown): RuntimeRunLifecycleStatus | null {
  switch (value) {
    case "IDLE":
    case "RESCHEDULING":
    case "RUNNING":
    case "TERMINATED": {
      return value;
    }
    default: {
      return null;
    }
  }
}

function readRuntimeRunStatus(value: unknown): RuntimeRunStatus | null {
  switch (value) {
    case "booting":
    case "cancelled":
    case "completed":
    case "expired":
    case "failed":
    case "idle":
    case "queued":
    case "running":
    case "waiting_input": {
      return value;
    }
    default: {
      return null;
    }
  }
}

function readRuntimeRunErrorRecord(value: unknown): RuntimeRunError | null {
  if (!isRuntimeEventRecord(value)) {
    return null;
  }

  const code = readRuntimeEventString(value, "code");
  const message = readRuntimeEventString(value, "message");

  if (code === null || message === null) {
    return null;
  }

  return {
    code,
    details: readRuntimeEventPrimitiveRecord(value["details"]),
    message,
    retryable: value["retryable"] === true,
  };
}

function readAdmittedRuntimeRunView(value: unknown): RuntimeRunView | null {
  if (!isRuntimeEventRecord(value)) {
    return null;
  }

  const status = readRuntimeRunStatus(value["status"]);
  const completedAt = readRuntimeEventNullableString(value, "completedAt");
  const id = readRuntimeEventNullableString(value, "id");
  const startedAt = readRuntimeEventNullableString(value, "startedAt");
  const traceId = readRuntimeEventNullableString(value, "traceId");

  if (
    status === null ||
    completedAt === undefined ||
    id === undefined ||
    startedAt === undefined ||
    traceId === undefined
  ) {
    return null;
  }

  return {
    completedAt,
    error: readRuntimeRunErrorRecord(value["error"]),
    id: id as SessionRunId | null,
    startedAt,
    status,
    traceId,
  };
}

function appRuntimeRunStatus(kind: RuntimeEventKind): RuntimeRunStatus | null {
  switch (kind) {
    case "run.started": {
      return "running";
    }
    case "run.completed": {
      return "completed";
    }
    case "run.cancelled": {
      return "cancelled";
    }
    case "run.failed": {
      return "failed";
    }
    default: {
      return null;
    }
  }
}

function isTerminalRuntimeRunStatus(status: RuntimeRunStatus): boolean {
  return (
    status === "cancelled" || status === "completed" || status === "expired" || status === "failed"
  );
}

function appRuntimeRunView(
  event: RuntimeEventEnvelope,
  payload: RuntimeEventRecord,
): RuntimeRunView | null {
  const status = appRuntimeRunStatus(event.kind);

  if (status === null || event.runId === undefined) {
    return null;
  }

  const completedAt = isTerminalRuntimeRunStatus(status)
    ? (readRuntimeEventString(payload, "completedAt") ?? event.occurredAt)
    : null;
  const startedAt =
    readRuntimeEventString(payload, "startedAt") ??
    (status === "running" ? event.occurredAt : null);

  return {
    completedAt,
    error: status === "failed" ? readRuntimeRunErrorRecord(payload["error"]) : null,
    id: event.runId,
    startedAt,
    status,
    traceId: event.traceId ?? null,
  };
}

function readStrictRuntimeEventPrimitiveRecord(
  kind: RuntimeEventKind,
  value: unknown,
  label: string,
): Record<string, string | number | boolean | null> {
  if (value === undefined) {
    return {};
  }

  const record = requireRuntimeEventPayloadRecord(kind, value, label);
  const result: Record<string, string | number | boolean | null> = {};

  for (const [key, entry] of Object.entries(record)) {
    if (
      entry === null ||
      typeof entry === "string" ||
      typeof entry === "number" ||
      typeof entry === "boolean"
    ) {
      result[key] = entry;
      continue;
    }

    throw new Error(`Runtime event ${kind} payload ${label}.${key} must be primitive.`);
  }

  return result;
}

function requireRuntimeEventPayloadRecord(
  kind: RuntimeEventKind,
  payload: unknown,
  label = "payload",
): RuntimeEventRecord {
  if (!isRuntimeEventRecord(payload)) {
    throw new Error(`Runtime event ${kind} ${label} must be an object.`);
  }

  return payload;
}

function requireRuntimeEventString(
  record: RuntimeEventRecord,
  field: string,
  kind: RuntimeEventKind,
): string {
  const value = readRuntimeEventString(record, field);

  if (value === null) {
    throw new Error(`Runtime event ${kind} payload ${field} must be a non-empty string.`);
  }

  return value;
}

function requireOptionalString(
  record: RuntimeEventRecord,
  field: string,
  kind: RuntimeEventKind,
): void {
  if (!(field in record) || record[field] === undefined || record[field] === null) {
    return;
  }

  requireRuntimeEventString(record, field, kind);
}

function readOptionalRuntimeEventString(
  record: RuntimeEventRecord,
  field: string,
  kind: RuntimeEventKind,
): string | null {
  if (!(field in record) || record[field] === undefined || record[field] === null) {
    return null;
  }

  return requireRuntimeEventString(record, field, kind);
}

function requireOptionalNullableString(
  record: RuntimeEventRecord,
  field: string,
  kind: RuntimeEventKind,
): void {
  const value = record[field];

  if (value === null || value === undefined) {
    return;
  }

  if (typeof value === "string") {
    return;
  }

  throw new Error(`Runtime event ${kind} payload ${field} must be a string or null.`);
}

function readOptionalRuntimeEventNullableString(
  record: RuntimeEventRecord,
  field: string,
  kind: RuntimeEventKind,
): string | null {
  requireOptionalNullableString(record, field, kind);

  const value = record[field];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readOptionalRuntimeEventContentString(
  record: RuntimeEventRecord,
  field: string,
  kind: RuntimeEventKind,
): string | null {
  const value = record[field];

  if (value === undefined) {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error(`Runtime event ${kind} payload ${field} must be a string.`);
  }

  return value.length > 0 ? value : null;
}

function requireOptionalStringArray(
  record: RuntimeEventRecord,
  field: string,
  kind: RuntimeEventKind,
): void {
  if (!(field in record) || record[field] === undefined) {
    return;
  }

  const value = record[field];

  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string" || entry.length === 0)
  ) {
    throw new Error(`Runtime event ${kind} payload ${field} must be an array of strings.`);
  }
}

function requireOptionalMessageRole(record: RuntimeEventRecord, kind: RuntimeEventKind): void {
  const role = record["role"];

  if (role === undefined || role === null) {
    return;
  }

  if (typeof role !== "string" || !messageRoles.has(role)) {
    throw new Error(`Runtime event ${kind} payload role is unsupported.`);
  }
}

function requireNonNegativeNumber(record: RuntimeEventRecord, field: string): number {
  const value = readRuntimeEventNumber(record, field);

  if (value === null || value < 0) {
    throw new Error(
      `Runtime event runtime.timing.recorded payload ${field} must be a non-negative finite number.`,
    );
  }

  return value;
}

function requireOptionalEnumValue(
  record: RuntimeEventRecord,
  field: string,
  allowedValues: ReadonlySet<string>,
  kind: RuntimeEventKind,
): void {
  if (!(field in record) || record[field] === undefined) {
    return;
  }

  requireEnumValue(record, field, allowedValues, kind);
}

function requireEnumValue(
  record: RuntimeEventRecord,
  field: string,
  allowedValues: ReadonlySet<string>,
  kind: RuntimeEventKind,
): string {
  const value = requireRuntimeEventString(record, field, kind);

  if (!allowedValues.has(value)) {
    throw new Error(`Runtime event ${kind} payload ${field} is unsupported.`);
  }

  return value;
}

function assertRuntimeEventPayloadTimestamp(
  value: string,
  kind: RuntimeEventKind,
  label: string,
): void {
  if (!Number.isFinite(Date.parse(value))) {
    throw new Error(`Runtime event ${kind} payload ${label} must be a valid timestamp.`);
  }
}

function requireOptionalTimestampString(
  record: RuntimeEventRecord,
  field: string,
  kind: RuntimeEventKind,
): void {
  if (!(field in record) || record[field] === undefined) {
    return;
  }

  const value = requireRuntimeEventString(record, field, kind);
  assertRuntimeEventPayloadTimestamp(value, kind, field);
}

function requireNullableTimestampString(
  record: RuntimeEventRecord,
  field: string,
  kind: RuntimeEventKind,
  label: string,
): string | null {
  const value = readRuntimeEventNullableString(record, field);

  if (value === undefined) {
    throw new Error(`Runtime event ${kind} payload ${label} must be a string or null.`);
  }

  if (value !== null) {
    assertRuntimeEventPayloadTimestamp(value, kind, label);
  }

  return value;
}
