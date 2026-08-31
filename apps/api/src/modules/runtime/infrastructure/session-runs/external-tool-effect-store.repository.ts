import {
  ExternalToolEffectClaimToken,
  ExternalToolEffectSettlement,
} from "@mosoo/contracts/external-tool-effect";
import type {
  ExternalToolEffectClaim,
  ExternalToolEffectState,
  ExternalToolEffectStatus,
} from "@mosoo/contracts/external-tool-effect";
import { McpExecuteCommandResult, RuntimeCommand } from "@mosoo/contracts/runtime-command";
import type { McpExecuteCommand } from "@mosoo/contracts/runtime-command";
import { parseSchemaValue } from "@mosoo/contracts/validation";
import {
  driverCommandsTable,
  driverInstancesTable,
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
import { and, eq, exists, inArray, sql } from "drizzle-orm";

import {
  getAppDatabase,
  getD1ChangeCount,
  runAppDatabaseBatch,
} from "../../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../../time";
import { LIVE_DRIVER_INSTANCE_STATUSES } from "../../domain/driver-instance-lifecycle.machine";
import { ACTIVE_SESSION_RUN_STATUSES } from "../../domain/session-run-lifecycle.machine";

interface ExternalToolEffectRow {
  attemptCount: number;
  claimToken: string | null;
  command: McpExecuteCommand;
  id: ExternalToolEffectId;
  idempotencyKey: string;
  requestId: string;
  resultJson: string | null;
  serverId: string;
  status: ExternalToolEffectStatus;
  toolName: string;
}

type EffectLookup = {
  commandId: DriverCommandId;
  driverGeneration: number;
  driverInstanceId: DriverInstanceId;
};

function serializeRuntimeSettlement(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new TypeError("External tool effect settlement is not JSON serializable.");
  }
  return serialized;
}

function parseMcpResult(value: string): typeof McpExecuteCommandResult.infer {
  return parseSchemaValue(McpExecuteCommandResult, JSON.parse(value));
}

function selectedValue<Value>(value: Value, alias: string) {
  return sql<Value>`${value}`.as(alias);
}

function toExternalToolEffectState(effect: ExternalToolEffectRow): ExternalToolEffectState {
  switch (effect.status) {
    case "intent":
      return { effectId: effect.id, kind: "intent" };
    case "claimed":
      if (effect.claimToken === null || effect.attemptCount < 1) {
        throw new Error("Claimed external tool effect is missing its claim audit data.");
      }
      return {
        attempt: effect.attemptCount,
        effectId: effect.id,
        idempotencyKey: effect.idempotencyKey,
        kind: "claimed",
      };
    case "succeeded":
      if (effect.resultJson === null) {
        throw new Error("Succeeded external tool effect is missing its command result.");
      }
      return {
        effectId: effect.id,
        kind: "succeeded",
        result: parseMcpResultForCommand(effect.resultJson, effect.command),
      };
    case "unknown":
      return { effectId: effect.id, kind: "unknown" };
  }
}

function parseMcpResultForCommand(
  resultJson: string,
  command: McpExecuteCommand,
): typeof McpExecuteCommandResult.infer {
  const result = parseMcpResult(resultJson);
  if (
    result.requestId !== command.requestId ||
    result.serverId !== command.serverId ||
    result.toolName !== command.toolName
  ) {
    throw new Error("External tool effect result does not match its immutable command intent.");
  }

  return result;
}

