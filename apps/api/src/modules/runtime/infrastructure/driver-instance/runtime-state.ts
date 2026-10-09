import type { DriverHeartbeatInput, DriverReadyInput } from "@mosoo/agent-driver/orpc";
import { createPromiseDeferred, promiseWithTimeout } from "@mosoo/effects";
import type { PromiseDeferred } from "@mosoo/effects";
import type { DriverInstanceId } from "@mosoo/id";

import { isTruthy } from "../../../../shared/truthiness";
import { runtimeSessionLinkNeedsRefresh } from "./event-types";
import type { RuntimeSessionLink, SessionLiveState } from "./event-types";
import type { DriverHelloInput } from "./rpc-wire";
import {
  DRIVER_INSTANCE_STATE_STORAGE_KEY,
  DRIVER_FINALIZATION_RETRY_MS,
  createEmptyStoredState,
} from "./runtime-state-store";
import type {
  DriverInstanceRuntimeStateContext,
  DriverInstanceStoredState,
} from "./runtime-state-store";
import { getRuntimeSessionLink } from "./session-link.repository";
import type { GetRuntimeSessionLinkOptions } from "./session-link.repository";
import type { DriverInstanceCloseSnapshot } from "./state";

export class DriverInstanceRuntimeState {
  close: DriverInstanceCloseSnapshot | null = null;
  readonly closeWaiters: PromiseDeferred<void>[] = [];
  connectionId: string | null = null;
  driverGeneration: number | null = null;
  driverInstanceId: DriverInstanceId | null = null;
  driverEventReceiptSeq = 0;
  errorMessage: string | null = null;
  finalizationCompleted = false;
  heartbeatCount = 0;
  hello: DriverHelloInput | null = null;
  lastHeartbeat: DriverHeartbeatInput | null = null;
  liveState: SessionLiveState | null = null;
  ready: DriverReadyInput | null = null;
  readonly readyWaiters: PromiseDeferred<void>[] = [];
  runtimeSessionLink: RuntimeSessionLink | null = null;
  terminalized = false;
  traceId: string | null = null;
  readonly #ctx: DriverInstanceRuntimeStateContext;

  constructor(ctx: DriverInstanceRuntimeStateContext) {
    this.#ctx = ctx;
  }

