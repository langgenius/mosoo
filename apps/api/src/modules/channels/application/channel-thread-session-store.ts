import { channelThreadSessionsTable, sessionsTable } from "@mosoo/db";
import type { AgentChannelBindingProvider, ChannelThreadSessionId } from "@mosoo/db";
import { sleepPromise } from "@mosoo/effects";
import { createPlatformId } from "@mosoo/id";
import type { AgentId, ChannelBindingId, SessionId } from "@mosoo/id";
import { and, desc, eq, isNull, lt, ne, sql } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../time";

export interface ChannelThreadSessionReservation {
  reservationId: ChannelThreadSessionId | null;
  sessionId: SessionId | null;
}

const CHANNEL_THREAD_SESSION_STALE_MS = 5 * 60 * 1000;
const CHANNEL_THREAD_SESSION_WAIT_ATTEMPTS = 50;
const CHANNEL_THREAD_SESSION_WAIT_INTERVAL_MS = 100;

export async function completeChannelThreadSessionReservation(input: {
  database: D1Database;
  reservationId: ChannelThreadSessionId | null;
  sessionId: SessionId;
}): Promise<void> {
  if (!input.reservationId) {
    return;
  }

  await getAppDatabase(input.database)
    .update(channelThreadSessionsTable)
    .set({
      sessionId: input.sessionId,
      updatedAt: currentTimestampMs(),
    })
    .where(eq(channelThreadSessionsTable.id, input.reservationId))
    .run();
}

export async function clearChannelThreadSessionReservation(input: {
  database: D1Database;
  reservationId: ChannelThreadSessionId | null;
}): Promise<void> {
  if (!input.reservationId) {
    return;
  }

  await getAppDatabase(input.database)
    .delete(channelThreadSessionsTable)
    .where(
      and(
        eq(channelThreadSessionsTable.id, input.reservationId),
        isNull(channelThreadSessionsTable.sessionId),
      ),
    )
    .run();
}

async function findExistingChannelSessionFromMetadata(input: {
  agentId: AgentId;
  bindingId: ChannelBindingId;
  database: D1Database;
  externalThreadId: string;
}): Promise<SessionId | null> {
  const row =
    (await getAppDatabase(input.database)
      .select({ id: sessionsTable.id })
      .from(sessionsTable)
      .where(
        and(
          eq(sessionsTable.agentId, input.agentId),
          eq(sessionsTable.type, "api_channel"),
          isNull(sessionsTable.archivedAt),
          ne(sessionsTable.status, "TERMINATED"),
          sql`json_extract(${sessionsTable.metadataJson}, '$.triggered_by.binding_id') = ${input.bindingId}`,
          sql`json_extract(${sessionsTable.metadataJson}, '$.triggered_by.external_thread_id') = ${input.externalThreadId}`,
        ),
      )
      .orderBy(desc(sessionsTable.updatedAt))
      .limit(1)
      .get()) ?? null;

  return row?.id ?? null;
}

async function upsertChannelThreadSession(input: {
  bindingId: ChannelBindingId;
  database: D1Database;
  externalThreadId: string;
  provider: AgentChannelBindingProvider;
  sessionId: SessionId;
}): Promise<void> {
  const timestampMs = currentTimestampMs();

  await getAppDatabase(input.database)
    .insert(channelThreadSessionsTable)
    .values({
      bindingId: input.bindingId,
      createdAt: timestampMs,
      externalThreadId: input.externalThreadId,
      id: createPlatformId<ChannelThreadSessionId>(),
      provider: input.provider,
      sessionId: input.sessionId,
      updatedAt: timestampMs,
    })
    .onConflictDoUpdate({
      set: {
        sessionId: input.sessionId,
        updatedAt: timestampMs,
      },
      target: [
        channelThreadSessionsTable.provider,
        channelThreadSessionsTable.bindingId,
        channelThreadSessionsTable.externalThreadId,
      ],
    })
    .run();
}

async function waitForReservedChannelThreadSession(input: {
  bindingId: ChannelBindingId;
  database: D1Database;
  externalThreadId: string;
  provider: AgentChannelBindingProvider;
}): Promise<SessionId | null> {
  for (let attempt = 0; attempt < CHANNEL_THREAD_SESSION_WAIT_ATTEMPTS; attempt += 1) {
    const row =
      (await getAppDatabase(input.database)
        .select({ sessionId: channelThreadSessionsTable.sessionId })
        .from(channelThreadSessionsTable)
        .where(
          and(
            eq(channelThreadSessionsTable.provider, input.provider),
            eq(channelThreadSessionsTable.bindingId, input.bindingId),
            eq(channelThreadSessionsTable.externalThreadId, input.externalThreadId),
          ),
        )
        .limit(1)
        .get()) ?? null;

    if (!row || row.sessionId) {
      return row?.sessionId ?? null;
    }

    await sleepPromise(CHANNEL_THREAD_SESSION_WAIT_INTERVAL_MS);
  }

  return null;
}

