import type { DriverInstanceId } from "@mosoo/id";
import { RUNTIME_DIAGNOSTIC_EVENT } from "@mosoo/runtime-events";

import { createErrorLogContext, logInfo, logWarn } from "../../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { isTruthy } from "../../../../shared/truthiness";
import {
  appendRuntimeDiagnosticEvent,
  toRuntimeDiagnosticBaseValue,
} from "../../application/runtime-diagnostic-events";
import { resolvePendingRuntimeCommands } from "./commands";
import { runtimeSessionLinkNeedsRefresh } from "./event-types";
import { finalizeDriverInstance } from "./lifecycle";
import type { RuntimeSessionViewCache } from "./runtime-session-view-cache";
import type { DriverInstanceRuntimeState } from "./runtime-state";
import { getRuntimeSessionLink } from "./session-link.repository";
import type { SessionViewerEventDeliveryBuffer } from "./session-viewer-event-delivery-buffer";
import type { DriverInstanceCloseSnapshot } from "./state";
import { repairFinalizedTerminalDriverRunState } from "./terminal-run-release";
interface DriverInstanceTerminalStateCoordinatorOptions {
  clearStorage: () => Promise<void>;
  env: ApiBindings;
  state: DriverInstanceRuntimeState;
  viewCache: RuntimeSessionViewCache;
  viewerEventDelivery: SessionViewerEventDeliveryBuffer;
  withRuntimeLogContext: <T>(fn: () => T) => T;
}

export class DriverInstanceTerminalStateCoordinator {
  readonly #clearStorage: () => Promise<void>;
  readonly #env: ApiBindings;
  readonly #state: DriverInstanceRuntimeState;
  readonly #viewCache: RuntimeSessionViewCache;
  readonly #viewerEventDelivery: SessionViewerEventDeliveryBuffer;
  readonly #withRuntimeLogContext: <T>(fn: () => T) => T;

  constructor(options: DriverInstanceTerminalStateCoordinatorOptions) {
    this.#clearStorage = options.clearStorage;
    this.#env = options.env;
    this.#state = options.state;
    this.#viewCache = options.viewCache;
    this.#viewerEventDelivery = options.viewerEventDelivery;
    this.#withRuntimeLogContext = options.withRuntimeLogContext;
  }

  async finalize(): Promise<void> {
    if (this.#state.terminalized) {
      return;
    }

    this.#state.terminalized = true;
    await this.#viewerEventDelivery.flushSafely();

    const driverInstanceId = this.#state.requireDriverInstanceId();
    const close = await this.#ensureCloseSnapshot();
    const status = getDriverInstanceTerminalStatus(this.#state.errorMessage, close.code);
    const closeResult = this.#state.closeResult();
    const connectionId = this.#state.connectionId;
    const finalized = isTruthy(connectionId)
      ? await finalizeDriverInstance(this.#env, driverInstanceId, {
          closeCode: close.code,
          closeReason: close.reason || null,
          connectionId,
          connectedAt: this.#state.connectedAt,
          driverPid: this.#state.hello?.pid ?? null,
          driverStartedAt: this.#state.hello?.startedAt ?? null,
          errorMessage: this.#state.errorMessage,
          generation: this.#state.requireDriverGeneration(),
          heartbeatCount: this.#state.heartbeatCount,
          lastHeartbeatAt: this.#state.lastHeartbeat?.at ?? null,
          status,
        })
      : false;

    if (finalized) {
      await this.#repairFinalizedRunState({
        driverInstanceId,
        status,
      });
      await this.#appendDriverCrashedEventIfNeeded({
        close,
        driverInstanceId,
        status,
      });

      this.#withRuntimeLogContext(() => {
        logInfo("runtime.run.finalized", {
          closeCode: close.code,
          closeReason: close.reason || null,
          connectedAt: this.#state.connectedAt,
          connectionId,
          driverInstanceId,
          driverPid: this.#state.hello?.pid ?? null,
          errorMessage: this.#state.errorMessage,
          heartbeatCount: this.#state.heartbeatCount,
          status,
        });
      });
    }

    this.#state.resolveCloseWaiters(closeResult);
    this.#state.rejectHeartbeatWaiters(new Error(`Driver instance ${driverInstanceId} is closed.`));

    if (!this.#state.hello) {
      this.#state.rejectHelloWaiters(
        new Error(`Driver instance ${driverInstanceId} closed before hello.`),
      );
    }

    if (!this.#state.ready) {
      this.#state.rejectReadyWaiters(
        new Error(`Driver instance ${driverInstanceId} closed before ready.`),
      );
    }

    resolvePendingRuntimeCommands(this.#state.commandWaiters);
    await this.#state.persistTerminalSnapshot();
  }

  async resetForReuse(): Promise<void> {
    await this.#state.resetForReuse({
      beforeReset: async () => {
        await this.#viewerEventDelivery.flushSafely();
        this.#viewerEventDelivery.resetAfterFlush();
        this.#viewCache.reset();
      },
    });
  }

  async destroy(reason: string): Promise<void> {
    await this.#viewerEventDelivery.flushSafely();
    this.#viewerEventDelivery.resetAfterFlush();
    this.#viewCache.reset();
    await this.#clearStorage();
    this.#state.resetAfterDestroy(reason);
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

  async #appendDriverCrashedEventIfNeeded(input: {
    close: DriverInstanceCloseSnapshot;
    driverInstanceId: DriverInstanceId;
    status: "failed" | "stopped";
  }): Promise<void> {
    if (input.status !== "failed") {
      return;
    }

    try {
      const cachedLink = this.#state.runtimeSessionLink;
      const link =
        cachedLink !== null && !runtimeSessionLinkNeedsRefresh(cachedLink)
          ? cachedLink
          : await getRuntimeSessionLink(this.#env.DB, input.driverInstanceId);
      this.#state.setRuntimeSessionLink(link);

      if (!isTruthy(link.agentId) || !isTruthy(link.sessionId)) {
        return;
      }

      await appendRuntimeDiagnosticEvent(this.#env, {
        eventName: RUNTIME_DIAGNOSTIC_EVENT.driverCrashed.name,
        sessionId: link.sessionId,
        value: {
          ...toRuntimeDiagnosticBaseValue({
            agentId: link.agentId,
            sessionId: link.sessionId,
            traceId: this.#state.traceId,
          }),
          driverInstanceId: input.driverInstanceId,
          status: input.close.reason || "failed",
        },
      });
    } catch (error) {
      this.#withRuntimeLogContext(() => {
        logWarn("runtime.driver.crashed_event.emit_failed", {
          ...createErrorLogContext(error),
          driverInstanceId: input.driverInstanceId,
        });
      });
    }
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
