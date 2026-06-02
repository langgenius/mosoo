import { MOSOO_CUSTOM_EVENT, parseViewerCustomEventJson } from "@mosoo/ag-ui-session";
import type { AgUiSessionEvent } from "@mosoo/ag-ui-session";

import {
  closeOpenSocket,
  sendFrames,
} from "../../../../platform/cloudflare/durable-object-support";
import { createErrorLogContext, logError, logInfo } from "../../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import type { SessionLiveState } from "../session-live-state.types";
import { json } from "./requests";
import { readSessionViewerSocketHeaders } from "./socket-headers";
import {
  clearViewerPermissionCleanupAlarm,
  runViewerPermissionCleanupAlarm,
  scheduleViewerPermissionCleanupAlarm,
} from "./viewer-permission-cleanup";
import { isViewerSocketAttachment } from "./viewer-socket";
import type { SessionSocketAttachment, ViewerSocketAttachment } from "./viewer-socket";
import { buildViewerBroadcastFrames } from "./viewer-socket-broadcast";
import {
  ensureViewerSocketSessionActive,
  closeInactiveViewerSocket,
  isKnownInactiveViewerSessionError,
  sendViewerSocketStateSyncBatch,
  sendViewerSocketStateSync,
} from "./viewer-socket-state-sync";

declare const WebSocketPair: new () => [WebSocket, WebSocket];

interface SessionViewerSocketHubOptions {
  ctx: DurableObjectState;
  env: ApiBindings;
  getSessionId: () => string | null;
  rememberSessionId: (sessionId: string) => void;
  withSessionLogContext: <T>(fn: () => T) => T;
}

function getSocketAttachment(ws: WebSocket): SessionSocketAttachment | null {
  const attachment: unknown = ws.deserializeAttachment();
  return isViewerSocketAttachment(attachment) ? attachment : null;
}

export class SessionViewerSocketHub {
  readonly #ctx: DurableObjectState;
  readonly #env: ApiBindings;
  readonly #getSessionId: () => string | null;
  #liveStateCache: SessionLiveState | null = null;
  readonly #rememberSessionId: (sessionId: string) => void;
  readonly #withSessionLogContext: <T>(fn: () => T) => T;

  constructor(options: SessionViewerSocketHubOptions) {
    this.#ctx = options.ctx;
    this.#env = options.env;
    this.#getSessionId = options.getSessionId;
    this.#rememberSessionId = options.rememberSessionId;
    this.#withSessionLogContext = options.withSessionLogContext;
  }

  async broadcastEvents(events: AgUiSessionEvent[]): Promise<void> {
    if (events.length === 0) {
      return;
    }

    const broadcast = buildViewerBroadcastFrames({
      cachedState: this.#liveStateCache,
      events,
    });

    if (!broadcast) {
      return;
    }

    if (broadcast.state) {
      this.#liveStateCache = broadcast.state;
    }

    for (const socket of this.#getViewerSockets()) {
      const attachment = getSocketAttachment(socket);

      if (!attachment || socket.readyState !== WebSocket.OPEN) {
        continue;
      }

      sendFrames(socket, broadcast.frames);
    }
  }

  async broadcastStateSync(): Promise<void> {
    const sockets = this.#getViewerSockets()
      .map((socket) => ({ attachment: getSocketAttachment(socket), socket }))
      .filter(
        (
          candidate,
        ): candidate is {
          attachment: ViewerSocketAttachment;
          socket: WebSocket;
        } => candidate.attachment !== null,
      );

    await sendViewerSocketStateSyncBatch({
      cachedState: this.#liveStateCache,
      database: this.#env.DB,
      getLatestCachedState: () => this.#liveStateCache,
      sockets,
      updateLiveStateCache: (state) => {
        this.#rememberLoadedLiveState(state);
      },
    });
  }

  closeSockets(reason: string): void {
    for (const socket of this.#getViewerSockets()) {
      closeOpenSocket(socket, 1008, reason);
    }
  }

