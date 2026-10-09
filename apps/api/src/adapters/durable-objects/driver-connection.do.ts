import type { RuntimeCommand } from "@mosoo/contracts/runtime-command";
import type { DriverInstanceId } from "@mosoo/id";
import { DurableObject } from "cloudflare:workers";

import type { DriverInstanceSnapshot } from "../../modules/runtime/infrastructure/driver-instance/state";
import type { ApiBindings } from "../../platform/cloudflare/worker-types";

interface DriverConnectionDelegate {
  alarm(): Promise<void>;
  destroy(driverInstanceId: DriverInstanceId, reason: string): Promise<void>;
  fail(driverInstanceId: DriverInstanceId, message: string): Promise<void>;
  fetch(request: Request): Promise<Response>;
  sendControlCommand(driverInstanceId: DriverInstanceId, command: RuntimeCommand): Promise<void>;
  snapshot(driverInstanceId: DriverInstanceId): Promise<DriverInstanceSnapshot>;
  waitForClose(driverInstanceId: DriverInstanceId, timeoutMs: number): Promise<void>;
  waitForReady(driverInstanceId: DriverInstanceId, timeoutMs: number): Promise<void>;
  webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void>;
  webSocketError(ws: WebSocket, error: unknown): Promise<void> | void;
  webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void>;
}

export class DriverConnection extends DurableObject {
  readonly #delegatePromise: Promise<DriverConnectionDelegate>;

  constructor(ctx: DurableObjectState, env: ApiBindings) {
    super(ctx, env);

    this.#delegatePromise = import("../../modules/runtime/infrastructure/driver-instance/do").then(
      ({ DriverInstance }) => new DriverInstance(ctx, env),
    );
  }

  override async fetch(request: Request): Promise<Response> {
    return (await this.#delegatePromise).fetch(request);
  }

  override async alarm(): Promise<void> {
    await (await this.#delegatePromise).alarm();
  }

  async destroy(driverInstanceId: DriverInstanceId, reason: string): Promise<void> {
    await (await this.#delegatePromise).destroy(driverInstanceId, reason);
  }

  async fail(driverInstanceId: DriverInstanceId, message: string): Promise<void> {
    await (await this.#delegatePromise).fail(driverInstanceId, message);
  }

  async sendControlCommand(
    driverInstanceId: DriverInstanceId,
    command: RuntimeCommand,
  ): Promise<void> {
    await (await this.#delegatePromise).sendControlCommand(driverInstanceId, command);
  }

  async snapshot(driverInstanceId: DriverInstanceId): Promise<DriverInstanceSnapshot> {
    return (await this.#delegatePromise).snapshot(driverInstanceId);
  }

  async waitForClose(driverInstanceId: DriverInstanceId, timeoutMs: number): Promise<void> {
    await (await this.#delegatePromise).waitForClose(driverInstanceId, timeoutMs);
  }

  async waitForReady(driverInstanceId: DriverInstanceId, timeoutMs: number): Promise<void> {
    await (await this.#delegatePromise).waitForReady(driverInstanceId, timeoutMs);
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    await (await this.#delegatePromise).webSocketClose(ws, code, reason);
  }

  override async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    await (await this.#delegatePromise).webSocketError(ws, error);
  }

  override async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
    await (await this.#delegatePromise).webSocketMessage(ws, message);
  }
}
