import type { AgUiSessionEvent } from "@mosoo/ag-ui-session";
import { DurableObject } from "cloudflare:workers";

import type { ApiBindings } from "../../platform/cloudflare/worker-types";

interface SessionDelegate {
  alarm(): Promise<void>;
  closeViewers(sessionId: string, reason: string): Promise<void>;
  destroy(sessionId: string, reason: string): Promise<void>;
  fetch(request: Request): Promise<Response>;
  publishEvents(sessionId: string, events: AgUiSessionEvent[]): Promise<void>;
  syncViewers(sessionId: string): Promise<void>;
  webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void>;
  webSocketError(ws: WebSocket, error: unknown): Promise<void> | void;
  webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void>;
}

export class Session extends DurableObject {
  readonly #delegatePromise: Promise<SessionDelegate>;

  constructor(ctx: DurableObjectState, env: ApiBindings) {
    super(ctx, env);

    this.#delegatePromise = import("../../modules/sessions/application/session-do.service").then(
      ({ Session: SessionImplementation }) => new SessionImplementation(ctx, env),
    );
  }

  override async fetch(request: Request): Promise<Response> {
    return (await this.#delegatePromise).fetch(request);
  }

  override async alarm(): Promise<void> {
    await (await this.#delegatePromise).alarm();
  }

  async publishEvents(sessionId: string, events: AgUiSessionEvent[]): Promise<void> {
    await (await this.#delegatePromise).publishEvents(sessionId, events);
  }

  async syncViewers(sessionId: string): Promise<void> {
    await (await this.#delegatePromise).syncViewers(sessionId);
  }

  async closeViewers(sessionId: string, reason: string): Promise<void> {
    await (await this.#delegatePromise).closeViewers(sessionId, reason);
  }

  async destroy(sessionId: string, reason: string): Promise<void> {
    await (await this.#delegatePromise).destroy(sessionId, reason);
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
