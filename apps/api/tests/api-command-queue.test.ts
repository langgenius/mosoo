import { describe, expect, test } from "bun:test";

import { apiCommandsTable } from "@mosoo/db";
import { eq } from "drizzle-orm";

import {
  API_COMMAND_LEASE_MS,
  API_COMMAND_QUEUE_DELIVERY_PENDING_CODE,
  API_COMMAND_QUEUE_SEND_FAILED_CODE,
  admitApiCommand,
  claimApiCommand,
  deliverApiCommand,
  enqueueApiCommand,
  redriveFailedApiCommandEnqueues,
  renewApiCommandClaim,
} from "../src/modules/api-command/application/api-command-ledger";
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

  test("persists admission before deferred Queue delivery", async () => {
    const database = await createPublicHttpContractDatabase();
    const queue = createApiCommandQueueStub();
    const bindings = createPublicHttpTestBindings(database, {
      apiCommandQueue: queue,
    }) as ApiBindings;

    const admission = await admitApiCommand(bindings, {
      dedupeKey: "scheduled:deferred",
      kind: "scheduled_maintenance",
      payload: { scheduledTime: nowMsForTest() },
    });

    expect(queue.sent).toEqual([]);
    await expect(
      database
        .app()
        .select()
        .from(apiCommandsTable)
        .where(eq(apiCommandsTable.id, admission.commandId))
        .get(),
    ).resolves.toMatchObject({
      id: admission.commandId,
      lastErrorCode: API_COMMAND_QUEUE_DELIVERY_PENDING_CODE,
      status: "queued",
    });

    await deliverApiCommand(bindings, admission);
    expect(queue.sent[0]?.body).toEqual({ commandId: admission.commandId });
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

  test("keeps a command claimable when Queue accepts it but send reports a timeout", async () => {
    const database = await createPublicHttpContractDatabase();
    const retainedMessages: ApiCommandMessage[] = [];
    const queue = {
      sent: [],
      async send(body: ApiCommandMessage): Promise<void> {
        retainedMessages.push(body);
        throw new Error("Queue response timed out.");
      },
    };
    const bindings = createPublicHttpTestBindings(database, {
      apiCommandQueue: queue,
    }) as ApiBindings;

    const commandId = await enqueueApiCommand(bindings, {
      dedupeKey: "scheduled:ambiguous-send",
      kind: "scheduled_maintenance",
      payload: { scheduledTime: nowMsForTest() },
    });

    const retained = retainedMessages[0];
    if (retained === undefined) {
      throw new Error("Expected Queue to retain the command message.");
    }

    const row = await database
      .app()
      .select({
        lastErrorCode: apiCommandsTable.lastErrorCode,
        status: apiCommandsTable.status,
      })
      .from(apiCommandsTable)
      .get();

    expect(row).toEqual({
      lastErrorCode: API_COMMAND_QUEUE_SEND_FAILED_CODE,
      status: "queued",
    });
    expect(commandId).toBe(retained.commandId);
    await expect(
      claimApiCommand({
        commandId: retained.commandId,
        database,
        nowMs: nowMsForTest(),
        ownerId: "consumer-after-timeout",
      }),
    ).resolves.toMatchObject({ commandId: retained.commandId });
  });

  test("redrives a durable command after a definite Queue send failure", async () => {
    const database = await createPublicHttpContractDatabase();
    const sent: ApiCommandMessage[] = [];
    let attempts = 0;
    const queue = {
      sent,
      async send(body: ApiCommandMessage): Promise<void> {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("Queue is unavailable.");
        }
        sent.push(body);
      },
    };
    const bindings = createPublicHttpTestBindings(database, {
      apiCommandQueue: queue,
    }) as ApiBindings;

    await enqueueApiCommand(bindings, {
      dedupeKey: "scheduled:redrive",
      kind: "scheduled_maintenance",
      payload: { scheduledTime: nowMsForTest() },
    });

    await redriveFailedApiCommandEnqueues(bindings);

    expect(sent).toHaveLength(1);
    const row = await database
      .app()
      .select({
        lastErrorCode: apiCommandsTable.lastErrorCode,
        lastErrorMessage: apiCommandsTable.lastErrorMessage,
        status: apiCommandsTable.status,
      })
      .from(apiCommandsTable)
      .get();

    expect(row).toEqual({
      lastErrorCode: null,
      lastErrorMessage: null,
      status: "queued",
    });
  });

  test("redrives a command left pending before its first Queue send", async () => {
    const database = await createPublicHttpContractDatabase();
    const queue = createApiCommandQueueStub();
    const bindings = createPublicHttpTestBindings(database, {
      apiCommandQueue: queue,
    }) as ApiBindings;
    const commandId = "01J0000000000000000000000C";

    await database
      .app()
      .insert(apiCommandsTable)
      .values({
        attemptCount: 0,
        claimExpiresAt: null,
        claimOwner: null,
        completedAt: null,
        createdAt: nowMsForTest(),
        dedupeKey: "scheduled:pending-before-send",
        id: commandId,
        kind: "scheduled_maintenance",
        lastErrorCode: API_COMMAND_QUEUE_DELIVERY_PENDING_CODE,
        lastErrorMessage: "API command is awaiting queue delivery.",
        payloadJson: JSON.stringify({ scheduledTime: nowMsForTest() }),
        status: "queued",
        updatedAt: nowMsForTest(),
      })
      .run();

    await redriveFailedApiCommandEnqueues(bindings);

    const row = await database
      .app()
      .select({
        lastErrorCode: apiCommandsTable.lastErrorCode,
        lastErrorMessage: apiCommandsTable.lastErrorMessage,
      })
      .from(apiCommandsTable)
      .where(eq(apiCommandsTable.id, commandId))
      .get();

    expect(queue.sent).toHaveLength(1);
    expect(queue.sent[0]?.body).toEqual({ commandId });
    expect(row).toEqual({ lastErrorCode: null, lastErrorMessage: null });
  });

  test("renews a running command claim for the current owner", async () => {
    const database = await createPublicHttpContractDatabase();
    const queue = createApiCommandQueueStub();
    const bindings = createPublicHttpTestBindings(database, {
      apiCommandQueue: queue,
    }) as ApiBindings;
    const commandId = await enqueueApiCommand(bindings, {
      dedupeKey: "scheduled:renew",
      kind: "scheduled_maintenance",
      payload: { scheduledTime: nowMsForTest() },
    });

    await claimApiCommand({
      commandId,
      database,
      nowMs: 1_000,
      ownerId: "owner-1",
    });

    await expect(
      renewApiCommandClaim({
        commandId,
        database,
        nowMs: 2_000,
        ownerId: "owner-1",
      }),
    ).resolves.toBe(true);

    const row = await database
      .app()
      .select({
        claimExpiresAt: apiCommandsTable.claimExpiresAt,
      })
      .from(apiCommandsTable)
      .where(eq(apiCommandsTable.id, commandId))
      .get();

    expect(row?.claimExpiresAt).toBe(2_000 + API_COMMAND_LEASE_MS);
  });
});
