import { describe, expect, test } from "bun:test";

import { apiCommandsTable } from "@mosoo/db";
import { eq } from "drizzle-orm";

import {
  API_COMMAND_LEASE_EXPIRED_CODE,
  API_COMMAND_LEASE_MS,
  API_COMMAND_MAX_CLAIM_ATTEMPTS,
  API_COMMAND_QUEUE_DELIVERY_PENDING_CODE,
  API_COMMAND_QUEUE_SEND_FAILED_CODE,
  admitApiCommand,
  claimApiCommand,
  deliverApiCommand,
  enqueueApiCommand,
  redriveFailedApiCommandEnqueues,
  renewApiCommandClaim,
  requeueExpiredApiCommandClaims,
} from "../src/modules/api-command/application/api-command-ledger";
import type { ApiCommandMessage } from "../src/modules/api-command/application/api-command-message";
import { parseApiCommandPayload } from "../src/modules/api-command/application/api-command-payload";
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
  test("normalizes durable payloads written before the Project rename", () => {
    const projectId = "01J0000000000000000000000E";
    const sessionId = "01J0000000000000000000000K";
    const sessionRunId = "01J0000000000000000000000N";
    const viewer = {
      email: "owner@example.com",
      emailVerified: true,
      id: "01J00000000000000000000001",
      imageUrl: null,
      name: "Owner",
    };

    expect(
      parseApiCommandPayload(
        "session_run_dispatch",
        JSON.stringify({
          attachmentIds: [],
          prompt: "continue",
          queuedAtMs: nowMsForTest(),
          requestUrl: "https://cloud.mosoo.ai/graphql",
          session: { app_id: projectId, id: sessionId },
          sessionRunId,
          traceId: "trace-1",
          viewer,
        }),
      ),
    ).toMatchObject({ session: { id: sessionId, project_id: projectId } });

    expect(
      parseApiCommandPayload(
        "environment_package_artifact_build",
        JSON.stringify({
          appId: projectId,
          artifactAbi: "abi-1",
          inputDigest: "digest-1",
          packages: [],
        }),
      ),
    ).toMatchObject({ projectId });
  });

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

  describe("expired claims", () => {
    async function insertRunningCommand(
      database: Awaited<ReturnType<typeof createPublicHttpContractDatabase>>,
      input: { attemptCount: number; claimExpiresAt: number; id: string },
    ): Promise<void> {
      await database
        .app()
        .insert(apiCommandsTable)
        .values({
          attemptCount: input.attemptCount,
          claimExpiresAt: input.claimExpiresAt,
          claimOwner: "killed-consumer",
          completedAt: null,
          createdAt: 1_000,
          dedupeKey: `scheduled:${input.id}`,
          id: input.id,
          kind: "scheduled_maintenance",
          lastErrorCode: null,
          lastErrorMessage: null,
          payloadJson: JSON.stringify({ scheduledTime: 1_000 }),
          status: "running",
          updatedAt: 1_000,
        })
        .run();
    }

    async function readCommand(
      database: Awaited<ReturnType<typeof createPublicHttpContractDatabase>>,
      id: string,
    ) {
      return database
        .app()
        .select({
          claimOwner: apiCommandsTable.claimOwner,
          lastErrorCode: apiCommandsTable.lastErrorCode,
          status: apiCommandsTable.status,
        })
        .from(apiCommandsTable)
        .where(eq(apiCommandsTable.id, id))
        .get();
    }

    test("hands a command whose consumer died back to the outbox", async () => {
      const database = await createPublicHttpContractDatabase();
      const queue = createApiCommandQueueStub();
      const bindings = createPublicHttpTestBindings(database, {
        apiCommandQueue: queue,
      }) as ApiBindings;
      const commandId = "01J0000000000000000000000D";
      await insertRunningCommand(database, {
        attemptCount: 1,
        claimExpiresAt: Date.now() - 10 * 60_000,
        id: commandId,
      });

      await redriveFailedApiCommandEnqueues(bindings);

      expect(queue.sent.map((message) => message.body)).toEqual([{ commandId }]);
      await expect(readCommand(database, commandId)).resolves.toEqual({
        claimOwner: null,
        lastErrorCode: null,
        status: "queued",
      });
      await expect(
        claimApiCommand({ commandId, database, ownerId: "next-consumer" }),
      ).resolves.toMatchObject({ attemptCount: 2, commandId });
    });

    test("dead-letters an expired command that used every attempt", async () => {
      const database = await createPublicHttpContractDatabase();
      const commandId = "01J0000000000000000000000E";
      await insertRunningCommand(database, {
        attemptCount: API_COMMAND_MAX_CLAIM_ATTEMPTS,
        claimExpiresAt: 1_000,
        id: commandId,
      });

      await requeueExpiredApiCommandClaims(database, 10 * 60_000);

      await expect(readCommand(database, commandId)).resolves.toEqual({
        claimOwner: null,
        lastErrorCode: API_COMMAND_LEASE_EXPIRED_CODE,
        status: "dead_lettered",
      });
    });

    test("leaves a claim alone inside the renewal grace period", async () => {
      const database = await createPublicHttpContractDatabase();
      const commandId = "01J0000000000000000000000F";
      await insertRunningCommand(database, {
        attemptCount: 1,
        claimExpiresAt: 100_000,
        id: commandId,
      });

      await requeueExpiredApiCommandClaims(database, 130_000);

      await expect(readCommand(database, commandId)).resolves.toEqual({
        claimOwner: "killed-consumer",
        lastErrorCode: null,
        status: "running",
      });
    });
  });
});
