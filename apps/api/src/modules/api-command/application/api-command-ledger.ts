import { apiCommandsTable } from "@mosoo/db";
import type { ApiCommandId, ApiCommandKind, ApiCommandRow } from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import { and, asc, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";

import { createErrorLogContext, logError } from "../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase, getD1ChangeCount } from "../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../time";
import type { ApiCommandMessage } from "./api-command-message";

export const API_COMMAND_LEASE_MS = 5 * 60 * 1000;

export const API_COMMAND_LEASE_RENEWAL_INTERVAL_MS = API_COMMAND_LEASE_MS / 5;

export const API_COMMAND_QUEUE_SEND_FAILED_CODE = "queue_send_failed";

export const API_COMMAND_QUEUE_DELIVERY_PENDING_CODE = "queue_delivery_pending";

const API_COMMAND_QUEUE_DELIVERY_PENDING_MESSAGE = "API command is awaiting queue delivery.";

const API_COMMAND_QUEUE_SEND_FAILED_MESSAGE = "API command queue send failed.";

const API_COMMAND_QUEUE_REDRIVE_LIMIT = 100;

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
  claimOwner: string;
  commandId: ApiCommandId;
  dedupeKey: string;
  deliveryGeneration: number;
  kind: ApiCommandKind;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  payloadJson: string;
}

export type ApiCommandClaimAuthority = Pick<
  ApiCommandClaim,
  "attemptCount" | "claimOwner" | "commandId" | "deliveryGeneration"
>;

export type ApiCommandClaimResult =
  | { readonly claim: ApiCommandClaim; readonly kind: "claimed" }
  | { readonly claimExpiresAt: number | null; readonly kind: "busy" }
  | { readonly kind: "missing" | "stale" | "terminal" };

export interface ApiCommandAdmission {
  readonly commandId: ApiCommandId;
  readonly kind: ApiCommandKind;
  readonly shouldDeliver: boolean;
}

type ApiCommandDeliveryBindings = Pick<ApiBindings, "API_COMMAND_QUEUE" | "DB"> &
  Partial<Pick<ApiBindings, "ENVIRONMENT_ARTIFACT_BUILD_QUEUE">>;

function normalizeDedupeKey(value: string): string {
  const dedupeKey = value.trim();

  if (dedupeKey.length === 0) {
    throw new Error("API command dedupe key is required.");
  }

  return dedupeKey;
}

function toQueueMessage(commandId: ApiCommandId, deliveryGeneration: number): ApiCommandMessage {
  return { commandId, deliveryGeneration };
}

export async function findApiCommandByDedupeKey(
  database: D1Database,
  dedupeKey: string,
): Promise<Pick<
  ApiCommandRow,
  "deliveryGeneration" | "id" | "kind" | "lastErrorCode" | "lastErrorMessage" | "status"