export async function findExistingChannelSession(input: {
  agentId: AgentId;
  bindingId: ChannelBindingId;
  database: D1Database;
  externalThreadId: string;
  provider: AgentChannelBindingProvider;
}): Promise<SessionId | null> {
  const row =
    (await getAppDatabase(input.database)
      .select({
        sessionId: channelThreadSessionsTable.sessionId,
      })
      .from(channelThreadSessionsTable)
      .where(
        and(
          eq(channelThreadSessionsTable.provider, input.provider),
          eq(channelThreadSessionsTable.bindingId, input.bindingId),
          eq(channelThreadSessionsTable.externalThreadId, input.externalThreadId),
        ),
      )
      .limit(1)
      .get()) ?? null;

  if (row?.sessionId) {
    return row.sessionId;
  }

  if (row) {
    const reservedSessionId = await waitForReservedChannelThreadSession(input);

    if (reservedSessionId) {
      return reservedSessionId;
    }
  }

  const legacySessionId = await findExistingChannelSessionFromMetadata(input);

  if (legacySessionId) {
    await upsertChannelThreadSession({
      bindingId: input.bindingId,
      database: input.database,
      externalThreadId: input.externalThreadId,
      provider: input.provider,
      sessionId: legacySessionId,
    });
  }

  return legacySessionId;
}

export async function claimChannelThreadSession(input: {
  agentId: AgentId;
  bindingId: ChannelBindingId;
  database: D1Database;
  externalThreadId: string;
  provider: AgentChannelBindingProvider;
  retryStale?: boolean;
}): Promise<ChannelThreadSessionReservation> {
  const existingSessionId = await findExistingChannelSession(input);

  if (existingSessionId) {
    return {
      reservationId: null,
      sessionId: existingSessionId,
    };
  }

  const reservationId = createPlatformId<ChannelThreadSessionId>();
  const timestampMs = currentTimestampMs();

  await getAppDatabase(input.database)
    .insert(channelThreadSessionsTable)
    .values({
      bindingId: input.bindingId,
      createdAt: timestampMs,
      externalThreadId: input.externalThreadId,
      id: reservationId,
      provider: input.provider,
      sessionId: null,
      updatedAt: timestampMs,
    })
    .onConflictDoNothing({
      target: [
        channelThreadSessionsTable.provider,
        channelThreadSessionsTable.bindingId,
        channelThreadSessionsTable.externalThreadId,
      ],
    })
    .run();

  const current =
    (await getAppDatabase(input.database)
      .select({
        id: channelThreadSessionsTable.id,
        sessionId: channelThreadSessionsTable.sessionId,
        updatedAt: channelThreadSessionsTable.updatedAt,
      })
      .from(channelThreadSessionsTable)
      .where(
        and(
          eq(channelThreadSessionsTable.provider, input.provider),
          eq(channelThreadSessionsTable.bindingId, input.bindingId),
          eq(channelThreadSessionsTable.externalThreadId, input.externalThreadId),
        ),
      )
      .limit(1)
      .get()) ?? null;

  if (!current) {
    throw new Error("Channel thread session reservation could not be confirmed.");
  }

  if (current.id === reservationId) {
    return {
      reservationId,
      sessionId: null,
    };
  }

  if (current.sessionId) {
    return {
      reservationId: null,
      sessionId: current.sessionId,
    };
  }

  if (
    input.retryStale !== false &&
    current.updatedAt < timestampMs - CHANNEL_THREAD_SESSION_STALE_MS
  ) {
    await getAppDatabase(input.database)
      .delete(channelThreadSessionsTable)
      .where(
        and(
          eq(channelThreadSessionsTable.id, current.id),
          isNull(channelThreadSessionsTable.sessionId),
          lt(channelThreadSessionsTable.updatedAt, timestampMs - CHANNEL_THREAD_SESSION_STALE_MS),
        ),
      )
      .run();

    return claimChannelThreadSession({
      ...input,
      retryStale: false,
    });
  }

  const sessionId = await waitForReservedChannelThreadSession(input);

  if (sessionId) {
    return {
      reservationId: null,
      sessionId,
    };
  }

  throw new Error("Channel thread session reservation is still pending.");
}
