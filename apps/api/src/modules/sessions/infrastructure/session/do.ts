import type { AgUiSessionEvent } from "@mosoo/ag-ui-session";
import { DurableObject } from "cloudflare:workers";

import {
  createErrorLogContext,
  logError,
  runWithApiLogContext,
} from "../../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { SessionPublicEventSocketHub } from "./public-event-socket-hub";
import { SESSION_ID_HEADER } from "./socket-headers";
import { SessionViewerSocketHub } from "./viewer-socket-hub";
export class Session extends DurableObject {
  #destroyed = false;
  #sessionId: string | null = null;
  readonly #publicEventSockets: SessionPublicEventSocketHub;
  readonly #viewerSockets: SessionViewerSocketHub;

  constructor(ctx: DurableObjectState, env: ApiBindings) {
    super(ctx, env);

    this.#publicEventSockets = new SessionPublicEventSocketHub({
      ctx,
      getSessionId: () => this.#sessionId,
      withSessionLogContext: (fn) => this.#withSessionLogContext(fn),
    });
    this.#viewerSockets = new SessionViewerSocketHub({
      ctx,
      env,
      rememberSessionId: (sessionId) => {
        this.#sessionId = sessionId;
      },
      withSessionLogContext: (fn) => this.#withSessionLogContext(fn),
    });
  }

  override async fetch(request: Request): Promise<Response> {
    try {
      if (this.#destroyed) {
        return Response.json({ error: "Session Durable Object was destroyed." }, { status: 410 });
      }

      this.#sessionId = request.headers.get(SESSION_ID_HEADER);
      const url = new URL(request.url);

      if (url.pathname === "/viewer/ws") {
        return this.#viewerSockets.connect(request);
      }

      if (url.pathname === "/public-events/ws") {
        return this.#publicEventSockets.connect(request);
      }

      return Response.json({ error: "Not Found" }, { status: 404 });
    } catch (error) {
      this.#withSessionLogContext(() => {
        logError("session.do.request.failed", {
          ...createErrorLogContext(error),
          sessionId: this.#sessionId,
        });
      });
      return Response.json(
        { error: error instanceof Error ? error.message : "Session request failed." },
        { status: 500 },
      );
    }
  }

  override async alarm(): Promise<void> {
    if (this.#destroyed) {
      return;
    }

    await this.#viewerSockets.handleAlarm();
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    if (this.#destroyed) {
      return;
    }

    if (this.#publicEventSockets.owns(ws)) {
      return;
    }

    await this.#viewerSockets.handleSocketClose(ws, code, reason);
  }

  override webSocketError(ws: WebSocket, error: unknown): void {
    if (this.#destroyed) {
      return;
    }

    if (this.#publicEventSockets.owns(ws)) {
      return;
    }

    this.#viewerSockets.handleSocketError(ws, error);
  }

  #ensureActiveRpcSession(sessionId: string): void {
    if (this.#destroyed) {
      throw new Error("Session Durable Object was destroyed.");
    }

    this.#sessionId = sessionId;
  }

  async publishEvents(sessionId: string, events: AgUiSessionEvent[]): Promise<void> {
    this.#ensureActiveRpcSession(sessionId);
    if (events.length > 0) {
      this.#publicEventSockets.notifyEventsAvailable();
    }
    await this.#viewerSockets.broadcastEvents(events);
  }

  async syncViewers(sessionId: string): Promise<void> {
    this.#ensureActiveRpcSession(sessionId);
    await this.#viewerSockets.broadcastStateSync();
  }

  async closeViewers(sessionId: string, reason: string): Promise<void> {
    this.#ensureActiveRpcSession(sessionId);
    this.#viewerSockets.closeSockets(reason);
    this.#publicEventSockets.closeSockets(reason);
  }

  async destroy(reason: string): Promise<void> {
    if (this.#destroyed) {
      return;
    }

    this.#destroyed = true;
    this.#viewerSockets.closeSockets(reason);
    this.#publicEventSockets.closeSockets(reason);
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  #withSessionLogContext<T>(fn: () => T): T {
    return runWithApiLogContext(this.#sessionId !== null ? { sessionId: this.#sessionId } : {}, fn);
  }
}
