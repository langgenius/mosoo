import { DurableObject } from "cloudflare:workers";

import type { ApiBindings } from "../../platform/cloudflare/worker-types";

interface DriverConnectionDelegate {
  fetch(request: Request): Promise<Response>;
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
