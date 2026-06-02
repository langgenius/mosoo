import type { DriverBootPayload } from "@mosoo/driver-protocol";
import { createPromiseDeferred, settlePromiseWithTimeout } from "@mosoo/effects";

export type DriverWireSocket = Pick<
  WebSocket,
  "addEventListener" | "close" | "readyState" | "removeEventListener" | "send"
>;

interface BunServer {
  stop(closeActiveConnections?: boolean): void;
}

interface BunUpgradeServer<TData> {
  upgrade(request: Request, options?: { data?: TData }): boolean;
}

interface BunServerWebSocket<TData> {
  readonly data: TData;
  readonly readyState: number;
  close(code?: number, reason?: string): void;
  send(data: ArrayBuffer | string | Uint8Array): number | boolean;
}

interface BunServeOptions<TData> {
  fetch(request: Request, server: BunUpgradeServer<TData>): Response | undefined;
  hostname: string;
  port: number;
  websocket: {
    close(socket: BunServerWebSocket<TData>, code: number, reason: string): void;
    message(socket: BunServerWebSocket<TData>, message: ArrayBuffer | string | Uint8Array): void;
    open(socket: BunServerWebSocket<TData>): void;
  };
}

interface BunRuntime {
  serve<TData>(options: BunServeOptions<TData>): BunServer;
}

interface DriverControlSocketData {
  traceparent: string | null;
}

const DRIVER_CONTROL_CONNECT_TIMEOUT_MS = 30_000;
const DRIVER_SOCKET_OPEN = 1;

function requireBunRuntime(): BunRuntime {
  const runtime = (globalThis as typeof globalThis & { Bun?: BunRuntime }).Bun;

  if (!runtime) {
    throw new Error("Driver local control server requires Bun runtime.");
  }

  return runtime;
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  const bytes = new Uint8Array(value.byteLength);
  bytes.set(value);
  return bytes.buffer;
}

function toBunSocketData(
  data: Parameters<WebSocket["send"]>[0],
): ArrayBuffer | string | Uint8Array {
  if (typeof data === "string" || data instanceof ArrayBuffer) {
    return data;
  }

  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }

  if (typeof SharedArrayBuffer !== "undefined" && data instanceof SharedArrayBuffer) {
    return new Uint8Array(data);
  }

  throw new Error("Blob WebSocket messages are not supported by the driver control socket.");
}

function toMessageEventData(message: ArrayBuffer | string | Uint8Array): ArrayBuffer | string {
  return message instanceof Uint8Array ? toArrayBuffer(message) : message;
}

function toWebSocketReadyState(value: number): WebSocket["readyState"] {
  return value === WebSocket.CONNECTING ||
    value === WebSocket.OPEN ||
    value === WebSocket.CLOSING ||
    value === WebSocket.CLOSED
    ? value
    : WebSocket.CLOSED;
}

class DriverLocalWireSocket implements DriverWireSocket {
  readonly #events = new EventTarget();
  #closed = false;
  private readonly socket: BunServerWebSocket<DriverControlSocketData>;
  private readonly stopServer: () => void;

  constructor(socket: BunServerWebSocket<DriverControlSocketData>, stopServer: () => void) {
    this.socket = socket;
    this.stopServer = stopServer;
  }

  get readyState(): WebSocket["readyState"] {
    return toWebSocketReadyState(this.socket.readyState);
  }

  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: AddEventListenerOptions | boolean,
  ): void {
    this.#events.addEventListener(type, listener, options);
  }

  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: EventListenerOptions | boolean,
  ): void {
    this.#events.removeEventListener(type, listener, options);
  }

  send(data: Parameters<WebSocket["send"]>[0]): void {
    this.socket.send(toBunSocketData(data));
  }

  close(code?: number, reason?: string): void {
    if (this.#closed) {
      return;
    }

    this.#closed = true;
    this.socket.close(code, reason);
    this.stopServer();
  }

  dispatchOpen(): void {
    this.#events.dispatchEvent(new Event("open"));
  }

  dispatchMessage(message: ArrayBuffer | string | Uint8Array): void {
    this.#events.dispatchEvent(
      new MessageEvent("message", {
        data: toMessageEventData(message),
      }),
    );
  }

  dispatchClose(code: number, reason: string): void {
    if (this.#closed) {
      return;
    }

    this.#closed = true;
    this.#events.dispatchEvent(
      new CloseEvent("close", {
        code,
        reason,
      }),
    );
    this.stopServer();
  }
}

export async function acceptDriverControlSocket(
  payload: DriverBootPayload,
): Promise<DriverWireSocket> {
  const runtime = requireBunRuntime();
  let acceptedSocket: DriverLocalWireSocket | null = null;
  // Reserve the single-connection slot at upgrade time, not at websocket.open
  // time. Without this, two concurrent fetches both see acceptedSocket=null,
  // both upgrade, both fire open(), and the second open() overwrites the first
  // — leaving the server with an orphaned half-accepted socket.
  let pendingUpgrade = false;
  let server: BunServer | null = null;
  const accepted = createPromiseDeferred<DriverWireSocket>();

  const stopServer = () => {
    server?.stop(false);
  };

  server = runtime.serve<DriverControlSocketData>({
    fetch(request, upgradeServer) {
      if (acceptedSocket || pendingUpgrade) {
        return new Response("Driver control socket is already connected.", { status: 409 });
      }

      const url = new URL(request.url);

      if (url.pathname !== "/driver") {
        return new Response("Not Found", { status: 404 });
      }

      if (url.searchParams.get("token") !== payload.bootToken) {
        return new Response("Unauthorized", { status: 401 });
      }

      pendingUpgrade = true;
      const upgraded = upgradeServer.upgrade(request, {
        data: {
          traceparent: request.headers.get("x-traceparent") ?? url.searchParams.get("traceparent"),
        },
      });

      if (!upgraded) {
        pendingUpgrade = false;
        return new Response("WebSocket upgrade failed.", { status: 400 });
      }
      return;
    },
    hostname: "0.0.0.0",
    port: payload.driverControlPort,
    websocket: {
      close(_socket, code, reason) {
        acceptedSocket?.dispatchClose(code, reason);
      },
      message(_socket, message) {
        acceptedSocket?.dispatchMessage(message);
      },
      open(socket) {
        pendingUpgrade = false;
        const wireSocket = new DriverLocalWireSocket(socket, stopServer);
        acceptedSocket = wireSocket;

        if (wireSocket.readyState === DRIVER_SOCKET_OPEN) {
          accepted.resolve(wireSocket);
        } else {
          wireSocket.addEventListener(
            "open",
            () => {
              accepted.resolve(wireSocket);
            },
            { once: true },
          );
        }

        wireSocket.dispatchOpen();
      },
    },
  });

  const result = await settlePromiseWithTimeout(accepted.promise, {
    label: "runtime sandbox driver control socket",
    timeoutMs: DRIVER_CONTROL_CONNECT_TIMEOUT_MS,
  });

  if (result.status === "completed") {
    return result.value;
  }

  server?.stop(true);

  if (result.status === "failed") {
    throw result.error;
  }

  throw result.error;
}
