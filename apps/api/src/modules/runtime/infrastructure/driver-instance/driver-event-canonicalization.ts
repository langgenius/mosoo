import { DurableRunError } from "@mosoo/contracts/session-run";
import { parseSchemaValue } from "@mosoo/contracts/validation";
import type { DriverInstanceId, RuntimeEventId, SessionId, SessionRunId } from "@mosoo/id";
import {
  createRuntimeEvent,
  parseRuntimeEventEnvelope,
  readRuntimeEventPayload,
} from "@mosoo/runtime-events";
import type { RuntimeEventEnvelope } from "@mosoo/runtime-events";

import { createSessionRunTerminalSourceId } from "../../domain/session-run-terminal-event-id";
import type { CanonicalDriverEventEnvelope } from "./event-types";

interface DriverEventEnvelopeInput {
  readonly event: unknown;
  readonly eventId: string;
  readonly occurredAt?: string | null | undefined;
}

function isTerminalRunEventKind(
  kind: RuntimeEventEnvelope["kind"],
): kind is "run.cancelled" | "run.completed" | "run.failed" {
  return kind === "run.cancelled" || kind === "run.completed" || kind === "run.failed";
}

export function createCanonicalDriverRunFailedEvent(input: {
  driverInstanceId: DriverInstanceId;
  error: typeof DurableRunError.infer;
  id: RuntimeEventId;
  occurredAt: string;
  runId: SessionRunId;
  runtimeId: string;
  sessionId: SessionId;
  traceId: string;
}): RuntimeEventEnvelope {
  return createRuntimeEvent({
    actor: "driver",
    delivery: "lossless",
    driverInstanceId: input.driverInstanceId,
    id: input.id,
    kind: "run.failed",
    occurredAt: input.occurredAt,
    origin: "driver",
    payload: {
      error: input.error,
      lifecycle: "IDLE",
      recoverable: input.error.retryable,
    },
    runId: input.runId,
    runtimeId: input.runtimeId,
    sessionId: input.sessionId,
    sourceEventId: createSessionRunTerminalSourceId(input.runId, "run.failed"),
    traceId: input.traceId,
    visibility: "participant",
  });
}

export function canonicalizeDriverEventEnvelope(
  envelope: DriverEventEnvelopeInput,
  input: { traceId: string | null },
): CanonicalDriverEventEnvelope {
  const parsedEvent = parseRuntimeEventEnvelope(envelope.event);

  if (parsedEvent.sourceEventId !== undefined && parsedEvent.sourceEventId !== envelope.eventId) {
    throw new Error("Runtime driver event source id does not match the driver envelope.");
  }

  const event = (() => {
    if (parsedEvent.runId === undefined) {
      return parsedEvent;
    }

    if (input.traceId === null) {
      throw new Error("Runtime driver event run is missing its authoritative trace identity.");
    }

    if (parsedEvent.traceId !== undefined && parsedEvent.traceId !== input.traceId) {
      throw new Error("Runtime driver event trace id does not match its Session Run.");
    }

    return parsedEvent.traceId === undefined
      ? { ...parsedEvent, traceId: input.traceId }
      : parsedEvent;
  })();

  if (!isTerminalRunEventKind(event.kind) || event.runId === undefined) {
    return { ...envelope, event };
  }

  if (event.kind !== "run.failed") {
    return {
      ...envelope,
      event: {
        ...event,
        payload: {
          ...readRuntimeEventPayload(event),
          lifecycle: "IDLE",
        },
        sourceEventId: createSessionRunTerminalSourceId(event.runId, event.kind),
      },
    };
  }

  if (
    event.driverInstanceId === undefined ||
    event.runtimeId === undefined ||
    event.traceId === undefined
  ) {
    throw new Error("Runtime driver failure event is missing its canonical execution identity.");
  }

  const error = parseSchemaValue(DurableRunError, readRuntimeEventPayload(event)["error"]);

  return {
    ...envelope,
    event: createCanonicalDriverRunFailedEvent({
      driverInstanceId: event.driverInstanceId,
      error,
      id: event.id,
      occurredAt: event.occurredAt,
      runId: event.runId,
      runtimeId: event.runtimeId,
      sessionId: event.sessionId,
      traceId: event.traceId,
    }),
  };
}
