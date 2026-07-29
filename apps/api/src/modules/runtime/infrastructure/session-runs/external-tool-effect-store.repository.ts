import type {
  ExternalToolEffectClaim,
  ExternalToolEffectStatus,
} from "@mosoo/contracts/external-tool-effect";
import { McpExecuteCommandResult } from "@mosoo/contracts/runtime-command";
import { parseSchemaValue } from "@mosoo/contracts/validation";
import {
  externalToolEffectAttemptsTable,
  externalToolEffectsTable,
  sessionRunsTable,
} from "@mosoo/db";
import { createPlatformId, parsePlatformId } from "@mosoo/id";
import type {
  DriverCommandId,
  DriverInstanceId,
  ExternalToolEffectId,
  McpServerId,
  SessionRunId,
} from "@mosoo/id";
import { and, eq, inArray } from "drizzle-orm";

import {
  getAppDatabase,
  getD1ChangeCount,
  runAppDatabaseBatch,
} from "../../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../../time";
import { ACTIVE_SESSION_RUN_STATUSES } from "../../domain/session-run-lifecycle.machine";

interface ExternalToolEffectRow {
  attemptCount: number;
  id: ExternalToolEffectId;
  idempotencyKey: string;
  resultJson: string | null;
  status: ExternalToolEffectStatus;
}

function parseMcpResult(value: string): typeof McpExecuteCommandResult.infer {
  return parseSchemaValue(McpExecuteCommandResult, JSON.parse(value));
}

async function getExternalToolEffect(
  database: D1Database,
  input: {
    commandId: DriverCommandId;
    driverInstanceId: DriverInstanceId;
  },
): Promise<ExternalToolEffectRow> {
  const effect =
    (await getAppDatabase(database)
      .select({
        attemptCount: externalToolEffectsTable.attemptCount,
        id: externalToolEffectsTable.id,
        idempotencyKey: externalToolEffectsTable.idempotencyKey,
        resultJson: externalToolEffectsTable.resultJson,
        status: externalToolEffectsTable.status,
      })
      .from(externalToolEffectsTable)
      .where(
        and(
          eq(externalToolEffectsTable.commandId, input.commandId),
          eq(externalToolEffectsTable.driverInstanceId, input.driverInstanceId),
        ),
      )
      .limit(1)
      .get()) ?? null;

  if (effect === null) {
    throw new Error("External tool effect intent was not found for the runtime command.");
  }

  return effect;
}

/**
 * Prepares the durable intent before a MCP command may reach a Driver. The
 * caller commits it in the same D1 batch as the command record, so either both
 * become visible to a Driver or neither does.
 */
export async function prepareExternalToolEffectIntent(
  database: D1Database,
  input: {
    command: {
      commandId: string;
      serverId: string;
      toolName: string;
    };
    driverInstanceId: DriverInstanceId;
  },
): Promise<typeof externalToolEffectsTable.$inferInsert> {
  const commandId = parsePlatformId<DriverCommandId>(input.command.commandId, "driver command id");
  const serverId = parsePlatformId<McpServerId>(input.command.serverId, "MCP server id");
  const activeRun =
    (await getAppDatabase(database)
      .select({ id: sessionRunsTable.id })
      .from(sessionRunsTable)
      .where(
        and(
          eq(sessionRunsTable.driverInstanceId, input.driverInstanceId),
          inArray(sessionRunsTable.status, ACTIVE_SESSION_RUN_STATUSES),
        ),
      )
      .limit(1)
      .get()) ?? null;

  if (activeRun === null) {
    throw new Error("MCP external tool effects require an active Session Run.");
  }

  const effectId = createPlatformId<ExternalToolEffectId>();
  const nowMs = currentTimestampMs();

  return {
    attemptCount: 0,
    commandId,
    createdAt: nowMs,
    driverInstanceId: input.driverInstanceId,
    id: effectId,
    idempotencyKey: effectId,
    providerReceiptJson: null,
    resultJson: null,
    serverId,
    sessionRunId: activeRun.id,
    status: "intent" as const,
    toolName: input.command.toolName,
    updatedAt: nowMs,
  };
}

