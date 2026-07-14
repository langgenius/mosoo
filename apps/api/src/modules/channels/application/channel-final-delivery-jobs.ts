import { channelFinalDeliveryJobsTable } from "@mosoo/db";
import type { AgentChannelBindingProvider, ChannelFinalDeliveryJobId } from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import type { ChannelBindingId, SessionId, SessionRunId } from "@mosoo/id";
import { and, asc, eq, inArray, like, or } from "drizzle-orm";

import { createErrorLogContext, logError } from "../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase, getD1ChangeCount } from "../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../time";
import type {
  ChannelFinalDeliveryMessage,
  ChannelFinalDeliveryPayload,
} from "./channel-final-delivery-message";
import { parseChannelFinalDeliveryPayload } from "./channel-final-delivery-payload";

type ChannelFinalDeliveryProvider = ChannelFinalDeliveryPayload["provider"];
type ChannelFinalDeliveryPayloadFor<Provider extends ChannelFinalDeliveryProvider> = Extract<
  ChannelFinalDeliveryPayload,
  { provider: Provider }
>;

interface EnqueueChannelFinalDeliveryJobInputBase {
  bindingId: ChannelBindingId;
  externalEventId: string;
  runId: SessionRunId;
  sessionId: SessionId;
}

type EnqueueChannelFinalDeliveryJobInputFor<Provider extends ChannelFinalDeliveryProvider> =
  EnqueueChannelFinalDeliveryJobInputBase & {
    payload: ChannelFinalDeliveryPayloadFor<Provider>;
    provider: Provider;
  };

export type EnqueueChannelFinalDeliveryJobInput =
  | EnqueueChannelFinalDeliveryJobInputFor<"discord">
  | EnqueueChannelFinalDeliveryJobInputFor<"lark">
  | EnqueueChannelFinalDeliveryJobInputFor<"slack">
  | EnqueueChannelFinalDeliveryJobInputFor<"telegram">
  | EnqueueChannelFinalDeliveryJobInputFor<"wechat">;

export interface ChannelFinalDeliveryScheduler {
  enqueue(input: EnqueueChannelFinalDeliveryJobInput): Promise<void>;
}

export interface JobLedgerRow {
  attemptCount: number;
  bindingId: ChannelBindingId;
  externalEventId: string;
  lastErrorCode: string | null;
  payloadJson: string;
  provider: AgentChannelBindingProvider;
  runId: SessionRunId;
  sessionId: SessionId;
  status: "delivered" | "dispatched" | "failed";
}

const DELIVERY_CLAIM_PREFIX = "delivery_claim:";

export const CHANNEL_FINAL_DELIVERY_QUEUE_DELIVERY_PENDING_CODE =
  "channel_final_delivery_queue_delivery_pending";

export const CHANNEL_FINAL_DELIVERY_QUEUE_SEND_FAILED_CODE =
  "channel_final_delivery_queue_send_failed";

const CHANNEL_FINAL_DELIVERY_QUEUE_REDRIVE_LIMIT = 100;

const CHANNEL_FINAL_DELIVERY_RETRY_EXHAUSTED_PREFIX = "delivery_retry_exhausted:";

const CHANNEL_FINAL_DELIVERY_RECOVERY_QUEUE_PENDING_CODE =
  "channel_final_delivery_recovery_queue_pending";

const CHANNEL_FINAL_DELIVERY_RECOVERY_REDRIVE_LIMIT = 100;

export interface ChannelFinalDeliveryClaim {
  attemptCount: number;
  claimCode: string;
  leaseExpiresAtMs: number;
  ownerId: string;
}

export function parseActiveChannelFinalDeliveryClaim(
  lastErrorCode: string | null,
  nowMs: number,
): Omit<ChannelFinalDeliveryClaim, "attemptCount" | "claimCode"> | null {
  if (!lastErrorCode?.startsWith(DELIVERY_CLAIM_PREFIX)) {
    return null;
  }

  const [ownerId, expiresAtRaw] = lastErrorCode.slice(DELIVERY_CLAIM_PREFIX.length).split(":");
  const leaseExpiresAtMs = Number(expiresAtRaw);

  if (!ownerId || !Number.isSafeInteger(leaseExpiresAtMs) || leaseExpiresAtMs <= nowMs) {
    return null;
  }

  return { leaseExpiresAtMs, ownerId };
}

