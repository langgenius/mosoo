import type { AgUiSessionEvent } from "@mosoo/ag-ui-session";
import { parsePlatformId } from "@mosoo/id";
import type { SessionId } from "@mosoo/id";
import { DurableObject } from "cloudflare:workers";

import { DurableObjectIdentity } from "../../../../platform/cloudflare/durable-object-support";
import {
  createErrorLogContext,
  logError,
  runWithApiLogContext,
} from "../../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { SessionPublicEventSocketHub } from "./public-event-socket-hub";
import { json, toErrorMessage } from "./requests";
import { SESSION_ID_HEADER } from "./socket-headers";
import { SessionViewerSocketHub } from "./viewer-socket-hub";
export class Session extends DurableObject {
  #destroyed = false;
  readonly #identity = new DurableObjectIdentity({
    mismatchMessage: "Session id does not match the active Durable Object.",
    requiredMessage: "Session id is required.",
  });
  readonly #publicEventSockets: SessionPublicEventSocketHub;
  readonly #viewerSockets: SessionViewerSocketHub;

  constructor(ctx: DurableObjectState, env: ApiBindings) {
    super(ctx, env);

    this.#publicEventSockets = new SessionPublicEventSocketHub({
      ctx,
      getSessionId: () => this.#identity.value,
      withSessionLogContext: (fn) => this.#withSessionLogContext(fn),
    });
    this.#viewerSockets = new SessionViewerSocketHub({
      ctx,
      env,
      getSessionId: () => this.#identity.value,
      rememberSessionId: (sessionId) => {
        this.#identity.remember(sessionId);
      },
      withSessionLogContext: (fn) => this.#withSessionLogContext(fn),
    });
  }

  override async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);

      if (this.#destroyed) {
        if (request.method === "POST" && url.pathname === "/destroy") {
          return json({ ok: true });
        }

        return json({ error: "Session Durable Object was destroyed." }, { status: 410 });
      }

      const sessionId = request.headers.get(SESSION_ID_HEADER);
      this.#identity.ensure(
        sessionId === null
          ? null
          : parsePlatformId<SessionId>(sessionId, "Session Durable Object ID"),
      );

      if (url.pathname === "/viewer/ws") {
        return this.#viewerSockets.connect(request);
      }

      if (url.pathname === "/public-events/ws") {
        return this.#publicEventSockets.connect(request);
      }

      return json({ error: "Not Found" }, { status: 404 });
    } catch (error) {
      const message = toErrorMessage(error);
      this.#withSessionLogContext(() => {
        logError("session.do.request.failed", {
          ...createErrorLogContext(error),
          sessionId: this.#identity.value,
        });
      });
      return json({ error: message }, { status: 500 });
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

  override async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
    if (this.#destroyed) {
      return;
    }

    if (this.#publicEventSockets.owns(ws)) {
      return;
    }

    await this.#viewerSockets.handleSocketMessage(ws, message);
  }

  #ensureActiveRpcSession(sessionId: string): SessionId {
    if (this.#destroyed) {
      throw new Error("Session Durable Object was destroyed.");
    }

    const normalizedSessionId = parsePlatformId<SessionId>(
      sessionId,
      "Session Durable Object RPC session ID",
    );
    this.#identity.ensure(normalizedSessionId);
    return normalizedSessionId;
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

  async destroy(sessionId: string, reason: string): Promise<void> {
    if (this.#destroyed) {
      return;
    }

    this.#identity.ensure(
      parsePlatformId<SessionId>(sessionId, "Session Durable Object RPC session ID"),
    );
    await this.#destroy(reason);
  }

  async #destroy(reason: string): Promise<void> {
    this.#destroyed = true;
    this.#viewerSockets.closeSockets(reason);
    this.#publicEventSockets.closeSockets(reason);
    this.#identity.clear();
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  #withSessionLogContext<T>(fn: () => T): T {
    return runWithApiLogContext(
      this.#identity.value !== null ? { sessionId: this.#identity.value } : {},
      fn,
    );
  }
}
