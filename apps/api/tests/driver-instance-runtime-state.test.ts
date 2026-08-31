import { describe, expect, test } from "bun:test";

import { DRIVER_PROTOCOL_VERSION } from "@mosoo/agent-driver/boot";
import type {
  DriverHelloInput,
  DriverHelloOutput,
  DriverReadyInput,
} from "@mosoo/agent-driver/orpc";
import { PLATFORM_ID_FIXTURES } from "@mosoo/id/testing";

import { DriverInstanceRuntimeState } from "../src/modules/runtime/infrastructure/driver-instance/runtime-state";

class MemoryStorage {
  failHelloCommitOnce = false;
  failReadyCommitOnce = false;
  readonly values = new Map<string, unknown>();

  async deleteAll(): Promise<void> {
    this.values.clear();
  }

  async get<T>(key: string): Promise<T | undefined> {
    return structuredClone(this.values.get(key)) as T | undefined;
  }

  async put(key: string, value: unknown): Promise<void> {
    if (
      this.failHelloCommitOnce &&
      typeof value === "object" &&
      value !== null &&
      "hello" in value &&
      value.hello !== null &&
      "pendingHello" in value &&
      value.pendingHello === null
    ) {
      this.failHelloCommitOnce = false;
      throw new Error("DO hello commit failed");
    }
    if (
      this.failReadyCommitOnce &&
      typeof value === "object" &&
      value !== null &&
      "ready" in value &&
      value.ready !== null &&
      "pendingReady" in value &&
      value.pendingReady === null
    ) {
      this.failReadyCommitOnce = false;
      throw new Error("DO ready commit failed");
    }

    this.values.set(key, structuredClone(value));
  }
}

const HELLO: DriverHelloInput = {
  capabilities: [],
  driverVersion: "test-driver",
  pid: 42,
  protocolVersion: DRIVER_PROTOCOL_VERSION,
  runtime: "openai-runtime",
  startedAt: "2026-08-30T00:00:00.000Z",
};

const HELLO_OUTPUT: DriverHelloOutput = {
  acceptedCapabilities: [],
  connectionId: "connection-0",
  driverInstanceId: PLATFORM_ID_FIXTURES.driverInstance,
  heartbeatIntervalMs: 1_000,
  runConfig: {
    commandLeaseMs: 1_000,
    envPolicy: "strict",
    eventBatchMaxSize: 64,
    organizationPath: "/workspace",
  },
  runId: PLATFORM_ID_FIXTURES.sessionRun,
};

const READY: DriverReadyInput = {
  at: "2026-08-30T00:00:01.000Z",
  driverInstanceId: PLATFORM_ID_FIXTURES.driverInstance,
  pid: 42,
};

async function createState(storage = new MemoryStorage(), generation = 0) {
  const state = new DriverInstanceRuntimeState({ storage });
  await state.load();
  await state.initializeDriverInstance(PLATFORM_ID_FIXTURES.driverInstance, generation);
  await state.recordAcceptedConnection({
    connectedAt: 1,
    connectionId: `connection-${generation}`,
    driverGeneration: generation,
    traceId: null,
  });
  return { state, storage };
}

describe("driver instance durable handshake receipts", () => {
  test("resumes an exact hello after D1 committed but the DO commit failed", async () => {
    const { state, storage } = await createState();
    const epoch = state.requireConnectionEpoch();

    await expect(state.stageHello(epoch, HELLO, HELLO_OUTPUT)).resolves.toBe("applied");
    storage.failHelloCommitOnce = true;
    await expect(state.commitHello(epoch)).rejects.toThrow("DO hello commit failed");

    const restarted = new DriverInstanceRuntimeState({ storage });
    await restarted.load();
    await expect(restarted.stageHello(epoch, HELLO, HELLO_OUTPUT)).resolves.toBe("resume");
    await expect(restarted.commitHello(epoch)).resolves.toEqual(HELLO_OUTPUT);
    await expect(restarted.stageHello(epoch, HELLO, HELLO_OUTPUT)).resolves.toBe("replay");
    await expect(restarted.stageHello(epoch, { ...HELLO, pid: 43 }, HELLO_OUTPUT)).rejects.toThrow(
      "conflicts with the canonical receipt",
    );
  });

  test("a same-generation successor requires a fresh hello receipt", async () => {
    const { state } = await createState();
    const firstEpoch = state.requireConnectionEpoch();
    await state.stageHello(firstEpoch, HELLO, HELLO_OUTPUT);
    await state.commitHello(firstEpoch);

    await state.recordAcceptedConnection({
      connectedAt: 2,
      connectionId: "connection-successor",
      driverGeneration: 0,
      traceId: null,
    });

    expect(state.hello).toBeNull();
    expect(state.pendingHello).toBeNull();
    expect(state.ready).toBeNull();
    await expect(state.stageHello(firstEpoch, HELLO, HELLO_OUTPUT)).rejects.toThrow(
      "no longer current",
    );
  });

  test("resumes exact ready projection after its DO commit fails", async () => {
    const { state, storage } = await createState();
    const epoch = state.requireConnectionEpoch();
    await state.stageHello(epoch, HELLO, HELLO_OUTPUT);
    await state.commitHello(epoch);
    await expect(state.stageReady(epoch, READY)).resolves.toBe("applied");
    storage.failReadyCommitOnce = true;
    await expect(state.commitReady(epoch)).rejects.toThrow("DO ready commit failed");

    const restarted = new DriverInstanceRuntimeState({ storage });
    await restarted.load();
    await expect(restarted.stageReady(epoch, READY)).resolves.toBe("resume");
    await expect(restarted.commitReady(epoch)).resolves.toMatchObject({ ready: READY });
    await expect(restarted.stageReady(epoch, READY)).resolves.toBe("replay");
    await expect(restarted.stageReady(epoch, { ...READY, pid: 99 })).rejects.toThrow(
      "conflicts with the canonical receipt",
    );
  });
});

describe("driver instance generation waiters", () => {
  test("a generation-zero waiter cannot be resolved by generation one", async () => {
    const { state } = await createState();
    const oldWait = state.waitForReady(0, 10_000);
    const oldRejection = oldWait.catch((error: unknown) => error);
    expect(state.readyWaiters).toHaveLength(1);

    await state.resetForReuse({ beforeReset: async () => {}, driverGeneration: 1 });
    expect(state.readyWaiters).toHaveLength(0);
    expect(await oldRejection).toEqual(
      expect.objectContaining({
        message: expect.stringContaining("generation is no longer current"),
      }),
    );
    await state.recordAcceptedConnection({
      connectedAt: 2,
      connectionId: "connection-1",
      driverGeneration: 1,
      traceId: null,
    });
    const epoch = state.requireConnectionEpoch();
    const output = { ...HELLO_OUTPUT, connectionId: epoch.connectionId };
    await state.stageHello(epoch, HELLO, output);
    await state.commitHello(epoch);

    const currentWait = state.waitForReady(1, 10_000);
    await state.stageReady(epoch, READY);
    const result = await state.commitReady(epoch);
    state.resolveReadyWaiters(result, 1);
    await expect(currentWait).resolves.toEqual(result);
  });

  test("removes a timed-out waiter", async () => {
    const { state } = await createState();

    await expect(state.waitForReady(0, 1)).rejects.toThrow("timed out");
    expect(state.readyWaiters).toHaveLength(0);
    expect(state.closeWaiters).toHaveLength(0);
    expect(await state.waitForClose(0, 1).catch(() => null)).toBeNull();
    expect(state.closeWaiters).toHaveLength(0);
  });
});