function createDeliveryClaimCode(input: { leaseExpiresAtMs: number; ownerId: string }): string {
  return `${DELIVERY_CLAIM_PREFIX}${input.ownerId}:${input.leaseExpiresAtMs}`;
}

export async function claimJobForDelivery(input: {
  database: D1Database;
  expectedAttemptCount: number;
  jobId: ChannelFinalDeliveryJobId;
  leaseDurationMs: number;
  nowMs: number;
  ownerId: string;
}): Promise<ChannelFinalDeliveryClaim | null> {
  const leaseExpiresAtMs = input.nowMs + input.leaseDurationMs;
  const attemptCount = input.expectedAttemptCount + 1;
  const claimCode = createDeliveryClaimCode({
    leaseExpiresAtMs,
    ownerId: input.ownerId,
  });
  const result = await getAppDatabase(input.database)
    .update(channelFinalDeliveryJobsTable)
    .set({
      attemptCount,
      lastErrorCode: claimCode,
      updatedAt: input.nowMs,
    })
    .where(
      and(
        eq(channelFinalDeliveryJobsTable.id, input.jobId),
        eq(channelFinalDeliveryJobsTable.status, "dispatched"),
        eq(channelFinalDeliveryJobsTable.attemptCount, input.expectedAttemptCount),
      ),
    )
    .run();

  if (getD1ChangeCount(result) === 0) {
    return null;
  }

  return {
    attemptCount,
    claimCode,
    leaseExpiresAtMs,
    ownerId: input.ownerId,
  };
}

export async function markJobDelivered(input: {
  attemptCount: number;
  claimCode: string;
  database: D1Database;
  jobId: ChannelFinalDeliveryJobId;
  nowMs: number;
}): Promise<boolean> {
  const result = await getAppDatabase(input.database)
    .update(channelFinalDeliveryJobsTable)
    .set({
      attemptCount: input.attemptCount,
      lastErrorCode: null,
      status: "delivered",
      updatedAt: input.nowMs,
    })
    .where(
      and(
        eq(channelFinalDeliveryJobsTable.id, input.jobId),
        eq(channelFinalDeliveryJobsTable.status, "dispatched"),
        eq(channelFinalDeliveryJobsTable.attemptCount, input.attemptCount),
        eq(channelFinalDeliveryJobsTable.lastErrorCode, input.claimCode),
      ),
    )
    .run();

  return getD1ChangeCount(result) > 0;
}

export async function markJobFailed(input: {
  attemptCount: number;
  database: D1Database;
  errorCode: string;
  jobId: ChannelFinalDeliveryJobId;
  nowMs: number;
}): Promise<void> {
  await getAppDatabase(input.database)
    .update(channelFinalDeliveryJobsTable)
    .set({
      attemptCount: input.attemptCount,
      lastErrorCode: input.errorCode,
      status: "failed",
      updatedAt: input.nowMs,
    })
    .where(
      and(
        eq(channelFinalDeliveryJobsTable.id, input.jobId),
        eq(channelFinalDeliveryJobsTable.status, "dispatched"),
      ),
    )
    .run();
}

export async function markJobDeliveryRetryExhausted(input: {
  attemptCount: number;
  database: D1Database;
  errorCode: string;
  jobId: ChannelFinalDeliveryJobId;
  nowMs: number;
}): Promise<void> {
  await getAppDatabase(input.database)
    .update(channelFinalDeliveryJobsTable)
    .set({
      attemptCount: input.attemptCount,
      lastErrorCode: `${CHANNEL_FINAL_DELIVERY_RETRY_EXHAUSTED_PREFIX}${input.errorCode}`,
      status: "failed",
      updatedAt: input.nowMs,
    })
    .where(
      and(
        eq(channelFinalDeliveryJobsTable.id, input.jobId),
        eq(channelFinalDeliveryJobsTable.status, "dispatched"),
      ),
    )
    .run();
}