  #applyStoredState(snapshot: DriverInstanceStoredState): void {
    this.close = snapshot.close;
    this.connectionId = snapshot.connectionId;
    this.driverGeneration = snapshot.driverGeneration;
    this.driverInstanceId = snapshot.driverInstanceId;
    this.driverEventReceiptSeq = 0;
    this.errorMessage = snapshot.errorMessage;
    this.finalizationCompleted = snapshot.finalizationCompleted;
    this.heartbeatCount = snapshot.heartbeatCount;
    this.hello = snapshot.hello;
    this.lastHeartbeat = snapshot.lastHeartbeat;
    this.liveState = null;
    this.ready = snapshot.ready;
    this.runtimeSessionLink = null;
    this.terminalized = snapshot.close !== null;
    this.traceId = snapshot.traceId;
  }

  async #persistState(): Promise<void> {
    await this.#ctx.storage.put(DRIVER_INSTANCE_STATE_STORAGE_KEY, this.#toStoredState());
  }

  #toStoredState(): DriverInstanceStoredState & { commandQueue: []; connectedAt: null } {
    return {
      close: this.close,
      // The previous release parses stored state strictly and requires these
      // fields; keep writing them while that release is still a rollback target.
      commandQueue: [],
      connectedAt: null,
      connectionId: this.connectionId,
      driverGeneration: this.driverGeneration,
      driverInstanceId: this.driverInstanceId,
      errorMessage: this.errorMessage,
      finalizationCompleted: this.finalizationCompleted,
      heartbeatCount: this.heartbeatCount,
      hello: this.hello,
      lastHeartbeat: this.lastHeartbeat,
      ready: this.ready,
      traceId: this.traceId,
    };
  }

  async load(): Promise<void> {
    this.#applyStoredState({
      ...createEmptyStoredState(),
      ...(await this.#ctx.storage.get<Partial<DriverInstanceStoredState>>(
        DRIVER_INSTANCE_STATE_STORAGE_KEY,
      )),
    });
  }

  async getRuntimeSessionLink(
    database: D1Database,
    options: GetRuntimeSessionLinkOptions & { refresh?: boolean } = {},
  ): Promise<RuntimeSessionLink> {
    const cached = this.runtimeSessionLink;

    if (cached !== null && !(options.refresh ?? runtimeSessionLinkNeedsRefresh(cached))) {
      return cached;
    }

    const link = await getRuntimeSessionLink(database, this.requireDriverInstanceId(), options);
    this.runtimeSessionLink = link;
    return link;
  }

  async persistClose(close: DriverInstanceCloseSnapshot): Promise<void> {
    if (this.finalizationCompleted) {
      return;
    }
    this.close ??= close;
    this.terminalized = true;
    // Writes without an intervening await commit atomically in DO storage.
    await Promise.all([
      this.#persistState(),
      this.#ctx.storage.setAlarm(Date.now() + DRIVER_FINALIZATION_RETRY_MS),
    ]);
  }

  async persistTerminalSnapshot(): Promise<void> {
    await Promise.all([
      this.#ctx.storage.put(DRIVER_INSTANCE_STATE_STORAGE_KEY, {
        ...this.#toStoredState(),
        finalizationCompleted: true,
      }),
      this.#ctx.storage.deleteAlarm(),
    ]);
    this.finalizationCompleted = true;
  }

  async recordAcceptedConnection(input: {
    connectionId: string;
    driverGeneration: number;
    traceId: string | null;
  }): Promise<void> {
    this.connectionId = input.connectionId;
    this.driverGeneration = input.driverGeneration;

    if (input.traceId !== null) {
      this.traceId = input.traceId;
    }

    await this.#persistState();
  }

  async recordHeartbeat(payload: DriverHeartbeatInput): Promise<void> {
    this.heartbeatCount += 1;
    this.lastHeartbeat = payload;
    await this.#persistState();
  }

  async recordHello(input: DriverHelloInput): Promise<void> {
    this.hello = input;
    await this.#persistState();
  }

  async recordReady(input: DriverReadyInput): Promise<void> {
    this.ready = input;
    await this.#persistState();

    for (const waiter of this.readyWaiters.splice(0)) {
      waiter.resolve();
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

  async resetForReuse(): Promise<void> {
    const driverInstanceId = this.requireDriverInstanceId();
    this.#applyStoredState({
      ...createEmptyStoredState(),
      driverInstanceId,
    });
    await this.#ctx.storage.deleteAll();
    await this.#ctx.storage.deleteAlarm();
    await this.#persistState();
  }

  async destroy(reason: string): Promise<void> {
    await this.#ctx.storage.deleteAlarm();
    await this.#ctx.storage.deleteAll();

    const error = new Error(reason);

    for (const waiter of [...this.closeWaiters.splice(0), ...this.readyWaiters.splice(0)]) {
      waiter.reject(error);
    }

    this.#applyStoredState(createEmptyStoredState());
  }

  resolveCloseWaiters(): void {
    for (const waiter of this.closeWaiters.splice(0)) {
      waiter.resolve();
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
    this.rejectReadyWaiters(new Error(message));
  }

  async setTraceId(traceId: string): Promise<void> {
    if (this.traceId === traceId) {
      return;
    }

    this.traceId = traceId;
    await this.#persistState();
  }

  async waitForClose(timeoutMs: number): Promise<void> {
    if (this.close) {
      return;
    }

    const deferred = createPromiseDeferred<void>();
    this.closeWaiters.push(deferred);
    await promiseWithTimeout(deferred.promise, {
      label: `Driver instance ${this.requireDriverInstanceId()} close`,
      timeoutMs,
    });
  }

  async waitForReady(timeoutMs: number): Promise<void> {
    if (isTruthy(this.errorMessage)) {
      throw new Error(this.errorMessage);
    }

    if (this.close) {
      throw new Error(`Driver instance ${this.requireDriverInstanceId()} closed before ready.`);
    }

    if (this.ready) {
      return;
    }

    const deferred = createPromiseDeferred<void>();
    this.readyWaiters.push(deferred);
    await promiseWithTimeout(deferred.promise, {
      label: `Driver instance ${this.requireDriverInstanceId()} ready`,
      timeoutMs,
    });
  }
}
