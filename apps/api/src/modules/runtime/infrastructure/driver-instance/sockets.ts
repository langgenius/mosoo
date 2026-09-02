import { sleepPromise } from "@mosoo/effects";

import type { DriverInstanceConnectionEpoch } from "./state";

const DRIVER_SOCKET_TAG = "driver";

function parseDriverSocketEpoch(socket: WebSocket): DriverInstanceConnectionEpoch | null {
  const attachment: unknown = socket.deserializeAttachment();

  if (
    typeof attachment !== "object" ||
    attachment === null ||
    !("connectionId" in attachment) ||
    !("generation" in attachment) ||
    typeof attachment.connectionId !== "string" ||
    attachment.connectionId.length === 0 ||
    !Number.isSafeInteger(attachment.generation) ||
    (attachment.generation as number) < 0
  ) {
    return null;
  }

  return {
    connectionId: attachment.connectionId,
    generation: attachment.generation as number,
  };
}

function epochsMatch(
  left: DriverInstanceConnectionEpoch,
  right: DriverInstanceConnectionEpoch,
): boolean {
  return left.connectionId === right.connectionId && left.generation === right.generation;
}

export class DriverInstanceSocketRegistry {
  readonly #ctx: DurableObjectState;

  constructor(ctx: DurableObjectState) {
    this.#ctx = ctx;
  }

  acceptDriverSocket(socket: WebSocket, epoch: DriverInstanceConnectionEpoch): void {
    this.#ctx.acceptWebSocket(socket, [DRIVER_SOCKET_TAG]);
    socket.serializeAttachment(epoch);
  }

  getSocketEpoch(socket: WebSocket): DriverInstanceConnectionEpoch | null {
    return parseDriverSocketEpoch(socket);
  }

  socketMatchesEpoch(socket: WebSocket, epoch: DriverInstanceConnectionEpoch): boolean {
    const socketEpoch = parseDriverSocketEpoch(socket);
    return socketEpoch !== null && epochsMatch(socketEpoch, epoch);
  }

  isCurrentDriverSocket(
    socket: WebSocket,
    capturedEpoch: DriverInstanceConnectionEpoch,
    currentEpoch: DriverInstanceConnectionEpoch | null,
  ): boolean {
    return (
      currentEpoch !== null &&
      epochsMatch(capturedEpoch, currentEpoch) &&
      this.socketMatchesEpoch(socket, capturedEpoch)
    );
  }

  getDriverSocket(epoch: DriverInstanceConnectionEpoch | null): WebSocket | null {
    if (epoch === null) {
      return null;
    }

    return (
      this.#ctx
        .getWebSockets(DRIVER_SOCKET_TAG)
        .find(
          (socket) =>
            socket.readyState === WebSocket.OPEN && this.socketMatchesEpoch(socket, epoch),
        ) ?? null
    );
  }

  replaceDriverSockets(): void {
    for (const socket of this.#ctx.getWebSockets(DRIVER_SOCKET_TAG)) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.close(1012, "runtime.socket.replaced");
      }
    }
  }

  scheduleDriverSocketClose(
    epoch: DriverInstanceConnectionEpoch,
    code: number,
    reason: string,
  ): void {
    const socket = this.getDriverSocket(epoch);

    if (socket === null) {
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