export async function recordJobAttempt(input: {
  attemptCount: number;
  database: D1Database;
  errorCode: string | null;
  jobId: ChannelFinalDeliveryJobId;
  nowMs: number;
}): Promise<void> {
  await getAppDatabase(input.database)
    .update(channelFinalDeliveryJobsTable)
    .set({
      attemptCount: input.attemptCount,
      lastErrorCode: input.errorCode,
      updatedAt: input.nowMs,
    })
    .where(
      and(
        eq(channelFinalDeliveryJobsTable.id, input.jobId),
        eq(channelFinalDeliveryJobsTable.status, "dispatched"),
      ),
    )
    .run();
}

export async function recordJobWait(input: {
  database: D1Database;
  jobId: ChannelFinalDeliveryJobId;
  nowMs: number;
}): Promise<void> {
  await getAppDatabase(input.database)
    .update(channelFinalDeliveryJobsTable)
    .set({
      updatedAt: input.nowMs,
    })
    .where(
      and(
        eq(channelFinalDeliveryJobsTable.id, input.jobId),
        eq(channelFinalDeliveryJobsTable.status, "dispatched"),
      ),
    )
    .run();
}

async function markJobQueueSendFailed(input: {
  database: D1Database;
  jobId: ChannelFinalDeliveryJobId;
}): Promise<void> {
  await getAppDatabase(input.database)
    .update(channelFinalDeliveryJobsTable)
    .set({
      lastErrorCode: CHANNEL_FINAL_DELIVERY_QUEUE_SEND_FAILED_CODE,
      updatedAt: currentTimestampMs(),
    })
    .where(
      and(
        eq(channelFinalDeliveryJobsTable.id, input.jobId),
        eq(channelFinalDeliveryJobsTable.status, "dispatched"),
      ),
    )
    .run();
}

async function clearJobQueueSendFailure(input: {
  database: D1Database;
  jobId: ChannelFinalDeliveryJobId;
}): Promise<void> {
  await getAppDatabase(input.database)
    .update(channelFinalDeliveryJobsTable)
    .set({
      lastErrorCode: null,
      updatedAt: currentTimestampMs(),
    })
    .where(
      and(
        eq(channelFinalDeliveryJobsTable.id, input.jobId),
        eq(channelFinalDeliveryJobsTable.status, "dispatched"),
        inArray(channelFinalDeliveryJobsTable.lastErrorCode, [
          CHANNEL_FINAL_DELIVERY_QUEUE_DELIVERY_PENDING_CODE,
          CHANNEL_FINAL_DELIVERY_QUEUE_SEND_FAILED_CODE,
        ]),
      ),
    )
    .run();
}

function toChannelFinalDeliveryMessage(
  jobId: ChannelFinalDeliveryJobId,
): ChannelFinalDeliveryMessage {
  return { jobId };
}

async function sendChannelFinalDeliveryMessage(
  bindings: Pick<ApiBindings, "CHANNEL_FINAL_DELIVERY_QUEUE" | "DB">,
  jobId: ChannelFinalDeliveryJobId,
): Promise<void> {
  try {
    await bindings.CHANNEL_FINAL_DELIVERY_QUEUE.send(toChannelFinalDeliveryMessage(jobId));
  } catch (error) {
    // A rejected producer response does not prove that Queue discarded the message.
    // The durable ledger remains eligible for scheduled redrive either way.
    try {
      await markJobQueueSendFailed({ database: bindings.DB, jobId });
    } catch (markError) {
      logError("channel-final-delivery.enqueue_failure_mark_failed", {
        ...createErrorLogContext(markError),
        jobId,
      });
    }

    logError("channel-final-delivery.enqueue_deferred", {
      ...createErrorLogContext(error),
      jobId,
    });
    return;
  }

  try {
    await clearJobQueueSendFailure({ database: bindings.DB, jobId });
  } catch (error) {
    // Queue accepted the job. A later redrive can safely send a duplicate because
    // the consumer claim is idempotent.
    logError("channel-final-delivery.enqueue_success_clear_failed", {
      ...createErrorLogContext(error),
      jobId,
    });
  }
}

