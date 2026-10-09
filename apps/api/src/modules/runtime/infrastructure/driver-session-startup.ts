import type { DriverInstanceId } from "@mosoo/id";

import { disposeRpcResource } from "../../../platform/cloudflare/rpc-disposal";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { DRIVER_COLD_READY_TIMEOUT_MS } from "../domain/runtime-config";
import { failDriverInstance, waitForDriverInstanceReady } from "./driver-instance/client";
import { relayDriverProcessLogs } from "./driver-process-log-relay";
import { runBestEffortRuntimeCleanup } from "./runtime-cleanup";
import type { RuntimeProcessHandle } from "./sandbox-handles";

async function createDriverStartupExitError(
  bindings: ApiBindings,
  input: {
    driverInstanceId: DriverInstanceId;
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
      exitCode: exit.exitCode,
      logContext: input.logContext,
      ...(input.markStartupFailed ? { markStartupFailed: input.markStartupFailed } : {}),
      process,
    });
  });

  if (processExitPromise) {
    void processExitPromise.catch(() => undefined);
  }

  await (processExitPromise ? Promise.race([readyPromise, processExitPromise]) : readyPromise);
}

export function disposeDriverProcess(process: RuntimeProcessHandle | null): void {
  if (process !== null) {
    disposeRpcResource(process);
  }
}
