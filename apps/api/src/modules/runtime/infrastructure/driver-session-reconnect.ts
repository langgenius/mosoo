import { RUNTIME_DIAGNOSTIC_EVENT } from "@mosoo/runtime-events";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { createStopwatch } from "../../../time";
import type { Stopwatch } from "../../../time";
import {
  appendRuntimeDiagnosticEvent,
  toRuntimeDiagnosticBaseValue,
  toRuntimeDiagnosticReason,
} from "../application/runtime-diagnostic-events";
import type { DriverRuntimeStartupEventContext } from "./driver-session-startup";
import { DRIVER_SOCKET_MISSING_MESSAGE } from "./driver-session-stop-errors";

export interface DriverSocketReconnectAttempt {
  attemptNo: number;
  timer: Stopwatch;
}

export async function startDriverSocketReconnectAttempt(
  bindings: ApiBindings,
  input: {
    currentAttempt: DriverSocketReconnectAttempt | null;
    eventContext: DriverRuntimeStartupEventContext;
  },
): Promise<DriverSocketReconnectAttempt> {
  if (input.currentAttempt !== null) {
    return input.currentAttempt;
  }

  const attempt: DriverSocketReconnectAttempt = {
    attemptNo: 1,
    timer: createStopwatch(),
  };

  await appendRuntimeDiagnosticEvent(bindings, {
    eventName: RUNTIME_DIAGNOSTIC_EVENT.driverPortNotResponding.name,
    sessionId: input.eventContext.sessionId,
    value: {
      ...toRuntimeDiagnosticBaseValue(input.eventContext),
      driverInstanceId: input.eventContext.driverInstanceId,
      errorCode: "DRIVER_SOCKET_MISSING",
      port: input.eventContext.driverControlPort,
    },
  });
  await appendRuntimeDiagnosticEvent(bindings, {
    eventName: RUNTIME_DIAGNOSTIC_EVENT.transportWsReconnectStarted.name,
    sessionId: input.eventContext.sessionId,
    value: {
      ...toRuntimeDiagnosticBaseValue(input.eventContext),
      attemptNo: attempt.attemptNo,
      driverInstanceId: input.eventContext.driverInstanceId,
    },
  });

  return attempt;
}

export async function appendDriverSocketReconnectSucceededIfNeeded(
  bindings: ApiBindings,
  input: {
    attempt: DriverSocketReconnectAttempt | null;
    eventContext: DriverRuntimeStartupEventContext;
  },
): Promise<void> {
  if (input.attempt === null) {
    return;
  }

  await appendRuntimeDiagnosticEvent(bindings, {
    eventName: RUNTIME_DIAGNOSTIC_EVENT.transportWsReconnectSucceeded.name,
    sessionId: input.eventContext.sessionId,
    value: {
      ...toRuntimeDiagnosticBaseValue(input.eventContext),
      driverInstanceId: input.eventContext.driverInstanceId,
      elapsedMs: input.attempt.timer.elapsedMs(),
      reason: "driver_socket_reconnected",
    },
  });
}

export async function appendDriverSocketReconnectFailedIfNeeded(
  bindings: ApiBindings,
  input: {
    attempt: DriverSocketReconnectAttempt | null;
    error: unknown;
    eventContext: DriverRuntimeStartupEventContext;
  },
): Promise<void> {
  if (input.attempt === null) {
    return;
  }

  await appendRuntimeDiagnosticEvent(bindings, {
    eventName: RUNTIME_DIAGNOSTIC_EVENT.transportWsReconnectFailed.name,
    sessionId: input.eventContext.sessionId,
    value: {
      ...toRuntimeDiagnosticBaseValue(input.eventContext),
      driverInstanceId: input.eventContext.driverInstanceId,
      elapsedMs: input.attempt.timer.elapsedMs(),
      reason: toRuntimeDiagnosticReason(input.error, "Runtime driver socket reconnect failed."),
    },
  });
}

export { DRIVER_SOCKET_MISSING_MESSAGE };
