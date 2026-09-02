import type {
  DriverHeartbeatInput,
  DriverHelloInput,
  DriverHelloOutput,
  DriverReadyInput,
} from "@mosoo/agent-driver/orpc";
import type { RuntimeCommand } from "@mosoo/contracts/runtime-command";
import type { DriverInstanceId, SessionRunId } from "@mosoo/id";

import { isTruthy } from "../../../../shared/truthiness";
import type { DriverInstanceCommandState, RuntimeCommandWaiter } from "./commands";
import { createDriverDebugResumeSnapshot } from "./debug-resume-snapshot";
import type { DriverDebugRecoveryMode } from "./debug-resume-snapshot";
import { createDeferred, withTimeout } from "./driver-instance-support";
import type { Deferred } from "./driver-instance-support";
import type { RuntimeSessionLink } from "./event-types";
import {
  DRIVER_INSTANCE_STATE_STORAGE_KEY,
  HEARTBEAT_STATE_PERSIST_INTERVAL_MS,
  createEmptyStoredState,
  parseHeartbeatTimestampMs,
  parseStoredState,
} from "./runtime-state-store";
import type {
  DriverInstancePendingHello,
  DriverInstancePendingReady,
  DriverInstanceRuntimeStateContext,
  DriverInstanceStoredState,
} from "./runtime-state-store";
import type {
  DriverInstanceCloseSnapshot,
  DriverInstanceConnectionEpoch,
  DriverInstanceReadyResult,
  DriverInstanceSnapshot,
  DriverInstanceWaitForCloseResult,
} from "./state";

interface GenerationWaiter<T> {
  deferred: Deferred<T>;
  generation: number;
}

export type DriverInstanceHandshakeStageOutcome = "applied" | "replay" | "resume";

function isExactJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

interface DriverInstanceResetOptions {
  beforeReset: () => Promise<void>;
  driverGeneration: number;
}

export interface DriverInstanceHeartbeatRecord {
  shouldPersistCanonical: boolean;
}

export class DriverInstanceRuntimeState {
  close: DriverInstanceCloseSnapshot | null = null;
  readonly closeWaiters: GenerationWaiter<DriverInstanceWaitForCloseResult>[] = [];
  commandQueue: RuntimeCommand[] = [];
  readonly commandWaiters: RuntimeCommandWaiter[] = [];
  connectedAt: number | null = null;
  connectionId: string | null = null;
  driverGeneration: number | null = null;
  driverInstanceId: DriverInstanceId | null = null;
  errorMessage: string | null = null;
  heartbeatCount = 0;
  hello: DriverHelloInput | null = null;
  helloOutput: DriverHelloOutput | null = null;
  lastHeartbeat: DriverHeartbeatInput | null = null;
  lastPersistedHeartbeatAtMs: number | null = null;
  pendingHello: DriverInstancePendingHello | null = null;
  pendingReady: DriverInstancePendingReady | null = null;
  ready: DriverReadyInput | null = null;
  readonly readyWaiters: GenerationWaiter<DriverInstanceReadyResult>[] = [];
  runtimeSessionLink: RuntimeSessionLink | null = null;
  terminalCleanupComplete = false;
  terminalSessionRunId: SessionRunId | null = null;
  terminalized = false;
  traceId: string | null = null;
  readonly #ctx: DriverInstanceRuntimeStateContext;

  constructor(ctx: DriverInstanceRuntimeStateContext) {
    this.#ctx = ctx;
  }

