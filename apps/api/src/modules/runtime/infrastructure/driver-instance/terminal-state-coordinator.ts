import type { DriverInstanceId } from "@mosoo/id";

import { createErrorLogContext, logInfo, logWarn } from "../../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { isTruthy } from "../../../../shared/truthiness";
import { finalizeDriverInstance, getTerminalDriverInstanceStatusForConnection } from "./lifecycle";
import type { DriverInstanceRuntimeState } from "./runtime-state";
import type { DriverInstanceCloseSnapshot } from "./state";
import { repairFinalizedTerminalDriverRunState } from "./terminal-run-release";
interface DriverInstanceTerminalStateCoordinatorOptions {
  env: ApiBindings;
  state: DriverInstanceRuntimeState;
  withRuntimeLogContext: <T>(fn: () => T) => T;
}

export class DriverInstanceTerminalStateCoordinator {
  readonly #env: ApiBindings;
  #pendingFinalization: Promise<void> | null = null;
  readonly #state: DriverInstanceRuntimeState;
  readonly #withRuntimeLogContext: <T>(fn: () => T) => T;

  constructor(options: DriverInstanceTerminalStateCoordinatorOptions) {
    this.#env = options.env;
    this.#state = options.state;
    this.#withRuntimeLogContext = options.withRuntimeLogContext;
  }

  async finalize(): Promise<void> {
    if (this.#state.finalizationCompleted) {
      return;
    }

    const task = (this.#pendingFinalization ??= this.#finalize());
    try {
      await task;
    } finally {
      if (this.#pendingFinalization === task) {
        this.#pendingFinalization = null;
      }
    }
  }

  async #finalize(): Promise<void> {
    this.#state.terminalized = true;

    const driverInstanceId = this.#state.requireDriverInstanceId();
    const close = await this.#ensureCloseSnapshot();
    const status = getDriverInstanceTerminalStatus(this.#state.errorMessage, close.code);
    const connectionId = this.#state.connectionId;
    const finalized = isTruthy(connectionId)
      ? await finalizeDriverInstance(this.#env, driverInstanceId, {
          closeCode: close.code,
          closeReason: close.reason || null,
          connectionId,
          errorMessage: this.#state.errorMessage,
          generation: this.#state.requireDriverGeneration(),
          heartbeatCount: this.#state.heartbeatCount,
          lastHeartbeatAt: this.#state.lastHeartbeat?.at ?? null,
          status,
        })
      : false;

    const terminalStatus = finalized
      ? status
      : isTruthy(connectionId)
        ? await getTerminalDriverInstanceStatusForConnection(this.#env, {
            driverInstanceId,
            connectionId,
            generation: this.#state.requireDriverGeneration(),
          })
        : null;

    // A prior attempt may have committed the driver row and stopped before the
    // run/effect/lease repair. Only the same connection and generation may retry.
    if (terminalStatus !== null) {
      await this.#repairFinalizedRunState({
        driverInstanceId,
        status: terminalStatus,
      });
    }

    if (terminalStatus !== null) {
      this.#withRuntimeLogContext(() => {
        logInfo("runtime.run.finalized", {
          closeCode: close.code,
          closeReason: close.reason || null,
          connectionId,
          driverInstanceId,
          driverPid: this.#state.hello?.pid ?? null,
          errorMessage: this.#state.errorMessage,
          heartbeatCount: this.#state.heartbeatCount,
          recovered: !finalized,
          status: terminalStatus,
        });
      });
    }

    this.#state.resolveCloseWaiters();

    if (!this.#state.ready) {
      this.#state.rejectReadyWaiters(
        new Error(`Driver instance ${driverInstanceId} closed before ready.`),
      );
    }

    await this.#state.persistTerminalSnapshot();
  }

  async #ensureCloseSnapshot(): Promise<DriverInstanceCloseSnapshot> {
    const close =
      this.#state.close ??
      ({
        at: new Date().toISOString(),
        code: isTruthy(this.#state.errorMessage) ? 1011 : 1000,
        reason: isTruthy(this.#state.errorMessage) ? "runtime.failed" : "runtime.closed",
      } satisfies DriverInstanceCloseSnapshot);

    if (!this.#state.close) {
      await this.#state.persistClose(close);
    }

    return close;
  }

  async #repairFinalizedRunState(input: {
    driverInstanceId: DriverInstanceId;
    status: "failed" | "stopped";
  }): Promise<void> {
    try {
      await repairFinalizedTerminalDriverRunState(this.#env, input);
    } catch (error) {
      this.#withRuntimeLogContext(() => {
        logWarn("runtime.driver.finalize_repair.failed", {
          ...createErrorLogContext(error),
          driverInstanceId: input.driverInstanceId,
          status: input.status,
        });
      });
      throw error;
    }
  }
}

function getDriverInstanceTerminalStatus(
  errorMessage: string | null,
  closeCode: number,
): "failed" | "stopped" {
  if (errorMessage === null && closeCode === 1000) {
    return "stopped";
  }

  return "failed";
}
