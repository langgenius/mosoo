import { describe, expect, test } from "bun:test";

import { apiCommandsTable } from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import type { SandboxBackupId } from "@mosoo/id";
import { eq } from "drizzle-orm";

import { enqueueSandboxBackupReconciliationCommand } from "../src/modules/api-command/application/api-command-enqueue";
import {
  API_COMMAND_LEASE_MS,
  API_COMMAND_QUEUE_DELIVERY_PENDING_CODE,
  API_COMMAND_QUEUE_SEND_FAILED_CODE,
  admitApiCommand,
  claimApiCommand,
  completeApiCommand,
  deliverApiCommand,
  enqueueApiCommand,
  markApiCommandDeadLettered,
  markApiCommandFailed,
  prepareApiCommand,
  redriveFailedApiCommandEnqueues,
  releaseApiCommandForRetry,
  renewApiCommandClaim,
} from "../src/modules/api-command/application/api-command-ledger";
import type { ApiCommandClaim } from "../src/modules/api-command/application/api-command-ledger";
import type { ApiCommandMessage } from "../src/modules/api-command/application/api-command-message";
import { parseApiCommandMessage } from "../src/modules/api-command/application/api-command-message";
import { parseApiCommandPayload } from "../src/modules/api-command/application/api-command-payload";
import {
  processApiCommandDeadLetterMessage,
  processApiCommandDelivery,
  processApiCommandMessage,
} from "../src/modules/api-command/application/api-command-processor";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  createApiCommandQueueStub,
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  createRecordedQueueMessage,
  nowMsForTest,
  PUBLIC_API_TEST_IDS,
} from "./helpers/public-api-http-test-fixture";

