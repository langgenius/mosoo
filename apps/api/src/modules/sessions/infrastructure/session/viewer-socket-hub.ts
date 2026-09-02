import { MOSOO_CUSTOM_EVENT, parseViewerCustomEventJson } from "@mosoo/ag-ui-session";
import type { AgUiSessionEvent } from "@mosoo/ag-ui-session";

import {
  closeOpenSocket,
  sendFrames,
} from "../../../../platform/cloudflare/durable-object-support";
import { createErrorLogContext, logError, logInfo } from "../../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { currentTimestampMs } from "../../../../time";
import type { SessionLiveState } from "../session-live-state.types";
import { json } from "./requests";
import { readSessionViewerSocketHeaders } from "./socket-headers";
import {
  clearViewerPermissionCleanupAlarm,
  runViewerPermissionCleanupAlarm,
  scheduleViewerPermissionCleanupAlarm,
} from "./viewer-permission-cleanup";
import { normalizeViewerSocketAttachment } from "./viewer-socket";
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

const VIEWER_CURSOR_RECONCILIATION_DELAY_MS = 10_000;

interface SessionViewerSocketHubOptions {
  ctx: DurableObjectState;
  env: ApiBindings;
  getSessionId: () => string | null;
  rememberSessionId: (sessionId: string) => void;
  withSessionLogContext: <T>(fn: () => T) => T;
}

export interface SessionViewerEventBatch {
  events: AgUiSessionEvent[];
  previousRuntimeEventSeqCursor: number | null;
  runtimeEventSeqCursor: number | null;
}

function getSocketAttachment(ws: WebSocket): SessionSocketAttachment | null {
  const attachment: unknown = ws.deserializeAttachment();
  return normalizeViewerSocketAttachment(attachment);
}

export class SessionViewerSocketHub {
  readonly #ctx: DurableObjectState;
  readonly #env: ApiBindings;
  readonly #getSessionId: () => string | null;
  #liveStateCache: SessionLiveState | null = null;
  readonly #rememberSessionId: (sessionId: string) => void;
  #stateOperationTail: Promise<void> = Promise.resolve();
  readonly #withSessionLogContext: <T>(fn: () => T) => T;

  constructor(options: SessionViewerSocketHubOptions) {
    this.#ctx = options.ctx;
    this.#env = options.env;
    this.#getSessionId = options.getSessionId;
    this.#rememberSessionId = options.rememberSessionId;
    this.#withSessionLogContext = options.withSessionLogContext;
  }

  async broadcastEvents(
    events: AgUiSessionEvent[],
    runtimeEventSeqCursor: number | null = null,
    previousRuntimeEventSeqCursor: number | null = null,
  ): Promise<void> {
    await this.broadcastEventBatches([
      { events, previousRuntimeEventSeqCursor, runtimeEventSeqCursor },
    ]);
  }

