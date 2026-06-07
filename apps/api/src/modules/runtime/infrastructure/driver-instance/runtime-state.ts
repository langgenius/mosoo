import type { RuntimeCommand } from "@mosoo/contracts/runtime-command";
import type { DriverInstanceId } from "@mosoo/id";
import type { DriverEventEnvelope } from "agent-driver/events";
import type {
  DriverEventReceipt,
  DriverHeartbeatInput,
  DriverHelloInput,
  DriverReadyInput,
} from "agent-driver/orpc";

import { isTruthy } from "../../../../shared/truthiness";
import type { DriverInstanceCommandState, RuntimeCommandWaiter } from "./commands";
import {
  createReceiptsForDriverEvents,
  filterNewDriverEvents,
  readReceiptsForProcessedDriverEvents,
  rememberDriverEventReceipts,
} from "./driver-event-receipts";
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
  DriverInstanceRuntimeStateContext,
  DriverInstanceStoredState,
} from "./runtime-state-store";
import type {
  DriverInstanceCloseSnapshot,
  DriverInstanceHeartbeatResult,
  DriverInstanceHelloResult,
  DriverInstanceReadyResult,
  DriverInstanceSnapshot,
  DriverInstanceWaitForCloseResult,
  HeartbeatWaiter,
} from "./state";

interface DriverInstanceResetOptions {
  beforeReset: () => Promise<void>;
}

export interface DriverInstanceHeartbeatRecord {
  shouldPersistCanonical: boolean;
}

export class DriverInstanceRuntimeState {
  close: DriverInstanceCloseSnapshot | null = null;
  readonly closeWaiters: Deferred<DriverInstanceWaitForCloseResult>[] = [];
  commandQueue: RuntimeCommand[] = [];
  readonly commandWaiters: RuntimeCommandWaiter[] = [];
  connectedAt: number | null = null;
  connectionId: string | null = null;
  driverGeneration: number | null = null;
  driverInstanceId: DriverInstanceId | null = null;
  driverEventReceiptSeq = 0;
  errorMessage: string | null = null;
  heartbeatCount = 0;
  readonly heartbeatWaiters: HeartbeatWaiter[] = [];
  hello: DriverHelloInput | null = null;
  readonly helloWaiters: Deferred<DriverInstanceHelloResult>[] = [];
  lastHeartbeat: DriverHeartbeatInput | null = null;
  lastPersistedHeartbeatAtMs: number | null = null;
  readonly processedDriverEventReceipts = new Map<string, DriverEventReceipt>();
  ready: DriverReadyInput | null = null;
  readonly readyWaiters: Deferred<DriverInstanceReadyResult>[] = [];
  runtimeSessionLink: RuntimeSessionLink | null = null;
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
    this.driverEventReceiptSeq = 0;
    this.errorMessage = snapshot.errorMessage;
    this.heartbeatCount = snapshot.heartbeatCount;
    this.hello = snapshot.hello;
    this.lastHeartbeat = snapshot.lastHeartbeat;
    this.lastPersistedHeartbeatAtMs = snapshot.lastHeartbeat
      ? parseHeartbeatTimestampMs(snapshot.lastHeartbeat.at)
      : null;
    this.processedDriverEventReceipts.clear();
    this.ready = snapshot.ready ?? null;
    this.runtimeSessionLink = null;
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
      lastHeartbeat: this.lastHeartbeat,
      ready: this.ready,
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

  async persistClose(close: DriverInstanceCloseSnapshot): Promise<void> {
    this.close = close;
    await this.#persistState();
  }

  async persistCommandQueue(): Promise<void> {
    await this.#persistState();
  }

  async persistTerminalSnapshot(): Promise<void> {
    this.requireDriverInstanceId();
    this.commandQueue = [];
    await this.#persistState();
  }

  async recordAcceptedConnection(input: {
    connectedAt: number;
    connectionId: string;
    driverGeneration: number;
    traceId: string | null;
  }): Promise<void> {
    this.connectedAt = input.connectedAt;
    this.connectionId = input.connectionId;
    this.driverGeneration = input.driverGeneration;

    if (input.traceId !== null) {
      this.traceId = input.traceId;
    }

    await this.#persistState();
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

    const result: DriverInstanceHeartbeatResult = {
      heartbeat: payload,
      heartbeatCount: this.heartbeatCount,
      lastHeartbeatAt: payload.at,
    };

    for (const waiter of this.heartbeatWaiters.splice(0)) {
      if (result.heartbeatCount > waiter.afterCount) {
        waiter.deferred.resolve(result);
        continue;
      }

      this.heartbeatWaiters.push(waiter);
    }

    return { shouldPersistCanonical };
  }