async function claimCommand(input: {
  commandId: ApiCommandMessage["commandId"];
  database: D1Database;
  deliveryGeneration?: number;
  nowMs: number;
  claimOwner: string;
}): Promise<ApiCommandClaim> {
  const result = await claimApiCommand({
    ...input,
    deliveryGeneration: input.deliveryGeneration ?? 1,
  });
  if (result.kind !== "claimed") {
    throw new Error(`Expected claimed API command, received ${result.kind}.`);
  }
  return result.claim;
}

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

  test("requires a positive safe delivery generation in every queue message", () => {
    const commandId = "01J0000000000000000000000C";

    expect(parseApiCommandMessage({ commandId, deliveryGeneration: 1 })).toEqual({
      commandId,
      deliveryGeneration: 1,
    });
    expect(
      parseApiCommandMessage({ commandId, deliveryGeneration: Number.MAX_SAFE_INTEGER }),
    ).toEqual({ commandId, deliveryGeneration: Number.MAX_SAFE_INTEGER });

    for (const deliveryGeneration of [undefined, 0, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => parseApiCommandMessage({ commandId, deliveryGeneration })).toThrow();
    }
  });

  test("keeps the D1 backup page independent from the opaque R2 cursor", () => {
    const payload = { cursor: null, databasePage: 0, scheduledTime: nowMsForTest() };
    expect(
      parseApiCommandPayload("sandbox_backup_reconciliation", JSON.stringify(payload)),
    ).toEqual(payload);
    for (const databasePage of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() =>
        parseApiCommandPayload(
          "sandbox_backup_reconciliation",
          JSON.stringify({ ...payload, databasePage }),
        ),
      ).toThrow();
    }
  });

  test("continues a D1 backup backlog without an R2 cursor", async () => {
    const database = await createPublicHttpContractDatabase();
    const queue = createApiCommandQueueStub();
    const bucket = {
      async delete(): Promise<void> {},
      async list(): Promise<R2Objects> {
        return { delimitedPrefixes: [], objects: [], truncated: false };
      },
    } as unknown as R2Bucket;
    const bindings = {
      ...createPublicHttpTestBindings(database, { apiCommandQueue: queue }),
      SANDBOX_STATE_BUCKET: bucket,
    } as ApiBindings;
    database.execute("DROP TRIGGER sandbox_backup_delete_intent_authority");
    await database.batch(
      Array.from({ length: 65 }, () =>
        database
          .prepare(
            `INSERT INTO sandbox_backup_delete_intent (
               attempted_at, backup_id, created_at, delete_after, deleted_at
             ) VALUES (NULL, ?, 0, 0, NULL)`,
          )
          .bind(createPlatformId<SandboxBackupId>()),
      ),
    );
    const scheduledTime = nowMsForTest();
    await enqueueSandboxBackupReconciliationCommand(bindings, {
      cursor: null,
      databasePage: 0,
      scheduledTime,
    });

    const first = createRecordedQueueMessage<ApiCommandMessage>({ body: queue.sent[0].body });
    await processApiCommandMessage(bindings, first.message, nowMsForTest);

    expect(first.recorded).toEqual([{ type: "ack" }]);
    expect(queue.sent).toHaveLength(2);
    const rows = await database
      .app()
      .select({ dedupeKey: apiCommandsTable.dedupeKey, payloadJson: apiCommandsTable.payloadJson })
      .from(apiCommandsTable)
      .orderBy(apiCommandsTable.dedupeKey)
      .all();
    expect(rows.map(({ dedupeKey }) => dedupeKey)).toEqual([
      `sandbox_backup_reconciliation:${scheduledTime}:0:start`,
      `sandbox_backup_reconciliation:${scheduledTime}:1:start`,
    ]);
    expect(parseApiCommandPayload("sandbox_backup_reconciliation", rows[1].payloadJson)).toEqual({
      cursor: null,
      databasePage: 1,
      scheduledTime,
    });

    const second = createRecordedQueueMessage<ApiCommandMessage>({ body: queue.sent[1].body });
    await processApiCommandMessage(bindings, second.message, nowMsForTest);

    expect(second.recorded).toEqual([{ type: "ack" }]);
    expect(queue.sent).toHaveLength(2);
    await expect(
      database
        .prepare(
          "SELECT count(*) AS count FROM sandbox_backup_delete_intent WHERE deleted_at IS NOT NULL",
        )
        .first(),
    ).resolves.toEqual({ count: 65 });
  });

  test("dedupes producer-side and sends the durable delivery generation", async () => {
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
        body: { commandId: firstId, deliveryGeneration: 1 },
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
    expect(queue.sent[0]?.body).toEqual({
      commandId: admission.commandId,
      deliveryGeneration: 1,
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

  test("terminalizes a malformed Environment main-lane command before ACK", async () => {
    const database = await createPublicHttpContractDatabase();
    const apiQueue = createApiCommandQueueStub();
    const environmentQueue = createApiCommandQueueStub();
    const bindings = {
      ...createPublicHttpTestBindings(database, { apiCommandQueue: apiQueue }),
      ENVIRONMENT_ARTIFACT_BUILD_QUEUE: environmentQueue,
    } as ApiBindings;
    const commandId = await enqueueApiCommand(bindings, {
      dedupeKey: "environment-package-artifact:malformed",
      kind: "environment_package_artifact_build",
      payload: {},
    });
    const queued = environmentQueue.sent[0]?.body;
    if (!queued) throw new Error("Expected an Environment artifact Queue message.");
    const recorded = createRecordedQueueMessage<ApiCommandMessage>({ body: queued });

    await processApiCommandMessage(bindings, recorded.message, nowMsForTest);

    expect(apiQueue.sent).toHaveLength(0);
    expect(recorded.recorded).toEqual([{ type: "ack" }]);
    await expect(
      database
        .app()
        .select({
          lastErrorCode: apiCommandsTable.lastErrorCode,
          status: apiCommandsTable.status,
        })
        .from(apiCommandsTable)
        .where(eq(apiCommandsTable.id, commandId))
        .get(),
    ).resolves.toEqual({ lastErrorCode: "invalid_payload", status: "failed" });
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
        claimOwner: "consumer-after-timeout",
        commandId: retained.commandId,
        database,
        deliveryGeneration: retained.deliveryGeneration,
        nowMs: nowMsForTest(),
      }),
    ).resolves.toMatchObject({
      claim: { commandId: retained.commandId },
      kind: "claimed",
    });
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
    expect(queue.sent[0]?.body).toEqual({ commandId, deliveryGeneration: 1 });
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

    const claim = await claimCommand({
      claimOwner: "owner-1",
      commandId,
      database,
      nowMs: 1_000,
    });

    await expect(
      renewApiCommandClaim({
        claim,
        database,
        nowMs: 2_000,
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

  test("classifies claimed, busy, stale, terminal, and missing deliveries", async () => {
    const database = await createPublicHttpContractDatabase();
    const queue = createApiCommandQueueStub();
    const bindings = createPublicHttpTestBindings(database, {
      apiCommandQueue: queue,
    }) as ApiBindings;
    const commandId = await enqueueApiCommand(bindings, {
      dedupeKey: "scheduled:claim-dispositions",
      kind: "scheduled_maintenance",
      payload: { scheduledTime: nowMsForTest() },
    });
    const claimed = await claimApiCommand({
      claimOwner: "owner-a",
      commandId,
      database,
      deliveryGeneration: 1,
      nowMs: 1_000,
    });

    expect(claimed).toMatchObject({
      claim: { attemptCount: 1, claimOwner: "owner-a", commandId, deliveryGeneration: 1 },
      kind: "claimed",
    });
    await expect(
      claimApiCommand({
        claimOwner: "owner-b",
        commandId,
        database,
        deliveryGeneration: 1,
        nowMs: 2_000,
      }),
    ).resolves.toEqual({
      claimExpiresAt: 1_000 + API_COMMAND_LEASE_MS,
      kind: "busy",
    });
    await expect(
      claimApiCommand({
        claimOwner: "owner-b",
        commandId,
        database,
        deliveryGeneration: 2,
        nowMs: 2_000,
      }),
    ).resolves.toEqual({ kind: "stale" });

    if (claimed.kind !== "claimed") {
      throw new Error("Expected claimed API command.");
    }
    await completeApiCommand({ claim: claimed.claim, database, nowMs: 2_000 });
    await expect(
      claimApiCommand({
        claimOwner: "owner-b",
        commandId,
        database,
        deliveryGeneration: 1,
        nowMs: 3_000,
      }),
    ).resolves.toEqual({ kind: "terminal" });
    await expect(
      claimApiCommand({
        claimOwner: "owner-b",
        commandId: "01J0000000000000000000000Z",
        database,
        deliveryGeneration: 1,
        nowMs: 3_000,
      }),
    ).resolves.toEqual({ kind: "missing" });
  });

  test("fences completion at expiry and lets the next attempt take over", async () => {
    const database = await createPublicHttpContractDatabase();
    const queue = createApiCommandQueueStub();
    const bindings = createPublicHttpTestBindings(database, {
      apiCommandQueue: queue,
    }) as ApiBindings;
    const commandId = await enqueueApiCommand(bindings, {
      dedupeKey: "scheduled:expiry-boundary",
      kind: "scheduled_maintenance",
      payload: { scheduledTime: nowMsForTest() },
    });
    const first = await claimCommand({
      claimOwner: "owner-a",
      commandId,
      database,
      nowMs: 1_000,
    });
    const expiresAt = 1_000 + API_COMMAND_LEASE_MS;

    await expect(completeApiCommand({ claim: first, database, nowMs: expiresAt })).resolves.toBe(
      false,
    );
    await expect(
      claimApiCommand({
        claimOwner: "owner-b",
        commandId,
        database,
        deliveryGeneration: 1,
        nowMs: expiresAt,
      }),
    ).resolves.toMatchObject({
      claim: { attemptCount: 2, claimOwner: "owner-b" },
      kind: "claimed",
    });
  });

  test("rejects every stale attempt mutation after a successor takes over", async () => {
    const mutations: readonly {
      apply(claim: ApiCommandClaim, database: D1Database, nowMs: number): Promise<boolean>;
      name: string;
    }[] = [
      {
        apply: (claim, database, nowMs) => renewApiCommandClaim({ claim, database, nowMs }),
        name: "renew",
      },
      {
        apply: (claim, database, nowMs) => completeApiCommand({ claim, database, nowMs }),
        name: "complete",
      },
      {
        apply: (claim, database, nowMs) =>
          releaseApiCommandForRetry({
            claim,
            database,
            errorCode: "stale",
            errorMessage: "stale",
            nowMs,
          }),
        name: "release",
      },
      {
        apply: (claim, database, nowMs) =>
          markApiCommandFailed({
            claim,
            database,
            errorCode: "stale",
            errorMessage: "stale",
            nowMs,
          }),
        name: "fail",
      },
      {
        apply: (claim, database, nowMs) =>
          markApiCommandDeadLettered({
            claim,
            database,
            errorCode: "stale",
            errorMessage: "stale",
            nowMs,
          }),
        name: "dead-letter",
      },
    ];

    for (const mutation of mutations) {
      const database = await createPublicHttpContractDatabase();
      const queue = createApiCommandQueueStub();
      const bindings = createPublicHttpTestBindings(database, {
        apiCommandQueue: queue,
      }) as ApiBindings;
      const commandId = await enqueueApiCommand(bindings, {
        dedupeKey: `scheduled:stale-${mutation.name}`,
        kind: "scheduled_maintenance",
        payload: { scheduledTime: nowMsForTest() },
      });
      const first = await claimCommand({
        claimOwner: "owner-a",
        commandId,
        database,
        nowMs: 1_000,
      });
      const takeoverAt = 1_000 + API_COMMAND_LEASE_MS;
      await claimCommand({
        claimOwner: "owner-b",
        commandId,
        database,
        nowMs: takeoverAt,
      });
      const before = await database
        .app()
        .select()
        .from(apiCommandsTable)
        .where(eq(apiCommandsTable.id, commandId))
        .get();

      await expect(mutation.apply(first, database, takeoverAt + 1)).resolves.toBe(false);
      await expect(
        database
          .app()
          .select()
          .from(apiCommandsTable)
          .where(eq(apiCommandsTable.id, commandId))
          .get(),
      ).resolves.toEqual(before);
    }
  });

  test("increments the delivery generation for an explicit terminal retry", async () => {
    const database = await createPublicHttpContractDatabase();
    const queue = createApiCommandQueueStub();
    const bindings = createPublicHttpTestBindings(database, {
      apiCommandQueue: queue,
    }) as ApiBindings;
    const commandId = await enqueueApiCommand(bindings, {
      dedupeKey: "scheduled:terminal-retry",
      kind: "scheduled_maintenance",
      payload: { scheduledTime: 1 },
    });
    const first = await claimCommand({
      claimOwner: "owner-a",
      commandId,
      database,
      nowMs: 1_000,
    });
    await markApiCommandFailed({
      claim: first,
      database,
      errorCode: "failed",
      errorMessage: "failed",
      nowMs: 2_000,
    });

    const admission = await admitApiCommand(bindings, {
      dedupeKey: "scheduled:terminal-retry",
      kind: "scheduled_maintenance",
      payload: { scheduledTime: 2 },
      retryTerminal: true,
    });
    await deliverApiCommand(bindings, admission);

    await expect(
      database
        .app()
        .select({
          attemptCount: apiCommandsTable.attemptCount,
          deliveryGeneration: apiCommandsTable.deliveryGeneration,
          status: apiCommandsTable.status,
        })
        .from(apiCommandsTable)
        .where(eq(apiCommandsTable.id, commandId))
        .get(),
    ).resolves.toEqual({ attemptCount: 0, deliveryGeneration: 2, status: "queued" });
    expect(queue.sent.at(-1)?.body).toEqual({ commandId, deliveryGeneration: 2 });
    await expect(
      claimApiCommand({
        claimOwner: "old-message",
        commandId,
        database,
        deliveryGeneration: 1,
        nowMs: 3_000,
      }),
    ).resolves.toEqual({ kind: "stale" });
  });

  test("fails closed when delivery generation or attempt count is exhausted", async () => {
    const database = await createPublicHttpContractDatabase();
    const queue = createApiCommandQueueStub();
    const bindings = createPublicHttpTestBindings(database, {
      apiCommandQueue: queue,
    }) as ApiBindings;
    const commandId = await enqueueApiCommand(bindings, {
      dedupeKey: "scheduled:exhausted",
      kind: "scheduled_maintenance",
      payload: { scheduledTime: 1 },
    });

    database.execute(
      `UPDATE api_command SET delivery_generation = ${Number.MAX_SAFE_INTEGER}, status = 'failed' WHERE id = '${commandId}'`,
    );
    await expect(
      admitApiCommand(bindings, {
        dedupeKey: "scheduled:exhausted",
        kind: "scheduled_maintenance",
        payload: { scheduledTime: 2 },
        retryTerminal: true,
      }),
    ).rejects.toThrow("delivery generation is exhausted");

    database.execute(
      `UPDATE api_command SET attempt_count = ${Number.MAX_SAFE_INTEGER}, delivery_generation = 1, status = 'queued' WHERE id = '${commandId}'`,
    );
    await expect(
      claimApiCommand({
        claimOwner: "owner-a",
        commandId,
        database,
        deliveryGeneration: 1,
        nowMs: 1_000,
      }),
    ).rejects.toThrow("attempt count is exhausted");
    database.execute(`UPDATE api_command SET status = 'failed' WHERE id = '${commandId}'`);
    await expect(
      claimApiCommand({
        claimOwner: "owner-a",
        commandId,
        database,
        deliveryGeneration: 1,
        nowMs: 1_000,
      }),
    ).resolves.toEqual({ kind: "terminal" });
  });

  test("rejects a dedupe key reused by a different command kind", async () => {
    const database = await createPublicHttpContractDatabase();
    const queue = createApiCommandQueueStub();
    const bindings = createPublicHttpTestBindings(database, {
      apiCommandQueue: queue,
    }) as ApiBindings;
    await enqueueApiCommand(bindings, {
      dedupeKey: "shared:kind-collision",
      kind: "scheduled_maintenance",
      payload: { scheduledTime: 1 },
    });

    await expect(
      enqueueApiCommand(bindings, {
        dedupeKey: "shared:kind-collision",
        kind: "cost_ledger_reconciliation",
        payload: { cursor: null, mode: "audit", scheduledTime: 1 },
      }),
    ).rejects.toThrow("different command kind");
    expect(queue.sent).toHaveLength(1);
  });

  test("retries busy main and DLQ deliveries until the live lease expires", async () => {
    const database = await createPublicHttpContractDatabase();
    const queue = createApiCommandQueueStub();
    const bindings = createPublicHttpTestBindings(database, {
      apiCommandQueue: queue,
    }) as ApiBindings;
    const commandId = await enqueueApiCommand(bindings, {
      dedupeKey: "scheduled:busy-redelivery",
      kind: "scheduled_maintenance",
      payload: { scheduledTime: 1 },
    });
    await claimCommand({
      claimOwner: "live-owner",
      commandId,
      database,
      nowMs: 1_000,
    });
    const before = await database
      .app()
      .select()
      .from(apiCommandsTable)
      .where(eq(apiCommandsTable.id, commandId))
      .get();
    const recorded = createRecordedQueueMessage<ApiCommandMessage>({
      body: { commandId, deliveryGeneration: 1 },
    });
    const deadLetter = createRecordedQueueMessage<ApiCommandMessage>({
      body: { commandId, deliveryGeneration: 1 },
    });

    await processApiCommandMessage(bindings, recorded.message, () => 2_000);
    await processApiCommandDeadLetterMessage(bindings, deadLetter.message, () => 2_000);

    expect(recorded.recorded).toEqual([{ delaySeconds: 299, type: "retry" }]);
    expect(deadLetter.recorded).toEqual([{ delaySeconds: 299, type: "retry" }]);
    await expect(
      database
        .app()
        .select()
        .from(apiCommandsTable)
        .where(eq(apiCommandsTable.id, commandId))
        .get(),
    ).resolves.toEqual(before);
  });

  test("acks old-generation main and DLQ deliveries without touching the live successor", async () => {
    const database = await createPublicHttpContractDatabase();
    const queue = createApiCommandQueueStub();
    const bindings = createPublicHttpTestBindings(database, {
      apiCommandQueue: queue,
    }) as ApiBindings;
    const commandId = await enqueueApiCommand(bindings, {
      dedupeKey: "scheduled:old-deliveries",
      kind: "scheduled_maintenance",
      payload: { scheduledTime: 1 },
    });
    const first = await claimCommand({
      claimOwner: "owner-a",
      commandId,
      database,
      nowMs: 1_000,
    });
    await markApiCommandFailed({
      claim: first,
      database,
      errorCode: "failed",
      errorMessage: "failed",
      nowMs: 2_000,
    });
    const admission = await admitApiCommand(bindings, {
      dedupeKey: "scheduled:old-deliveries",
      kind: "scheduled_maintenance",
      payload: { scheduledTime: 2 },
      retryTerminal: true,
    });
    const successor = await claimCommand({
      claimOwner: "owner-b",
      commandId,
      database,
      deliveryGeneration: 2,
      nowMs: 3_000,
    });
    expect(admission.shouldDeliver).toBe(true);
    const before = await database
      .app()
      .select()
      .from(apiCommandsTable)
      .where(eq(apiCommandsTable.id, commandId))
      .get();
    const main = createRecordedQueueMessage<ApiCommandMessage>({
      body: { commandId, deliveryGeneration: 1 },
    });
    const deadLetter = createRecordedQueueMessage<ApiCommandMessage>({
      body: { commandId, deliveryGeneration: 1 },
    });

    await processApiCommandMessage(bindings, main.message, () => 4_000);
    await processApiCommandDeadLetterMessage(bindings, deadLetter.message, () => 4_000);

    expect(successor.deliveryGeneration).toBe(2);
    expect(main.recorded).toEqual([{ type: "ack" }]);
    expect(deadLetter.recorded).toEqual([{ type: "ack" }]);
    await expect(
      database
        .app()
        .select()
        .from(apiCommandsTable)
        .where(eq(apiCommandsTable.id, commandId))
        .get(),
    ).resolves.toEqual(before);
  });

  test("retries a DLQ message when its ledger claim cannot be persisted", async () => {
    const database = await createPublicHttpContractDatabase();
    const queue = createApiCommandQueueStub();
    const baseBindings = createPublicHttpTestBindings(database, {
      apiCommandQueue: queue,
    }) as ApiBindings;
    const commandId = await enqueueApiCommand(baseBindings, {
      dedupeKey: "scheduled:dlq-database-error",
      kind: "scheduled_maintenance",
      payload: { scheduledTime: 1 },
    });
    const failingDatabase = new Proxy(database, {
      get(target, property, receiver) {
        if (property === "prepare") {
          return () => {
            throw new Error("database unavailable");
          };
        }
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as D1Database;
    const bindings = { ...baseBindings, DB: failingDatabase };
    const recorded = createRecordedQueueMessage<ApiCommandMessage>({
      body: { commandId, deliveryGeneration: 1 },
    });

    await processApiCommandDeadLetterMessage(bindings, recorded.message, nowMsForTest);

    expect(recorded.recorded).toEqual([{ delaySeconds: 30, type: "retry" }]);
  });
});
