import { beforeEach, describe, expect, mock, test } from "bun:test";

import type { DriverLogBatchInput } from "agent-driver/orpc";

const publishedBatches: DriverLogBatchInput[] = [];

void mock.module(
  "../src/modules/runtime/infrastructure/driver-instance/driver-log-batch-publisher",
  () => ({
    publishDriverLogBatch: async (_env: unknown, _state: unknown, input: DriverLogBatchInput) => {
      publishedBatches.push(input);
    },
  }),
);

const { DriverInstanceRpcEventIngestionController } =
  await import("../src/modules/runtime/infrastructure/driver-instance/rpc-event-ingestion-controller");

const DRIVER_INSTANCE_ID = "01J000000000000000000000DR";

interface FakeState {
  hello: { pid: number } | null;
  requireDriverInstanceId: () => string;
}

function createController(state: FakeState) {
  return new DriverInstanceRpcEventIngestionController({
    env: {},
    state,
  } as never);
}

function createBatch(message: string): DriverLogBatchInput {
  return {
    driverInstanceId: DRIVER_INSTANCE_ID,
    logs: [
      {
        level: "info",
        message,
        seq: 0,
        timestamp: new Date(0).toISOString(),
      },
    ],
  } as DriverLogBatchInput;
}

const activeContext = {
  assertActiveConnection: () => undefined,
  connectionId: "connection-1",
} as never;

beforeEach(() => {
  publishedBatches.length = 0;
});

describe("pre-hello pushLogs buffering", () => {
  test("buffers pre-hello batches and publishes them after hello", async () => {
    const state: FakeState = {
      hello: null,
      requireDriverInstanceId: () => DRIVER_INSTANCE_ID,
    };
    const controller = createController(state);

    const first = await controller.handlePushLogs(createBatch("boot.loaded"), activeContext);
    const second = await controller.handlePushLogs(createBatch("hello.sending"), activeContext);

    expect(first).toEqual({ ok: true });
    expect(second).toEqual({ ok: true });
    expect(publishedBatches).toHaveLength(0);

    state.hello = { pid: 1 };
    await controller.publishPendingPreHelloLogs();

    expect(publishedBatches.map((batch) => batch.logs[0]?.message)).toEqual([
      "boot.loaded",
      "hello.sending",
    ]);
  });

  test("publishes directly once hello is recorded", async () => {
    const state: FakeState = {
      hello: { pid: 1 },
      requireDriverInstanceId: () => DRIVER_INSTANCE_ID,
    };
    const controller = createController(state);

    await controller.handlePushLogs(createBatch("post.hello"), activeContext);

    expect(publishedBatches.map((batch) => batch.logs[0]?.message)).toEqual(["post.hello"]);
  });

  test("bounds the pre-hello window by dropping the oldest batches", async () => {
    const state: FakeState = {
      hello: null,
      requireDriverInstanceId: () => DRIVER_INSTANCE_ID,
    };
    const controller = createController(state);

    for (let index = 0; index < 20; index += 1) {
      await controller.handlePushLogs(createBatch(`batch-${index}`), activeContext);
    }

    state.hello = { pid: 1 };
    await controller.publishPendingPreHelloLogs();

    expect(publishedBatches).toHaveLength(16);
    expect(publishedBatches[0]?.logs[0]?.message).toBe("batch-4");
    expect(publishedBatches.at(-1)?.logs[0]?.message).toBe("batch-19");
  });

  test("still rejects a driver instance id mismatch before hello", async () => {
    const state: FakeState = {
      hello: null,
      requireDriverInstanceId: () => DRIVER_INSTANCE_ID,
    };
    const controller = createController(state);

    await expect(
      controller.handlePushLogs(
        { ...createBatch("mismatch"), driverInstanceId: "01J000000000000000000OTHER" },
        activeContext,
      ),
    ).rejects.toThrow("Driver instance id mismatch.");
  });
});
