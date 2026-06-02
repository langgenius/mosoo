import { channelEventReceiptsTable } from "@mosoo/db";
import type { AgentChannelBindingProvider, ChannelEventReceiptId } from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import type { ChannelBindingId, SessionId } from "@mosoo/id";
import { and, eq, isNull, lt } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../time";
import { getSessionRuntimeEventSourceReceipts } from "../../sessions/application/session-runtime-event-receipts.service";

export interface ChannelEventReceiptReservation {
  duplicate: boolean;
  receiptId: ChannelEventReceiptId | null;
  sessionId: SessionId | null;
}

const CHANNEL_EVENT_RECEIPT_STALE_MS = 5 * 60 * 1000;
const CHANNEL_EVENT_RECEIPT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function hasProcessedChannelEvent(input: {
  clientRequestId: string;
  database: D1Database;
  sessionId: SessionId;
}): Promise<boolean> {
  const receipts = await getSessionRuntimeEventSourceReceipts(input.database, {
    sessionId: input.sessionId,
    sourceEventIds: [input.clientRequestId],
  });

  return receipts.has(input.clientRequestId);
}

async function deleteExpiredChannelEventReceipts(input: {
  database: D1Database;
  timestampMs: number;
}): Promise<void> {
  await getAppDatabase(input.database)
    .delete(channelEventReceiptsTable)
    .where(lt(channelEventReceiptsTable.expiresAt, input.timestampMs))
    .run();
}

export async function beginChannelEventReceipt(input: {
  bindingId: ChannelBindingId;
  database: D1Database;
  externalEventId: string;
  externalTenantId: string;
  provider: AgentChannelBindingProvider;
  retryStale?: boolean;
}): Promise<ChannelEventReceiptReservation> {
  const externalEventId = input.externalEventId.trim();

  if (externalEventId.length === 0) {
    throw new Error("Channel event receipt external event id is required.");
  }

  const reservationId = createPlatformId<ChannelEventReceiptId>();
  const timestampMs = currentTimestampMs();

  await deleteExpiredChannelEventReceipts({
    database: input.database,
    timestampMs,
  });

  await getAppDatabase(input.database)
    .insert(channelEventReceiptsTable)
    .values({
      bindingId: input.bindingId,
      createdAt: timestampMs,
      expiresAt: timestampMs + CHANNEL_EVENT_RECEIPT_TTL_MS,
      externalEventId,
      externalTenantId: input.externalTenantId,
      id: reservationId,
      provider: input.provider,
      sessionId: null,
      updatedAt: timestampMs,
    })
    .onConflictDoNothing({
      target: [
        channelEventReceiptsTable.provider,
        channelEventReceiptsTable.externalTenantId,
        channelEventReceiptsTable.externalEventId,
      ],
    })
    .run();

  const current =
    (await getAppDatabase(input.database)
      .select({
        id: channelEventReceiptsTable.id,
        sessionId: channelEventReceiptsTable.sessionId,
        updatedAt: channelEventReceiptsTable.updatedAt,
      })
      .from(channelEventReceiptsTable)
      .where(
        and(
          eq(channelEventReceiptsTable.provider, input.provider),
          eq(channelEventReceiptsTable.externalTenantId, input.externalTenantId),
          eq(channelEventReceiptsTable.externalEventId, externalEventId),
        ),
      )
      .limit(1)
      .get()) ?? null;

  if (!current) {
    throw new Error("Channel event receipt reservation could not be confirmed.");
  }

  if (
    current.id !== reservationId &&
    current.sessionId === null &&
    input.retryStale !== false &&
    current.updatedAt < timestampMs - CHANNEL_EVENT_RECEIPT_STALE_MS
  ) {
    await getAppDatabase(input.database)
      .delete(channelEventReceiptsTable)
      .where(
        and(
          eq(channelEventReceiptsTable.id, current.id),
          isNull(channelEventReceiptsTable.sessionId),
          lt(channelEventReceiptsTable.updatedAt, timestampMs - CHANNEL_EVENT_RECEIPT_STALE_MS),
        ),
      )
      .run();

    return beginChannelEventReceipt({
      ...input,
      retryStale: false,
    });
  }

  return {
    duplicate: current.id !== reservationId,
    receiptId: current.id === reservationId ? reservationId : null,
    sessionId: current.sessionId,
  };
}

export async function completeChannelEventReceipt(input: {
  database: D1Database;
  receiptId: ChannelEventReceiptId | null;
  sessionId: SessionId;
}): Promise<void> {
  if (!input.receiptId) {
    return;
  }

  const timestampMs = currentTimestampMs();

  await getAppDatabase(input.database)
    .update(channelEventReceiptsTable)
    .set({
      expiresAt: timestampMs + CHANNEL_EVENT_RECEIPT_TTL_MS,
      sessionId: input.sessionId,
      updatedAt: timestampMs,
    })
    .where(eq(channelEventReceiptsTable.id, input.receiptId))
    .run();
}

export async function clearChannelEventReceipt(input: {
  database: D1Database;
  receiptId: ChannelEventReceiptId | null;
}): Promise<void> {
  if (!input.receiptId) {
    return;
  }

  await getAppDatabase(input.database)
    .delete(channelEventReceiptsTable)
    .where(eq(channelEventReceiptsTable.id, input.receiptId))
    .run();
}
