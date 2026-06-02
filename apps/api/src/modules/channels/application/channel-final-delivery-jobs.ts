import { channelFinalDeliveryJobsTable } from "@mosoo/db";
import type { AgentChannelBindingProvider, ChannelFinalDeliveryJobId } from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import type { ChannelBindingId, SessionId, SessionRunId } from "@mosoo/id";
import { and, eq } from "drizzle-orm";

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

async function deleteJobDedupeRow(input: {
  database: D1Database;
  jobId: ChannelFinalDeliveryJobId;
}): Promise<void> {
  await getAppDatabase(input.database)
    .delete(channelFinalDeliveryJobsTable)
    .where(eq(channelFinalDeliveryJobsTable.id, input.jobId))
    .run();
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
      lastErrorCode: null,
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

  try {
    const message: ChannelFinalDeliveryMessage = { jobId };
    await bindings.CHANNEL_FINAL_DELIVERY_QUEUE.send(message);
  } catch (error) {
    await deleteJobDedupeRow({ database: bindings.DB, jobId });
    throw error;
  }

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
