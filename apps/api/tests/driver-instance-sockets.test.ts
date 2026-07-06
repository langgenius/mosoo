import { describe, expect, test } from "bun:test";

import { DriverInstanceSocketRegistry } from "../src/modules/runtime/infrastructure/driver-instance/sockets";

interface FakeSocket {
  acceptedTags: string[][];
  closes: { code: number; reason: string }[];
  readyState: number;
  close(code?: number, reason?: string): void;
}

const SOCKET_OPEN = 1;
const SOCKET_CLOSED = 3;

function createFakeSocket(): FakeSocket {
  const socket: FakeSocket = {
    acceptedTags: [],
    closes: [],
    readyState: SOCKET_OPEN,
    close(code = 1000, reason = "") {
      socket.closes.push({ code, reason });
      socket.readyState = SOCKET_CLOSED;
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

    registry.acceptDriverSocket(socket as unknown as WebSocket);

    expect(accepted).toHaveLength(1);
    expect(accepted[0]?.tags).toEqual(["driver"]);
    expect(registry.getDriverSocket()).toBe(socket as unknown as WebSocket);
  });

  test("finds the driver socket via tags after a hibernation wake", () => {
    const { ctx } = createFakeContext();
    const bootRegistry = new DriverInstanceSocketRegistry(ctx);
    const socket = createFakeSocket();
    bootRegistry.acceptDriverSocket(socket as unknown as WebSocket);

    // A wake after eviction constructs a fresh registry with no in-memory
    // active socket; the tagged socket must still be discoverable.
    const wokenRegistry = new DriverInstanceSocketRegistry(ctx);

    expect(wokenRegistry.getDriverSocket()).toBe(socket as unknown as WebSocket);
    expect(wokenRegistry.isActiveDriverSocket(socket as unknown as WebSocket)).toBe(true);
    expect(wokenRegistry.isSupersededDriverSocket(socket as unknown as WebSocket)).toBe(false);
  });

  test("marks replaced sockets as superseded without affecting the successor", () => {
    const { ctx } = createFakeContext();
    const registry = new DriverInstanceSocketRegistry(ctx);
    const first = createFakeSocket();
    registry.acceptDriverSocket(first as unknown as WebSocket);

    registry.replaceDriverSockets();
    const second = createFakeSocket();
    registry.acceptDriverSocket(second as unknown as WebSocket);

    expect(first.closes).toEqual([{ code: 1012, reason: "runtime.socket.replaced" }]);
    expect(registry.isSupersededDriverSocket(first as unknown as WebSocket)).toBe(true);
    expect(registry.isSupersededDriverSocket(second as unknown as WebSocket)).toBe(false);
    expect(registry.getDriverSocket()).toBe(second as unknown as WebSocket);
  });

  test("does not treat the last closing socket as superseded", () => {
    const { ctx } = createFakeContext();
    const registry = new DriverInstanceSocketRegistry(ctx);
    const socket = createFakeSocket();
    registry.acceptDriverSocket(socket as unknown as WebSocket);

    socket.readyState = SOCKET_CLOSED;

    expect(registry.isSupersededDriverSocket(socket as unknown as WebSocket)).toBe(false);
  });
});
