import { parseNullableSessionUsageSummary } from "@mosoo/ag-ui-session";
import type { RuntimeTimingPayload as DriverRuntimeTimingPayload } from "@mosoo/agent-driver/runtime-events";
import type { DriverInstanceId, SessionId, SessionRunId } from "@mosoo/id";

import type { RuntimeEventEnvelope, RuntimeEventKind } from "./runtime-event";

export type RuntimeEventRecord = Record<string, unknown>;
export type RuntimeEventToolStatus = "cancelled" | "completed" | "failed" | "running";
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
  readonly rawInputDelta: string | null;
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

export function isRuntimeEventRecord(value: unknown): value is RuntimeEventRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function projectRuntimeEventPayload(event: RuntimeEventEnvelope): unknown {
  if (event.kind === "usage.updated") {
    return parseNullableSessionUsageSummary(event.payload);
  }
  if (event.kind === "permission.resolved") {
    const requests = readRuntimeEventPayload(event)["permissionRequests"];
    if (requests !== undefined && !Array.isArray(requests)) {
      throw new Error(
        "Runtime event permission.resolved payload permissionRequests must be an array.",
      );
    }
  }
  if (event.kind === "runtime.timing.recorded") {
    const payload = event.payload as DriverRuntimeTimingPayload;
    const completedAtMs = Date.parse(payload.completedAt);
    const startedAtMs = Date.parse(payload.startedAt);
    if (completedAtMs < 0 || startedAtMs < 0) {
      throw new Error("Runtime event timing timestamps must not precede the Unix epoch.");
    }
    return {
      completedAtMs,
      path: payload.path,
      phases: payload.phases,
      runId: event.runId ?? null,
      sessionId: event.sessionId,
      source: payload.source,
      stage: payload.stage,
      startedAtMs,
      totalMs: payload.totalMs,
      traceId: event.traceId ?? null,
    } satisfies RuntimeTimingPayload;
  }
  return event.payload;
}

export function readRuntimeEventPayload(event: RuntimeEventEnvelope): RuntimeEventRecord {
  return isRuntimeEventRecord(event.payload) ? event.payload : {};
}

export function readRuntimeTimingPayload(event: RuntimeEventEnvelope): RuntimeTimingPayload {
  return event.payload as RuntimeTimingPayload;
}

export function readRuntimeEventString(value: unknown, field: string): string | null {
  if (!isRuntimeEventRecord(value)) {
    return null;
  }

  const entry = value[field];
  return typeof entry === "string" && entry.length > 0 ? entry : null;
}

export function readRuntimeEventToolStatus(status: unknown): RuntimeEventToolStatus {
  return status === "cancelled" || status === "completed" || status === "failed"
    ? status
    : "running";
}

export function readRuntimeEventToolStatusFromEvent(
  event: RuntimeEventEnvelope,
): RuntimeEventToolStatus {
  return readRuntimeEventToolStatus(readRuntimeEventPayload(event)["status"]);
}

export function readRuntimeEventToolCallUpdate(
  event: RuntimeEventEnvelope,
): RuntimeEventToolCallUpdate {
  const payload = readRuntimeEventPayload(event);

  return {
    content: readRuntimeEventString(payload, "content"),
    kind: readRuntimeEventString(payload, "kind"),
    messageId: readRuntimeEventString(payload, "messageId"),
    parentMessageId: readRuntimeEventString(payload, "parentMessageId"),
    rawInput: readRuntimeEventString(payload, "rawInput"),
    rawInputDelta: readRuntimeEventString(payload, "rawInputDelta"),
    rawOutput: readRuntimeEventString(payload, "rawOutput"),
    status: readRuntimeEventToolStatus(payload["status"]),
    title: readRuntimeEventString(payload, "title"),
    toolCallId: payload["toolCallId"] as string,
  };
}

export function readRuntimeRunPayload(event: RuntimeEventEnvelope): RuntimeRunPayload {
  const payload = readRuntimeEventPayload(event);

  return {
    lifecycle: (payload["lifecycle"] as RuntimeRunLifecycleStatus | undefined) ?? null,
    run: (payload["run"] as RuntimeRunView | undefined) ?? projectRuntimeRunView(event, payload),
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
    case "message.cancelled":
    case "message.failed":
    case "message.completed":
    case "message.delta":
    case "message.started": {
      return readRuntimeEventString(payload, "messageId") ?? event.id;
    }
    case "thought.cancelled":
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

export function readRuntimeEventPermissionRequest(
  event: RuntimeEventEnvelope,
): RuntimeEventPermissionRequest | null {
  if (event.kind !== "permission.requested") {
    return null;
  }

  const payload = readRuntimeEventPayload(event);
  const toolCall = isRuntimeEventRecord(payload["toolCall"]) ? payload["toolCall"] : {};

  return {
    driverInstanceId: event.driverInstanceId as DriverInstanceId,
    rawInput: readRuntimeEventString(payload, "details"),
    requestId: payload["requestId"] as string,
    runId: event.runId as SessionRunId,
    title: payload["title"] as string,
    toolCallId:
      readRuntimeEventString(payload, "targetItemId") ??
      readRuntimeEventString(toolCall, "toolCallId"),
    toolKind: readRuntimeEventString(toolCall, "kind"),
  };
}

function projectRuntimeRunStatus(kind: RuntimeEventKind): RuntimeRunStatus | null {
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

function projectRuntimeRunView(
  event: RuntimeEventEnvelope,
  payload: RuntimeEventRecord,
): RuntimeRunView | null {
  const status = projectRuntimeRunStatus(event.kind);

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
    error: status === "failed" ? ((payload["error"] as RuntimeRunError | undefined) ?? null) : null,
    id: event.runId,
    startedAt,
    status,
    traceId: event.traceId ?? null,
  };
}
