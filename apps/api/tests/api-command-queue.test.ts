import { describe, expect, test } from "bun:test";

import { apiCommandsTable } from "@mosoo/db";
import { eq } from "drizzle-orm";

import { enqueueApiCommand } from "../src/modules/api-command/application/api-command-ledger";
import type { ApiCommandMessage } from "../src/modules/api-command/application/api-command-message";
import { processApiCommandMessage } from "../src/modules/api-command/application/api-command-processor";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  createApiCommandQueueStub,
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  createRecordedQueueMessage,
  nowMsForTest,
} from "./helpers/public-api-http-test-fixture";

describe("API command queue", () => {
  test("dedupes producer-side and sends only the command id", async () => {
    const database = await createPublicHttpContractDatabase();
    const queue = createApiCommandQueueStub();
    const bindings = createPublicHttpTestBindings(database, {
      apiCommandQueue: queue,
    }) as ApiBindings;

    const firstId = await enqueueApiCommand(bindings, {
      dedupeKey: "scheduled:test",
      kind: "scheduled_maintenance",
      payload: { scheduledTime: nowMsForTest() },
    });
    const duplicateId = await enqueueApiCommand(bindings, {
      dedupeKey: "scheduled:test",
      kind: "scheduled_maintenance",
      payload: { scheduledTime: nowMsForTest() },
    });

    expect(duplicateId).toBe(firstId);
    expect(queue.sent).toEqual([
      {
        body: { commandId: firstId },
        contentType: "json",
        delaySeconds: null,
        id: "queued-1",
      },
    ]);

    const rows = await database.app().select().from(apiCommandsTable).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: firstId,
      kind: "scheduled_maintenance",
      status: "queued",
    });
  });

  test("marks malformed payload commands failed and acks the message", async () => {
    const database = await createPublicHttpContractDatabase();
    const queue = createApiCommandQueueStub();
    const bindings = createPublicHttpTestBindings(database, {
      apiCommandQueue: queue,
    }) as ApiBindings;
    const commandId = await enqueueApiCommand(bindings, {
      dedupeKey: "scheduled:malformed",
      kind: "scheduled_maintenance",
      payload: { scheduledTime: "bad" },
    });
    const queued = queue.sent[0]?.body;

    if (!queued) {
      throw new Error("Expected API command message to be queued.");
    }

    const recorded = createRecordedQueueMessage<ApiCommandMessage>({ body: queued });

    await processApiCommandMessage(bindings, recorded.message, nowMsForTest);

    const row = await database
      .app()
      .select({
        lastErrorCode: apiCommandsTable.lastErrorCode,
        status: apiCommandsTable.status,
      })
      .from(apiCommandsTable)
      .where(eq(apiCommandsTable.id, commandId))
      .get();

    expect(row).toEqual({
      lastErrorCode: "invalid_payload",
      status: "failed",
    });
    expect(recorded.recorded).toEqual([{ type: "ack" }]);
  });
});
