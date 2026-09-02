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
import type { RuntimeSessionLink } from "./event-types";
import { finalizeDriverInstance } from "./lifecycle";
import type { RuntimeSessionViewCache } from "./runtime-session-view-cache";
import type { DriverInstanceRuntimeState } from "./runtime-state";
import { getRuntimeSessionLink } from "./session-link.repository";
import type { SessionViewerEventDeliveryBuffer } from "./session-viewer-event-delivery-buffer";
import type { DriverInstanceCloseSnapshot, DriverInstanceConnectionEpoch } from "./state";
import { repairFinalizedTerminalDriverRunState } from "./terminal-run-release";

interface DriverInstanceTerminalStateCoordinatorOptions {
  appendDiagnosticEvent?: typeof appendRuntimeDiagnosticEvent;
  clearStorage: () => Promise<void>;
  env: ApiBindings;
  finalizeDriver?: typeof finalizeDriverInstance;
  repairFinalizedRunState?: typeof repairFinalizedTerminalDriverRunState;
  state: DriverInstanceRuntimeState;
  viewCache: RuntimeSessionViewCache;
  viewerEventDelivery: SessionViewerEventDeliveryBuffer;
  withRuntimeLogContext: <T>(fn: () => T) => T;
}

export class DriverInstanceTerminalStateCoordinator {
  readonly #appendDiagnosticEvent: typeof appendRuntimeDiagnosticEvent;
  readonly #clearStorage: () => Promise<void>;
  readonly #env: ApiBindings;
  readonly #finalizeDriver: typeof finalizeDriverInstance;
  #finalizationTask: { epoch: DriverInstanceConnectionEpoch; task: Promise<void> } | null = null;
  readonly #repairFinalizedRunState: typeof repairFinalizedTerminalDriverRunState;
  readonly #state: DriverInstanceRuntimeState;
  #resetTask: Promise<void> | null = null;
  readonly #viewCache: RuntimeSessionViewCache;
  readonly #viewerEventDelivery: SessionViewerEventDeliveryBuffer;
  readonly #withRuntimeLogContext: <T>(fn: () => T) => T;

  constructor(options: DriverInstanceTerminalStateCoordinatorOptions) {
    this.#appendDiagnosticEvent = options.appendDiagnosticEvent ?? appendRuntimeDiagnosticEvent;
    this.#clearStorage = options.clearStorage;
    this.#env = options.env;
    this.#finalizeDriver = options.finalizeDriver ?? finalizeDriverInstance;
    this.#repairFinalizedRunState =
      options.repairFinalizedRunState ?? repairFinalizedTerminalDriverRunState;
    this.#state = options.state;
    this.#viewCache = options.viewCache;
    this.#viewerEventDelivery = options.viewerEventDelivery;
    this.#withRuntimeLogContext = options.withRuntimeLogContext;
  }

