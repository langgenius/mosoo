import type { SessionRunView } from "@mosoo/ag-ui-session";
import type { RunError, SessionRunStatus, SessionRunSummary } from "@mosoo/contracts/session-run";
import type { SessionId, SessionMessageId } from "@mosoo/id";
import type { RuntimeEventEnvelope, RuntimeEventKind } from "@mosoo/runtime-events";

import { createSessionRuntimeEvent } from "../../../sessions/application/session-event-write.service";
import { toSessionLifecycleStatusForRunStatus } from "../../../sessions/domain/session-lifecycle";
import { isTerminalSessionRunStatus } from "../../domain/session-run-lifecycle.machine";

function toSessionRunView(run: SessionRunSummary): SessionRunView {
  return {
    completedAt: run.completedAt,
    error: run.error,
    id: run.id,
    startedAt: run.startedAt,
    status: run.status,
    traceId: run.traceId,
  };
}

function toPersistedTerminalEventTime(run: SessionRunSummary) {
  return isTerminalSessionRunStatus(run.status)
    ? { occurredAtMs: Date.parse(run.completedAt ?? run.updatedAt) }
    : {};
}

export function createSessionRunUpdatedEvent(
  run: SessionRunSummary,
  sessionId: SessionId,
  lifecycle = toSessionLifecycleStatusForRunStatus(run.status),
  sourceEventId?: string,
): RuntimeEventEnvelope {
  return createSessionRuntimeEvent({
    ...toPersistedTerminalEventTime(run),
    kind: toRuntimeEventKindForRunStatus(run.status),
    payload: {
      lifecycle,
      run: toSessionRunView(run),
    },
    runId: run.id,
    sessionId,
    ...(sourceEventId === undefined ? {} : { sourceEventId }),
    traceId: run.traceId,
  });
}

export function toTerminalRunEventKind(
  status: SessionRunStatus,
): "run.cancelled" | "run.completed" | "run.failed" {
  switch (status) {
    case "completed": {
      return "run.completed";
    }
    case "failed": {
      return "run.failed";
    }
    case "cancelled":
    case "expired": {
      return "run.cancelled";
    }
    case "queued":
    case "booting":
    case "running":
    case "waiting_input": {
      throw new Error(`Expected terminal Session Run status, received ${status}.`);
    }
  }
}

function toRuntimeEventKindForRunStatus(status: SessionRunStatus): RuntimeEventKind {
  if (isTerminalSessionRunStatus(status)) {
    return toTerminalRunEventKind(status);
  }

  return status === "queued" ? "run.queued" : "run.dispatched";
}

export function createQueuedSessionRunRuntimeEvents(input: {
  prompt: string;
  run: SessionRunSummary;
  sessionMessageId: SessionMessageId;
  sessionId: SessionId;
}): RuntimeEventEnvelope[] {
  return [
    createSessionRuntimeEvent({
      kind: "message.added",
      payload: {
        content: input.prompt,
        messageId: input.sessionMessageId,
        role: "user",
      },
      runId: input.run.id,
      sessionId: input.sessionId,
      traceId: input.run.traceId,
    }),
    createSessionRuntimeEvent({
      kind: "run.queued",
      payload: {
        lifecycle: toSessionLifecycleStatusForRunStatus(input.run.status),
        run: toSessionRunView(input.run),
      },
      runId: input.run.id,
      sessionId: input.sessionId,
      traceId: input.run.traceId,
    }),
  ];
}

export function createCancelledSessionRunRuntimeEvent(input: {
  run: SessionRunSummary;
  runError?: RunError | null;
  sessionId: SessionId;
  sourceEventId?: string;
}): RuntimeEventEnvelope {
  const run: SessionRunView = {
    ...toSessionRunView(input.run),
    error: input.runError ?? input.run.error,
    status: "cancelled",
  };

  return createSessionRuntimeEvent({
    ...toPersistedTerminalEventTime(input.run),
    ...(input.sourceEventId === undefined ? {} : { sourceEventId: input.sourceEventId }),
    kind: "run.cancelled",
    payload: {
      lifecycle: "IDLE",
      run,
    },
    runId: input.run.id,
    sessionId: input.sessionId,
    traceId: input.run.traceId,
  });
}

export function createFailedSessionRunRuntimeEvent(input: {
  run: SessionRunSummary;
  runError: RunError;
  sessionId: SessionId;
  sourceEventId?: string;
}): RuntimeEventEnvelope {
  return createSessionRuntimeEvent({
    ...toPersistedTerminalEventTime(input.run),
    kind: "run.failed",
    payload: {
      error: {
        code: input.runError.code,
        details: input.runError.details,
        message: input.runError.message,
        retryable: input.runError.retryable,
      },
      lifecycle: "IDLE",
      run: toSessionRunView(input.run),
    },
    runId: input.run.id,
    sessionId: input.sessionId,
    ...(input.sourceEventId === undefined ? {} : { sourceEventId: input.sourceEventId }),
    traceId: input.run.traceId,
  });
}
