import type { SessionLifecycleStatus, SessionRunView } from "@mosoo/ag-ui-session";
import type { RunError, SessionRunStatus, SessionRunSummary } from "@mosoo/contracts/session-run";
import type { PrimitiveRecord } from "@mosoo/contracts/validation";
import type { RuntimeEventId, SessionId, SessionMessageId } from "@mosoo/id";
import type { RuntimeEventEnvelope, RuntimeEventKind } from "@mosoo/runtime-events";

import { createSessionRuntimeEvent } from "../../../sessions/application/session-event-write.service";

function toPrimitiveRecord(value: Record<string, unknown>): PrimitiveRecord {
  const details: PrimitiveRecord = {};

  for (const [key, entry] of Object.entries(value)) {
    if (
      typeof entry === "string" ||
      typeof entry === "number" ||
      typeof entry === "boolean" ||
      entry === null
    ) {
      details[key] = entry;
    }
  }

  return details;
}

function toSessionLifecycleStatusForRunView(status: SessionRunStatus): SessionLifecycleStatus {
  if (
    status === "queued" ||
    status === "booting" ||
    status === "running" ||
    status === "waiting_input"
  ) {
    return "RUNNING";
  }

  return "IDLE";
}

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

export function createSessionRunUpdatedEvent(
  run: SessionRunSummary,
  sessionId: SessionId,
  lifecycle = toSessionLifecycleStatusForRunView(run.status),
): RuntimeEventEnvelope {
  return createSessionRuntimeEvent({
    kind: toRuntimeEventKindForRunStatus(run.status),
    payload: {
      lifecycle,
      run: toSessionRunView(run),
    },
    runId: run.id,
    sessionId,
    traceId: run.traceId,
  });
}

function toRuntimeEventKindForRunStatus(status: SessionRunStatus): RuntimeEventKind {
  switch (status) {
    case "queued": {
      return "run.queued";
    }
    case "booting":
    case "running":
    case "waiting_input": {
      return "run.dispatched";
    }
    case "cancelled":
    case "expired": {
      return "run.cancelled";
    }
    case "failed": {
      return "run.failed";
    }
    case "completed": {
      return "run.completed";
    }
  }
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
        lifecycle: toSessionLifecycleStatusForRunView(input.run.status),
        run: toSessionRunView(input.run),
      },
      runId: input.run.id,
      sessionId: input.sessionId,
      traceId: input.run.traceId,
    }),
  ];
}

export function createCancelledSessionRunRuntimeEvent(input: {
  eventId?: RuntimeEventId;
  lifecycle?: Extract<SessionLifecycleStatus, "IDLE" | "TERMINATED">;
  run: SessionRunSummary;
  runError?: RunError | null;
  sessionId: SessionId;
  sourceEventId?: string;
}): RuntimeEventEnvelope {
  const run: SessionRunView = {
    ...toSessionRunView(input.run),
    error: input.runError
      ? {
          ...input.runError,
          details: toPrimitiveRecord(input.runError.details),
        }
      : input.run.error,
    status: "cancelled",
  };

  return createSessionRuntimeEvent({
    ...(input.eventId === undefined ? {} : { id: input.eventId }),
    ...(input.sourceEventId === undefined ? {} : { sourceEventId: input.sourceEventId }),
    kind: "run.cancelled",
    payload: {
      lifecycle: input.lifecycle ?? "IDLE",
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
    kind: "run.failed",
    payload: {
      error: {
        code: input.runError.code,
        details: toPrimitiveRecord(input.runError.details),
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

export function createSessionLifecycleTerminatedEvent(input: {
  eventId?: RuntimeEventId;
  lastSeen: string;
  message: string;
  reason: string;
  sessionId: SessionId;
  sourceEventId?: string;
}): RuntimeEventEnvelope {
  return createSessionRuntimeEvent({
    ...(input.eventId === undefined ? {} : { id: input.eventId }),
    ...(input.sourceEventId === undefined ? {} : { sourceEventId: input.sourceEventId }),
    kind: "session.lifecycle.updated",
    payload: {
      lastSeen: input.lastSeen,
      message: input.message,
      reason: input.reason,
      status: "TERMINATED",
    },
    sessionId: input.sessionId,
  });
}