  async broadcastEventBatches(batches: SessionViewerEventBatch[]): Promise<void> {
    if (batches.every((batch) => batch.events.length === 0)) {
      return;
    }

    await this.#runStateOperation(async () => {
      const sockets = this.#getViewerSockets().flatMap((socket) => {
        const attachment = getSocketAttachment(socket);
        return attachment === null || socket.readyState !== WebSocket.OPEN
          ? []
          : [{ attachment, frames: [] as string[], requiresStateSync: false, socket }];
      });

      for (const batch of batches) {
        const broadcast = buildViewerBroadcastFrames({
          cachedState: batch.runtimeEventSeqCursor === null ? this.#liveStateCache : null,
          events: batch.events,
        });
        if (broadcast === null) {
          continue;
        }
        if (batch.runtimeEventSeqCursor !== null) {
          this.#liveStateCache = null;
        } else if (broadcast.state !== null) {
          this.#liveStateCache = broadcast.state;
        }
        for (const target of sockets) {
          if (target.requiresStateSync) {
            continue;
          }
          if (target.attachment.runtimeEventSeqCursor === undefined) {
            target.frames = [];
            target.requiresStateSync = true;
            continue;
          }
          if (
            batch.runtimeEventSeqCursor !== null &&
            target.attachment.runtimeEventSeqCursor >= batch.runtimeEventSeqCursor
          ) {
            continue;
          }
          if (
            batch.runtimeEventSeqCursor !== null &&
            (batch.previousRuntimeEventSeqCursor === null ||
              target.attachment.runtimeEventSeqCursor !== batch.previousRuntimeEventSeqCursor)
          ) {
            target.frames = [];
            target.requiresStateSync = true;
            continue;
          }
          target.frames.push(...broadcast.frames);
          if (batch.runtimeEventSeqCursor !== null) {
            target.attachment = {
              ...target.attachment,
              runtimeEventSeqCursor: batch.runtimeEventSeqCursor,
            };
          }
        }
      }

      for (const target of sockets) {
        if (target.requiresStateSync) {
          continue;
        }
        if (target.frames.length === 0) {
          continue;
        }
        try {
          sendFrames(target.socket, target.frames);
          target.socket.serializeAttachment(target.attachment);
        } catch {
          closeOpenSocket(target.socket, 1011, "session.viewer.event-delivery-failed");
        }
      }
      const stateSyncTargets = sockets
        .filter((target) => target.requiresStateSync)
        .map(({ attachment, socket }) => ({ attachment, socket }));
      if (stateSyncTargets.length > 0) {
        await sendViewerSocketStateSyncBatch({
          database: this.#env.DB,
          sockets: stateSyncTargets,
          updateLiveStateCache: (state) => {
            this.#rememberLoadedLiveState(state);
          },
        });
      }
    });
  }

  async broadcastStateSync(): Promise<void> {
    await this.#runStateOperation(async () => {
      this.#liveStateCache = null;
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
        database: this.#env.DB,
        sockets,
        updateLiveStateCache: (state) => {
          this.#rememberLoadedLiveState(state);
        },
      });
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
    this.#ctx.waitUntil(
      clearViewerPermissionCleanupAlarm({ storage: this.#ctx.storage }).then(() =>
        this.#scheduleViewerCursorReconciliation(),
      ),
    );
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
    await this.#runStateOperation(async () => {
      try {
        await runViewerPermissionCleanupAlarm({
          cachedState: this.#liveStateCache,
          env: this.#env,
          hasOpenViewer: (sessionId) => this.#hasOpenViewer(sessionId),
          storage: this.#ctx.storage,
          updateLiveStateCache: (state) => {
            this.#rememberLoadedLiveState(state);
          },
        });
      } finally {
        try {
          await this.#reconcileViewerCursors();
        } finally {
          await this.#scheduleViewerCursorReconciliation();
        }
      }
    });
  }

  async #sendViewerStateSync(ws: WebSocket, attachment: ViewerSocketAttachment): Promise<void> {
    await this.#runStateOperation(async () => {
      await sendViewerSocketStateSync({
        attachment,
        database: this.#env.DB,
        updateLiveStateCache: (state) => {
          this.#rememberLoadedLiveState(state);
        },
        ws,
      });
    });
  }

  #runStateOperation(operation: () => Promise<void>): Promise<void> {
    const result = this.#stateOperationTail.then(operation);
    this.#stateOperationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
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

  async #reconcileViewerCursors(): Promise<void> {
    const sessionId = this.#resolveSessionId();
    if (sessionId === null) {
      return;
    }
    const durable = await this.#env.DB.prepare(
      "SELECT runtime_event_seq_cursor FROM session WHERE id = ?",
    )
      .bind(sessionId)
      .first<{ runtime_event_seq_cursor: number }>();
    const sockets = this.#getViewerSockets().flatMap((socket) => {
      const attachment = getSocketAttachment(socket);
      return attachment !== null &&
        durable !== null &&
        (attachment.runtimeEventSeqCursor === undefined ||
          attachment.runtimeEventSeqCursor !== durable.runtime_event_seq_cursor)
        ? [{ attachment, socket }]
        : [];
    });
    if (sockets.length === 0) {
      return;
    }

    await sendViewerSocketStateSyncBatch({
      database: this.#env.DB,
      sockets,
      updateLiveStateCache: (state) => {
        this.#rememberLoadedLiveState(state);
      },
    });
  }

  async #scheduleViewerCursorReconciliation(): Promise<void> {
    const sessionId = this.#resolveSessionId();
    if (sessionId === null || !this.#hasOpenViewer(sessionId)) {
      return;
    }
    await this.#ctx.storage.setAlarm(currentTimestampMs() + VIEWER_CURSOR_RECONCILIATION_DELAY_MS);
  }

  #resolveSessionId(): string | null {
    const rememberedSessionId = this.#getSessionId();
    const attachedSessionIds = new Set<string>();

    for (const socket of this.#getViewerSockets()) {
      const attachment = getSocketAttachment(socket);
      if (attachment !== null) {
        attachedSessionIds.add(attachment.sessionId);
      }
    }

    if (rememberedSessionId !== null) {
      for (const socket of this.#getViewerSockets()) {
        const attachment = getSocketAttachment(socket);
        if (attachment !== null && attachment.sessionId !== rememberedSessionId) {
          closeOpenSocket(socket, 1008, "session.viewer.session-mismatch");
        }
      }
      return rememberedSessionId;
    }

    if (attachedSessionIds.size !== 1) {
      if (attachedSessionIds.size > 1) {
        this.closeSockets("session.viewer.session-mismatch");
      }
      return null;
    }

    const [sessionId] = attachedSessionIds;
    if (sessionId === undefined) {
      return null;
    }
    this.#rememberSessionId(sessionId);
    return sessionId;
  }

  async #scheduleViewerPermissionsOnLastDisconnect(
    attachment: ViewerSocketAttachment,
  ): Promise<void> {
    if (this.#hasOpenViewer(attachment.sessionId)) {
      await this.#scheduleViewerCursorReconciliation();
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