  async recordHello(input: DriverHelloInput): Promise<DriverInstanceHelloResult> {
    if (this.hello) {
      throw new Error("Driver hello has already been received.");
    }

    this.hello = input;
    await this.#persistState();

    const result: DriverInstanceHelloResult = {
      heartbeatCount: this.heartbeatCount,
      hello: input,
      lastHeartbeatAt: this.lastHeartbeat?.at ?? null,
    };

    return result;
  }

  async recordReady(input: DriverReadyInput): Promise<DriverInstanceReadyResult> {
    if (this.ready) {
      throw new Error("Driver ready has already been received.");
    }

    this.ready = input;
    await this.#persistState();

    return {
      heartbeatCount: this.heartbeatCount,
      lastHeartbeatAt: this.lastHeartbeat?.at ?? null,
      ready: input,
    };
  }

  rejectHeartbeatWaiters(error: Error): void {
    for (const waiter of this.heartbeatWaiters.splice(0)) {
      waiter.deferred.reject(error);
    }
  }

  rejectHelloWaiters(error: Error): void {
    for (const waiter of this.helloWaiters.splice(0)) {
      waiter.reject(error);
    }
  }

  rejectReadyWaiters(error: Error): void {
    for (const waiter of this.readyWaiters.splice(0)) {
      waiter.reject(error);
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

  async resetForReuse(options: DriverInstanceResetOptions): Promise<void> {
    await options.beforeReset();

    const driverInstanceId = this.requireDriverInstanceId();
    this.#applyStoredState({
      ...createEmptyStoredState(),
      driverInstanceId,
    });
    await this.#ctx.storage.deleteAll();
    await this.#persistState();
  }

  resetAfterDestroy(reason: string): void {
    const error = new Error(reason);

    for (const waiter of this.closeWaiters.splice(0)) {
      waiter.reject(error);
    }

    for (const waiter of this.commandWaiters.splice(0)) {
      waiter.deferred.resolve(null);
    }

    for (const waiter of this.helloWaiters.splice(0)) {
      waiter.reject(error);
    }

    for (const waiter of this.heartbeatWaiters.splice(0)) {
      waiter.deferred.reject(error);
    }

    for (const waiter of this.readyWaiters.splice(0)) {
      waiter.reject(error);
    }

    this.#applyStoredState(createEmptyStoredState());
  }

  resolveCloseWaiters(result: DriverInstanceWaitForCloseResult): void {
    for (const waiter of this.closeWaiters.splice(0)) {
      waiter.resolve(result);
    }
  }

  resolveHelloWaiters(result: DriverInstanceHelloResult): void {
    for (const waiter of this.helloWaiters.splice(0)) {
      waiter.resolve(result);
    }
  }

  resolveReadyWaiters(result: DriverInstanceReadyResult): void {
    for (const waiter of this.readyWaiters.splice(0)) {
      waiter.resolve(result);
    }
  }

  async setDriverInstanceId(driverInstanceId: DriverInstanceId): Promise<void> {
    this.driverInstanceId = driverInstanceId;
    await this.#persistState();
  }

