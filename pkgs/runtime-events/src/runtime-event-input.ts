import type { DriverInstanceId, RuntimeEventId, SessionId, SessionRunId } from "@mosoo/id";

import { createRuntimeEvent, parseRuntimeEventEnvelope } from "./runtime-event";
import type {
  RuntimeEventActor,
  RuntimeEventContext,
  RuntimeEventDelivery,
  RuntimeEventEnvelope,
  RuntimeEventKind,
  RuntimeEventNativeRef,
  RuntimeEventOrigin,
  RuntimeEventVisibility,
} from "./runtime-event";
import { isRuntimeEventRecord } from "./runtime-event-payload";

export interface RuntimeEventInputDraft {
  readonly actor?: RuntimeEventActor | undefined;
  readonly context?: RuntimeEventContext | undefined;
  readonly correlationId?: string | undefined;
  readonly delivery?: RuntimeEventDelivery | undefined;
  readonly id?: RuntimeEventId | undefined;
  readonly kind: RuntimeEventKind;
  readonly native?: RuntimeEventNativeRef | undefined;
  readonly occurredAt?: string | undefined;
  readonly origin?: RuntimeEventOrigin | undefined;
  readonly payload: unknown;
  readonly receivedAt?: string | undefined;
  readonly runId?: SessionRunId | undefined;
  readonly sourceEventId?: string | undefined;
  readonly traceId?: string | undefined;
  readonly visibility?: RuntimeEventVisibility | undefined;
}

export type RuntimeEventInput = RuntimeEventEnvelope | RuntimeEventInputDraft;

export interface RuntimeEventBuildContext {
  readonly createId: () => RuntimeEventId;
  readonly draftRunIdPolicy?: "admit" | "ignore" | undefined;
  readonly driverInstanceId?: DriverInstanceId | undefined;
  readonly occurredAt: string;
  readonly origin?: RuntimeEventOrigin | undefined;
  readonly runId?: SessionRunId | undefined;
  readonly runtimeId?: string | undefined;
  readonly sessionId: SessionId;
  readonly sourceEventId?: string | undefined;
  readonly traceId?: string | undefined;
}

export type RuntimeEventIngressRejectionCode =
  | "invalid_input"
  | "malformed_event"
  | "unsupported_kind"
  | "unsupported_schema";

export interface RuntimeEventIngressRejection {
  readonly code: RuntimeEventIngressRejectionCode;
  readonly kind?: string | undefined;
  readonly message: string;
}

export interface RuntimeEventIngressAccepted {
  readonly event: RuntimeEventEnvelope;
  readonly status: "accepted";
}

export interface RuntimeEventIngressRejected {
  readonly rejection: RuntimeEventIngressRejection;
  readonly status: "rejected";
}

export type RuntimeEventIngressOutcome = RuntimeEventIngressAccepted | RuntimeEventIngressRejected;

function isRuntimeEventInputDraft(value: unknown): value is RuntimeEventInputDraft {
  return isRuntimeEventRecord(value) && typeof value["kind"] === "string" && "payload" in value;
}

function readRuntimeEventInputKind(input: unknown): string | undefined {
  return isRuntimeEventRecord(input) && typeof input["kind"] === "string"
    ? input["kind"]
    : undefined;
}

function classifyRuntimeEventIngressError(
  input: unknown,
  error: unknown,
): RuntimeEventIngressRejection {
  const message = error instanceof Error ? error.message : "Runtime event input is malformed.";
  const kind = readRuntimeEventInputKind(input);

  if (message.includes("schema version")) {
    return {
      code: "unsupported_schema",
      ...(kind === undefined ? {} : { kind }),
      message,
    };
  }

  if (message.includes("kind is unsupported")) {
    return {
      code: "unsupported_kind",
      ...(kind === undefined ? {} : { kind }),
      message,
    };
  }

  return {
    code: message.includes("canonical runtime event draft") ? "invalid_input" : "malformed_event",
    ...(kind === undefined ? {} : { kind }),
    message,
  };
}

function createRuntimeEnvelopeFromDraft(
  context: RuntimeEventBuildContext,
  draft: RuntimeEventInputDraft,
): RuntimeEventEnvelope {
  const runId = context.runId ?? (context.draftRunIdPolicy === "ignore" ? undefined : draft.runId);

  return createRuntimeEvent({
    actor: draft.actor,
    context: draft.context,
    correlationId: draft.correlationId,
    delivery: draft.delivery,
    driverInstanceId: context.driverInstanceId,
    id: draft.id ?? context.createId(),
    kind: draft.kind,
    native: draft.native,
    occurredAt: draft.occurredAt ?? context.occurredAt,
    origin: draft.origin ?? context.origin ?? "driver",
    payload: draft.payload,
    receivedAt: draft.receivedAt,
    runId,
    runtimeId: context.runtimeId,
    sessionId: context.sessionId,
    sourceEventId: draft.sourceEventId ?? context.sourceEventId,
    traceId: draft.traceId ?? context.traceId,
    visibility: draft.visibility,
  });
}

export function toRuntimeEventInput(
  context: RuntimeEventBuildContext,
  input: unknown,
): RuntimeEventEnvelope[] {
  const outcome = ingestRuntimeEventInput(context, input);

  if (outcome.status === "accepted") {
    return [outcome.event];
  }

  throw new Error(outcome.rejection.message);
}

export function ingestRuntimeEventInput(
  context: RuntimeEventBuildContext,
  input: unknown,
): RuntimeEventIngressOutcome {
  try {
    if (isRuntimeEventRecord(input) && "schemaVersion" in input) {
      return {
        event: parseRuntimeEventEnvelope(input),
        status: "accepted",
      };
    }

    if (!isRuntimeEventInputDraft(input)) {
      return {
        rejection: {
          code: "invalid_input",
          ...(readRuntimeEventInputKind(input) === undefined
            ? {}
            : { kind: readRuntimeEventInputKind(input) }),
          message: "Driver runtime event input must be a canonical runtime event draft.",
        },
        status: "rejected",
      };
    }

    return {
      event: parseRuntimeEventEnvelope(createRuntimeEnvelopeFromDraft(context, input)),
      status: "accepted",
    };
  } catch (error) {
    return {
      rejection: classifyRuntimeEventIngressError(input, error),
      status: "rejected",
    };
  }
}