export async function redriveFailedChannelFinalDeliveryEnqueues(
  bindings: Pick<ApiBindings, "CHANNEL_FINAL_DELIVERY_QUEUE" | "DB">,
): Promise<void> {
  const jobs = await getAppDatabase(bindings.DB)
    .select({ id: channelFinalDeliveryJobsTable.id })
    .from(channelFinalDeliveryJobsTable)
    .where(
      and(
        eq(channelFinalDeliveryJobsTable.status, "dispatched"),
        inArray(channelFinalDeliveryJobsTable.lastErrorCode, [
          CHANNEL_FINAL_DELIVERY_QUEUE_DELIVERY_PENDING_CODE,
          CHANNEL_FINAL_DELIVERY_QUEUE_SEND_FAILED_CODE,
        ]),
      ),
    )
    .orderBy(asc(channelFinalDeliveryJobsTable.id))
    .limit(CHANNEL_FINAL_DELIVERY_QUEUE_REDRIVE_LIMIT)
    .all();

  for (const job of jobs) {
    await sendChannelFinalDeliveryMessage(bindings, job.id);
  }
}

async function clearRecoveredJobPendingMarker(input: {
  database: D1Database;
  jobId: ChannelFinalDeliveryJobId;
}): Promise<void> {
  await getAppDatabase(input.database)
    .update(channelFinalDeliveryJobsTable)
    .set({
      lastErrorCode: null,
      updatedAt: currentTimestampMs(),
    })
    .where(
      and(
        eq(channelFinalDeliveryJobsTable.id, input.jobId),
        eq(channelFinalDeliveryJobsTable.status, "dispatched"),
        eq(
          channelFinalDeliveryJobsTable.lastErrorCode,
          CHANNEL_FINAL_DELIVERY_RECOVERY_QUEUE_PENDING_CODE,
        ),
      ),
    )
    .run();
}

async function sendRecoveredJobMessage(
  bindings: Pick<ApiBindings, "CHANNEL_FINAL_DELIVERY_QUEUE" | "DB">,
  jobId: ChannelFinalDeliveryJobId,
): Promise<void> {
  try {
    await bindings.CHANNEL_FINAL_DELIVERY_QUEUE.send({ jobId });
  } catch (error) {
    // A rejected producer response does not prove Queue discarded the message.
    // Keep the pending marker so both actual rejections and ambiguous accepts
    // are retried safely by a later scheduled run.
    logError("channel-final-delivery.recovery_enqueue_deferred", {
      ...createErrorLogContext(error),
      jobId,
    });
    return;
  }

  try {
    await clearRecoveredJobPendingMarker({ database: bindings.DB, jobId });
  } catch (error) {
    // Queue accepted the job. Retaining the marker causes a safe duplicate on
    // a later scheduled recovery if the consumer has not claimed it yet.
    logError("channel-final-delivery.recovery_success_clear_failed", {
      ...createErrorLogContext(error),
      jobId,
    });
  }
}

