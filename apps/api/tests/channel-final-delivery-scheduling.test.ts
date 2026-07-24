import { describe, expect, test } from "bun:test";

import {
  agentChannelBindingsTable,
  channelFinalDeliveryJobsTable,
  sessionRunsTable,
  sessionsTable,
} from "@mosoo/db";
import { eq } from "drizzle-orm";

import type { ChannelFinalDeliveryMessage } from "../src/modules/channels/application/channel-final-delivery-message";
import {
  enqueueChannelFinalDeliveryJob,
  processChannelFinalDeliveryMessage,
  redriveFailedChannelFinalDeliveryEnqueues,
} from "../src/modules/channels/application/channel-final-delivery.service";
import { createApiWorker } from "../src/platform/cloudflare/create-api-worker";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  createTestEnvironment,
  installDiscordFetch,
  installLarkFetch,
  installTelegramFetch,
  takeQueuedMessageBody,
} from "./channel-final-delivery-fetch-fixtures";
import {
  createCompletedDiscordFinalDeliveryJob,
  createCompletedLarkFinalDeliveryJob,
  createCompletedTelegramFinalDeliveryJob,
} from "./channel-final-delivery-job-fixtures";
import { readFetchUrl } from "./helpers/fetch-request-url";
import { createRecordedQueueMessage, nowMsForTest } from "./helpers/public-api-http-test-fixture";

function readJsonObjectBody(body: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(body);

  if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
    return parsed;
  }

  throw new Error("Expected Telegram request body to be a JSON object.");
}

