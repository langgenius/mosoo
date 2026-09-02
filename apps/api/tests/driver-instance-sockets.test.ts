import { describe, expect, test } from "bun:test";

import { DriverInstanceSocketRegistry } from "../src/modules/runtime/infrastructure/driver-instance/sockets";

interface FakeSocket {
  acceptedTags: string[][];
  attachment: unknown;
  closes: { code: number; reason: string }[];
  readyState: number;
  close(code?: number, reason?: string): void;
  deserializeAttachment(): unknown;
  serializeAttachment(value: unknown): void;
}

const SOCKET_OPEN = 1;
const SOCKET_CLOSING = 2;
const SOCKET_CLOSED = 3;
const EPOCH_A = { connectionId: "connection-a", generation: 1 } as const;
const EPOCH_B = { connectionId: "connection-b", generation: 1 } as const;

function createFakeSocket(): FakeSocket {
  const socket: FakeSocket = {
    acceptedTags: [],
    attachment: null,
    closes: [],
    readyState: SOCKET_OPEN,
    close(code = 1000, reason = "") {
      socket.closes.push({ code, reason });
      socket.readyState = SOCKET_CLOSING;
    },
    deserializeAttachment: () => socket.attachment,
    serializeAttachment(value: unknown) {
      socket.attachment = structuredClone(value);
    },
  };

  return socket;
}

function createFakeContext(): {
  accepted: { socket: FakeSocket; tags: string[] }[];
  ctx: DurableObjectState;
} {
  const accepted: { socket: FakeSocket; tags: string[] }[] = [];
  const ctx = {
    acceptWebSocket(socket: FakeSocket, tags: string[]) {
      accepted.push({ socket, tags });
    },
    getWebSockets(tag?: string) {
      return accepted
        .filter(
          (entry) =>
            entry.socket.readyState !== SOCKET_CLOSED &&
            (tag === undefined || entry.tags.includes(tag)),
        )
        .map((entry) => entry.socket);
    },
    waitUntil(_promise: Promise<unknown>) {
      /* fire and forget in tests */
    },
  } as unknown as DurableObjectState;

  return { accepted, ctx };
}

describe("driver instance socket registry", () => {
  test("accepts driver sockets through the hibernation API with the driver tag", () => {
    const { accepted, ctx } = createFakeContext();
    const registry = new DriverInstanceSocketRegistry(ctx);
    const socket = createFakeSocket();

    registry.acceptDriverSocket(socket as unknown as WebSocket, EPOCH_A);

    expect(accepted).toHaveLength(1);
    expect(accepted[0]?.tags).toEqual(["driver"]);
    expect(socket.attachment).toEqual(EPOCH_A);
    expect(registry.getDriverSocket(EPOCH_A)).toBe(socket);
  });

  test("finds the driver socket via tags after a hibernation wake", () => {
    const { ctx } = createFakeContext();
    const bootRegistry = new DriverInstanceSocketRegistry(ctx);
    const socket = createFakeSocket();
    bootRegistry.acceptDriverSocket(socket as unknown as WebSocket, EPOCH_A);

    // A wake after eviction constructs a fresh registry with no in-memory
    // active socket; the tagged socket must still be discoverable.
    const wokenRegistry = new DriverInstanceSocketRegistry(ctx);

    expect(wokenRegistry.getDriverSocket(EPOCH_A)).toBe(socket);
    expect(wokenRegistry.socketMatchesEpoch(socket as unknown as WebSocket, EPOCH_A)).toBe(true);
  });

  test("marks replaced sockets as superseded without affecting the successor", () => {
    const { ctx } = createFakeContext();
    const registry = new DriverInstanceSocketRegistry(ctx);
    const first = createFakeSocket();
    registry.acceptDriverSocket(first as unknown as WebSocket, EPOCH_A);

    registry.replaceDriverSockets();
    const second = createFakeSocket();
    registry.acceptDriverSocket(second as unknown as WebSocket, EPOCH_B);

    expect(first.closes).toEqual([{ code: 1012, reason: "runtime.socket.replaced" }]);
    expect(first.readyState).toBe(SOCKET_CLOSING);
    expect(registry.getDriverSocket(EPOCH_A)).toBeNull();
    expect(registry.getDriverSocket(EPOCH_B)).toBe(second);
  });

  test("hibernation ignores a closing predecessor even when it is listed before the successor", () => {
    const { ctx } = createFakeContext();
    const registry = new DriverInstanceSocketRegistry(ctx);
    const first = createFakeSocket();
    registry.acceptDriverSocket(first as unknown as WebSocket, EPOCH_A);
    registry.replaceDriverSockets();
    const second = createFakeSocket();
    registry.acceptDriverSocket(second as unknown as WebSocket, EPOCH_B);

    const wokenRegistry = new DriverInstanceSocketRegistry(ctx);

    expect(wokenRegistry.getDriverSocket(EPOCH_B)).toBe(second);
    expect(wokenRegistry.getDriverSocket(EPOCH_A)).toBeNull();
  });

  test("ignores missing and malformed persistent attachments", () => {
    const { ctx } = createFakeContext();
    const socket = createFakeSocket();
    const registry = new DriverInstanceSocketRegistry(ctx);
    ctx.acceptWebSocket(socket, ["driver"]);

    expect(registry.getDriverSocket(EPOCH_A)).toBeNull();
    socket.attachment = { connectionId: "connection-a", generation: -1 };
    expect(registry.getDriverSocket(EPOCH_A)).toBeNull();
  });

  test("an old callback resumed after a successor can only close its own socket", async () => {
    const { ctx } = createFakeContext();
    const registry = new DriverInstanceSocketRegistry(ctx);
    const first = createFakeSocket();
    registry.acceptDriverSocket(first as unknown as WebSocket, EPOCH_A);
    const capturedEpoch = registry.getSocketEpoch(first as unknown as WebSocket);
    let resume: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const staleCallback = (async () => {
      await gate;

      if (
        capturedEpoch !== null &&
        !registry.isCurrentDriverSocket(first as unknown as WebSocket, capturedEpoch, EPOCH_B)
      ) {
        first.close(1000, "runtime.socket.superseded");
      }
    })();

    const second = createFakeSocket();
    registry.acceptDriverSocket(second as unknown as WebSocket, EPOCH_B);
    resume();
    await staleCallback;

    expect(first.closes).toEqual([{ code: 1000, reason: "runtime.socket.superseded" }]);
    expect(second.closes).toEqual([]);
    expect(registry.getDriverSocket(EPOCH_B)).toBe(second);
  });
});
