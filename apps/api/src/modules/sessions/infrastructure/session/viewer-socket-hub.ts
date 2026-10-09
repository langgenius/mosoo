import type { AgUiSessionEvent } from "@mosoo/ag-ui-session";

import {
  closeOpenSocket,
  sendFrames,
} from "../../../../platform/cloudflare/durable-object-support";
import { createErrorLogContext, logError, logInfo } from "../../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { readSessionViewerSocketHeaders } from "./socket-headers";
import type { SessionViewerSocketContext } from "./socket-headers";
import {
  clearViewerPermissionCleanupAlarm,
  runViewerPermissionCleanupAlarm,
  scheduleViewerPermissionCleanupAlarm,
} from "./viewer-permission-cleanup";
import { sendViewerSocketStateSync } from "./viewer-socket-state-sync";

declare const WebSocketPair: new () => [WebSocket, WebSocket];

// Bounds the frames kept for replay so one long turn cannot exhaust Durable
// Object memory; past it a (re)connecting viewer gets only the newest frames.
const MAX_REPLAY_FRAME_CHARS = 4 * 1024 * 1024;

interface SessionViewerSocketHubOptions {
  ctx: DurableObjectState;
  env: ApiBindings;
  rememberSessionId: (sessionId: string) => void;
  withSessionLogContext: <T>(fn: () => T) => T;
}

function getSocketAttachment(ws: WebSocket): SessionViewerSocketContext {
  return ws.deserializeAttachment() as SessionViewerSocketContext;
}

export class SessionViewerSocketHub {
  readonly #ctx: DurableObjectState;
  readonly #env: ApiBindings;
  readonly #rememberSessionId: (sessionId: string) => void;
  readonly #withSessionLogContext: <T>(fn: () => T) => T;
  // D1 holds a turn's streamed output only once the turn ends, so a snapshot
  // taken mid-turn is followed by the frames sent since the last state sync.
  #replayFrames: string[] = [];
  #replayFrameChars = 0;

  constructor(options: SessionViewerSocketHubOptions) {
    this.#ctx = options.ctx;
    this.#env = options.env;
    this.#rememberSessionId = options.rememberSessionId;
    this.#withSessionLogContext = options.withSessionLogContext;
  }

  async broadcastEvents(events: AgUiSessionEvent[]): Promise<void> {
    if (events.length === 0) {
      return;
    }

    const frames = events.map((event) => JSON.stringify(event));

    this.#rememberReplayFrames(frames);

    for (const socket of this.#getViewerSockets()) {
      sendFrames(socket, frames);
    }
  }

  // Callers sync once D1 holds the Run's outcome, so earlier frames are no
  // longer needed for replay.
  async broadcastStateSync(): Promise<void> {
    this.#replayFrames = [];
    this.#replayFrameChars = 0;

    for (const socket of this.#getViewerSockets()) {
      if (socket.readyState === WebSocket.OPEN) {
        await sendViewerSocketStateSync(
          this.#env.DB,
          getSocketAttachment(socket),
          socket,
          () => this.#replayFrames,
        );
      }
    }
  }

  closeSockets(reason: string): void {
    for (const socket of this.#getViewerSockets()) {
      closeOpenSocket(socket, 1008, reason);
    }
  }

  connect(request: Request): Response {
    if (request.headers.get("upgrade") !== "websocket") {
      return Response.json({ error: "WebSocket upgrade is required." }, { status: 426 });
    }

    const attachment = readSessionViewerSocketHeaders(request.headers);
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    this.#rememberSessionId(attachment.sessionId);
    this.#ctx.acceptWebSocket(server, ["viewer"]);
    server.serializeAttachment(attachment);
    this.#ctx.waitUntil(clearViewerPermissionCleanupAlarm(this.#ctx.storage));
    this.#ctx.waitUntil(
      sendViewerSocketStateSync(this.#env.DB, attachment, server, () => this.#replayFrames),
    );

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

    this.#rememberSessionId(attachment.sessionId);

    if (!this.#hasOpenViewer(attachment.sessionId)) {
      await scheduleViewerPermissionCleanupAlarm({
        attachment,
        storage: this.#ctx.storage,
      });
    }

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

    this.#rememberSessionId(attachment.sessionId);
    this.#withSessionLogContext(() => {
      logError("session.viewer_socket.error", {
        ...createErrorLogContext(error),
        sessionId: attachment.sessionId,
        viewerId: attachment.viewer.id,
      });
    });
  }

  async handleAlarm(): Promise<void> {
    await runViewerPermissionCleanupAlarm({
      env: this.#env,
      hasOpenViewer: (sessionId) => this.#hasOpenViewer(sessionId),
      storage: this.#ctx.storage,
    });
  }

  #getViewerSockets(): WebSocket[] {
    return this.#ctx.getWebSockets("viewer");
  }

  #rememberReplayFrames(frames: string[]): void {
    for (const frame of frames) {
      this.#replayFrames.push(frame);
      this.#replayFrameChars += frame.length;
    }

    while (this.#replayFrameChars > MAX_REPLAY_FRAME_CHARS) {
      const dropped = this.#replayFrames.shift();

      if (dropped === undefined) {
        break;
      }

      this.#replayFrameChars -= dropped.length;
    }
  }

  #hasOpenViewer(sessionId: string): boolean {
    return this.#getViewerSockets().some(
      (socket) =>
        socket.readyState === WebSocket.OPEN && getSocketAttachment(socket).sessionId === sessionId,
    );
  }
}