async function getExternalToolEffect(
  database: D1Database,
  input: EffectLookup,
): Promise<ExternalToolEffectRow> {
  const effect =
    (await getAppDatabase(database)
      .select({
        attemptCount: externalToolEffectsTable.attemptCount,
        claimToken: externalToolEffectsTable.claimToken,
        id: externalToolEffectsTable.id,
        idempotencyKey: externalToolEffectsTable.idempotencyKey,
        payloadJson: driverCommandsTable.payloadJson,
        resultJson: externalToolEffectsTable.resultJson,
        serverId: externalToolEffectsTable.serverId,
        sessionRunId: externalToolEffectsTable.sessionRunId,
        status: externalToolEffectsTable.status,
        toolName: externalToolEffectsTable.toolName,
      })
      .from(externalToolEffectsTable)
      .innerJoin(
        driverCommandsTable,
        and(
          eq(driverCommandsTable.id, externalToolEffectsTable.commandId),
          eq(driverCommandsTable.driverGeneration, input.driverGeneration),
          eq(driverCommandsTable.driverInstanceId, externalToolEffectsTable.driverInstanceId),
        ),
      )
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
  const command = parseSchemaValue(RuntimeCommand, JSON.parse(effect.payloadJson));
  if (
    command.kind !== "mcp.execute" ||
    command.commandId !== input.commandId ||
    command.runId !== effect.sessionRunId ||
    command.serverId !== effect.serverId ||
    command.toolName !== effect.toolName
  ) {
    throw new Error("External tool effect does not match its immutable command intent.");
  }

  return { ...effect, command, requestId: command.requestId };
}

/**
 * Prepares the durable intent before a MCP command may reach a Driver. The
 * caller commits it in the same D1 batch as the command record, so either both
 * become visible to a Driver or neither does.
 */
export function prepareExternalToolEffectIntent(input: {
  command: {
    commandId: string;
    runId: string;
    serverId: string;
    toolName: string;
  };
  driverInstanceId: DriverInstanceId;
}) {
  const commandId = parsePlatformId<DriverCommandId>(input.command.commandId, "driver command id");
  const sessionRunId = parsePlatformId<SessionRunId>(input.command.runId, "Session Run id");
  const serverId = parsePlatformId<McpServerId>(input.command.serverId, "MCP server id");
  const effectId = createPlatformId<ExternalToolEffectId>();
  const nowMs = currentTimestampMs();

  return {
    attemptCount: 0,
    claimToken: null,
    commandId,
    createdAt: nowMs,
    driverInstanceId: input.driverInstanceId,
    id: effectId,
    idempotencyKey: effectId,
    providerReceiptJson: null,
    resultJson: null,
    serverId,
    // This scalar subquery is evaluated in the command+intent D1 batch. If the
    // exact Run is no longer active it yields NULL, so the NOT NULL constraint
    // rolls the whole batch back instead of leaving a command without a fence.
    sessionRunId: sql<SessionRunId>`(
      SELECT ${sessionRunsTable.id}
      FROM ${sessionRunsTable}
      WHERE ${sessionRunsTable.id} = ${sessionRunId}
        AND ${sessionRunsTable.driverInstanceId} = ${input.driverInstanceId}
        AND ${sessionRunsTable.status} IN (${sql.join(
          ACTIVE_SESSION_RUN_STATUSES.map((status) => sql`${status}`),
          sql`, `,
        )})
      LIMIT 1
    )`,
    status: "intent" as const,
    toolName: input.command.toolName,
    updatedAt: nowMs,
  };
}

/** Reads the authoritative ledger without acquiring permission to execute. */
export async function observeExternalToolEffect(
  database: D1Database,
  input: EffectLookup,
): Promise<ExternalToolEffectState> {
  return toExternalToolEffectState(await getExternalToolEffect(database, input));
}

/**
 * Fences the only permitted provider invocation. A repeated token recovers a
 * lost claim response; any different token closes the ambiguous claim instead
 * of replaying the provider call.
 */
export async function claimExternalToolEffect(
  database: D1Database,
  input: EffectLookup & { claimToken: string },
): Promise<ExternalToolEffectClaim> {
  parseSchemaValue(ExternalToolEffectClaimToken, input.claimToken);

  for (let retry = 0; retry < 3; retry += 1) {
    const effect = await getExternalToolEffect(database, input);

    if (effect.status === "succeeded" || effect.status === "unknown") {
      const canonical = toExternalToolEffectState(effect);
      if (canonical.kind === "intent" || canonical.kind === "claimed") {
        throw new Error("A terminal external tool effect returned a non-terminal state.");
      }
      return canonical;
    }

    if (effect.status === "claimed") {
      if (effect.claimToken === input.claimToken) {
        const canonical = toExternalToolEffectState(effect);
        if (canonical.kind !== "claimed") {
          throw new Error("A claimed external tool effect returned a different state.");
        }
        return canonical;
      }

      await markClaimedExternalToolEffectUnknown(database, effect);
      const canonical = await observeExternalToolEffect(database, input);
      if (canonical.kind === "intent") {
        throw new Error("A claimed external tool effect unexpectedly returned to intent.");
      }
      return canonical;
    }

    const attempt = effect.attemptCount + 1;
    const nowMs = currentTimestampMs();
    const [update] = await runAppDatabaseBatch(database, (appDatabase) => [
      appDatabase
        .update(externalToolEffectsTable)
        .set({
          attemptCount: attempt,
          claimToken: input.claimToken,
          status: "claimed",
          updatedAt: nowMs,
        })
        .where(
          and(
            eq(externalToolEffectsTable.id, effect.id),
            eq(externalToolEffectsTable.attemptCount, effect.attemptCount),
            eq(externalToolEffectsTable.status, "intent"),
            exists(
              appDatabase
                .select({ id: driverInstancesTable.id })
                .from(driverInstancesTable)
                .where(
                  and(
                    eq(driverInstancesTable.id, input.driverInstanceId),
                    eq(driverInstancesTable.generation, input.driverGeneration),
                    inArray(driverInstancesTable.status, LIVE_DRIVER_INSTANCE_STATUSES),
                  ),
                ),
            ),
            exists(
              appDatabase
                .select({ id: sessionRunsTable.id })
                .from(sessionRunsTable)
                .where(
                  and(
                    eq(sessionRunsTable.id, externalToolEffectsTable.sessionRunId),
                    eq(sessionRunsTable.driverInstanceId, input.driverInstanceId),
                    inArray(sessionRunsTable.status, ACTIVE_SESSION_RUN_STATUSES),
                  ),
                ),
            ),
            exists(
              appDatabase
                .select({ id: driverCommandsTable.id })
                .from(driverCommandsTable)
                .where(
                  and(
                    eq(driverCommandsTable.id, input.commandId),
                    eq(driverCommandsTable.driverGeneration, input.driverGeneration),
                    eq(driverCommandsTable.driverInstanceId, input.driverInstanceId),
                    eq(driverCommandsTable.status, "accepted"),
                  ),
                ),
            ),
          ),
        ),
      appDatabase
        .insert(externalToolEffectAttemptsTable)
        .select(
          appDatabase
            .select({
              attempt: selectedValue(attempt, "attempt"),
              claimToken: selectedValue(input.claimToken, "claim_token"),
              completedAt: selectedValue(null, "completed_at"),
              createdAt: selectedValue(nowMs, "created_at"),
              effectId: externalToolEffectsTable.id,
              providerReceiptJson: selectedValue(null, "provider_receipt_json"),
              resultJson: selectedValue(null, "result_json"),
              status: selectedValue("claimed" as const, "status"),
            })
            .from(externalToolEffectsTable)
            .where(
              and(
                eq(externalToolEffectsTable.id, effect.id),
                eq(externalToolEffectsTable.attemptCount, attempt),
                eq(externalToolEffectsTable.claimToken, input.claimToken),
                eq(externalToolEffectsTable.status, "claimed"),
              ),
            ),
        )
        .onConflictDoNothing(),
    ]);

    if (getD1ChangeCount(update) > 0) {
      return {
        attempt,
        effectId: effect.id,
        idempotencyKey: effect.idempotencyKey,
        kind: "claimed",
      };
    }
  }

  throw new Error("External tool effect claim did not reach a stable state.");
}

/**
 * Persists an owner's terminal observation and always returns the state that
 * actually won the ledger CAS. This makes settlement-response loss retryable.
 */
export async function settleExternalToolEffect(
  database: D1Database,
  input: EffectLookup & {
    claimToken: string;
    effectId: ExternalToolEffectId;
    settlement: ExternalToolEffectSettlement;
  },
): Promise<ExternalToolEffectState> {
  parseSchemaValue(ExternalToolEffectClaimToken, input.claimToken);
  const settlement = parseSchemaValue(
    ExternalToolEffectSettlement,
    JSON.parse(serializeRuntimeSettlement(input.settlement)),
  );

  const effect = await getExternalToolEffect(database, input);

  if (effect.id !== input.effectId) {
    throw new Error("External tool effect settlement does not match the command's effect id.");
  }

  if (effect.status !== "claimed" || effect.claimToken !== input.claimToken) {
    return toExternalToolEffectState(effect);
  }

  if (
    settlement.kind === "succeeded" &&
    (settlement.result.requestId !== effect.requestId ||
      settlement.result.serverId !== effect.serverId ||
      settlement.result.toolName !== effect.toolName)
  ) {
    throw new Error("External tool effect result does not match its immutable command intent.");
  }

  const nowMs = currentTimestampMs();
  const providerReceiptJson =
    settlement.kind === "succeeded" ? (settlement.providerReceiptJson ?? null) : null;
  const resultJson = settlement.kind === "succeeded" ? JSON.stringify(settlement.result) : null;
  const status = settlement.kind === "succeeded" ? "succeeded" : "unknown";

  await runAppDatabaseBatch(database, (appDatabase) => [
    appDatabase
      .update(externalToolEffectsTable)
      .set({
        providerReceiptJson,
        resultJson,
        status,
        updatedAt: nowMs,
      })
      .where(
        and(
          eq(externalToolEffectsTable.id, effect.id),
          eq(externalToolEffectsTable.claimToken, input.claimToken),
          eq(externalToolEffectsTable.status, "claimed"),
        ),
      ),
    appDatabase
      .update(externalToolEffectAttemptsTable)
      .set({ completedAt: nowMs, providerReceiptJson, resultJson, status })
      .where(
        and(
          eq(externalToolEffectAttemptsTable.effectId, effect.id),
          eq(externalToolEffectAttemptsTable.attempt, effect.attemptCount),
          eq(externalToolEffectAttemptsTable.claimToken, input.claimToken),
          eq(externalToolEffectAttemptsTable.status, "claimed"),
        ),
      ),
  ]);

  return observeExternalToolEffect(database, input);
}

async function markClaimedExternalToolEffectUnknown(
  database: D1Database,
  effect: ExternalToolEffectRow,
): Promise<void> {
  if (effect.status !== "claimed" || effect.claimToken === null) {
    return;
  }

  const claimToken = effect.claimToken;
  const nowMs = currentTimestampMs();
  await runAppDatabaseBatch(database, (appDatabase) => [
    appDatabase
      .update(externalToolEffectsTable)
      .set({ status: "unknown", updatedAt: nowMs })
      .where(
        and(
          eq(externalToolEffectsTable.id, effect.id),
          eq(externalToolEffectsTable.claimToken, claimToken),
          eq(externalToolEffectsTable.status, "claimed"),
        ),
      ),
    appDatabase
      .update(externalToolEffectAttemptsTable)
      .set({ completedAt: nowMs, status: "unknown" })
      .where(
        and(
          eq(externalToolEffectAttemptsTable.effectId, effect.id),
          eq(externalToolEffectAttemptsTable.attempt, effect.attemptCount),
          eq(externalToolEffectAttemptsTable.claimToken, claimToken),
          eq(externalToolEffectAttemptsTable.status, "claimed"),
        ),
      ),
  ]);
}

/** Fences every unresolved claim owned by a terminal Driver. */
export async function markClaimedExternalToolEffectsUnknownForDriver(
  database: D1Database,
  input: {
    driverGeneration: number;
    driverInstanceId: DriverInstanceId;
  },
): Promise<void> {
  const nowMs = currentTimestampMs();
  await runAppDatabaseBatch(database, (appDatabase) => [
    appDatabase
      .update(externalToolEffectAttemptsTable)
      .set({ completedAt: nowMs, status: "unknown" })
      .where(
        and(
          eq(externalToolEffectAttemptsTable.status, "claimed"),
          exists(
            appDatabase
              .select({ id: externalToolEffectsTable.id })
              .from(externalToolEffectsTable)
              .where(
                and(
                  eq(externalToolEffectsTable.id, externalToolEffectAttemptsTable.effectId),
                  eq(externalToolEffectsTable.driverInstanceId, input.driverInstanceId),
                  eq(externalToolEffectsTable.status, "claimed"),
                  exists(
                    appDatabase
                      .select({ id: driverCommandsTable.id })
                      .from(driverCommandsTable)
                      .where(
                        and(
                          eq(driverCommandsTable.id, externalToolEffectsTable.commandId),
                          eq(driverCommandsTable.driverGeneration, input.driverGeneration),
                          eq(driverCommandsTable.driverInstanceId, input.driverInstanceId),
                        ),
                      ),
                  ),
                ),
              ),
          ),
        ),
      ),
    appDatabase
      .update(externalToolEffectsTable)
      .set({ status: "unknown", updatedAt: nowMs })
      .where(
        and(
          eq(externalToolEffectsTable.driverInstanceId, input.driverInstanceId),
          eq(externalToolEffectsTable.status, "claimed"),
          exists(
            appDatabase
              .select({ id: driverCommandsTable.id })
              .from(driverCommandsTable)
              .where(
                and(
                  eq(driverCommandsTable.id, externalToolEffectsTable.commandId),
                  eq(driverCommandsTable.driverGeneration, input.driverGeneration),
                  eq(driverCommandsTable.driverInstanceId, input.driverInstanceId),
                ),
              ),
          ),
        ),
      ),
  ]);
}

export async function getExternalToolEffectForCommand(
  database: D1Database,
  input: EffectLookup,
): Promise<{
  attemptCount: number;
  claimToken: string | null;
  id: ExternalToolEffectId;
  idempotencyKey: string;
  providerReceiptJson: string | null;
  resultJson: string | null;
  sessionRunId: SessionRunId;
  status: ExternalToolEffectStatus;
} | null> {
  return (
    (await getAppDatabase(database)
      .select({
        attemptCount: externalToolEffectsTable.attemptCount,
        claimToken: externalToolEffectsTable.claimToken,
        id: externalToolEffectsTable.id,
        idempotencyKey: externalToolEffectsTable.idempotencyKey,
        providerReceiptJson: externalToolEffectsTable.providerReceiptJson,
        resultJson: externalToolEffectsTable.resultJson,
        sessionRunId: externalToolEffectsTable.sessionRunId,
        status: externalToolEffectsTable.status,
      })
      .from(externalToolEffectsTable)
      .innerJoin(
        driverCommandsTable,
        and(
          eq(driverCommandsTable.id, externalToolEffectsTable.commandId),
          eq(driverCommandsTable.driverGeneration, input.driverGeneration),
          eq(driverCommandsTable.driverInstanceId, externalToolEffectsTable.driverInstanceId),
        ),
      )
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
