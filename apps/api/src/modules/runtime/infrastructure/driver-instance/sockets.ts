import { sleepPromise } from "@mosoo/effects";

interface DriverInstanceSocketRegistryOptions {
  ctx: DurableObjectState;
  onDriverClose: (socket: WebSocket, code: number, reason: string) => Promise<void>;
  onDriverError: (socket: WebSocket, error: unknown) => Promise<void>;
  onDriverMessage: (socket: WebSocket, message: ArrayBuffer | string) => Promise<void>;
  onDriverSocketClosed: (socket: WebSocket) => Promise<void> | void;
}

export class DriverInstanceSocketRegistry {
  readonly #ctx: DurableObjectState;
  #activeDriverSocket: WebSocket | null = null;
  readonly #onDriverClose: DriverInstanceSocketRegistryOptions["onDriverClose"];
  readonly #onDriverError: DriverInstanceSocketRegistryOptions["onDriverError"];
  readonly #onDriverMessage: DriverInstanceSocketRegistryOptions["onDriverMessage"];
  readonly #onDriverSocketClosed: DriverInstanceSocketRegistryOptions["onDriverSocketClosed"];

  constructor(options: DriverInstanceSocketRegistryOptions) {
    this.#ctx = options.ctx;
    this.#onDriverClose = options.onDriverClose;
    this.#onDriverError = options.onDriverError;
    this.#onDriverMessage = options.onDriverMessage;
    this.#onDriverSocketClosed = options.onDriverSocketClosed;
  }

  acceptDriverSocket(socket: WebSocket): void {
    // The driver command stream keeps an in-memory waiter while it long-polls
    // for the next command. Hibernating this socket can resume the send path in
    // a fresh Durable Object instance with no waiter to resolve, leaving driver
    // commands permanently queued.
    this.#acceptEphemeralDriverSocket(socket);
  }

  getDriverSocket(): WebSocket | null {
    if (this.#activeDriverSocket && this.#activeDriverSocket.readyState !== WebSocket.CLOSED) {
      return this.#activeDriverSocket;
    }

    const [socket] = this.#ctx.getWebSockets("driver");
    return socket ?? null;
  }

  isActiveDriverSocket(socket: WebSocket): boolean {
    return this.#activeDriverSocket === socket && socket.readyState !== WebSocket.CLOSED;
  }

  replaceDriverSockets(): void {
    if (this.#activeDriverSocket && this.#activeDriverSocket.readyState !== WebSocket.CLOSED) {
      this.#activeDriverSocket.close(1012, "runtime.socket.replaced");
      this.#activeDriverSocket = null;
    }

    for (const existingSocket of this.#ctx.getWebSockets("driver")) {
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

  #acceptEphemeralDriverSocket(socket: WebSocket): void {
    (socket as WebSocket & { accept: () => void }).accept();

    this.#activeDriverSocket = socket;
    socket.addEventListener("message", (event: MessageEvent) => {
      if (this.#activeDriverSocket !== socket) {
        return;
      }

      const { data } = event;

      if (typeof data !== "string" && !(data instanceof ArrayBuffer)) {
        socket.close(1003, "runtime.unsupported-message");
        return;
      }

      this.#ctx.waitUntil(this.#onDriverMessage(socket, data));
    });
    socket.addEventListener("close", (event: CloseEvent) => {
      this.#ctx.waitUntil(this.#handleEphemeralDriverSocketClose(socket, event.code, event.reason));
    });
    socket.addEventListener("error", (event: Event) => {
      if (this.#activeDriverSocket !== socket) {
        return;
      }

      this.#ctx.waitUntil(this.#onDriverError(socket, event));
    });
  }

  async #handleEphemeralDriverSocketClose(
    socket: WebSocket,
    code: number,
    reason: string,
  ): Promise<void> {
    await this.#onDriverSocketClosed(socket);

    if (this.#activeDriverSocket !== socket) {
      return;
    }

    this.#activeDriverSocket = null;

    await this.#onDriverClose(socket, code, reason);
  }
}
