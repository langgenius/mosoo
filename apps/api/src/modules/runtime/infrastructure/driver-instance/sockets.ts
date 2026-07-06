import { sleepPromise } from "@mosoo/effects";

const DRIVER_SOCKET_TAG = "driver";

export class DriverInstanceSocketRegistry {
  readonly #ctx: DurableObjectState;
  #activeDriverSocket: WebSocket | null = null;

  constructor(ctx: DurableObjectState) {
    this.#ctx = ctx;
  }

  acceptDriverSocket(socket: WebSocket): void {
    // Hibernation accept: the socket survives Durable Object eviction, and
    // driver messages re-instantiate this object. Command delivery does not
    // depend on in-memory waiters — the driver polls nextCommand, which
    // claims from D1 — so waking into a fresh instance is safe.
    this.#ctx.acceptWebSocket(socket, [DRIVER_SOCKET_TAG]);
    this.#activeDriverSocket = socket;
  }

  getDriverSocket(): WebSocket | null {
    if (this.#activeDriverSocket && this.#activeDriverSocket.readyState !== WebSocket.CLOSED) {
      return this.#activeDriverSocket;
    }

    const [socket] = this.#ctx.getWebSockets(DRIVER_SOCKET_TAG);
    return socket ?? null;
  }

  isActiveDriverSocket(socket: WebSocket): boolean {
    return this.getDriverSocket() === socket;
  }

  /**
   * True when a different, still-open driver socket has superseded this one.
   * Close/error events from superseded sockets must not finalize the state
   * that now belongs to the successor connection.
   */
  isSupersededDriverSocket(socket: WebSocket): boolean {
    const current = this.getDriverSocket();
    return current !== null && current !== socket;
  }

  releaseDriverSocket(socket: WebSocket): void {
    if (this.#activeDriverSocket === socket) {
      this.#activeDriverSocket = null;
    }
  }

  replaceDriverSockets(): void {
    if (this.#activeDriverSocket && this.#activeDriverSocket.readyState !== WebSocket.CLOSED) {
      this.#activeDriverSocket.close(1012, "runtime.socket.replaced");
      this.#activeDriverSocket = null;
    }

    for (const existingSocket of this.#ctx.getWebSockets(DRIVER_SOCKET_TAG)) {
      existingSocket.close(1012, "runtime.socket.replaced");
    }
  }

  scheduleDriverSocketClose(code: number, reason: string): void {
    const socket = this.getDriverSocket();

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    this.#ctx.waitUntil(
      DriverInstanceSocketRegistry.#closeDriverSocketAfterCurrentTurn(socket, code, reason),
    );
  }

  static async #closeDriverSocketAfterCurrentTurn(
    socket: WebSocket,
    code: number,
    reason: string,
  ): Promise<void> {
    await sleepPromise(0);

    if (socket.readyState === WebSocket.OPEN) {
      socket.close(code, reason);
    }
  }
}
