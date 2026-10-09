import { apiCommandsTable } from "@mosoo/db";
import type { ApiCommandId, ApiCommandKind, ApiCommandRow } from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import { and, asc, eq, gte, inArray, lt, or, sql } from "drizzle-orm";

import { createErrorLogContext, logError } from "../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase, getD1ChangeCount } from "../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../time";
import type { ApiCommandMessage } from "./api-command-message";

// A Queue consumer invocation cannot outlive 15 minutes of wall time, so a
// claim never expires under a live consumer.
const API_COMMAND_LEASE_MS = 15 * 60 * 1000;

export const API_COMMAND_QUEUE_DELIVERY_PENDING_CODE = "queue_delivery_pending";

// Older builds marked a failed Queue send "queue_send_failed" instead of leaving
// it pending. Redrive those rows until production holds none, then delete it.
const REDRIVABLE_DELIVERY_CODES = [API_COMMAND_QUEUE_DELIVERY_PENDING_CODE, "queue_send_failed"];

const API_COMMAND_QUEUE_DELIVERY_PENDING_MESSAGE = "API command is awaiting queue delivery.";

const API_COMMAND_QUEUE_REDRIVE_LIMIT = 100;

export const API_COMMAND_LEASE_EXPIRED_CODE = "lease_expired";

// One claim per Queue delivery: the first attempt plus `max_retries = 5`.
export const API_COMMAND_MAX_CLAIM_ATTEMPTS = 6;

// One extra minute absorbs clock skew against the consumer wall-time limit.
const API_COMMAND_LEASE_EXPIRY_GRACE_MS = 60_000;

export interface EnqueueApiCommandInput {
  dedupeKey: string;
  kind: ApiCommandKind;
  payload: unknown;
  retryTerminal?: boolean;
}

export interface PreparedApiCommand {
  commandId: ApiCommandId;
  record: ApiCommandRow;
}

export interface ApiCommandClaim {
  attemptCount: number;
  commandId: ApiCommandId;
  kind: ApiCommandKind;
  payloadJson: string;
}

export interface ApiCommandAdmission {
  readonly commandId: ApiCommandId;
  readonly kind: ApiCommandKind;
  readonly shouldDeliver: boolean;
}

type ApiCommandDeliveryBindings = Pick<
  ApiBindings,
  "API_COMMAND_QUEUE" | "DB" | "ENVIRONMENT_ARTIFACT_BUILD_QUEUE"
>;

export async function findApiCommandByDedupeKey(
  database: D1Database,
  dedupeKey: string,
): Promise<Pick<ApiCommandRow, "id" | "lastErrorCode" | "lastErrorMessage" | "status"> | null> {
  return (
    (await getAppDatabase(database)
      .select({
        id: apiCommandsTable.id,
        lastErrorCode: apiCommandsTable.lastErrorCode,
        lastErrorMessage: apiCommandsTable.lastErrorMessage,
        status: apiCommandsTable.status,
      })
      .from(apiCommandsTable)
      .where(eq(apiCommandsTable.dedupeKey, dedupeKey))
      .limit(1)
      .get()) ?? null
  );
}

async function clearApiCommandDeliveryPending(input: {
  commandId: ApiCommandId;
  database: D1Database;
}): Promise<void> {
  await getAppDatabase(input.database)
    .update(apiCommandsTable)
    .set({
      lastErrorCode: null,
      lastErrorMessage: null,
      updatedAt: currentTimestampMs(),
    })
    .where(
      and(
        eq(apiCommandsTable.id, input.commandId),
        eq(apiCommandsTable.status, "queued"),
        inArray(apiCommandsTable.lastErrorCode, REDRIVABLE_DELIVERY_CODES),
      ),
    )
    .run();
}

async function sendApiCommandMessage(
  bindings: ApiCommandDeliveryBindings,
  commandId: ApiCommandId,
  kind: ApiCommandKind,
): Promise<void> {
  const queue =
    kind === "environment_package_artifact_build"
      ? bindings.ENVIRONMENT_ARTIFACT_BUILD_QUEUE
      : bindings.API_COMMAND_QUEUE;
  try {
    await queue.send({ commandId } satisfies ApiCommandMessage);
  } catch (error) {
    // A rejected producer response does not prove that Queue discarded the message.
    // The durable outbox record stays pending and eligible for scheduled redrive.
    logError("api-command.enqueue_deferred", {
      ...createErrorLogContext(error),
      commandId,
    });
    return;
  }

  try {
    await clearApiCommandDeliveryPending({ commandId, database: bindings.DB });
  } catch (error) {
    // Queue accepted the command. Leaving its delivery marker intact is safe:
    // a later redrive may send a duplicate, and consumer claiming is idempotent.
    logError("api-command.enqueue_success_clear_failed", {
      ...createErrorLogContext(error),
      commandId,
    });
  }
}