describe("channel final delivery scheduling", () => {
  test("delivers Telegram replies via the queue consumer and acks the message", async () => {
    const telegramBodies: unknown[] = [];
    const restoreFetch = installTelegramFetch(telegramBodies);

    try {
      const { bindings, database, queue } = await createTestEnvironment();
      const seed = await createCompletedTelegramFinalDeliveryJob({
        bindings,
        database,
        externalEventId: "telegram:update:1",
      });

      const queued = takeQueuedMessageBody(queue, seed.jobId);
      const recorded = createRecordedQueueMessage<ChannelFinalDeliveryMessage>({ body: queued });
      await processChannelFinalDeliveryMessage(bindings, recorded.message, {}, nowMsForTest);

      const job = await database
        .app()
        .select({
          attemptCount: channelFinalDeliveryJobsTable.attemptCount,
          status: channelFinalDeliveryJobsTable.status,
        })
        .from(channelFinalDeliveryJobsTable)
        .where(eq(channelFinalDeliveryJobsTable.externalEventId, "telegram:update:1"))
        .get();

      expect(telegramBodies).toEqual([
        {
          chat_id: "42",
          text: `mosoo session ${seed.sessionId}\n\nFinal answer`,
        },
      ]);
      expect(job).toEqual({
        attemptCount: 1,
        status: "delivered",
      });
      expect(recorded.recorded).toEqual([{ type: "ack" }]);
    } finally {
      restoreFetch();
    }
  });

  test("edits Discord working messages and acks the queue message", async () => {
    const discordRequests: { body: unknown; url: string }[] = [];
    const restoreFetch = installDiscordFetch(discordRequests);

    try {
      const { bindings, database, queue } = await createTestEnvironment();
      const seed = await createCompletedDiscordFinalDeliveryJob({
        bindings,
        database,
        externalEventId: "discord:message:1",
      });

      const queued = takeQueuedMessageBody(queue, seed.jobId);
      const recorded = createRecordedQueueMessage<ChannelFinalDeliveryMessage>({ body: queued });
      await processChannelFinalDeliveryMessage(bindings, recorded.message, {}, nowMsForTest);

      const job = await database
        .app()
        .select({
          attemptCount: channelFinalDeliveryJobsTable.attemptCount,
          status: channelFinalDeliveryJobsTable.status,
        })
        .from(channelFinalDeliveryJobsTable)
        .where(eq(channelFinalDeliveryJobsTable.externalEventId, "discord:message:1"))
        .get();

      expect(discordRequests.map((request) => request.body)).toEqual([
        {
          allowed_mentions: { parse: [] },
          content: `mosoo session ${seed.sessionId}\n\nFinal answer`,
        },
      ]);
      expect(job).toEqual({
        attemptCount: 1,
        status: "delivered",
      });
      expect(recorded.recorded).toEqual([{ type: "ack" }]);
    } finally {
      restoreFetch();
    }
  });

  test("waiting for run completion requeues without spending delivery attempts", async () => {
    const telegramBodies: unknown[] = [];
    const restoreFetch = installTelegramFetch(telegramBodies);

    try {
      const { bindings, database, queue } = await createTestEnvironment();
      const seed = await createCompletedTelegramFinalDeliveryJob({
        bindings,
        database,
        externalEventId: "telegram:update:still-running",
      });
      await database
        .app()
        .update(sessionRunsTable)
        .set({
          status: "running",
          updatedAt: nowMsForTest(),
        })
        .where(eq(sessionRunsTable.id, seed.runId))
        .run();

      const queued = takeQueuedMessageBody(queue, seed.jobId);
      const recorded = createRecordedQueueMessage<ChannelFinalDeliveryMessage>({ body: queued });
      await processChannelFinalDeliveryMessage(bindings, recorded.message, {}, nowMsForTest);

      const job = await database
        .app()
        .select({
          attemptCount: channelFinalDeliveryJobsTable.attemptCount,
          lastErrorCode: channelFinalDeliveryJobsTable.lastErrorCode,
          status: channelFinalDeliveryJobsTable.status,
        })
        .from(channelFinalDeliveryJobsTable)
        .where(eq(channelFinalDeliveryJobsTable.id, seed.jobId))
        .get();

      expect(telegramBodies).toEqual([]);
      expect(job).toEqual({
        attemptCount: 0,
        lastErrorCode: null,
        status: "dispatched",
      });
      expect(recorded.recorded).toEqual([{ type: "ack" }]);
      expect(queue.sent.at(-1)).toEqual({
        body: { jobId: seed.jobId },
        contentType: "json",
        delaySeconds: 30,
        id: "queued-2",
      });
    } finally {
      restoreFetch();
    }
  });

  test("blocks provider calls when delete cleanup has terminated the session", async () => {
    const telegramBodies: unknown[] = [];
    const restoreFetch = installTelegramFetch(telegramBodies);

    try {
      const { bindings, database, queue } = await createTestEnvironment();
      const seed = await createCompletedTelegramFinalDeliveryJob({
        bindings,
        database,
        externalEventId: "telegram:update:delete-cleanup",
      });
      await database
        .app()
        .update(sessionsTable)
        .set({
          archivedAt: nowMsForTest(),
          status: "TERMINATED",
          updatedAt: nowMsForTest(),
        })
        .where(eq(sessionsTable.id, seed.sessionId))
        .run();

      const queued = takeQueuedMessageBody(queue, seed.jobId);
      const recorded = createRecordedQueueMessage<ChannelFinalDeliveryMessage>({ body: queued });
      await processChannelFinalDeliveryMessage(bindings, recorded.message, {}, nowMsForTest);

      const job = await database
        .app()
        .select({
          attemptCount: channelFinalDeliveryJobsTable.attemptCount,
          lastErrorCode: channelFinalDeliveryJobsTable.lastErrorCode,
          status: channelFinalDeliveryJobsTable.status,
        })
        .from(channelFinalDeliveryJobsTable)
        .where(eq(channelFinalDeliveryJobsTable.id, seed.jobId))
        .get();

      expect(telegramBodies).toEqual([]);
      expect(job).toEqual({
        attemptCount: 1,
        lastErrorCode: "session_not_deliverable",
        status: "failed",
      });
      expect(recorded.recorded).toEqual([{ type: "ack" }]);
    } finally {
      restoreFetch();
    }
  });

  test("delivers queued final replies for archived non-terminated sessions", async () => {
    const telegramBodies: unknown[] = [];
    const restoreFetch = installTelegramFetch(telegramBodies);

    try {
      const { bindings, database, queue } = await createTestEnvironment();
      const seed = await createCompletedTelegramFinalDeliveryJob({
        bindings,
        database,
        externalEventId: "telegram:update:archived",
      });
      await database
        .app()
        .update(sessionsTable)
        .set({
          archivedAt: nowMsForTest(),
          updatedAt: nowMsForTest(),
        })
        .where(eq(sessionsTable.id, seed.sessionId))
        .run();

      const queued = takeQueuedMessageBody(queue, seed.jobId);
      const recorded = createRecordedQueueMessage<ChannelFinalDeliveryMessage>({ body: queued });
      await processChannelFinalDeliveryMessage(bindings, recorded.message, {}, nowMsForTest);

      const job = await database
        .app()
        .select({
          attemptCount: channelFinalDeliveryJobsTable.attemptCount,
          status: channelFinalDeliveryJobsTable.status,
        })
        .from(channelFinalDeliveryJobsTable)
        .where(eq(channelFinalDeliveryJobsTable.id, seed.jobId))
        .get();

      expect(telegramBodies).toEqual([
        {
          chat_id: "42",
          text: `mosoo session ${seed.sessionId}\n\nFinal answer`,
        },
      ]);
      expect(job).toEqual({
        attemptCount: 1,
        status: "delivered",
      });
      expect(recorded.recorded).toEqual([{ type: "ack" }]);
    } finally {
      restoreFetch();
    }
  });

  test("active delivery leases requeue replayed messages without resending replies", async () => {
    const telegramBodies: unknown[] = [];
    const restoreFetch = installTelegramFetch(telegramBodies);

    try {
      const { bindings, database, queue } = await createTestEnvironment();
      const seed = await createCompletedTelegramFinalDeliveryJob({
        bindings,
        database,
        externalEventId: "telegram:update:active-claim",
      });
      await database
        .app()
        .update(channelFinalDeliveryJobsTable)
        .set({
          attemptCount: 1,
          lastErrorCode: `delivery_claim:worker-a:${nowMsForTest() + 25_000}`,
          updatedAt: nowMsForTest(),
        })
        .where(eq(channelFinalDeliveryJobsTable.id, seed.jobId))
        .run();

      const queued = takeQueuedMessageBody(queue, seed.jobId);
      const recorded = createRecordedQueueMessage<ChannelFinalDeliveryMessage>({ body: queued });
      await processChannelFinalDeliveryMessage(bindings, recorded.message, {}, nowMsForTest);

      const job = await database
        .app()
        .select({
          attemptCount: channelFinalDeliveryJobsTable.attemptCount,
          lastErrorCode: channelFinalDeliveryJobsTable.lastErrorCode,
          status: channelFinalDeliveryJobsTable.status,
        })
        .from(channelFinalDeliveryJobsTable)
        .where(eq(channelFinalDeliveryJobsTable.id, seed.jobId))
        .get();

      expect(telegramBodies).toEqual([]);
      expect(job).toEqual({
        attemptCount: 1,
        lastErrorCode: `delivery_claim:worker-a:${nowMsForTest() + 25_000}`,
        status: "dispatched",
      });
      expect(recorded.recorded).toEqual([{ type: "ack" }]);
      expect(queue.sent.at(-1)).toEqual({
        body: { jobId: seed.jobId },
        contentType: "json",
        delaySeconds: 25,
        id: "queued-2",
      });
    } finally {
      restoreFetch();
    }
  });

  test("marks Lark binding error and acks when delivery fails with a credential-scoped error", async () => {
    const restoreFetch = installLarkFetch({
      replyResponse: { code: 230035, msg: "Send Message Permission deny." },
    });

    try {
      const { bindings, database, queue } = await createTestEnvironment();
      const seed = await createCompletedLarkFinalDeliveryJob({
        bindings,
        database,
        externalEventId: "lark:event:permission-failure",
      });

      const queued = takeQueuedMessageBody(queue, seed.jobId);
      const recorded = createRecordedQueueMessage<ChannelFinalDeliveryMessage>({ body: queued });
      await processChannelFinalDeliveryMessage(bindings, recorded.message, {}, nowMsForTest);

      const binding = await database
        .app()
        .select({
          lastErrorCode: agentChannelBindingsTable.lastErrorCode,
          status: agentChannelBindingsTable.status,
        })
        .from(agentChannelBindingsTable)
        .where(eq(agentChannelBindingsTable.id, seed.bindingId))
        .get();
      const job = await database
        .app()
        .select({
          attemptCount: channelFinalDeliveryJobsTable.attemptCount,
          lastErrorCode: channelFinalDeliveryJobsTable.lastErrorCode,
          status: channelFinalDeliveryJobsTable.status,
        })
        .from(channelFinalDeliveryJobsTable)
        .where(eq(channelFinalDeliveryJobsTable.externalEventId, "lark:event:permission-failure"))
        .get();

      expect(binding).toEqual({
        lastErrorCode: "lark_230035",
        status: "error",
      });
      expect(job).toEqual({
        attemptCount: 1,
        lastErrorCode: "lark_230035",
        status: "failed",
      });
      expect(recorded.recorded).toEqual([{ type: "ack" }]);
    } finally {
      restoreFetch();
    }
  });

  test("retries when binding credentials cannot be decrypted", async () => {
    const discordRequests: { body: unknown; url: string }[] = [];
    const restoreFetch = installDiscordFetch(discordRequests);

    try {
      const { bindings, database, queue } = await createTestEnvironment();
      const seed = await createCompletedDiscordFinalDeliveryJob({
        bindings,
        database,
        externalEventId: "discord:message:secret-failure",
      });

      const queued = takeQueuedMessageBody(queue, seed.jobId);
      const brokenBindings = {
        ...bindings,
        VAULT_ROOT_SECRET: "wrong-vault-secret",
      } satisfies ApiBindings;
      const recorded = createRecordedQueueMessage<ChannelFinalDeliveryMessage>({ body: queued });
      await processChannelFinalDeliveryMessage(brokenBindings, recorded.message, {}, nowMsForTest);

      const job = await database
        .app()
        .select({
          attemptCount: channelFinalDeliveryJobsTable.attemptCount,
          lastErrorCode: channelFinalDeliveryJobsTable.lastErrorCode,
          status: channelFinalDeliveryJobsTable.status,
        })
        .from(channelFinalDeliveryJobsTable)
        .where(eq(channelFinalDeliveryJobsTable.externalEventId, "discord:message:secret-failure"))
        .get();

      expect(discordRequests).toEqual([]);
      expect(job).toEqual({
        attemptCount: 1,
        lastErrorCode: "OperationError",
        status: "dispatched",
      });
      expect(recorded.recorded).toEqual([{ type: "ack" }]);
      expect(queue.sent.at(-1)).toEqual({
        body: { jobId: seed.jobId },
        contentType: "json",
        delaySeconds: 60,
        id: "queued-2",
      });
    } finally {
      restoreFetch();
    }
  });

  test("retries when the provider send times out", async () => {
    const telegramBodies: unknown[] = [];
    let abortObserved = false;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      const requestUrl = readFetchUrl(url);

      if (requestUrl === "https://api.telegram.org/bottelegram-token/getMe") {
        return Response.json({
          ok: true,
          result: {
            first_name: "mosoo Telegram",
            id: 9001,
            is_bot: true,
            username: "mosoo_telegram_bot",
          },
        });
      }

      if (requestUrl === "https://api.telegram.org/bottelegram-token/sendMessage") {
        if (typeof init?.body === "string") {
          telegramBodies.push(readJsonObjectBody(init.body));
        }

        return await new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;

          if (!signal) {
            reject(new Error("Expected Telegram sendMessage to receive an AbortSignal."));
            return;
          }

          signal.addEventListener("abort", () => {
            abortObserved = true;
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
      }

      return Response.json({
        data: [{ id: "gpt-5.4" }],
      });
    };

    try {
      const { bindings, database, queue } = await createTestEnvironment();
      const seed = await createCompletedTelegramFinalDeliveryJob({
        bindings,
        database,
        externalEventId: "telegram:update:send-timeout",
      });

      const queued = takeQueuedMessageBody(queue, seed.jobId);
      const recorded = createRecordedQueueMessage<ChannelFinalDeliveryMessage>({ body: queued });
      await processChannelFinalDeliveryMessage(
        bindings,
        recorded.message,
        { providerRequestTimeoutMs: 1 },
        nowMsForTest,
      );

      const job = await database
        .app()
        .select({
          attemptCount: channelFinalDeliveryJobsTable.attemptCount,
          lastErrorCode: channelFinalDeliveryJobsTable.lastErrorCode,
          status: channelFinalDeliveryJobsTable.status,
        })
        .from(channelFinalDeliveryJobsTable)
        .where(eq(channelFinalDeliveryJobsTable.externalEventId, "telegram:update:send-timeout"))
        .get();

      expect(abortObserved).toBe(true);
      expect(telegramBodies).toHaveLength(1);
      expect(job).toEqual({
        attemptCount: 1,
        lastErrorCode: "ChannelWebApiTimeoutError",
        status: "dispatched",
      });
      expect(recorded.recorded).toEqual([{ type: "ack" }]);
      expect(queue.sent.at(-1)).toEqual({
        body: { jobId: seed.jobId },
        contentType: "json",
        delaySeconds: 60,
        id: "queued-2",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("recovers a final delivery job after the retry limit through the scheduled worker", async () => {
    const telegramBodies: unknown[] = [];
    let providerAvailable = false;
    let recoveryQueueAvailable = true;
    const restoreFetch = installTelegramFetch(telegramBodies, {
      async onSendMessage() {
        if (!providerAvailable) {
          throw new Error("provider unavailable");
        }
      },
    });

    try {
      const { bindings: baseBindings, database, queue } = await createTestEnvironment();
      const bindings: ApiBindings = {
        ...baseBindings,
        CHANNEL_FINAL_DELIVERY_QUEUE: {
          sent: queue.sent,
          async send(body, options): Promise<void> {
            if (!recoveryQueueAvailable) {
              throw new Error("Queue unavailable during terminal recovery.");
            }

            await queue.send(body, options);
          },
        },
      } as ApiBindings;
      const seed = await createCompletedTelegramFinalDeliveryJob({
        bindings,
        database,
        externalEventId: "telegram:update:max-retries",
      });
      await database
        .app()
        .update(channelFinalDeliveryJobsTable)
        .set({
          attemptCount: 7,
          updatedAt: nowMsForTest(),
        })
        .where(eq(channelFinalDeliveryJobsTable.id, seed.jobId))
        .run();

      const queued = takeQueuedMessageBody(queue, seed.jobId);
      const recorded = createRecordedQueueMessage<ChannelFinalDeliveryMessage>({ body: queued });
      await processChannelFinalDeliveryMessage(bindings, recorded.message, {}, nowMsForTest);

      const job = await database
        .app()
        .select({
          attemptCount: channelFinalDeliveryJobsTable.attemptCount,
          lastErrorCode: channelFinalDeliveryJobsTable.lastErrorCode,
          status: channelFinalDeliveryJobsTable.status,
        })
        .from(channelFinalDeliveryJobsTable)
        .where(eq(channelFinalDeliveryJobsTable.externalEventId, "telegram:update:max-retries"))
        .get();

      expect(telegramBodies).toHaveLength(1);
      expect(job).toEqual({
        attemptCount: 8,
        lastErrorCode: "delivery_retry_exhausted:Error",
        status: "failed",
      });
      expect(recorded.recorded).toEqual([{ type: "ack" }]);
      expect(queue.sent).toHaveLength(1);

      providerAvailable = true;
      recoveryQueueAvailable = false;
      await createApiWorker().scheduled(
        { scheduledTime: nowMsForTest() } as ScheduledController,
        bindings,
      );

      const pendingRecovery = await database
        .app()
        .select({
          lastErrorCode: channelFinalDeliveryJobsTable.lastErrorCode,
          status: channelFinalDeliveryJobsTable.status,
        })
        .from(channelFinalDeliveryJobsTable)
        .where(eq(channelFinalDeliveryJobsTable.id, seed.jobId))
        .get();

      expect(pendingRecovery).toEqual({
        lastErrorCode: "channel_final_delivery_recovery_queue_pending",
        status: "dispatched",
      });
      recoveryQueueAvailable = true;
      await createApiWorker().scheduled(
        { scheduledTime: nowMsForTest() } as ScheduledController,
        bindings,
      );
      const redriven = createRecordedQueueMessage<ChannelFinalDeliveryMessage>({
        body: takeQueuedMessageBody(queue, seed.jobId),
      });
      await processChannelFinalDeliveryMessage(bindings, redriven.message, {}, nowMsForTest);

      const recovered = await database
        .app()
        .select({
          attemptCount: channelFinalDeliveryJobsTable.attemptCount,
          lastErrorCode: channelFinalDeliveryJobsTable.lastErrorCode,
          status: channelFinalDeliveryJobsTable.status,
        })
        .from(channelFinalDeliveryJobsTable)
        .where(eq(channelFinalDeliveryJobsTable.id, seed.jobId))
        .get();

      expect(telegramBodies).toHaveLength(2);
      expect(recovered).toEqual({
        attemptCount: 9,
        lastErrorCode: null,
        status: "delivered",
      });
      expect(redriven.recorded).toEqual([{ type: "ack" }]);
    } finally {
      restoreFetch();
    }
  });

  test("fails malformed job payloads without retrying poison messages", async () => {
    const telegramBodies: unknown[] = [];
    const restoreFetch = installTelegramFetch(telegramBodies);

    try {
      const { bindings, database, queue } = await createTestEnvironment();
      const seed = await createCompletedTelegramFinalDeliveryJob({
        bindings,
        database,
        externalEventId: "telegram:update:bad-payload",
      });

      await database
        .app()
        .update(channelFinalDeliveryJobsTable)
        .set({
          payloadJson: JSON.stringify({
            provider: "slack",
          }),
        })
        .where(eq(channelFinalDeliveryJobsTable.id, seed.jobId))
        .run();

      const queued = takeQueuedMessageBody(queue, seed.jobId);
      const recorded = createRecordedQueueMessage<ChannelFinalDeliveryMessage>({ body: queued });
      await processChannelFinalDeliveryMessage(bindings, recorded.message, {}, nowMsForTest);

      const job = await database
        .app()
        .select({
          attemptCount: channelFinalDeliveryJobsTable.attemptCount,
          lastErrorCode: channelFinalDeliveryJobsTable.lastErrorCode,
          status: channelFinalDeliveryJobsTable.status,
        })
        .from(channelFinalDeliveryJobsTable)
        .where(eq(channelFinalDeliveryJobsTable.id, seed.jobId))
        .get();

      expect(telegramBodies).toEqual([]);
      expect(job).toEqual({
        attemptCount: 1,
        lastErrorCode: "ChannelFinalDeliveryPayloadError",
        status: "failed",
      });
      expect(recorded.recorded).toEqual([{ type: "ack" }]);
    } finally {
      restoreFetch();
    }
  });

  test("dedupes producer-side: repeated enqueue with same key sends only one queue message", async () => {
    const restoreFetch = installTelegramFetch([]);

    try {
      const { bindings, database, queue } = await createTestEnvironment();
      const seed = await createCompletedTelegramFinalDeliveryJob({
        bindings,
        database,
        externalEventId: "telegram:update:dedupe",
      });

      expect(queue.sent).toHaveLength(1);
      expect(queue.sent[0]?.body).toEqual({ jobId: seed.jobId });

      const duplicateJobId = await enqueueChannelFinalDeliveryJob(
        bindings,
        {
          bindingId: seed.bindingId,
          externalEventId: "telegram:update:dedupe",
          payload: {
            chatId: "42",
            messageThreadId: null,
            provider: "telegram",
          },
          provider: "telegram",
          runId: seed.runId,
          sessionId: seed.sessionId,
        },
        nowMsForTest(),
      );

      expect(duplicateJobId).toBeNull();
      expect(queue.sent).toHaveLength(1);
    } finally {
      restoreFetch();
    }
  });

  test("retains an ambiguously accepted enqueue and delivers the retained job", async () => {
    const telegramBodies: unknown[] = [];
    const restoreFetch = installTelegramFetch(telegramBodies);

    try {
      const { bindings: baseBindings, database, queue } = await createTestEnvironment();
      const bindings: ApiBindings = {
        ...baseBindings,
        CHANNEL_FINAL_DELIVERY_QUEUE: {
          sent: queue.sent,
          async send(body, options): Promise<void> {
            await queue.send(body, options);
            throw new Error("Queue response timed out after accepting the message.");
          },
        },
      } as ApiBindings;
      const seed = await createCompletedTelegramFinalDeliveryJob({
        bindings,
        database,
        externalEventId: "telegram:update:ambiguous-enqueue",
      });

      const retained = await database
        .app()
        .select({
          lastErrorCode: channelFinalDeliveryJobsTable.lastErrorCode,
          status: channelFinalDeliveryJobsTable.status,
        })
        .from(channelFinalDeliveryJobsTable)
        .where(eq(channelFinalDeliveryJobsTable.id, seed.jobId))
        .get();
      const recorded = createRecordedQueueMessage<ChannelFinalDeliveryMessage>({
        body: takeQueuedMessageBody(queue, seed.jobId),
      });
      await processChannelFinalDeliveryMessage(bindings, recorded.message, {}, nowMsForTest);

      expect(retained).toEqual({
        lastErrorCode: "channel_final_delivery_queue_send_failed",
        status: "dispatched",
      });
      expect(telegramBodies).toHaveLength(1);
      expect(recorded.recorded).toEqual([{ type: "ack" }]);
    } finally {
      restoreFetch();
    }
  });

  test("scheduled redrive delivers jobs when the initial queue send is rejected", async () => {
    const telegramBodies: unknown[] = [];
    const restoreFetch = installTelegramFetch(telegramBodies);

    try {
      const { bindings: baseBindings, database, queue } = await createTestEnvironment();
      let queueAvailable = false;
      const bindings: ApiBindings = {
        ...baseBindings,
        CHANNEL_FINAL_DELIVERY_QUEUE: {
          sent: queue.sent,
          async send(body, options): Promise<void> {
            if (!queueAvailable) {
              throw new Error("Queue unavailable.");
            }

            await queue.send(body, options);
          },
        },
      } as ApiBindings;
      const seed = await createCompletedTelegramFinalDeliveryJob({
        bindings,
        database,
        externalEventId: "telegram:update:enqueue-redrive",
      });

      expect(queue.sent).toEqual([]);
      queueAvailable = true;
      await createApiWorker().scheduled(
        { scheduledTime: nowMsForTest() } as ScheduledController,
        bindings,
      );

      const queued = takeQueuedMessageBody(queue, seed.jobId);
      const recorded = createRecordedQueueMessage<ChannelFinalDeliveryMessage>({ body: queued });
      await processChannelFinalDeliveryMessage(bindings, recorded.message, {}, nowMsForTest);

      expect(telegramBodies).toHaveLength(1);
      expect(recorded.recorded).toEqual([{ type: "ack" }]);
      await redriveFailedChannelFinalDeliveryEnqueues(bindings);
      expect(queue.sent).toHaveLength(1);
    } finally {
      restoreFetch();
    }
  });

  test("consumer-side idempotency: processing a delivered message twice does not resend", async () => {
    const telegramBodies: unknown[] = [];
    const restoreFetch = installTelegramFetch(telegramBodies);

    try {
      const { bindings, database, queue } = await createTestEnvironment();
      const seed = await createCompletedTelegramFinalDeliveryJob({
        bindings,
        database,
        externalEventId: "telegram:update:idempotent",
      });

      const queued = takeQueuedMessageBody(queue, seed.jobId);
      const first = createRecordedQueueMessage<ChannelFinalDeliveryMessage>({ body: queued });
      await processChannelFinalDeliveryMessage(bindings, first.message, {}, nowMsForTest);

      const second = createRecordedQueueMessage<ChannelFinalDeliveryMessage>({ body: queued });
      await processChannelFinalDeliveryMessage(bindings, second.message, {}, nowMsForTest);

      expect(telegramBodies).toHaveLength(1);
      expect(first.recorded).toEqual([{ type: "ack" }]);
      expect(second.recorded).toEqual([{ type: "ack" }]);
    } finally {
      restoreFetch();
    }
  });
});
