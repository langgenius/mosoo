import { apiCommandsTable } from "@mosoo/db";
import type { ApiCommandId, ApiCommandKind, ApiCommandRow } from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import { and, eq, lt, or, sql } from "drizzle-orm";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase, getD1ChangeCount } from "../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../time";
import type { ApiCommandMessage } from "./api-command-message";

export const API_COMMAND_LEASE_MS = 5 * 60 * 1000;

export const API_COMMAND_LEASE_RENEWAL_INTERVAL_MS = API_COMMAND_LEASE_MS / 5;

export interface EnqueueApiCommandInput {
  dedupeKey: string;
  kind: ApiCommandKind;
  payload: unknown;
}

export interface ApiCommandClaim {
  attemptCount: number;
  commandId: ApiCommandId;
  dedupeKey: string;
  kind: ApiCommandKind;
  payloadJson: string;
}

function normalizeDedupeKey(value: string): string {
  const dedupeKey = value.trim();

  if (dedupeKey.length === 0) {
    throw new Error("API command dedupe key is required.");
  }

  return dedupeKey;
}

function toQueueMessage(commandId: ApiCommandId): ApiCommandMessage {
  return { commandId };
}

async function readApiCommandByDedupeKey(
  database: D1Database,
  dedupeKey: string,
): Promise<Pick<ApiCommandRow, "id"> | null> {
  return (
    (await getAppDatabase(database)
      .select({ id: apiCommandsTable.id })
      .from(apiCommandsTable)
      .where(eq(apiCommandsTable.dedupeKey, dedupeKey))
      .limit(1)
      .get()) ?? null
  );
}

async function deleteApiCommand(input: {
  commandId: ApiCommandId;
  database: D1Database;
}): Promise<void> {
  await getAppDatabase(input.database)
    .delete(apiCommandsTable)
    .where(eq(apiCommandsTable.id, input.commandId))
    .run();
}

export async function enqueueApiCommand(
  bindings: Pick<ApiBindings, "API_COMMAND_QUEUE" | "DB">,
  input: EnqueueApiCommandInput,
): Promise<ApiCommandId> {
  const nowMs = currentTimestampMs();
  const commandId = createPlatformId<ApiCommandId>();
  const dedupeKey = normalizeDedupeKey(input.dedupeKey);

  const insertResult = await getAppDatabase(bindings.DB)
    .insert(apiCommandsTable)
    .values({
      attemptCount: 0,
      claimExpiresAt: null,
      claimOwner: null,
      completedAt: null,
      createdAt: nowMs,
      dedupeKey,
      id: commandId,
      kind: input.kind,
      lastErrorCode: null,
      lastErrorMessage: null,
      payloadJson: JSON.stringify(input.payload),
      status: "queued",
      updatedAt: nowMs,
    })
    .onConflictDoNothing()
    .run();

  if (getD1ChangeCount(insertResult) > 0) {
    try {
      await bindings.API_COMMAND_QUEUE.send(toQueueMessage(commandId));
    } catch (error) {
      await deleteApiCommand({ commandId, database: bindings.DB });
      throw error;
    }

    return commandId;
  }

  const current = await readApiCommandByDedupeKey(bindings.DB, dedupeKey);

  if (current === null) {
    throw new Error("API command enqueue could not confirm the ledger row.");
  }

  return current.id;
}

export async function claimApiCommand(input: {
  commandId: ApiCommandId;
  database: D1Database;
  nowMs?: number;
  ownerId: string;
}): Promise<ApiCommandClaim | null> {
  const nowMs = input.nowMs ?? currentTimestampMs();
  const row =
    (await getAppDatabase(input.database)
      .update(apiCommandsTable)
      .set({
        attemptCount: sql`${apiCommandsTable.attemptCount} + 1`,
        claimExpiresAt: nowMs + API_COMMAND_LEASE_MS,
        claimOwner: input.ownerId,
        status: "running",
        updatedAt: nowMs,
      })
      .where(
        and(
          eq(apiCommandsTable.id, input.commandId),
          or(
            eq(apiCommandsTable.status, "queued"),
            and(eq(apiCommandsTable.status, "running"), lt(apiCommandsTable.claimExpiresAt, nowMs)),
          ),
        ),
      )
      .returning({
        attemptCount: apiCommandsTable.attemptCount,
        commandId: apiCommandsTable.id,
        dedupeKey: apiCommandsTable.dedupeKey,
        kind: apiCommandsTable.kind,
        payloadJson: apiCommandsTable.payloadJson,
      })
      .get()) ?? null;

  return row;
}

