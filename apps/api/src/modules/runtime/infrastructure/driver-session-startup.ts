import { isAsyncTimeoutError } from "@mosoo/effects";
import type { AgentId, DriverInstanceId, SessionId } from "@mosoo/id";
import { RUNTIME_DIAGNOSTIC_EVENT } from "@mosoo/runtime-events";

import { disposeRpcResource } from "../../../platform/cloudflare/rpc-disposal";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import {
  appendRuntimeDiagnosticEvent,
  toRuntimeDiagnosticBaseValue,
} from "../application/runtime-diagnostic-events";
import { DRIVER_COLD_READY_TIMEOUT_MS } from "../domain/runtime-config";
import { failDriverInstance, waitForDriverInstanceReady } from "./driver-instance/client";
import { relayDriverProcessLogs } from "./driver-process-log-relay";
import { runBestEffortRuntimeCleanup } from "./runtime-cleanup";
import type { RuntimeProcessHandle } from "./sandbox-handles";

export interface DriverRuntimeStartupEventContext {
  agentId: AgentId;
  driverControlPort: number;
  driverInstanceId: DriverInstanceId;
  sessionId: SessionId;
  traceId: string | null;
}

async function createDriverStartupExitError(
  bindings: ApiBindings,
  input: {
    driverInstanceId: DriverInstanceId;
    eventContext?: DriverRuntimeStartupEventContext;
    exitCode: number;
    logContext: Record<string, unknown>;
    markStartupFailed?: (message: string) => Promise<void>;
    process: RuntimeProcessHandle;
  },
): Promise<Error> {
  await relayDriverProcessLogs({
    context: input.logContext,
    message: "runtime.driver.startup.failed.logs",
    process: input.process,
  });

  const message = `Driver process exited before ready with exit code ${String(input.exitCode)}.`;

  if (input.eventContext) {
    await appendRuntimeDiagnosticEvent(bindings, {
      eventName: RUNTIME_DIAGNOSTIC_EVENT.driverExitedBeforeReady.name,
      sessionId: input.eventContext.sessionId,
      value: {
        ...toRuntimeDiagnosticBaseValue(input.eventContext),
        driverInstanceId: input.driverInstanceId,
        exitCode: input.exitCode,
        message,
      },
    });
  }

  await runBestEffortRuntimeCleanup({
    context: {
      driverInstanceId: input.driverInstanceId,
      ...input.logContext,
    },
    message: "runtime.driver.startup.record_failed_cleanup_failed",
    task: () =>
      input.markStartupFailed
        ? input.markStartupFailed(message)
        : failDriverInstance(bindings, input.driverInstanceId, message),
  });

  return new Error(message);
}

export async function waitForDriverReady(
  bindings: ApiBindings,
  input: {
    driverInstanceId: DriverInstanceId;
    eventContext: DriverRuntimeStartupEventContext;
    getStaleStartupError?: () => Promise<Error | null>;
    logContext: Record<string, unknown>;
    markStartupFailed?: (message: string) => Promise<void>;
    process?: RuntimeProcessHandle;
  },
): Promise<void> {
  let ready = false;
  const process = input.process;
  const readyPromise = waitForDriverInstanceReady(
    bindings,
    input.driverInstanceId,
    DRIVER_COLD_READY_TIMEOUT_MS,
  ).then(() => {
    ready = true;
  });
  const processExitPromise = process?.waitForExit().then(async (exit) => {
    if (ready) {
      return;
    }

    const staleError = (await input.getStaleStartupError?.()) ?? null;

    if (staleError !== null) {
      throw staleError;
    }

    throw await createDriverStartupExitError(bindings, {
      driverInstanceId: input.driverInstanceId,
      eventContext: input.eventContext,
      exitCode: exit.exitCode,
      logContext: input.logContext,
      ...(input.markStartupFailed ? { markStartupFailed: input.markStartupFailed } : {}),
      process,
    });
  });

  if (processExitPromise) {
    void processExitPromise.catch(() => undefined);
  }

  try {
    await (processExitPromise ? Promise.race([readyPromise, processExitPromise]) : readyPromise);
  } catch (error) {
    if (!isAsyncTimeoutError(error)) {
      throw error;
    }

    const staleError = (await input.getStaleStartupError?.()) ?? null;

    if (staleError !== null) {
      throw staleError;
    }

    if (process) {
      await relayDriverProcessLogs({
        context: input.logContext,
        message: "runtime.driver.startup.timeout.logs",
        process,
        severity: "warn",
      });
    }

    await appendRuntimeDiagnosticEvent(bindings, {
      eventName: RUNTIME_DIAGNOSTIC_EVENT.driverReadyTimeout.name,
      sessionId: input.eventContext.sessionId,
      value: {
        ...toRuntimeDiagnosticBaseValue(input.eventContext),
        driverInstanceId: input.driverInstanceId,
        elapsedMs: DRIVER_COLD_READY_TIMEOUT_MS,
        port: input.eventContext.driverControlPort,
      },
    });

    throw error;
  }

  await appendRuntimeDiagnosticEvent(bindings, {
    eventName: RUNTIME_DIAGNOSTIC_EVENT.driverReady.name,
    sessionId: input.eventContext.sessionId,
    value: {
      ...toRuntimeDiagnosticBaseValue(input.eventContext),
      driverInstanceId: input.driverInstanceId,
      port: input.eventContext.driverControlPort,
    },
  });
}

export function disposeDriverProcess(process: RuntimeProcessHandle | null): void {
  if (process !== null) {
    disposeRpcResource(process);
  }
}
