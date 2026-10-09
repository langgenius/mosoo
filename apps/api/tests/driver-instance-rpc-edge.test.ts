import { beforeEach, describe, expect, mock, test } from "bun:test";

import type { DriverLogBatchInput } from "@mosoo/agent-driver/orpc";
import type { DriverInstanceId } from "@mosoo/id";

const publishedBatches: DriverLogBatchInput[] = [];

void mock.module(
  "../src/modules/runtime/infrastructure/driver-instance/driver-log-batch-publisher",
  () => ({
    publishDriverLogBatch: async (_env: unknown, _state: unknown, input: DriverLogBatchInput) => {
      publishedBatches.push(input);
    },
  }),
);

const { createDriverInstanceRpcContext } =
  await import("../src/modules/runtime/infrastructure/driver-instance/rpc");
const { DriverInstanceRpcEventIngestionController } =
  await import("../src/modules/runtime/infrastructure/driver-instance/rpc-event-ingestion-controller");

const DRIVER_INSTANCE_ID = "01J000000000000000000000DR" as DriverInstanceId;

function createRpcContext() {
  const events = new DriverInstanceRpcEventIngestionController({
    env: {},
    state: { hello: null, requireDriverInstanceId: () => DRIVER_INSTANCE_ID },
  } as never);

  return createDriverInstanceRpcContext({ events } as never, {
    assertActiveConnection: () => undefined,
    connectionId: "connection-1",
    driverInstanceId: DRIVER_INSTANCE_ID,
  });
}

function createBatch(driverInstanceId: string): DriverLogBatchInput {
  return {
    driverInstanceId,
    logs: [
      {
        level: "info",
        message: "boot.loaded",
        seq: 0,
        timestamp: new Date(0).toISOString(),
      },
    ],
  };
}

beforeEach(() => {
  publishedBatches.length = 0;
});

describe("driver instance RPC edge", () => {
  test("publishes a log batch that arrives before hello", async () => {
    await expect(createRpcContext().onPushLogs(createBatch(DRIVER_INSTANCE_ID))).resolves.toEqual({
      ok: true,
    });

    expect(publishedBatches.map((batch) => batch.logs[0]?.message)).toEqual(["boot.loaded"]);
  });

  test("rejects input that names another driver instance", async () => {
    await expect(
      createRpcContext().onPushLogs(createBatch("01J000000000000000000OTHER")),
    ).rejects.toThrow("Driver instance id mismatch.");

    expect(publishedBatches).toEqual([]);
  });
});