  async setErrorMessage(message: string): Promise<void> {
    if (isTruthy(this.errorMessage)) {
      return;
    }

    this.errorMessage = message;
    await this.#persistState();
    this.rejectHelloWaiters(new Error(message));
    this.rejectHeartbeatWaiters(new Error(message));
    this.rejectReadyWaiters(new Error(message));
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

  filterUnprocessedDriverEvents(events: readonly DriverEventEnvelope[]): DriverEventEnvelope[] {
    return filterNewDriverEvents({
      events,
      processedReceipts: this.processedDriverEventReceipts,
    });
  }

  createDriverEventReceipts(events: readonly DriverEventEnvelope[]): DriverEventReceipt[] {
    const result = createReceiptsForDriverEvents({
      events,
      nextSeq: this.driverEventReceiptSeq,
    });
    this.driverEventReceiptSeq = result.nextSeq;
    return result.receipts;
  }

  readProcessedDriverEventReceipts(events: readonly DriverEventEnvelope[]): DriverEventReceipt[] {
    return readReceiptsForProcessedDriverEvents({
      events,
      processedReceipts: this.processedDriverEventReceipts,
    });
  }

  rememberProcessedDriverEventReceipts(receipts: DriverEventReceipt[]): void {
    rememberDriverEventReceipts({
      processedReceipts: this.processedDriverEventReceipts,
      receipts,
    });
  }

  async setTraceId(traceId: string): Promise<void> {
    if (this.traceId === traceId) {
      return;
    }

    this.traceId = traceId;
    await this.#persistState();
  }

  snapshot(driverSocketConnected: boolean): DriverInstanceSnapshot {
    return {
      close: this.close,
      driverSocketConnected,
      heartbeatCount: this.heartbeatCount,
      hello: this.hello,
      lastHeartbeatAt: this.lastHeartbeat?.at ?? null,
    };
  }

  async waitForClose(timeoutMs: number): Promise<DriverInstanceWaitForCloseResult> {
    if (this.close) {
      return this.closeResult();
    }

    const deferred = createDeferred<DriverInstanceWaitForCloseResult>();
    this.closeWaiters.push(deferred);
    return withTimeout(
      deferred.promise,
      timeoutMs,
      `Driver instance ${this.requireDriverInstanceId()} close`,
    );
  }

  async waitForHeartbeat(
    afterCount: number,
    timeoutMs: number,
  ): Promise<DriverInstanceHeartbeatResult> {
    if (this.lastHeartbeat && this.heartbeatCount > afterCount) {
      return {
        heartbeat: this.lastHeartbeat,
        heartbeatCount: this.heartbeatCount,
        lastHeartbeatAt: this.lastHeartbeat.at,
      };
    }

    if (isTruthy(this.errorMessage)) {
      throw new Error(this.errorMessage);
    }

    if (this.close) {
      throw new Error(`Driver instance ${this.requireDriverInstanceId()} is already closed.`);
    }

    const waiter: HeartbeatWaiter = {
      afterCount,
      deferred: createDeferred<DriverInstanceHeartbeatResult>(),
    };

    this.heartbeatWaiters.push(waiter);
    return withTimeout(
      waiter.deferred.promise,
      timeoutMs,
      `Driver instance ${this.requireDriverInstanceId()} heartbeat`,
    );
  }

  async waitForHello(timeoutMs: number): Promise<DriverInstanceHelloResult> {
    if (this.hello) {
      return {
        heartbeatCount: this.heartbeatCount,
        hello: this.hello,
        lastHeartbeatAt: this.lastHeartbeat?.at ?? null,
      };
    }

    if (isTruthy(this.errorMessage)) {
      throw new Error(this.errorMessage);
    }

    if (this.close) {
      throw new Error(`Driver instance ${this.requireDriverInstanceId()} closed before hello.`);
    }

    const deferred = createDeferred<DriverInstanceHelloResult>();
    this.helloWaiters.push(deferred);
    return withTimeout(
      deferred.promise,
      timeoutMs,
      `Driver instance ${this.requireDriverInstanceId()} hello`,
    );
  }

  async waitForReady(timeoutMs: number): Promise<DriverInstanceReadyResult> {
    if (isTruthy(this.errorMessage)) {
      throw new Error(this.errorMessage);
    }

    if (this.close) {
      throw new Error(`Driver instance ${this.requireDriverInstanceId()} closed before ready.`);
    }

    if (this.ready) {
      return {
        heartbeatCount: this.heartbeatCount,
        lastHeartbeatAt: this.lastHeartbeat?.at ?? null,
        ready: this.ready,
      };
    }

    const deferred = createDeferred<DriverInstanceReadyResult>();
    this.readyWaiters.push(deferred);
    return withTimeout(
      deferred.promise,
      timeoutMs,
      `Driver instance ${this.requireDriverInstanceId()} ready`,
    );
  }

  closeResult(): DriverInstanceWaitForCloseResult {
    if (!this.close) {
      throw new Error(`Driver instance ${this.requireDriverInstanceId()} is not closed yet.`);
    }

    return {
      close: this.close,
      driverSocketConnected: false,
      heartbeatCount: this.heartbeatCount,
      hello: this.hello,
      lastHeartbeatAt: this.lastHeartbeat?.at ?? null,
    };
  }
}