/**
 * Atomically fences the only permitted provider invocation. An interrupted
 * execution becomes unknown instead of being replayed by a new Driver.
 */
export async function claimExternalToolEffect(
  database: D1Database,
  input: {
    commandId: DriverCommandId;
    driverInstanceId: DriverInstanceId;
  },
): Promise<typeof ExternalToolEffectClaim.infer> {
  const effect = await getExternalToolEffect(database, input);

  if (effect.status === "succeeded") {
    if (effect.resultJson === null) {
      throw new Error("Succeeded external tool effect is missing its command result.");
    }

    return {
      effectId: effect.id,
      kind: "completed",
      result: parseMcpResult(effect.resultJson),
    };
  }

  if (effect.status === "unknown") {
    return { effectId: effect.id, kind: "unknown" };
  }

  if (effect.status === "executing") {
    await markExternalToolEffectUnknown(database, input);
    return { effectId: effect.id, kind: "unknown" };
  }

  const attempt = effect.attemptCount + 1;
  const nowMs = currentTimestampMs();
  const [update] = await runAppDatabaseBatch(database, (appDatabase) => [
    appDatabase
      .update(externalToolEffectsTable)
      .set({
        attemptCount: attempt,
        status: "executing",
        updatedAt: nowMs,
      })
      .where(
        and(
          eq(externalToolEffectsTable.id, effect.id),
          eq(externalToolEffectsTable.attemptCount, effect.attemptCount),
          eq(externalToolEffectsTable.status, "intent"),
        ),
      ),
    appDatabase
      .insert(externalToolEffectAttemptsTable)
      .values({
        attempt,
        completedAt: null,
        createdAt: nowMs,
        effectId: effect.id,
        providerReceiptJson: null,
        resultJson: null,
        status: "executing",
      })
      .onConflictDoNothing(),
  ]);

  if (getD1ChangeCount(update) === 0) {
    return claimExternalToolEffect(database, input);
  }

  return {
    attempt,
    effectId: effect.id,
    idempotencyKey: effect.idempotencyKey,
    kind: "execute",
  };
}

/**
 * Stores the outcome before the Driver sends the command terminal receipt.
 * The Driver preserves provider `_meta` as an opaque receipt when one exists.
 * MCP does not standardize reconciliation, so absent receipts remain null and
 * a later delivery uncertainty is fenced as unknown rather than replayed.
 */
export async function completeExternalToolEffect(
  database: D1Database,
  input: {
    commandId: DriverCommandId;
    driverInstanceId: DriverInstanceId;
    providerReceiptJson?: string | null;
    result: typeof McpExecuteCommandResult.infer;
  },
): Promise<void> {
  const effect = await getExternalToolEffect(database, input);

  if (effect.status === "succeeded") {
    return;
  }
  if (effect.status !== "executing") {
    throw new Error(`Cannot complete an external tool effect in ${effect.status} state.`);
  }

  const nowMs = currentTimestampMs();
  const resultJson = JSON.stringify(input.result);
  const [update] = await runAppDatabaseBatch(database, (appDatabase) => [
    appDatabase
      .update(externalToolEffectsTable)
      .set({
        providerReceiptJson: input.providerReceiptJson ?? null,
        resultJson,
        status: "succeeded",
        updatedAt: nowMs,
      })
      .where(
        and(
          eq(externalToolEffectsTable.id, effect.id),
          eq(externalToolEffectsTable.status, "executing"),
        ),
      ),
    appDatabase
      .update(externalToolEffectAttemptsTable)
      .set({
        completedAt: nowMs,
        providerReceiptJson: input.providerReceiptJson ?? null,
        resultJson,
        status: "succeeded",
      })
      .where(
        and(
          eq(externalToolEffectAttemptsTable.effectId, effect.id),
          eq(externalToolEffectAttemptsTable.attempt, effect.attemptCount),
          eq(externalToolEffectAttemptsTable.status, "executing"),
        ),
      ),
  ]);

  if (getD1ChangeCount(update) === 0) {
    throw new Error("External tool effect completion lost its execution claim.");
  }
}