export async function renewApiCommandClaim(input: {
  commandId: ApiCommandId;
  database: D1Database;
  nowMs?: number;
  ownerId: string;
}): Promise<boolean> {
  const nowMs = input.nowMs ?? currentTimestampMs();
  const result = await getAppDatabase(input.database)
    .update(apiCommandsTable)
    .set({
      claimExpiresAt: nowMs + API_COMMAND_LEASE_MS,
      updatedAt: nowMs,
    })
    .where(
      and(
        eq(apiCommandsTable.id, input.commandId),
        eq(apiCommandsTable.status, "running"),
        eq(apiCommandsTable.claimOwner, input.ownerId),
      ),
    )
    .run();

  return getD1ChangeCount(result) > 0;
}

export async function completeApiCommand(input: {
  commandId: ApiCommandId;
  database: D1Database;
  nowMs?: number;
  ownerId: string;
}): Promise<void> {
  const nowMs = input.nowMs ?? currentTimestampMs();

  await getAppDatabase(input.database)
    .update(apiCommandsTable)
    .set({
      claimExpiresAt: null,
      claimOwner: null,
      completedAt: nowMs,
      lastErrorCode: null,
      lastErrorMessage: null,
      status: "succeeded",
      updatedAt: nowMs,
    })
    .where(
      and(
        eq(apiCommandsTable.id, input.commandId),
        eq(apiCommandsTable.status, "running"),
        eq(apiCommandsTable.claimOwner, input.ownerId),
      ),
    )
    .run();
}

export async function releaseApiCommandForRetry(input: {
  commandId: ApiCommandId;
  database: D1Database;
  errorCode: string;
  errorMessage: string;
  nowMs?: number;
  ownerId: string;
}): Promise<void> {
  const nowMs = input.nowMs ?? currentTimestampMs();

  await getAppDatabase(input.database)
    .update(apiCommandsTable)
    .set({
      claimExpiresAt: null,
      claimOwner: null,
      lastErrorCode: input.errorCode,
      lastErrorMessage: input.errorMessage,
      status: "queued",
      updatedAt: nowMs,
    })
    .where(
      and(
        eq(apiCommandsTable.id, input.commandId),
        eq(apiCommandsTable.status, "running"),
        eq(apiCommandsTable.claimOwner, input.ownerId),
      ),
    )
    .run();
}

export async function markApiCommandFailed(input: {
  commandId: ApiCommandId;
  database: D1Database;
  errorCode: string;
  errorMessage: string;
  nowMs?: number;
  ownerId: string;
}): Promise<void> {
  const nowMs = input.nowMs ?? currentTimestampMs();

  await getAppDatabase(input.database)
    .update(apiCommandsTable)
    .set({
      claimExpiresAt: null,
      claimOwner: null,
      completedAt: nowMs,
      lastErrorCode: input.errorCode,
      lastErrorMessage: input.errorMessage,
      status: "failed",
      updatedAt: nowMs,
    })
    .where(
      and(
        eq(apiCommandsTable.id, input.commandId),
        eq(apiCommandsTable.status, "running"),
        eq(apiCommandsTable.claimOwner, input.ownerId),
      ),
    )
    .run();
}

export async function markApiCommandDeadLettered(input: {
  commandId: ApiCommandId;
  database: D1Database;
  errorCode: string;
  errorMessage: string;
  nowMs?: number;
}): Promise<void> {
  const nowMs = input.nowMs ?? currentTimestampMs();

  await getAppDatabase(input.database)
    .update(apiCommandsTable)
    .set({
      claimExpiresAt: null,
      claimOwner: null,
      completedAt: nowMs,
      lastErrorCode: input.errorCode,
      lastErrorMessage: input.errorMessage,
      status: "dead_lettered",
      updatedAt: nowMs,
    })
    .where(eq(apiCommandsTable.id, input.commandId))
    .run();
}