  async finalize(epoch: DriverInstanceConnectionEpoch): Promise<void> {
    if (!this.#state.matchesConnectionEpoch(epoch)) {
      return;
    }

    if (this.#finalizationTask !== null && this.#epochsMatch(this.#finalizationTask.epoch, epoch)) {
      return this.#finalizationTask.task;
    }

    if (this.#state.terminalCleanupComplete) {
      return;
    }

    const task = this.#finalize(epoch).finally(() => {
      if (this.#finalizationTask?.task === task) {
        this.#finalizationTask = null;
      }
    });
    this.#finalizationTask = { epoch, task };
    return task;
  }

  async #finalize(epoch: DriverInstanceConnectionEpoch): Promise<void> {
    if (!this.#state.matchesConnectionEpoch(epoch)) {
      return;
    }

    const driverInstanceId = this.#state.requireDriverInstanceId();
    const close = await this.#ensureCloseSnapshot(epoch);

    if (!this.#state.matchesConnectionEpoch(epoch)) {
      return;
    }

    const terminalSessionLink = await this.#captureTerminalSessionLink(driverInstanceId, epoch);

    if (!this.#state.matchesConnectionEpoch(epoch)) {
      return;
    }

    this.#viewerEventDelivery.requestStateSync(terminalSessionLink.sessionId);
    const desiredStatus = getDriverInstanceTerminalStatus(this.#state.errorMessage, close.code);
    const closeResult = this.#state.closeResult();
    const snapshot = {
      connectedAt: this.#state.connectedAt,
      driverPid: this.#state.hello?.pid ?? null,
      driverStartedAt: this.#state.hello?.startedAt ?? null,
      errorMessage: this.#state.errorMessage,
      heartbeatCount: this.#state.heartbeatCount,
      lastHeartbeatAt: this.#state.lastHeartbeat?.at ?? null,
      terminalSessionRunId: this.#state.terminalSessionRunId,
      traceId: this.#state.traceId,
    };
    const terminalStatus = await this.#finalizeDriver(this.#env, driverInstanceId, {
      closeCode: close.code,
      closeReason: close.reason || null,
      connectionId: epoch.connectionId,
      connectedAt: snapshot.connectedAt,
      driverPid: snapshot.driverPid,
      driverStartedAt: snapshot.driverStartedAt,
      errorMessage: snapshot.errorMessage,
      generation: epoch.generation,
      heartbeatCount: snapshot.heartbeatCount,
      lastHeartbeatAt: snapshot.lastHeartbeatAt,
      status: desiredStatus,
    });

    if (terminalStatus === null || !this.#state.matchesConnectionEpoch(epoch)) {
      return;
    }

    await this.#repairFinalizedRunState(this.#env, {
      driverGeneration: epoch.generation,
      driverInstanceId,
      sessionRunId: snapshot.terminalSessionRunId,
      status: terminalStatus,
    });

    if (!this.#state.matchesConnectionEpoch(epoch)) {
      return;
    }

    await this.#appendDriverCrashedEventIfNeeded({
      close,
      driverGeneration: epoch.generation,
      driverInstanceId,
      link: terminalSessionLink,
      status: terminalStatus,
      traceId: snapshot.traceId,
    });

    if (!this.#state.matchesConnectionEpoch(epoch)) {
      return;
    }

    this.#withRuntimeLogContext(() => {
      logInfo("runtime.run.finalized", {
        closeCode: close.code,
        closeReason: close.reason || null,
        connectedAt: snapshot.connectedAt,
        connectionId: epoch.connectionId,
        driverInstanceId,
        driverPid: snapshot.driverPid,
        errorMessage: snapshot.errorMessage,
        heartbeatCount: snapshot.heartbeatCount,
        status: terminalStatus,
      });
    });

    this.#state.resolveCloseWaiters(closeResult, epoch.generation);

    if (!this.#state.ready) {
      this.#state.rejectReadyWaiters(
        new Error(`Driver instance ${driverInstanceId} closed before ready.`),
        epoch.generation,
      );
    }

    resolvePendingRuntimeCommands(this.#state.commandWaiters);
    await this.#state.persistTerminalSnapshot(epoch);
  }

  async resetForReuse(driverGeneration: number): Promise<void> {
    await this.prepareForReuse();

    return (this.#resetTask ??= this.#resetForReuse(driverGeneration).finally(() => {
      this.#resetTask = null;
    }));
  }

  async prepareForReuse(): Promise<void> {
    if (this.#finalizationTask !== null) {
      await this.#finalizationTask.task;
    }

    this.#viewerEventDelivery.resetAfterFlush();
  }

  async #resetForReuse(driverGeneration: number): Promise<void> {
    await this.#state.resetForReuse({
      beforeReset: async () => {
        this.#viewerEventDelivery.resetAfterFlush();
        this.#viewCache.reset();
      },
      driverGeneration,
    });
  }

  async destroy(reason: string): Promise<void> {
    if (this.#finalizationTask !== null) {
      await this.#finalizationTask.task;
    }

    if (this.#resetTask !== null) {
      await this.#resetTask;
    }

    this.#viewerEventDelivery.resetAfterFlush();
    this.#viewCache.reset();
    await this.#clearStorage();
    this.#state.resetAfterDestroy(reason);
  }

  async #ensureCloseSnapshot(
    epoch: DriverInstanceConnectionEpoch,
  ): Promise<DriverInstanceCloseSnapshot> {
    this.#state.assertConnectionEpoch(epoch);
    const close =
      this.#state.close ??
      ({
        at: new Date().toISOString(),
        code: isTruthy(this.#state.errorMessage) ? 1011 : 1000,
        reason: isTruthy(this.#state.errorMessage) ? "runtime.failed" : "runtime.closed",
      } satisfies DriverInstanceCloseSnapshot);

    if (!this.#state.close) {
      await this.#state.persistClose(close, epoch);
    }

    return close;
  }

  async #appendDriverCrashedEventIfNeeded(input: {
    close: DriverInstanceCloseSnapshot;
    driverGeneration: number;
    driverInstanceId: DriverInstanceId;
    link: RuntimeSessionLink;
    status: "failed" | "stopped";
    traceId: string | null;
  }): Promise<void> {
    if (input.status !== "failed") {
      return;
    }

    try {
      const { link } = input;

      if (!isTruthy(link.agentId) || !isTruthy(link.sessionId)) {
        return;
      }

      await this.#appendDiagnosticEvent(this.#env, {
        eventName: RUNTIME_DIAGNOSTIC_EVENT.driverCrashed.name,
        sessionId: link.sessionId,
        sourceEventId: `driver-terminal:${input.driverInstanceId}:${String(input.driverGeneration)}:crashed`,
        value: {
          ...toRuntimeDiagnosticBaseValue({
            agentId: link.agentId,
            sessionId: link.sessionId,
            traceId: input.traceId,
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

  async #captureTerminalSessionLink(
    driverInstanceId: DriverInstanceId,
    epoch: DriverInstanceConnectionEpoch,
  ): Promise<RuntimeSessionLink> {
    this.#state.assertConnectionEpoch(epoch);
    const sessionRunId = this.#state.terminalSessionRunId;
    const cachedLink = this.#state.runtimeSessionLink;
    const link =
      sessionRunId !== null
        ? cachedLink?.sessionRunId === sessionRunId && !runtimeSessionLinkNeedsRefresh(cachedLink)
          ? cachedLink
          : await getRuntimeSessionLink(this.#env.DB, driverInstanceId, { sessionRunId })
        : cachedLink !== null && !runtimeSessionLinkNeedsRefresh(cachedLink)
          ? cachedLink
          : await getRuntimeSessionLink(this.#env.DB, driverInstanceId);

    this.#state.assertConnectionEpoch(epoch);

    if (sessionRunId !== null && link.sessionRunId !== sessionRunId) {
      throw new Error("Terminal Session Run ownership was lost.");
    }

    if (sessionRunId === null && link.sessionRunId !== null) {
      await this.#state.setTerminalSessionRunId(link.sessionRunId, epoch);
    }

    this.#state.assertConnectionEpoch(epoch);
    this.#state.setRuntimeSessionLink(link);
    return link;
  }

  #epochsMatch(left: DriverInstanceConnectionEpoch, right: DriverInstanceConnectionEpoch): boolean {
    return left.connectionId === right.connectionId && left.generation === right.generation;
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