  #applyStoredState(snapshot: DriverInstanceStoredState): void {
    this.close = snapshot.close;
    this.commandQueue = [...snapshot.commandQueue];
    this.connectedAt = snapshot.connectedAt;
    this.connectionId = snapshot.connectionId;
    this.driverGeneration = snapshot.driverGeneration;
    this.driverInstanceId = snapshot.driverInstanceId;
    this.errorMessage = snapshot.errorMessage;
    this.heartbeatCount = snapshot.heartbeatCount;
    this.hello = snapshot.hello;
    this.helloOutput = snapshot.helloOutput;
    this.lastHeartbeat = snapshot.lastHeartbeat;
    this.lastPersistedHeartbeatAtMs = snapshot.lastHeartbeat
      ? parseHeartbeatTimestampMs(snapshot.lastHeartbeat.at)
      : null;
    this.pendingHello = snapshot.pendingHello;
    this.pendingReady = snapshot.pendingReady;
    this.ready = snapshot.ready ?? null;
    this.runtimeSessionLink = null;
    this.terminalCleanupComplete = snapshot.terminalCleanupComplete;
    this.terminalSessionRunId = snapshot.terminalSessionRunId;
    this.terminalized = snapshot.close !== null;
    this.traceId = snapshot.traceId;
  }

  async #persistState(): Promise<void> {
    await this.#ctx.storage.put(DRIVER_INSTANCE_STATE_STORAGE_KEY, this.#toStoredState());
  }

  #toStoredState(): DriverInstanceStoredState {
    return {
      close: this.close,
      commandQueue: [...this.commandQueue],
      connectedAt: this.connectedAt,
      connectionId: this.connectionId,
      driverGeneration: this.driverGeneration,
      driverInstanceId: this.driverInstanceId,
      errorMessage: this.errorMessage,
      heartbeatCount: this.heartbeatCount,
      hello: this.hello,
      helloOutput: this.helloOutput,
      lastHeartbeat: this.lastHeartbeat,
      pendingHello: this.pendingHello,
      pendingReady: this.pendingReady,
      ready: this.ready,
      terminalCleanupComplete: this.terminalCleanupComplete,
      terminalSessionRunId: this.terminalSessionRunId,
      traceId: this.traceId,
    };
  }

  commandState(): DriverInstanceCommandState {
    return {
      commandQueue: this.commandQueue,
      commandWaiters: this.commandWaiters,
      terminalized: this.terminalized,
    };
  }

  async load(): Promise<void> {
    this.#applyStoredState(
      parseStoredState(await this.#ctx.storage.get(DRIVER_INSTANCE_STATE_STORAGE_KEY)),
    );
  }

  async persistClose(
    close: DriverInstanceCloseSnapshot,
    epoch: DriverInstanceConnectionEpoch,
  ): Promise<void> {
    this.assertConnectionEpoch(epoch);
    await this.#ctx.storage.put(DRIVER_INSTANCE_STATE_STORAGE_KEY, {
      ...this.#toStoredState(),
      close,
      terminalCleanupComplete: false,
    });
    this.assertConnectionEpoch(epoch);
    this.close = close;
    this.terminalCleanupComplete = false;
    this.terminalized = true;
  }

  async persistCommandQueue(): Promise<void> {
    await this.#persistState();
  }

  async persistTerminalSnapshot(epoch: DriverInstanceConnectionEpoch): Promise<void> {
    this.assertConnectionEpoch(epoch);
    this.requireDriverInstanceId();
    await this.#ctx.storage.put(DRIVER_INSTANCE_STATE_STORAGE_KEY, {
      ...this.#toStoredState(),
      commandQueue: [],
      terminalCleanupComplete: true,
    });
    this.assertConnectionEpoch(epoch);
    this.commandQueue = [];
    this.terminalCleanupComplete = true;
  }

  async recordAcceptedConnection(input: {
    connectedAt: number;
    connectionId: string;
    driverGeneration: number;
    traceId: string | null;
  }): Promise<void> {
    const isNewConnection =
      this.connectionId !== input.connectionId || this.driverGeneration !== input.driverGeneration;
    const next: DriverInstanceStoredState = {
      ...this.#toStoredState(),
      connectedAt: input.connectedAt,
      connectionId: input.connectionId,
      driverGeneration: input.driverGeneration,
      errorMessage: null,
      ...(isNewConnection
        ? {
            heartbeatCount: 0,
            hello: null,
            helloOutput: null,
            lastHeartbeat: null,
            pendingHello: null,
            pendingReady: null,
            ready: null,
          }
        : {}),
      traceId: input.traceId ?? this.traceId,
    };

    await this.#ctx.storage.put(DRIVER_INSTANCE_STATE_STORAGE_KEY, next);
    this.#applyStoredState(next);
  }

  async recordHeartbeat(payload: DriverHeartbeatInput): Promise<DriverInstanceHeartbeatRecord> {
    const heartbeatAtMs = parseHeartbeatTimestampMs(payload.at);
    this.heartbeatCount += 1;
    this.lastHeartbeat = payload;
    const shouldPersistCanonical = this.#shouldPersistHeartbeat(heartbeatAtMs);

    if (shouldPersistCanonical) {
      await this.#persistState();
      this.lastPersistedHeartbeatAtMs = heartbeatAtMs;
    }

    return { shouldPersistCanonical };
  }

  async stageHello(
    epoch: DriverInstanceConnectionEpoch,
    input: DriverHelloInput,
    output: DriverHelloOutput,
  ): Promise<DriverInstanceHandshakeStageOutcome> {
    this.assertConnectionEpoch(epoch);

    if (this.hello !== null || this.helloOutput !== null) {
      if (isExactJson(this.hello, input) && isExactJson(this.helloOutput, output)) {
        return "replay";
      }
      throw new Error("Driver hello conflicts with the canonical receipt.");
    }

    const pending = { epoch, input, output } satisfies DriverInstancePendingHello;

    if (this.pendingHello !== null) {
      if (isExactJson(this.pendingHello, pending)) {
        return "resume";
      }
      throw new Error("Driver hello conflicts with the pending receipt.");
    }

    await this.#ctx.storage.put(DRIVER_INSTANCE_STATE_STORAGE_KEY, {
      ...this.#toStoredState(),
      pendingHello: pending,
    });
    this.assertConnectionEpoch(epoch);
    this.pendingHello = pending;
    return "applied";
  }

  async commitHello(epoch: DriverInstanceConnectionEpoch): Promise<DriverHelloOutput> {
    this.assertConnectionEpoch(epoch);
    const pending = this.pendingHello;

    if (pending === null || !isExactJson(pending.epoch, epoch)) {
      throw new Error("Pending Driver hello receipt was lost.");
    }

    await this.#ctx.storage.put(DRIVER_INSTANCE_STATE_STORAGE_KEY, {
      ...this.#toStoredState(),
      hello: pending.input,
      helloOutput: pending.output,
      pendingHello: null,
    });
    this.assertConnectionEpoch(epoch);
    this.hello = pending.input;
    this.helloOutput = pending.output;
    this.pendingHello = null;
    return pending.output;
  }

  async stageReady(
    epoch: DriverInstanceConnectionEpoch,
    input: DriverReadyInput,
  ): Promise<DriverInstanceHandshakeStageOutcome> {
    this.assertConnectionEpoch(epoch);

    if (this.ready !== null) {
      if (isExactJson(this.ready, input)) {
        return "replay";
      }
      throw new Error("Driver ready conflicts with the canonical receipt.");
    }

    const pending = { epoch, input } satisfies DriverInstancePendingReady;

    if (this.pendingReady !== null) {
      if (isExactJson(this.pendingReady, pending)) {
        return "resume";
      }
      throw new Error("Driver ready conflicts with the pending receipt.");
    }

    await this.#ctx.storage.put(DRIVER_INSTANCE_STATE_STORAGE_KEY, {
      ...this.#toStoredState(),
      pendingReady: pending,
    });
    this.assertConnectionEpoch(epoch);
    this.pendingReady = pending;
    return "applied";
  }

  async commitReady(epoch: DriverInstanceConnectionEpoch): Promise<DriverInstanceReadyResult> {
    this.assertConnectionEpoch(epoch);
    const pending = this.pendingReady;

    if (pending === null || !isExactJson(pending.epoch, epoch)) {
      throw new Error("Pending Driver ready receipt was lost.");
    }

    await this.#ctx.storage.put(DRIVER_INSTANCE_STATE_STORAGE_KEY, {
      ...this.#toStoredState(),
      pendingReady: null,
      ready: pending.input,
    });
    this.assertConnectionEpoch(epoch);
    this.pendingReady = null;
    this.ready = pending.input;

    return this.readyResult();
  }

  rejectReadyWaiters(error: Error, generation: number): void {
    for (const waiter of this.readyWaiters.splice(0)) {
      if (waiter.generation === generation) {
        waiter.deferred.reject(error);
      } else {
        this.readyWaiters.push(waiter);
      }
    }
  }

  requireDriverInstanceId(): DriverInstanceId {
    if (!isTruthy(this.driverInstanceId)) {
      throw new Error("Driver instance id was not initialized.");
    }

    return this.driverInstanceId;
  }

  requireConnectionId(): string {
    if (!isTruthy(this.connectionId)) {
      throw new Error("Driver connection id was not initialized.");
    }

    return this.connectionId;
  }

  requireDriverGeneration(): number {
    if (this.driverGeneration === null) {
      throw new Error("Driver generation was not initialized.");
    }

    return this.driverGeneration;
  }

  connectionEpoch(): DriverInstanceConnectionEpoch | null {
    return this.connectionId === null || this.driverGeneration === null
      ? null
      : { connectionId: this.connectionId, generation: this.driverGeneration };
  }

  requireConnectionEpoch(): DriverInstanceConnectionEpoch {
    const epoch = this.connectionEpoch();

    if (epoch === null) {
      throw new Error("Driver connection epoch was not initialized.");
    }

    return epoch;
  }

  matchesConnectionEpoch(epoch: DriverInstanceConnectionEpoch): boolean {
    return this.connectionId === epoch.connectionId && this.driverGeneration === epoch.generation;
  }

  assertConnectionEpoch(epoch: DriverInstanceConnectionEpoch): void {
    if (!this.matchesConnectionEpoch(epoch)) {
      throw new Error("Driver connection is no longer current.");
    }
  }

  async resetForReuse(options: DriverInstanceResetOptions): Promise<void> {
    await options.beforeReset();

    const staleError = new Error("Driver generation is no longer current.");
    for (const waiter of this.closeWaiters.splice(0)) {
      waiter.deferred.reject(staleError);
    }
    for (const waiter of this.readyWaiters.splice(0)) {
      waiter.deferred.reject(staleError);
    }

    const driverInstanceId = this.requireDriverInstanceId();
    this.#applyStoredState({
      ...createEmptyStoredState(),
      driverGeneration: options.driverGeneration,
      driverInstanceId,
    });
    await this.#ctx.storage.deleteAll();
    await this.#persistState();
  }

  resetAfterDestroy(reason: string): void {
    const error = new Error(reason);

    for (const waiter of this.closeWaiters.splice(0)) {
      waiter.deferred.reject(error);
    }

    for (const waiter of this.commandWaiters.splice(0)) {
      waiter.deferred.resolve(null);
    }

    for (const waiter of this.readyWaiters.splice(0)) {
      waiter.deferred.reject(error);
    }

    this.#applyStoredState(createEmptyStoredState());
  }

  resolveCloseWaiters(result: DriverInstanceWaitForCloseResult, generation: number): void {
    for (const waiter of this.closeWaiters.splice(0)) {
      if (waiter.generation === generation) {
        waiter.deferred.resolve(result);
      } else {
        this.closeWaiters.push(waiter);
      }
    }
  }

  resolveReadyWaiters(result: DriverInstanceReadyResult, generation: number): void {
    for (const waiter of this.readyWaiters.splice(0)) {
      if (waiter.generation === generation) {
        waiter.deferred.resolve(result);
      } else {
        this.readyWaiters.push(waiter);
      }
    }
  }

  async initializeDriverInstance(
    driverInstanceId: DriverInstanceId,
    driverGeneration: number,
  ): Promise<void> {
    await this.#ctx.storage.put(DRIVER_INSTANCE_STATE_STORAGE_KEY, {
      ...this.#toStoredState(),
      driverGeneration,
      driverInstanceId,
    });
    this.driverGeneration = driverGeneration;
    this.driverInstanceId = driverInstanceId;
  }

  async setDriverGeneration(driverGeneration: number): Promise<void> {
    await this.#ctx.storage.put(DRIVER_INSTANCE_STATE_STORAGE_KEY, {
      ...this.#toStoredState(),
      driverGeneration,
    });
    this.driverGeneration = driverGeneration;
  }

  async setTerminalSessionRunId(
    sessionRunId: SessionRunId,
    epoch?: DriverInstanceConnectionEpoch,
  ): Promise<void> {
    if (epoch !== undefined) {
      this.assertConnectionEpoch(epoch);
    }
    if (this.terminalSessionRunId !== null && this.terminalSessionRunId !== sessionRunId) {
      throw new Error("Terminal Session Run identity is already fixed.");
    }

    await this.#ctx.storage.put(DRIVER_INSTANCE_STATE_STORAGE_KEY, {
      ...this.#toStoredState(),
      terminalSessionRunId: sessionRunId,
    });
    if (epoch !== undefined) {
      this.assertConnectionEpoch(epoch);
    }
    this.terminalSessionRunId = sessionRunId;
  }

  async setErrorMessage(message: string): Promise<void> {
    if (isTruthy(this.errorMessage)) {
      return;
    }

    this.errorMessage = message;
    await this.#persistState();
    this.rejectReadyWaiters(new Error(message), this.requireDriverGeneration());
  }

  async setConnectionErrorMessage(
    epoch: DriverInstanceConnectionEpoch,
    message: string,
  ): Promise<void> {
    this.assertConnectionEpoch(epoch);

    if (isTruthy(this.errorMessage)) {
      return;
    }

    await this.#ctx.storage.put(DRIVER_INSTANCE_STATE_STORAGE_KEY, {
      ...this.#toStoredState(),
      errorMessage: message,
    });
    this.assertConnectionEpoch(epoch);
    this.errorMessage = message;
    this.rejectReadyWaiters(new Error(message), epoch.generation);
  }

  setRuntimeSessionLink(link: RuntimeSessionLink): void {
    this.runtimeSessionLink = link;
  }

  #shouldPersistHeartbeat(heartbeatAtMs: number): boolean {
    return (
      this.lastPersistedHeartbeatAtMs === null ||
      heartbeatAtMs - this.lastPersistedHeartbeatAtMs >= HEARTBEAT_STATE_PERSIST_INTERVAL_MS
    );
  }

  async setTraceId(traceId: string, epoch?: DriverInstanceConnectionEpoch): Promise<void> {
    if (epoch !== undefined) {
      this.assertConnectionEpoch(epoch);
    }
    if (this.traceId === traceId) {
      return;
    }

    this.traceId = traceId;
    await this.#persistState();
    if (epoch !== undefined) {
      this.assertConnectionEpoch(epoch);
    }
  }

  snapshot(driverSocketConnected: boolean): DriverInstanceSnapshot {
    const recoveryMode = this.#snapshotRecoveryMode(driverSocketConnected);
    return {
      close: this.close,
      debugResume: createDriverDebugResumeSnapshot({
        recoveryMode,
        sandboxId: this.runtimeSessionLink?.sandboxId ?? null,
      }),
      driverSocketConnected,
      heartbeatCount: this.heartbeatCount,
      hello: this.hello,
      lastHeartbeatAt: this.lastHeartbeat?.at ?? null,
    };
  }

  #snapshotRecoveryMode(driverSocketConnected: boolean): DriverDebugRecoveryMode {
    if (this.close !== null) {
      return "turn_interrupted";
    }

    if (driverSocketConnected) {
      return "ready";
    }

    if (this.hello !== null) {
      return "disconnected";
    }

    return "fresh";
  }

  async waitForClose(
    generation: number,
    timeoutMs: number,
  ): Promise<DriverInstanceWaitForCloseResult> {
    this.assertGeneration(generation);

    if (this.close) {
      return this.closeResult();
    }

    const waiter: GenerationWaiter<DriverInstanceWaitForCloseResult> = {
      deferred: createDeferred<DriverInstanceWaitForCloseResult>(),
      generation,
    };
    this.closeWaiters.push(waiter);
    try {
      return await withTimeout(
        waiter.deferred.promise,
        timeoutMs,
        `Driver instance ${this.requireDriverInstanceId()} close`,
      );
    } finally {
      this.#removeWaiter(this.closeWaiters, waiter);
    }
  }

  async waitForReady(generation: number, timeoutMs: number): Promise<DriverInstanceReadyResult> {
    this.assertGeneration(generation);

    if (isTruthy(this.errorMessage)) {
      throw new Error(this.errorMessage);
    }

    if (this.close) {
      throw new Error(`Driver instance ${this.requireDriverInstanceId()} closed before ready.`);
    }

    if (this.ready) {
      return this.readyResult();
    }

    const waiter: GenerationWaiter<DriverInstanceReadyResult> = {
      deferred: createDeferred<DriverInstanceReadyResult>(),
      generation,
    };

    this.readyWaiters.push(waiter);
    try {
      return await withTimeout(
        waiter.deferred.promise,
        timeoutMs,
        `Driver instance ${this.requireDriverInstanceId()} ready`,
      );
    } finally {
      this.#removeWaiter(this.readyWaiters, waiter);
    }
  }

  #removeWaiter<T>(waiters: GenerationWaiter<T>[], waiter: GenerationWaiter<T>): void {
    const index = waiters.indexOf(waiter);

    if (index !== -1) {
      waiters.splice(index, 1);
    }
  }

  assertGeneration(generation: number): void {
    if (this.requireDriverGeneration() !== generation) {
      throw new Error("Driver generation is no longer current.");
    }
  }

  readyResult(): DriverInstanceReadyResult {
    if (this.ready === null) {
      throw new Error(`Driver instance ${this.requireDriverInstanceId()} is not ready yet.`);
    }

    return {
      heartbeatCount: this.heartbeatCount,
      lastHeartbeatAt: this.lastHeartbeat?.at ?? null,
      ready: this.ready,
    };
  }

  closeResult(): DriverInstanceWaitForCloseResult {
    if (!this.close) {
      throw new Error(`Driver instance ${this.requireDriverInstanceId()} is not closed yet.`);
    }

    const snapshot = this.snapshot(false);

    return {
      close: this.close,
      debugResume: snapshot.debugResume,
      driverSocketConnected: false,
      heartbeatCount: this.heartbeatCount,
      hello: this.hello,
      lastHeartbeatAt: this.lastHeartbeat?.at ?? null,
    };
  }
}
