import { closeOpenSocket } from "../../../../platform/cloudflare/durable-object-support";
import { createErrorLogContext, logError } from "../../../../platform/cloudflare/logger";
import { json } from "./requests";

declare const WebSocketPair: new () => [WebSocket, WebSocket];

const PUBLIC_EVENT_SOCKET_TAG = "public-events";

interface PublicEventSocketAttachment {
  readonly role: "public-events";
  readonly sessionId: string;
}

interface SessionPublicEventSocketHubOptions {
  readonly ctx: DurableObjectState;
  readonly getSessionId: () => string | null;
  readonly withSessionLogContext: <T>(fn: () => T) => T;
}

function readAttachment(socket: WebSocket): PublicEventSocketAttachment | null {
  const value: unknown = socket.deserializeAttachment();

  if (
    typeof value !== "object" ||
    value === null ||
    !("role" in value) ||
    value.role !== PUBLIC_EVENT_SOCKET_TAG ||
    !("sessionId" in value) ||
    typeof value.sessionId !== "string"
  ) {
    return null;
  }

  return { role: PUBLIC_EVENT_SOCKET_TAG, sessionId: value.sessionId };
}

export class SessionPublicEventSocketHub {
  readonly #ctx: DurableObjectState;
  readonly #getSessionId: () => string | null;
  readonly #withSessionLogContext: <T>(fn: () => T) => T;

  constructor(options: SessionPublicEventSocketHubOptions) {
    this.#ctx = options.ctx;
    this.#getSessionId = options.getSessionId;
    this.#withSessionLogContext = options.withSessionLogContext;
  }

  connect(request: Request): Response {
    if (request.headers.get("upgrade") !== "websocket") {
      return json({ error: "WebSocket upgrade is required." }, { status: 426 });
    }

    const sessionId = this.#getSessionId();

    if (sessionId === null) {
      return json({ error: "Session id is required." }, { status: 400 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const attachment: PublicEventSocketAttachment = {
      role: PUBLIC_EVENT_SOCKET_TAG,
      sessionId,
    };

    this.#ctx.acceptWebSocket(server, [PUBLIC_EVENT_SOCKET_TAG]);
    server.serializeAttachment(attachment);

    return new Response(null, { status: 101, webSocket: client });
  }

  owns(socket: WebSocket): boolean {
    return readAttachment(socket) !== null;
  }

  notifyEventsAvailable(): void {
    for (const socket of this.#ctx.getWebSockets(PUBLIC_EVENT_SOCKET_TAG)) {
      if (socket.readyState !== WebSocket.OPEN) {
        continue;
      }

      try {
        socket.send("events");
      } catch (error) {
        this.#withSessionLogContext(() => {
          logError("session.public_event_socket.send_failed", {
            ...createErrorLogContext(error),
            sessionId: readAttachment(socket)?.sessionId ?? this.#getSessionId(),
          });
        });
        closeOpenSocket(socket, 1011, "session.public-events.send-failed");
      }
    }
  }

  closeSockets(reason: string): void {
    for (const socket of this.#ctx.getWebSockets(PUBLIC_EVENT_SOCKET_TAG)) {
      closeOpenSocket(socket, 1008, reason);
    }
  }
}