/**
 * No generic MCP provider reconciliation or compensation exists. This is a
 * deliberate terminal fence: callers must resolve an unknown effect explicitly
 * before they create another external action.
 */
export async function markExternalToolEffectUnknown(
  database: D1Database,
  input: {
    commandId: DriverCommandId;
    driverInstanceId: DriverInstanceId;
  },
): Promise<void> {
  const effect = await getExternalToolEffect(database, input);

  if (effect.status !== "executing") {
    return;
  }

  const nowMs = currentTimestampMs();
  const [update] = await runAppDatabaseBatch(database, (appDatabase) => [
    appDatabase
      .update(externalToolEffectsTable)
      .set({
        status: "unknown",
        updatedAt: nowMs,
      })
      .where(
        and(
          eq(externalToolEffectsTable.id, effect.id),
          eq(externalToolEffectsTable.status, "executing"),
        ),
      ),
    appDatabase
      .update(externalToolEffectAttemptsTable)
      .set({
        completedAt: nowMs,
        status: "unknown",
      })
      .where(
        and(
          eq(externalToolEffectAttemptsTable.effectId, effect.id),
          eq(externalToolEffectAttemptsTable.attempt, effect.attemptCount),
          eq(externalToolEffectAttemptsTable.status, "executing"),
        ),
      ),
  ]);

  if (getD1ChangeCount(update) === 0) {
    return;
  }
}

/** Marks all in-flight effects for a terminal Driver in two bounded writes. */
export async function markExecutingExternalToolEffectsUnknownForDriver(
  database: D1Database,
  driverInstanceId: DriverInstanceId,
): Promise<void> {
  const effects = await getAppDatabase(database)
    .select({
      attemptCount: externalToolEffectsTable.attemptCount,
      id: externalToolEffectsTable.id,
    })
    .from(externalToolEffectsTable)
    .where(
      and(
        eq(externalToolEffectsTable.driverInstanceId, driverInstanceId),
        eq(externalToolEffectsTable.status, "executing"),
      ),
    )
    .all();

  if (effects.length === 0) {
    return;
  }

  const effectIds = effects.map((effect) => effect.id);
  const nowMs = currentTimestampMs();
  await runAppDatabaseBatch(database, (appDatabase) => [
    appDatabase
      .update(externalToolEffectsTable)
      .set({ status: "unknown", updatedAt: nowMs })
      .where(
        and(
          eq(externalToolEffectsTable.driverInstanceId, driverInstanceId),
          eq(externalToolEffectsTable.status, "executing"),
          inArray(externalToolEffectsTable.id, effectIds),
        ),
      ),
    appDatabase
      .update(externalToolEffectAttemptsTable)
      .set({ completedAt: nowMs, status: "unknown" })
      .where(
        and(
          inArray(externalToolEffectAttemptsTable.effectId, effectIds),
          eq(externalToolEffectAttemptsTable.status, "executing"),
        ),
      ),
  ]);
}

export async function getExternalToolEffectForCommand(
  database: D1Database,
  input: {
    commandId: DriverCommandId;
    driverInstanceId: DriverInstanceId;
  },
): Promise<{
  attemptCount: number;
  idempotencyKey: string;
  providerReceiptJson: string | null;
  sessionRunId: SessionRunId;
  status: ExternalToolEffectStatus;
} | null> {
  return (
    (await getAppDatabase(database)
      .select({
        attemptCount: externalToolEffectsTable.attemptCount,
        idempotencyKey: externalToolEffectsTable.idempotencyKey,
        providerReceiptJson: externalToolEffectsTable.providerReceiptJson,
        sessionRunId: externalToolEffectsTable.sessionRunId,
        status: externalToolEffectsTable.status,
      })
      .from(externalToolEffectsTable)
      .where(
        and(
          eq(externalToolEffectsTable.commandId, input.commandId),
          eq(externalToolEffectsTable.driverInstanceId, input.driverInstanceId),
        ),
      )
      .limit(1)
      .get()) ?? null
  );
}