> | null> {
  return (
    (await getAppDatabase(database)
      .select({
        id: apiCommandsTable.id,
        deliveryGeneration: apiCommandsTable.deliveryGeneration,
        kind: apiCommandsTable.kind,
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

async function markApiCommandQueueSendFailed(input: {
  commandId: ApiCommandId;
  database: D1Database;
  deliveryGeneration: number;
}): Promise<void> {
  await getAppDatabase(input.database)
    .update(apiCommandsTable)
    .set({
      lastErrorCode: API_COMMAND_QUEUE_SEND_FAILED_CODE,
      lastErrorMessage: API_COMMAND_QUEUE_SEND_FAILED_MESSAGE,
      updatedAt: currentTimestampMs(),
    })
    .where(
      and(
        eq(apiCommandsTable.id, input.commandId),
        eq(apiCommandsTable.deliveryGeneration, input.deliveryGeneration),
        eq(apiCommandsTable.status, "queued"),
      ),
    )
    .run();
}

async function clearApiCommandQueueSendFailure(input: {
  commandId: ApiCommandId;
  database: D1Database;
  deliveryGeneration: number;
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
        eq(apiCommandsTable.deliveryGeneration, input.deliveryGeneration),
        eq(apiCommandsTable.status, "queued"),
        inArray(apiCommandsTable.lastErrorCode, [
          API_COMMAND_QUEUE_DELIVERY_PENDING_CODE,
          API_COMMAND_QUEUE_SEND_FAILED_CODE,
        ]),
      ),
    )
    .run();
}

async function sendApiCommandMessage(
  bindings: ApiCommandDeliveryBindings,
  commandId: ApiCommandId,
  deliveryGeneration: number,
  kind: ApiCommandKind,
): Promise<boolean> {
  try {
    const message = toQueueMessage(commandId, deliveryGeneration);
    const queue =
      kind === "environment_package_artifact_build"
        ? bindings.ENVIRONMENT_ARTIFACT_BUILD_QUEUE
        : bindings.API_COMMAND_QUEUE;
    if (!queue) {
      throw new Error("Environment artifact build queue binding is required.");
    }
    await queue.send(message);
  } catch (error) {
    // A rejected producer response does not prove that Queue discarded the message.
    // The durable outbox record remains eligible for scheduled redrive either way.
    try {
      await markApiCommandQueueSendFailed({
        commandId,
        database: bindings.DB,
        deliveryGeneration,
      });
    } catch (markError) {
      logError("api-command.enqueue_failure_mark_failed", {
        ...createErrorLogContext(markError),
        commandId,
      });
    }

    logError("api-command.enqueue_deferred", {
      ...createErrorLogContext(error),
      commandId,
    });
    return false;
  }

  try {
    await clearApiCommandQueueSendFailure({
      commandId,
      database: bindings.DB,
      deliveryGeneration,
    });
  } catch (error) {
    // Queue accepted the command. Leaving its delivery marker intact is safe:
    // a later redrive may send a duplicate, and consumer claiming is idempotent.
    logError("api-command.enqueue_success_clear_failed", {
      ...createErrorLogContext(error),
      commandId,
    });
  }
  return true;
}

export async function redriveFailedApiCommandEnqueues(
  bindings: ApiCommandDeliveryBindings,
): Promise<void> {
  const commands = await getAppDatabase(bindings.DB)
    .select({
      deliveryGeneration: apiCommandsTable.deliveryGeneration,
      id: apiCommandsTable.id,
      kind: apiCommandsTable.kind,
    })
    .from(apiCommandsTable)
    .where(
      and(
        eq(apiCommandsTable.status, "queued"),
        inArray(apiCommandsTable.lastErrorCode, [
          API_COMMAND_QUEUE_DELIVERY_PENDING_CODE,
          API_COMMAND_QUEUE_SEND_FAILED_CODE,
        ]),
      ),
    )
    .orderBy(asc(apiCommandsTable.id))
    .limit(API_COMMAND_QUEUE_REDRIVE_LIMIT)
    .all();

  for (const command of commands) {
    await sendApiCommandMessage(bindings, command.id, command.deliveryGeneration, command.kind);
  }
}

export function prepareApiCommand(
  input: EnqueueApiCommandInput,
  options: { commandId?: ApiCommandId; timestampMs?: number } = {},
): PreparedApiCommand {
  const timestampMs = options.timestampMs ?? currentTimestampMs();
  const commandId = options.commandId ?? createPlatformId<ApiCommandId>();

  return {
    commandId,
    record: {
      attemptCount: 0,
      claimExpiresAt: null,
      claimOwner: null,
      completedAt: null,
      createdAt: timestampMs,
      dedupeKey: normalizeDedupeKey(input.dedupeKey),
      deliveryGeneration: 1,
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

  const current = await findApiCommandByDedupeKey(bindings.DB, prepared.record.dedupeKey);

  if (current === null) {
    throw new Error("API command enqueue could not confirm the ledger row.");
  }
  if (current.kind !== input.kind) {
    throw new Error("API command dedupe key is already used by a different command kind.");
  }

  if (input.retryTerminal === true && current.status !== "queued" && current.status !== "running") {
    if (current.deliveryGeneration >= Number.MAX_SAFE_INTEGER) {
      throw new Error("API command delivery generation is exhausted.");
    }

    const retried = await database
      .update(apiCommandsTable)
      .set({
        attemptCount: 0,
        claimExpiresAt: null,
        claimOwner: null,
        completedAt: null,
        deliveryGeneration: sql`${apiCommandsTable.deliveryGeneration} + 1`,
        lastErrorCode: API_COMMAND_QUEUE_DELIVERY_PENDING_CODE,
        lastErrorMessage: API_COMMAND_QUEUE_DELIVERY_PENDING_MESSAGE,
        payloadJson: prepared.record.payloadJson,
        status: "queued",
        updatedAt: prepared.record.updatedAt,
      })
      .where(
        and(
          eq(apiCommandsTable.id, current.id),
          eq(apiCommandsTable.deliveryGeneration, current.deliveryGeneration),
          inArray(apiCommandsTable.status, ["dead_lettered", "failed", "succeeded"]),
        ),
      )
      .returning({ id: apiCommandsTable.id })
      .get();
    return { commandId: current.id, kind: input.kind, shouldDeliver: retried !== undefined };
  }

  if (
    current.status === "queued" &&
    (current.lastErrorCode === API_COMMAND_QUEUE_DELIVERY_PENDING_CODE ||
      current.lastErrorCode === API_COMMAND_QUEUE_SEND_FAILED_CODE)
  ) {
    return { commandId: current.id, kind: input.kind, shouldDeliver: true };
  }

  return { commandId: current.id, kind: input.kind, shouldDeliver: false };
}

export async function deliverApiCommand(
  bindings: ApiCommandDeliveryBindings,
  admission: ApiCommandAdmission,
): Promise<void> {
  if (!admission.shouldDeliver) {
    return;
  }

  const command = await getAppDatabase(bindings.DB)
    .select({
      deliveryGeneration: apiCommandsTable.deliveryGeneration,
      kind: apiCommandsTable.kind,
    })
    .from(apiCommandsTable)
    .where(eq(apiCommandsTable.id, admission.commandId))
    .limit(1)
    .get();
  if (command === undefined) {
    throw new Error("API command delivery could not find its durable ledger row.");
  }
  await sendApiCommandMessage(
    bindings,
    admission.commandId,
    command.deliveryGeneration,
    command.kind,
  );
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
  deliveryGeneration: number;
  nowMs?: number;
  claimOwner: string;
}): Promise<ApiCommandClaimResult> {
  if (input.claimOwner.trim().length === 0) {
    throw new Error("API command claim owner is required.");
  }
  const nowMs = input.nowMs ?? currentTimestampMs();
  const row =
    (await getAppDatabase(input.database)
      .update(apiCommandsTable)
      .set({
        attemptCount: sql`${apiCommandsTable.attemptCount} + 1`,
        claimExpiresAt: nowMs + API_COMMAND_LEASE_MS,
        claimOwner: input.claimOwner,
        status: "running",
        updatedAt: nowMs,
      })
      .where(
        and(
          eq(apiCommandsTable.id, input.commandId),
          eq(apiCommandsTable.deliveryGeneration, input.deliveryGeneration),
          sql`typeof(${apiCommandsTable.attemptCount}) = 'integer' AND ${apiCommandsTable.attemptCount} BETWEEN 0 AND ${Number.MAX_SAFE_INTEGER - 1}`,
          or(
            eq(apiCommandsTable.status, "queued"),
            and(
              eq(apiCommandsTable.status, "running"),
              or(
                isNull(apiCommandsTable.claimExpiresAt),
                lte(apiCommandsTable.claimExpiresAt, nowMs),
              ),
            ),
          ),
        ),
      )
      .returning({
        attemptCount: apiCommandsTable.attemptCount,
        commandId: apiCommandsTable.id,
        dedupeKey: apiCommandsTable.dedupeKey,
        deliveryGeneration: apiCommandsTable.deliveryGeneration,
        kind: apiCommandsTable.kind,
        lastErrorCode: apiCommandsTable.lastErrorCode,
        lastErrorMessage: apiCommandsTable.lastErrorMessage,
        payloadJson: apiCommandsTable.payloadJson,
      })
      .get()) ?? null;

  if (row !== null) {
    return { claim: { ...row, claimOwner: input.claimOwner }, kind: "claimed" };
  }

  const state = await getAppDatabase(input.database)
    .select({
      attemptCount: apiCommandsTable.attemptCount,
      claimExpiresAt: apiCommandsTable.claimExpiresAt,
      deliveryGeneration: apiCommandsTable.deliveryGeneration,
      status: apiCommandsTable.status,
    })
    .from(apiCommandsTable)
    .where(eq(apiCommandsTable.id, input.commandId))
    .limit(1)
    .get();
  if (state === undefined) {
    return { kind: "missing" };
  }
  if (state.deliveryGeneration !== input.deliveryGeneration) {
    return { kind: "stale" };
  }
  if (state.status !== "queued" && state.status !== "running") {
    return { kind: "terminal" };
  }
  if (!Number.isSafeInteger(state.attemptCount) || state.attemptCount < 0) {
    throw new Error("API command attempt count is corrupt.");
  }
  if (state.attemptCount === Number.MAX_SAFE_INTEGER) {
    throw new Error("API command attempt count is exhausted.");
  }
  return { claimExpiresAt: state.claimExpiresAt, kind: "busy" };
}

export function exactApiCommandClaimPredicate(claim: ApiCommandClaimAuthority, nowMs: number) {
  return and(
    eq(apiCommandsTable.id, claim.commandId),
    eq(apiCommandsTable.deliveryGeneration, claim.deliveryGeneration),
    eq(apiCommandsTable.attemptCount, claim.attemptCount),
    eq(apiCommandsTable.status, "running"),
    eq(apiCommandsTable.claimOwner, claim.claimOwner),
    gt(apiCommandsTable.claimExpiresAt, nowMs),
  );
}

export async function renewApiCommandClaim(input: {
  claim: ApiCommandClaim;
  database: D1Database;
  nowMs?: number;
}): Promise<boolean> {
  const nowMs = input.nowMs ?? currentTimestampMs();
  const result = await getAppDatabase(input.database)
    .update(apiCommandsTable)
    .set({
      claimExpiresAt: nowMs + API_COMMAND_LEASE_MS,
      updatedAt: nowMs,
    })
    .where(exactApiCommandClaimPredicate(input.claim, nowMs))
    .run();

  return getD1ChangeCount(result) > 0;
}

export async function completeApiCommand(input: {
  claim: ApiCommandClaim;
  database: D1Database;
  nowMs?: number;
}): Promise<boolean> {
  const nowMs = input.nowMs ?? currentTimestampMs();

  const result = await getAppDatabase(input.database)
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
    .where(exactApiCommandClaimPredicate(input.claim, nowMs))
    .run();
  return getD1ChangeCount(result) > 0;
}

export async function releaseApiCommandForRetry(input: {
  claim: ApiCommandClaim;
  database: D1Database;
  errorCode: string;
  errorMessage: string;
  nowMs?: number;
}): Promise<boolean> {
  const nowMs = input.nowMs ?? currentTimestampMs();

  const result = await getAppDatabase(input.database)
    .update(apiCommandsTable)
    .set({
      claimExpiresAt: null,
      claimOwner: null,
      lastErrorCode: input.errorCode,
      lastErrorMessage: input.errorMessage,
      status: "queued",
      updatedAt: nowMs,
    })
    .where(exactApiCommandClaimPredicate(input.claim, nowMs))
    .run();
  return getD1ChangeCount(result) > 0;
}

export async function markApiCommandFailed(input: {
  claim: ApiCommandClaim;
  database: D1Database;
  errorCode: string;
  errorMessage: string;
  nowMs?: number;
}): Promise<boolean> {
  const nowMs = input.nowMs ?? currentTimestampMs();

  const result = await getAppDatabase(input.database)
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
    .where(exactApiCommandClaimPredicate(input.claim, nowMs))
    .run();
  return getD1ChangeCount(result) > 0;
}

export async function markApiCommandDeadLettered(input: {
  claim: ApiCommandClaim;
  database: D1Database;
  errorCode: string;
  errorMessage: string;
  nowMs?: number;
}): Promise<boolean> {
  const nowMs = input.nowMs ?? currentTimestampMs();

  const result = await getAppDatabase(input.database)
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
    .where(exactApiCommandClaimPredicate(input.claim, nowMs))
    .run();
  return getD1ChangeCount(result) > 0;
}