  connect(request: Request): Response {
    if (request.headers.get("upgrade") !== "websocket") {
      return json({ error: "WebSocket upgrade is required." }, { status: 426 });
    }

    const viewerContext = readSessionViewerSocketHeaders(request.headers);
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const attachment: ViewerSocketAttachment = {
      ...viewerContext,
      role: "viewer",
    };

    this.#rememberSessionId(attachment.sessionId);
    this.#ctx.acceptWebSocket(server, ["viewer"]);
    server.serializeAttachment(attachment);
    this.#ctx.waitUntil(clearViewerPermissionCleanupAlarm({ storage: this.#ctx.storage }));
    this.#ctx.waitUntil(this.#sendViewerStateSync(server, attachment));

    this.#withSessionLogContext(() => {
      logInfo("session.viewer_socket.accepted", {
        sessionId: attachment.sessionId,
        viewerId: attachment.viewer.id,
      });
    });

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  async handleSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    const attachment = getSocketAttachment(ws);

    if (!attachment) {
      return;
    }

    this.#rememberSessionId(attachment.sessionId);
    await this.#scheduleViewerPermissionsOnLastDisconnect(attachment);
    this.#withSessionLogContext(() => {
      logInfo("session.viewer_socket.closed", {
        closeCode: code,
        closeReason: reason || null,
        sessionId: attachment.sessionId,
        viewerId: attachment.viewer.id,
      });
    });
  }

  handleSocketError(ws: WebSocket, error: unknown): void {
    const attachment = getSocketAttachment(ws);

    if (attachment) {
      this.#rememberSessionId(attachment.sessionId);
    }

    this.#withSessionLogContext(() => {
      logError("session.viewer_socket.error", {
        ...createErrorLogContext(error),
        sessionId: attachment?.sessionId ?? this.#getSessionId(),
        viewerId: attachment?.viewer.id ?? null,
      });
    });
  }

  async handleSocketMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
    const attachment = getSocketAttachment(ws);

    if (!attachment) {
      closeOpenSocket(ws, 1008, "session.viewer.missing-attachment");
      return;
    }

    this.#rememberSessionId(attachment.sessionId);

    try {
      await this.#handleViewerSocketMessage(ws, attachment, message);
    } catch (error) {
      this.#withSessionLogContext(() => {
        logError("session.viewer_socket.message.failed", {
          ...createErrorLogContext(error),
          sessionId: attachment.sessionId,
          viewerId: attachment.viewer.id,
        });
      });

      closeOpenSocket(ws, 1003, "session.viewer.invalid-message");
    }
  }

  #getViewerSockets(): WebSocket[] {
    return this.#ctx.getWebSockets("viewer");
  }

  async handleAlarm(): Promise<void> {
    await runViewerPermissionCleanupAlarm({
      cachedState: this.#liveStateCache,
      env: this.#env,
      hasOpenViewer: (sessionId) => this.#hasOpenViewer(sessionId),
      storage: this.#ctx.storage,
      updateLiveStateCache: (state) => {
        this.#rememberLoadedLiveState(state);
      },
    });
  }

  async #sendViewerStateSync(ws: WebSocket, attachment: ViewerSocketAttachment): Promise<void> {
    await sendViewerSocketStateSync({
      attachment,
      cachedState: this.#liveStateCache,
      database: this.#env.DB,
      getLatestCachedState: () => this.#liveStateCache,
      updateLiveStateCache: (state) => {
        this.#rememberLoadedLiveState(state);
      },
      ws,
    });
  }

  #rememberLoadedLiveState(state: SessionLiveState | null): void {
    if (!state) {
      return;
    }

    this.#liveStateCache = state;
  }

  #hasOpenViewer(sessionId: string): boolean {
    return this.#getViewerSockets().some((socket) => {
      if (socket.readyState !== WebSocket.OPEN) {
        return false;
      }

      const currentAttachment = getSocketAttachment(socket);
      return currentAttachment?.sessionId === sessionId;
    });
  }

  async #scheduleViewerPermissionsOnLastDisconnect(
    attachment: ViewerSocketAttachment,
  ): Promise<void> {
    if (this.#hasOpenViewer(attachment.sessionId)) {
      return;
    }

    await scheduleViewerPermissionCleanupAlarm({
      attachment,
      storage: this.#ctx.storage,
    });
  }

  async #handleViewerSocketMessage(
    ws: WebSocket,
    attachment: ViewerSocketAttachment,
    message: ArrayBuffer | string,
  ): Promise<void> {
    try {
      await ensureViewerSocketSessionActive(this.#env.DB, attachment);
    } catch (error) {
      closeInactiveViewerSocket(ws);

      if (isKnownInactiveViewerSessionError(error)) {
        return;
      }

      throw error;
    }

    const rawMessage = typeof message === "string" ? message : new TextDecoder().decode(message);
    const event = parseViewerCustomEventJson(rawMessage);

    switch (event.name) {
      case MOSOO_CUSTOM_EVENT.sessionSyncRequest.name: {
        await this.#sendViewerStateSync(ws, attachment);
        return;
      }
      default: {
        break;
      }
    }
  }
}