export async function redriveExhaustedChannelFinalDeliveryJobs(
  bindings: Pick<ApiBindings, "CHANNEL_FINAL_DELIVERY_QUEUE" | "DB">,
): Promise<void> {
  const jobs = await getAppDatabase(bindings.DB)
    .select({
      id: channelFinalDeliveryJobsTable.id,
      lastErrorCode: channelFinalDeliveryJobsTable.lastErrorCode,
      status: channelFinalDeliveryJobsTable.status,
    })
    .from(channelFinalDeliveryJobsTable)
    .where(
      or(
        and(
          eq(channelFinalDeliveryJobsTable.status, "failed"),
          like(
            channelFinalDeliveryJobsTable.lastErrorCode,
            `${CHANNEL_FINAL_DELIVERY_RETRY_EXHAUSTED_PREFIX}%`,
          ),
        ),
        and(
          eq(channelFinalDeliveryJobsTable.status, "dispatched"),
          eq(
            channelFinalDeliveryJobsTable.lastErrorCode,
            CHANNEL_FINAL_DELIVERY_RECOVERY_QUEUE_PENDING_CODE,
          ),
        ),
      ),
    )
    .orderBy(asc(channelFinalDeliveryJobsTable.id))
    .limit(CHANNEL_FINAL_DELIVERY_RECOVERY_REDRIVE_LIMIT)
    .all();

  for (const job of jobs) {
    if (job.status === "failed") {
      if (job.lastErrorCode === null) {
        continue;
      }

      const transitioned = await getAppDatabase(bindings.DB)
        .update(channelFinalDeliveryJobsTable)
        .set({
          lastErrorCode: CHANNEL_FINAL_DELIVERY_RECOVERY_QUEUE_PENDING_CODE,
          status: "dispatched",
          updatedAt: currentTimestampMs(),
        })
        .where(
          and(
            eq(channelFinalDeliveryJobsTable.id, job.id),
            eq(channelFinalDeliveryJobsTable.status, "failed"),
            eq(channelFinalDeliveryJobsTable.lastErrorCode, job.lastErrorCode),
          ),
        )
        .run();

      if (getD1ChangeCount(transitioned) === 0) {
        continue;
      }
    }

    await sendRecoveredJobMessage(bindings, job.id);
  }
}

export async function enqueueChannelFinalDeliveryJob(
  bindings: ApiBindings,
  input: EnqueueChannelFinalDeliveryJobInput,
  nowMs = currentTimestampMs(),
): Promise<ChannelFinalDeliveryJobId | null> {
  const payload = parseChannelFinalDeliveryPayload(input.provider, input.payload);
  const jobId = createPlatformId<ChannelFinalDeliveryJobId>();
  const insertResult = await getAppDatabase(bindings.DB)
    .insert(channelFinalDeliveryJobsTable)
    .values({
      attemptCount: 0,
      bindingId: input.bindingId,
      createdAt: nowMs,
      externalEventId: input.externalEventId,
      id: jobId,
      lastErrorCode: CHANNEL_FINAL_DELIVERY_QUEUE_DELIVERY_PENDING_CODE,
      payloadJson: JSON.stringify(payload),
      provider: input.provider,
      runId: input.runId,
      sessionId: input.sessionId,
      status: "dispatched",
      updatedAt: nowMs,
    })
    .onConflictDoNothing({
      target: [
        channelFinalDeliveryJobsTable.provider,
        channelFinalDeliveryJobsTable.bindingId,
        channelFinalDeliveryJobsTable.externalEventId,
      ],
    })
    .run();

  if (getD1ChangeCount(insertResult) === 0) {
    return null;
  }

  await sendChannelFinalDeliveryMessage(bindings, jobId);

  return jobId;
}

export function createChannelFinalDeliveryScheduler(
  bindings: ApiBindings,
): ChannelFinalDeliveryScheduler {
  return {
    async enqueue(input) {
      await enqueueChannelFinalDeliveryJob(bindings, input);
    },
  };
}

export async function readJobLedger(input: {
  database: D1Database;
  jobId: ChannelFinalDeliveryJobId;
}): Promise<JobLedgerRow | null> {
  const row = await getAppDatabase(input.database)
    .select({
      attemptCount: channelFinalDeliveryJobsTable.attemptCount,
      bindingId: channelFinalDeliveryJobsTable.bindingId,
      externalEventId: channelFinalDeliveryJobsTable.externalEventId,
      lastErrorCode: channelFinalDeliveryJobsTable.lastErrorCode,
      payloadJson: channelFinalDeliveryJobsTable.payloadJson,
      provider: channelFinalDeliveryJobsTable.provider,
      runId: channelFinalDeliveryJobsTable.runId,
      sessionId: channelFinalDeliveryJobsTable.sessionId,
      status: channelFinalDeliveryJobsTable.status,
    })
    .from(channelFinalDeliveryJobsTable)
    .where(eq(channelFinalDeliveryJobsTable.id, input.jobId))
    .limit(1)
    .get();

  return row ?? null;
}