// A consumer killed mid-run (wall-clock limit, deploy) leaves its command
// `running`. Queue redeliveries that land inside the lease are acknowledged
// without work, so nothing would ever resume it; hand it back to the outbox.
export async function requeueExpiredApiCommandClaims(
  database: D1Database,
  nowMs: number = currentTimestampMs(),
): Promise<void> {
  const expiredClaim = and(
    eq(apiCommandsTable.status, "running"),
    lt(apiCommandsTable.claimExpiresAt, nowMs - API_COMMAND_LEASE_EXPIRY_GRACE_MS),
  );
  const appDb = getAppDatabase(database);

  // Requeueing an exhausted command again would loop forever.
  await appDb
    .update(apiCommandsTable)
    .set({
      claimExpiresAt: null,
      claimOwner: null,
      completedAt: nowMs,
      lastErrorCode: API_COMMAND_LEASE_EXPIRED_CODE,
      lastErrorMessage: null,
      status: "dead_lettered",
      updatedAt: nowMs,
    })
    .where(and(expiredClaim, gte(apiCommandsTable.attemptCount, API_COMMAND_MAX_CLAIM_ATTEMPTS)))
    .run();

  await appDb
    .update(apiCommandsTable)
    .set({
      claimExpiresAt: null,
      claimOwner: null,
      lastErrorCode: API_COMMAND_QUEUE_DELIVERY_PENDING_CODE,
      lastErrorMessage: API_COMMAND_QUEUE_DELIVERY_PENDING_MESSAGE,
      status: "queued",
      updatedAt: nowMs,
    })
    .where(and(expiredClaim, lt(apiCommandsTable.attemptCount, API_COMMAND_MAX_CLAIM_ATTEMPTS)))
    .run();
}

export async function redriveFailedApiCommandEnqueues(
  bindings: ApiCommandDeliveryBindings,
): Promise<void> {
  await requeueExpiredApiCommandClaims(bindings.DB);

  const commands = await getAppDatabase(bindings.DB)
    .select({ id: apiCommandsTable.id, kind: apiCommandsTable.kind })
    .from(apiCommandsTable)
    .where(
      and(
        eq(apiCommandsTable.status, "queued"),
        inArray(apiCommandsTable.lastErrorCode, REDRIVABLE_DELIVERY_CODES),
      ),
    )
    .orderBy(asc(apiCommandsTable.id))
    .limit(API_COMMAND_QUEUE_REDRIVE_LIMIT)
    .all();

  for (const command of commands) {
    await sendApiCommandMessage(bindings, command.id, command.kind);
  }
}

export function prepareApiCommand(
  input: EnqueueApiCommandInput,
  options: { timestampMs?: number } = {},
): PreparedApiCommand {
  const timestampMs = options.timestampMs ?? currentTimestampMs();
  const commandId = createPlatformId<ApiCommandId>();

  return {
    commandId,
    record: {
      attemptCount: 0,
      claimExpiresAt: null,
      claimOwner: null,
      completedAt: null,
      createdAt: timestampMs,
      dedupeKey: input.dedupeKey,
      id: commandId,
      kind: input.kind,
      lastErrorCode: API_COMMAND_QUEUE_DELIVERY_PENDING_CODE,
      lastErrorMessage: API_COMMAND_QUEUE_DELIVERY_PENDING_MESSAGE,
      payloadJson: JSON.stringify(input.payload),
      status: "queued",
      updatedAt: timestampMs,
    },
  };
}

export async function admitApiCommand(
  bindings: ApiCommandDeliveryBindings,
  input: EnqueueApiCommandInput,
): Promise<ApiCommandAdmission> {
  const prepared = prepareApiCommand(input);
  const database = getAppDatabase(bindings.DB);

  const insertResult = await database
    .insert(apiCommandsTable)
    .values(prepared.record)
    .onConflictDoNothing()
    .run();

  if (getD1ChangeCount(insertResult) > 0) {
    return { commandId: prepared.commandId, kind: input.kind, shouldDeliver: true };
  }

  // Rows are never deleted, so the conflicting dedupe key always resolves.
  const current = (await findApiCommandByDedupeKey(bindings.DB, prepared.record.dedupeKey))!;

  if (input.retryTerminal === true && current.status !== "queued" && current.status !== "running") {
    await database
      .update(apiCommandsTable)
      .set({
        attemptCount: 0,
        claimExpiresAt: null,
        claimOwner: null,
        completedAt: null,
        lastErrorCode: API_COMMAND_QUEUE_DELIVERY_PENDING_CODE,
        lastErrorMessage: API_COMMAND_QUEUE_DELIVERY_PENDING_MESSAGE,
        payloadJson: prepared.record.payloadJson,
        status: "queued",
        updatedAt: prepared.record.updatedAt,
      })
      .where(
        and(
          eq(apiCommandsTable.id, current.id),
          inArray(apiCommandsTable.status, ["dead_lettered", "failed", "succeeded"]),
        ),
      )
      .run();
    return { commandId: current.id, kind: input.kind, shouldDeliver: true };
  }

  return {
    commandId: current.id,
    kind: input.kind,
    shouldDeliver:
      current.status === "queued" &&
      REDRIVABLE_DELIVERY_CODES.includes(current.lastErrorCode ?? ""),
  };
}

export async function deliverApiCommand(
  bindings: ApiCommandDeliveryBindings,
  admission: ApiCommandAdmission,
): Promise<void> {
  if (!admission.shouldDeliver) {
    return;
  }

  await sendApiCommandMessage(bindings, admission.commandId, admission.kind);
}

export async function enqueueApiCommand(
  bindings: ApiCommandDeliveryBindings,
  input: EnqueueApiCommandInput,
): Promise<ApiCommandId> {
  const admission = await admitApiCommand(bindings, input);
  await deliverApiCommand(bindings, admission);
  return admission.commandId;
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
        kind: apiCommandsTable.kind,
        payloadJson: apiCommandsTable.payloadJson,
      })
      .get()) ?? null;

  return row;
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
