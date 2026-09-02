import { createMcpExecuteFailedEventIdentity } from "@mosoo/agent-driver/events";
import {
  InputStartCommandResult,
  McpExecuteCommandResult,
  RUNTIME_COMMAND_MAX_UTF8_BYTES,
  RUNTIME_COMMAND_TERMINAL_PAYLOAD_MAX_UTF8_BYTES,
  RuntimeCommand,
  RuntimeCommandResult,
  RuntimeCommandStatus,
} from "@mosoo/contracts/runtime-command";
import type { RuntimeCommandRecord } from "@mosoo/contracts/runtime-command";
import { DurableRunError } from "@mosoo/contracts/session-run";
import type { RunError } from "@mosoo/contracts/session-run";
import { PrimitiveRecord, parseSchemaValue } from "@mosoo/contracts/validation";
import {
  driverCommandsTable,
  driverInstancesTable,
  externalToolEffectsTable,
  sessionEventsTable,
  sessionRunsTable,
  sessionsTable,
} from "@mosoo/db";
import { parsePlatformId } from "@mosoo/id";
import type { DriverCommandId, DriverInstanceId, SessionId, SessionRunId } from "@mosoo/id";
import { stringifyRuntimeEventSemanticValue } from "@mosoo/runtime-events";
import { and, asc, eq, exists, gt, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import {
  getAppDatabase,
  getD1ChangeCount,
  runAppDatabaseBatch,
} from "../../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../../time";
import { LIVE_DRIVER_INSTANCE_STATUSES } from "../../domain/driver-instance-lifecycle.machine";
import { ACTIVE_SESSION_RUN_STATUSES } from "../../domain/session-run-lifecycle.machine";
import { createSessionRunTerminalSourceId } from "../../domain/session-run-terminal-event-id";
import { prepareExternalToolEffectIntent } from "./external-tool-effect-store.repository";
import { toRuntimeCommandStorageRecordFromRow } from "./runtime-command-record.mapper";
import type {
  RuntimeCommandRecordRow,
  RuntimeCommandStorageRecord,
} from "./runtime-command-record.mapper";
import {
  createRuntimeCommandBatchTransitionOutcome,
  decideRuntimeCommandTransition,
  getRuntimeCommandDeliveryLeaseExpirableStatuses,
  getRuntimeCommandPreviousStatuses,
  isRuntimeCommandAcknowledgedStatus,
  isRuntimeCommandTerminalStatus,
} from "./runtime-command-transition";
import type {
  RuntimeCommandBatchTransitionOutcome,
  RuntimeCommandTransitionOutcome,
} from "./runtime-command-transition";

export interface RuntimeCommandMaintenanceOutcome {
  expired: RuntimeCommandBatchTransitionOutcome;
  recovered: RuntimeCommandBatchTransitionOutcome;
}

export interface RuntimeCommandTerminalRepairOutcome {
  completed: RuntimeCommandBatchTransitionOutcome;
  failed: RuntimeCommandBatchTransitionOutcome;
}

export interface AcceptedMcpCommandRepair {
  command: Extract<RuntimeCommand, { kind: "mcp.execute" }>;
  commandId: DriverCommandId;
  effectId: string;
  effectStatus: "intent" | "succeeded" | "unknown";
  runtimeId: string;
  sessionId: SessionId;
  terminal:
    | {
        result: typeof McpExecuteCommandResult.infer;
        status: "completed";
      }
    | {
        error: RunError;
        status: "failed";
      };
}

export interface AcceptedInputStartCommandRepair {
  command: Extract<RuntimeCommand, { kind: "input.start" }>;
  commandId: DriverCommandId;
  runtimeId: string;
  sessionId: SessionId;
  terminal:
    | {
        result: typeof InputStartCommandResult.infer;
        status: "completed";
      }
    | {
        status: "cancelled";
      }
    | {
        error: RunError;
        status: "failed";
      };
}

function parseSessionRunRepairError(input: {
  errorCode: string | null;
  errorDetailsJson: string | null;
  errorMessage: string | null;
  errorRetryable: boolean | null;
}): RunError | null {
  if (input.errorCode === null && input.errorDetailsJson === null && input.errorMessage === null) {
    return null;
  }
  if (
    input.errorCode === null ||
    input.errorCode.length === 0 ||
    input.errorMessage === null ||
    input.errorMessage.length === 0
  ) {
    throw new Error("Session Run has an incomplete authoritative durable error.");
  }

  const details =
    input.errorDetailsJson === null
      ? {}
      : parseSchemaValue(PrimitiveRecord, JSON.parse(input.errorDetailsJson));
  return parseSchemaValue(DurableRunError, {
    code: input.errorCode,
    details,
    message: input.errorMessage,
    retryable: input.errorRetryable ?? false,
  });
}

function selectedValue<Value>(value: Value, alias: string) {
  return sql<Value>`${value}`.as(alias);
}

function isDriverCommandSeqConflict(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message.includes("driver_command_instance_seq_idx") ||
    error.message.includes("driver_command.driver_instance_id, driver_command.seq")
  );
}

function isExternalToolEffectRunAdmissionConflict(error: unknown): boolean {
  return error instanceof Error && error.message.includes("external_tool_effect.session_run_id");
}

type RuntimeCommandErrorDetails = Record<string, string | number | boolean | null>;

function createRuntimeCommandDeliveryExpiredError(details: RuntimeCommandErrorDetails): RunError {
  return {
    code: "driver.command_delivery_expired",
    details,
    message: "Runtime command delivery lease expired before the driver accepted it.",
    retryable: true,
  };
}

function createRuntimeCommandDriverTerminalError(details: RuntimeCommandErrorDetails): RunError {
  return {
    code: "driver.command_driver_terminal",
    details,
    message: "Runtime driver stopped before the accepted command completed.",
    retryable: false,
  };
}

function createRuntimeCommandExternalToolEffectUnknownError(input: {
  command: Extract<RuntimeCommand, { kind: "mcp.execute" }>;
  effectId: string;
}): RunError {
  const message = `External effect ${input.effectId} for MCP tool ${input.command.toolName} has an unknown outcome and will not be replayed.`;
  return {
    code: "driver.external_tool_effect_unknown",
    details: {
      commandId: input.command.commandId,
      effectId: input.effectId,
      requestId: input.command.requestId,
      runId: input.command.runId,
      serverId: input.command.serverId,
      toolName: input.command.toolName,
    },
    message,
    retryable: false,
  };
}

function createRuntimeCommandExternalToolEffectNotExecutedError(
  details: RuntimeCommandErrorDetails,
): RunError {
  return {
    code: "driver.external_tool_effect_not_executed",
    details,
    message: "The Driver stopped before the external tool invocation was claimed.",
    retryable: true,
  };
}

const runtimeCommandJsonEncoder = new TextEncoder();

function serializeRuntimeCommandJson(value: unknown, label: string): string {
  const serialized = JSON.stringify(value);

  if (serialized === undefined) {
    throw new TypeError(`${label} is not JSON serializable.`);
  }

  return serialized;
}

function assertRuntimeCommandJsonLimit(serialized: string, limit: number, label: string): void {
  const byteLength = runtimeCommandJsonEncoder.encode(serialized).byteLength;

  if (byteLength > limit) {
    throw new RangeError(`${label} exceeds ${limit} UTF-8 bytes.`);
  }
}

function externalToolEffectCommandTerminalGuard(
  database: ReturnType<typeof getAppDatabase>,
  input: {
    commandId: DriverCommandId;
    resultJson: string | null;
    status: RuntimeCommandStatus;
  },
): SQL {
  if (input.status !== "completed") {
    return exists(
      database
        .select({ id: externalToolEffectsTable.id })
        .from(externalToolEffectsTable)
        .where(
          and(
            eq(externalToolEffectsTable.commandId, input.commandId),
            inArray(externalToolEffectsTable.status, ["intent", "unknown"]),
          ),
        ),
    );
  }

  if (input.resultJson === null) {
    return sql`FALSE`;
  }

  const proposed = parseSchemaValue(McpExecuteCommandResult, JSON.parse(input.resultJson));
  return exists(
    database
      .select({ id: externalToolEffectsTable.id })
      .from(externalToolEffectsTable)
      .where(
        and(
          eq(externalToolEffectsTable.commandId, input.commandId),
          eq(externalToolEffectsTable.status, "succeeded"),
          sql`json_extract(${externalToolEffectsTable.resultJson}, '$.outputText') = ${proposed.outputText}`,
          sql`json_extract(${externalToolEffectsTable.resultJson}, '$.requestId') = ${proposed.requestId}`,
          sql`json_extract(${externalToolEffectsTable.resultJson}, '$.serverId') = ${proposed.serverId}`,
          sql`json_extract(${externalToolEffectsTable.resultJson}, '$.toolName') = ${proposed.toolName}`,
          sql`COALESCE(json_extract(${externalToolEffectsTable.resultJson}, '$.isError'), 0) = ${proposed.isError === true ? 1 : 0}`,
        ),
      ),
  );
}

interface RuntimeCommandTerminalState {
  readonly ackedAt: number | null;
  readonly errorJson: string | null;
  readonly kind: RuntimeCommand["kind"];
  readonly payloadJson: string;
  readonly resultJson: string | null;
  readonly status: RuntimeCommandStatus;
}

function mcpTerminalSourceEventId(
  commandId: DriverCommandId,
  status: "cancelled" | "completed",
): string {
  return `mcp.execute.${status}:${commandId}`;
}

function primitiveRecordJsonEquals(column: SQL, value: Record<string, unknown>): SQL {
  const serialized = JSON.stringify(value);

  return sql`NOT EXISTS (
    SELECT 1
    FROM json_each(${column}) AS stored
    WHERE NOT EXISTS (
      SELECT 1
      FROM json_each(${serialized}) AS proposed
      WHERE proposed.key = stored.key
        AND proposed.type = stored.type
        AND proposed.value IS stored.value
    )
  ) AND NOT EXISTS (
    SELECT 1
    FROM json_each(${serialized}) AS proposed
    WHERE NOT EXISTS (
      SELECT 1
      FROM json_each(${column}) AS stored
      WHERE stored.key = proposed.key
        AND stored.type = proposed.type
        AND stored.value IS proposed.value
    )
  )`;
}

function runtimeCommandTerminalEventGuard(
  database: ReturnType<typeof getAppDatabase>,
  input: {
    command: RuntimeCommand;
    driverInstanceId: DriverInstanceId;
    error: RunError | null;
    result: RuntimeCommandResult | null;
    status: RuntimeCommandStatus;
  },
): SQL {
  if (!isRuntimeCommandTerminalStatus(input.status)) {
    return sql`TRUE`;
  }

  if (input.command.kind === "input.start") {
    const runId = parsePlatformId<SessionRunId>(
      input.command.runId,
      "input.start terminal Session Run ID",
    );
    const eventType =
      input.status === "completed"
        ? "run.completed"
        : input.status === "failed"
          ? "run.failed"
          : "run.cancelled";
    const runStatusGuard =
      input.status === "cancelled" || input.status === "expired"
        ? inArray(sessionRunsTable.status, ["cancelled", "expired"])
        : input.status === "completed" || input.status === "failed"
          ? eq(sessionRunsTable.status, input.status)
          : sql`FALSE`;
    const runErrorGuard = (() => {
      if (input.status === "failed") {
        return input.error === null
          ? sql`FALSE`
          : and(
              eq(sessionRunsTable.errorCode, input.error.code),
              eq(sessionRunsTable.errorMessage, input.error.message),
              eq(sessionRunsTable.errorRetryable, input.error.retryable),
              primitiveRecordJsonEquals(
                sql`${sessionRunsTable.errorDetailsJson}`,
                input.error.details,
              ),
            );
      }

      return input.status === "completed"
        ? and(
            isNull(sessionRunsTable.errorCode),
            isNull(sessionRunsTable.errorDetailsJson),
            isNull(sessionRunsTable.errorMessage),
            isNull(sessionRunsTable.errorRetryable),
          )
        : sql`TRUE`;
    })();
    const terminalRun = database
      .select({ id: sessionRunsTable.id })
      .from(sessionRunsTable)
      .where(
        and(
          eq(sessionRunsTable.id, runId),
          eq(sessionRunsTable.driverInstanceId, input.driverInstanceId),
          runStatusGuard,
          runErrorGuard,
        ),
      );

    return exists(
      database
        .select({ id: sessionEventsTable.id })
        .from(sessionEventsTable)
        .where(
          and(
            eq(sessionEventsTable.runId, runId),
            eq(sessionEventsTable.eventType, eventType),
            eq(
              sessionEventsTable.sourceEventId,
              createSessionRunTerminalSourceId(runId, eventType),
            ),
            exists(terminalRun),
          ),
        ),
    );
  }

  if (input.command.kind !== "mcp.execute") {
    return sql`TRUE`;
  }

  const commandId = parsePlatformId<DriverCommandId>(
    input.command.commandId,
    "mcp.execute terminal command ID",
  );
  const runId = parsePlatformId<SessionRunId>(
    input.command.runId,
    "mcp.execute terminal Session Run ID",
  );

  const toolStatus =
    input.status === "completed" ? "completed" : input.status === "failed" ? "failed" : "cancelled";
  const outputGuard =
    input.status === "completed" && input.result !== null
      ? eq(
          sessionEventsTable.toolOutputText,
          parseSchemaValue(McpExecuteCommandResult, input.result).outputText,
        )
      : input.status === "failed" && input.error !== null
        ? eq(sessionEventsTable.toolOutputText, input.error.message)
        : isNull(sessionEventsTable.toolOutputText);
  const sourceEventId =
    input.status === "failed"
      ? input.error === null
        ? null
        : createMcpExecuteFailedEventIdentity({
            commandId,
            rawInput: input.command.argumentsJson,
            rawOutput: input.error.message,
            title: input.command.toolName,
            toolCallId: input.command.toolCallId,
          }).sourceEventId
      : mcpTerminalSourceEventId(
          commandId,
          input.status === "completed" ? "completed" : "cancelled",
        );

  return exists(
    database
      .select({ id: sessionEventsTable.id })
      .from(sessionEventsTable)
      .where(
        and(
          eq(sessionEventsTable.mcpCommandId, commandId),
          eq(sessionEventsTable.runId, runId),
          eq(sessionEventsTable.eventType, "tool.call.updated"),
          sourceEventId === null ? sql`FALSE` : eq(sessionEventsTable.sourceEventId, sourceEventId),
          eq(sessionEventsTable.toolCallId, input.command.toolCallId),
          eq(sessionEventsTable.toolInputJson, input.command.argumentsJson),
          eq(sessionEventsTable.toolName, input.command.toolName),
          eq(sessionEventsTable.toolStatus, toolStatus),
          outputGuard,
        ),
      ),
  );
}

async function assertRuntimeCommandTerminalEvent(
  database: D1Database,
  input: Parameters<typeof runtimeCommandTerminalEventGuard>[1],
): Promise<void> {
  const row = await getAppDatabase(database)
    .select({
      valid: sql<number>`CASE WHEN ${runtimeCommandTerminalEventGuard(
        getAppDatabase(database),
        input,
      )} THEN 1 ELSE 0 END`,
    })
    .from(driverCommandsTable)
    .where(
      eq(
        driverCommandsTable.id,
        parsePlatformId<DriverCommandId>(input.command.commandId, "Runtime command ID"),
      ),
    )
    .limit(1)
    .get();

  if (row?.valid !== 1) {
    throw new Error(
      `Runtime command ${input.command.commandId} terminal update is missing its durable event.`,
    );
  }
}

function parseRuntimeCommandResultJson(
  kind: RuntimeCommand["kind"],
  value: string | null,
): RuntimeCommandResult | null {
  if (value === null) {
    return null;
  }

  const result = parseSchemaValue(RuntimeCommandResult, JSON.parse(value));

  if (kind === "input.start") {
    return parseSchemaValue(InputStartCommandResult, result);
  }

  if (kind === "mcp.execute") {
    const parsed = parseSchemaValue(McpExecuteCommandResult, result);
    return { ...parsed, isError: parsed.isError ?? false };
  }

  throw new Error(`${kind} runtime commands cannot contain a durable result.`);
}

function parseRuntimeCommandErrorJson(value: string | null): RunError | null {
  return value === null ? null : parseSchemaValue(DurableRunError, JSON.parse(value));
}

function assertEqualRuntimeCommandPayload(
  expected: unknown,
  actual: unknown,
  commandId: DriverCommandId,
): void {
  if (stringifyRuntimeEventSemanticValue(expected) !== stringifyRuntimeEventSemanticValue(actual)) {
    throw new Error(
      `Runtime command ${commandId} duplicate conflicts with its durable terminal payload.`,
    );
  }
}

async function assertMcpTerminalEffectState(
  database: D1Database,
  input: {
    commandId: DriverCommandId;
    driverGeneration: number;
    driverInstanceId: DriverInstanceId;
    proposedResult: RuntimeCommandResult | null;
    storedResult: RuntimeCommandResult | null;
    status: RuntimeCommandStatus;
  },
): Promise<void> {
  const effect =
    (await getAppDatabase(database)
      .select({
        resultJson: externalToolEffectsTable.resultJson,
        status: externalToolEffectsTable.status,
      })
      .from(externalToolEffectsTable)
      .innerJoin(
        driverCommandsTable,
        and(
          eq(driverCommandsTable.id, externalToolEffectsTable.commandId),
          eq(driverCommandsTable.driverGeneration, input.driverGeneration),
          eq(driverCommandsTable.driverInstanceId, input.driverInstanceId),
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
    throw new Error(`MCP runtime command ${input.commandId} is missing its durable effect.`);
  }

  if (input.status === "completed") {
    if (effect.status !== "succeeded" || effect.resultJson === null) {
      throw new Error(`MCP runtime command ${input.commandId} has no succeeded durable effect.`);
    }

    const effectResult = parseRuntimeCommandResultJson("mcp.execute", effect.resultJson);
    assertEqualRuntimeCommandPayload(effectResult, input.storedResult, input.commandId);
    assertEqualRuntimeCommandPayload(effectResult, input.proposedResult, input.commandId);
    return;
  }

  if (!isRuntimeCommandTerminalStatus(input.status)) {
    return;
  }

  if ((effect.status !== "intent" && effect.status !== "unknown") || effect.resultJson !== null) {
    throw new Error(
      `MCP runtime command ${input.commandId} terminal state conflicts with its effect.`,
    );
  }
}

async function assertRuntimeCommandDuplicatePayload(
  database: D1Database,
  input: {
    commandId: DriverCommandId;
    driverGeneration: number;
    driverInstanceId: DriverInstanceId;
    errorJson: string | null;
    resultJson: string | null;
    stored: RuntimeCommandTerminalState;
  },
): Promise<void> {
  const proposedError = parseRuntimeCommandErrorJson(input.errorJson);
  const storedError = parseRuntimeCommandErrorJson(input.stored.errorJson);
  const proposedResult = parseRuntimeCommandResultJson(input.stored.kind, input.resultJson);
  const storedResult = parseRuntimeCommandResultJson(input.stored.kind, input.stored.resultJson);
  const command = parseSchemaValue(RuntimeCommand, JSON.parse(input.stored.payloadJson));

  assertEqualRuntimeCommandPayload(storedError, proposedError, input.commandId);
  assertEqualRuntimeCommandPayload(storedResult, proposedResult, input.commandId);

  if (isRuntimeCommandTerminalStatus(input.stored.status)) {
    await assertRuntimeCommandTerminalEvent(database, {
      command,
      driverInstanceId: input.driverInstanceId,
      error: storedError,
      result: storedResult,
      status: input.stored.status,
    });
  }

  if (input.stored.kind === "mcp.execute") {
    await assertMcpTerminalEffectState(database, {
      commandId: input.commandId,
      driverGeneration: input.driverGeneration,
      driverInstanceId: input.driverInstanceId,
      proposedResult,
      status: input.stored.status,
      storedResult,
    });
  }
}

function runtimeCommandActiveRunGuard(database: ReturnType<typeof getAppDatabase>): SQL {
  return or(
    eq(driverCommandsTable.kind, "session.stop"),
    exists(
      database
        .select({ id: sessionRunsTable.id })
        .from(sessionRunsTable)
        .where(
          and(
            eq(
              sessionRunsTable.id,
              sql<SessionRunId>`json_extract(${driverCommandsTable.payloadJson}, '$.runId')`,
            ),
            eq(sessionRunsTable.driverInstanceId, driverCommandsTable.driverInstanceId),
            inArray(sessionRunsTable.status, ACTIVE_SESSION_RUN_STATUSES),
          ),
        ),
    ),
  )!;
}

export async function createRuntimeCommandRecord(
  database: D1Database,
  input: {
    command: RuntimeCommand;
    driverGeneration: number;
    driverInstanceId: DriverInstanceId;
    expiresAt?: number | null;
    status?: RuntimeCommandStatus;
  },
): Promise<RuntimeCommandRecord> {
  const payloadJson = serializeRuntimeCommandJson(input.command, "Runtime command");
  assertRuntimeCommandJsonLimit(payloadJson, RUNTIME_COMMAND_MAX_UTF8_BYTES, "Runtime command");
  const command = parseSchemaValue(RuntimeCommand, JSON.parse(payloadJson));
  if (!Number.isSafeInteger(input.driverGeneration) || input.driverGeneration < 0) {
    throw new TypeError("Driver generation must be a non-negative safe integer.");
  }
  const issuedAt = currentTimestampMs();
  const commandId = parsePlatformId<DriverCommandId>(command.commandId, "Runtime command ID");
  const sessionRunId =
    command.kind === "session.stop"
      ? null
      : parsePlatformId<SessionRunId>(command.runId, "Runtime command Session Run ID");
  const status = parseSchemaValue(RuntimeCommandStatus, input.status ?? "queued");

  return createRuntimeCommandRecordAttempt(
    database,
    { ...input, command },
    {
      attempt: 0,
      commandId,
      issuedAt,
      payloadJson,
      sessionRunId,
      status,
    },
  );
}

async function createRuntimeCommandRecordAttempt(
  database: D1Database,
  input: {
    command: RuntimeCommand;
    driverGeneration: number;
    driverInstanceId: DriverInstanceId;
    expiresAt?: number | null;
    status?: RuntimeCommandStatus;
  },
  state: {
    attempt: number;
    commandId: DriverCommandId;
    issuedAt: number;
    payloadJson: string;
    sessionRunId: SessionRunId | null;
    status: RuntimeCommandStatus;
  },
): Promise<RuntimeCommandRecord> {
  if (state.attempt >= 5) {
    throw new Error("Failed to allocate a runtime command sequence.");
  }

  try {
    const externalToolEffectIntent =
      input.command.kind === "mcp.execute"
        ? prepareExternalToolEffectIntent({
            command: input.command,
            driverInstanceId: input.driverInstanceId,
          })
        : null;
    const commandValues = {
      ackedAt: selectedValue(null, "acked_at"),
      completedAt: selectedValue(null, "completed_at"),
      deliveryConnectionId: selectedValue(null, "delivery_connection_id"),
      driverGeneration: driverInstancesTable.generation,
      driverInstanceId: driverInstancesTable.id,
      errorJson: selectedValue(null, "error_json"),
      expiresAt: selectedValue(input.expiresAt ?? null, "expires_at"),
      id: selectedValue(state.commandId, "id"),
      issuedAt: selectedValue(state.issuedAt, "issued_at"),
      kind: selectedValue(input.command.kind, "kind"),
      payloadJson: selectedValue(state.payloadJson, "payload_json"),
      resultJson: selectedValue(null, "result_json"),
      seq: driverInstancesTable.commandSeqCursor,
      status: selectedValue(state.status, "status"),
    };
    const results = await runAppDatabaseBatch(database, (appDatabase) => {
      const activeRun =
        state.sessionRunId === null
          ? null
          : appDatabase
              .select({ id: sessionRunsTable.id })
              .from(sessionRunsTable)
              .where(
                and(
                  eq(sessionRunsTable.id, state.sessionRunId),
                  eq(sessionRunsTable.driverInstanceId, input.driverInstanceId),
                  inArray(sessionRunsTable.status, ACTIVE_SESSION_RUN_STATUSES),
                ),
              );
      const admission = and(
        eq(driverInstancesTable.id, input.driverInstanceId),
        eq(driverInstancesTable.generation, input.driverGeneration),
        inArray(driverInstancesTable.status, [...LIVE_DRIVER_INSTANCE_STATUSES]),
        ...(activeRun === null ? [] : [exists(activeRun)]),
      );
      const commandInsert = appDatabase
        .insert(driverCommandsTable)
        .select(appDatabase.select(commandValues).from(driverInstancesTable).where(admission));
      const cursorUpdate = appDatabase
        .update(driverInstancesTable)
        .set({ commandSeqCursor: sql`${driverInstancesTable.commandSeqCursor} + 1` })
        .where(admission);

      return externalToolEffectIntent === null
        ? [cursorUpdate, commandInsert]
        : [
            cursorUpdate,
            commandInsert,
            appDatabase.insert(externalToolEffectsTable).values(externalToolEffectIntent),
          ];
    });

    if (getD1ChangeCount((results as readonly unknown[])[1]) === 0) {
      throw new Error("Driver generation is no longer current.");
    }

    const record = await getRuntimeCommandRecord(
      database,
      input.driverInstanceId,
      input.driverGeneration,
      state.commandId,
    );

    if (record === null) {
      throw new Error("Runtime command was not persisted.");
    }

    return record;
  } catch (error) {
    if (input.command.kind === "mcp.execute" && isExternalToolEffectRunAdmissionConflict(error)) {
      throw new Error("MCP external tool effects require the command's active Session Run.", {
        cause: error,
      });
    }

    if (state.attempt < 4 && isDriverCommandSeqConflict(error)) {
      return createRuntimeCommandRecordAttempt(database, input, {
        ...state,
        attempt: state.attempt + 1,
      });
    }

    throw error;
  }
}

export async function updateRuntimeCommandRecord(
  database: D1Database,
  input: {
    commandId: DriverCommandId;
    deliveryConnectionId?: string;
    driverGeneration: number;
    driverInstanceId: DriverInstanceId;
    error?: RunError;
    result?: RuntimeCommandResult;
    status: RuntimeCommandStatus;
  },
): Promise<RuntimeCommandTransitionOutcome> {
  const status = parseSchemaValue(RuntimeCommandStatus, input.status);
  if (input.error !== undefined && input.result !== undefined) {
    throw new TypeError("Runtime command terminal update cannot contain both error and result.");
  }

  const errorJson =
    input.error === undefined
      ? null
      : serializeRuntimeCommandJson(input.error, "Runtime command terminal error");
  const resultJson =
    input.result === undefined
      ? null
      : serializeRuntimeCommandJson(input.result, "Runtime command result");
  const terminalPayloadJson = errorJson ?? resultJson;
  if (terminalPayloadJson !== null) {
    assertRuntimeCommandJsonLimit(
      terminalPayloadJson,
      RUNTIME_COMMAND_TERMINAL_PAYLOAD_MAX_UTF8_BYTES,
      "Runtime command terminal payload",
    );
  }
  if (errorJson !== null) {
    parseSchemaValue(DurableRunError, JSON.parse(errorJson));
  }
  const parsedResult =
    resultJson === null
      ? undefined
      : parseSchemaValue(RuntimeCommandResult, JSON.parse(resultJson));
  const storedResultJson = parsedResult === null ? null : resultJson;
  if (
    (!isRuntimeCommandTerminalStatus(status) &&
      (errorJson !== null || storedResultJson !== null)) ||
    (status === "completed" && errorJson !== null) ||
    (status !== "completed" && isRuntimeCommandTerminalStatus(status) && storedResultJson !== null)
  ) {
    throw new TypeError("Runtime command terminal payload does not match its target status.");
  }

  const current =
    (await getAppDatabase(database)
      .select({
        ackedAt: driverCommandsTable.ackedAt,
        deliveryConnectionId: driverCommandsTable.deliveryConnectionId,
        errorJson: driverCommandsTable.errorJson,
        kind: driverCommandsTable.kind,
        payloadJson: driverCommandsTable.payloadJson,
        resultJson: driverCommandsTable.resultJson,
        status: driverCommandsTable.status,
      })
      .from(driverCommandsTable)
      .where(
        and(
          eq(driverCommandsTable.id, input.commandId),
          eq(driverCommandsTable.driverGeneration, input.driverGeneration),
          eq(driverCommandsTable.driverInstanceId, input.driverInstanceId),
        ),
      )
      .limit(1)
      .get()) ?? null;

  if (current === null) {
    return {
      currentStatus: null,
      kind: "rejected",
      reason: "command_not_found",
      targetStatus: status,
    };
  }

  const command = parseSchemaValue(RuntimeCommand, JSON.parse(current.payloadJson));
  if (command.commandId !== input.commandId || command.kind !== current.kind) {
    throw new Error(`Runtime command ${input.commandId} has inconsistent immutable payload.`);
  }

  if (parsedResult !== undefined && parsedResult !== null) {
    if (current.kind === "input.start") {
      parseSchemaValue(InputStartCommandResult, parsedResult);
      if (Object.keys(parsedResult).some((key) => key !== "requestId")) {
        throw new TypeError("input.start runtime command results may only contain requestId.");
      }
    } else if (current.kind === "mcp.execute") {
      parseSchemaValue(McpExecuteCommandResult, parsedResult);
      const allowedKeys = new Set(["isError", "outputText", "requestId", "serverId", "toolName"]);
      if (Object.keys(parsedResult).some((key) => !allowedKeys.has(key))) {
        throw new TypeError("mcp.execute runtime command result contains an unknown field.");
      }
    } else {
      throw new TypeError(`${current.kind} runtime commands cannot store a result.`);
    }
  }

  if (
    command.kind === "input.start" &&
    status === "completed" &&
    (parsedResult === undefined ||
      parsedResult === null ||
      parseSchemaValue(InputStartCommandResult, parsedResult).requestId !== command.requestId)
  ) {
    throw new TypeError("input.start completion must carry its exact requestId.");
  }

  if (
    input.deliveryConnectionId !== undefined &&
    current.deliveryConnectionId !== input.deliveryConnectionId
  ) {
    return {
      currentStatus: current.status,
      kind: "rejected",
      reason: "stale_delivery_connection",
      targetStatus: status,
    };
  }

  const transition = decideRuntimeCommandTransition(current.status, status);

  if (transition.kind === "duplicate") {
    await assertRuntimeCommandDuplicatePayload(database, {
      commandId: input.commandId,
      driverGeneration: input.driverGeneration,
      driverInstanceId: input.driverInstanceId,
      errorJson,
      resultJson: storedResultJson,
      stored: { ...current, kind: command.kind },
    });
    return transition;
  }

  if (transition.kind !== "applied") {
    return transition;
  }

  const timestampMs = currentTimestampMs();
  const ackedAt = isRuntimeCommandAcknowledgedStatus(status) ? timestampMs : null;
  const completedAt = isRuntimeCommandTerminalStatus(status) ? timestampMs : null;

  const authoritativeResultJson =
    current.kind === "mcp.execute" && status === "completed"
      ? sql<string | null>`(
          SELECT ${externalToolEffectsTable.resultJson}
          FROM ${externalToolEffectsTable}
          WHERE ${externalToolEffectsTable.commandId} = ${input.commandId}
            AND ${externalToolEffectsTable.status} = 'succeeded'
          LIMIT 1
        )`
      : storedResultJson;
  const result = await getAppDatabase(database)
    .update(driverCommandsTable)
    .set({
      ackedAt:
        ackedAt === null ? undefined : sql`COALESCE(${ackedAt}, ${driverCommandsTable.ackedAt})`,
      completedAt:
        completedAt === null
          ? undefined
          : sql`COALESCE(${completedAt}, ${driverCommandsTable.completedAt})`,
      errorJson,
      resultJson: authoritativeResultJson,
      status,
    })
    .where(
      and(
        eq(driverCommandsTable.id, input.commandId),
        eq(driverCommandsTable.driverGeneration, input.driverGeneration),
        eq(driverCommandsTable.driverInstanceId, input.driverInstanceId),
        eq(driverCommandsTable.status, current.status),
        ...(input.deliveryConnectionId === undefined
          ? []
          : [eq(driverCommandsTable.deliveryConnectionId, input.deliveryConnectionId)]),
        ...(status === "accepted" ? [runtimeCommandActiveRunGuard(getAppDatabase(database))] : []),
        ...(current.kind === "mcp.execute" && isRuntimeCommandTerminalStatus(status)
          ? [
              externalToolEffectCommandTerminalGuard(getAppDatabase(database), {
                commandId: input.commandId,
                resultJson: storedResultJson,
                status,
              }),
            ]
          : []),
        ...(isRuntimeCommandTerminalStatus(status) &&
        (command.kind === "input.start" || command.kind === "mcp.execute")
          ? [
              runtimeCommandTerminalEventGuard(getAppDatabase(database), {
                command,
                driverInstanceId: input.driverInstanceId,
                error: parseRuntimeCommandErrorJson(errorJson),
                result:
                  storedResultJson === null
                    ? null
                    : parseRuntimeCommandResultJson(command.kind, storedResultJson),
                status,
              }),
            ]
          : []),
      ),
    )
    .run();

  if (getD1ChangeCount(result) > 0) {
    return transition;
  }

  const winner =
    (await getAppDatabase(database)
      .select({
        ackedAt: driverCommandsTable.ackedAt,
        errorJson: driverCommandsTable.errorJson,
        kind: driverCommandsTable.kind,
        payloadJson: driverCommandsTable.payloadJson,
        resultJson: driverCommandsTable.resultJson,
        status: driverCommandsTable.status,
      })
      .from(driverCommandsTable)
      .where(
        and(
          eq(driverCommandsTable.id, input.commandId),
          eq(driverCommandsTable.driverGeneration, input.driverGeneration),
          eq(driverCommandsTable.driverInstanceId, input.driverInstanceId),
        ),
      )
      .limit(1)
      .get()) ?? null;

  if (winner?.status === status) {
    const winnerCommand = parseSchemaValue(RuntimeCommand, JSON.parse(winner.payloadJson));
    if (winnerCommand.commandId !== input.commandId || winnerCommand.kind !== winner.kind) {
      throw new Error(`Runtime command ${input.commandId} has inconsistent immutable payload.`);
    }
    await assertRuntimeCommandDuplicatePayload(database, {
      commandId: input.commandId,
      driverGeneration: input.driverGeneration,
      driverInstanceId: input.driverInstanceId,
      errorJson,
      resultJson: storedResultJson,
      stored: { ...winner, kind: winnerCommand.kind },
    });
    return { kind: "duplicate", status };
  }

  return {
    currentStatus: winner?.status ?? current.status,
    kind: "rejected",
    reason: "illegal_transition",
    targetStatus: status,
  };
}

export async function markRuntimeCommandRecordDelivered(
  database: D1Database,
  input: {
    commandId: DriverCommandId;
    connectionId: string;
    driverGeneration: number;
    driverInstanceId: DriverInstanceId;
    expiresAfter?: number;
  },
): Promise<RuntimeCommandTransitionOutcome> {
  const db = getAppDatabase(database);
  const targetStatus = "delivered" satisfies RuntimeCommandStatus;
  const current =
    (await db
      .select({
        deliveryConnectionId: driverCommandsTable.deliveryConnectionId,
        kind: driverCommandsTable.kind,
        payloadJson: driverCommandsTable.payloadJson,
        status: driverCommandsTable.status,
      })
      .from(driverCommandsTable)
      .where(
        and(
          eq(driverCommandsTable.id, input.commandId),
          eq(driverCommandsTable.driverGeneration, input.driverGeneration),
          eq(driverCommandsTable.driverInstanceId, input.driverInstanceId),
        ),
      )
      .limit(1)
      .get()) ?? null;
  const activeConnection =
    (await db
      .select({ id: driverInstancesTable.id })
      .from(driverInstancesTable)
      .where(
        and(
          eq(driverInstancesTable.id, input.driverInstanceId),
          eq(driverInstancesTable.connectionId, input.connectionId),
          eq(driverInstancesTable.generation, input.driverGeneration),
        ),
      )
      .limit(1)
      .get()) ?? null;

  if (current === null) {
    return {
      currentStatus: null,
      kind: "rejected",
      reason: "command_not_found",
      targetStatus,
    };
  }

  if (current.kind !== "session.stop") {
    const command = parseSchemaValue(RuntimeCommand, JSON.parse(current.payloadJson));

    if (command.kind === "session.stop") {
      throw new Error("Runtime command kind does not match its payload.");
    }

    const runId = parsePlatformId<SessionRunId>(command.runId, "Runtime command Session Run ID");
    const activeRun =
      (await db
        .select({ id: sessionRunsTable.id })
        .from(sessionRunsTable)
        .where(
          and(
            eq(sessionRunsTable.id, runId),
            eq(sessionRunsTable.driverInstanceId, input.driverInstanceId),
            inArray(sessionRunsTable.status, ACTIVE_SESSION_RUN_STATUSES),
          ),
        )
        .limit(1)
        .get()) ?? null;

    if (activeRun === null) {
      await db
        .update(driverCommandsTable)
        .set({ completedAt: currentTimestampMs(), status: "cancelled" })
        .where(
          and(
            eq(driverCommandsTable.id, input.commandId),
            eq(driverCommandsTable.driverGeneration, input.driverGeneration),
            eq(driverCommandsTable.driverInstanceId, input.driverInstanceId),
            eq(driverCommandsTable.status, current.status),
          ),
        )
        .run();
      return {
        currentStatus: current.status,
        kind: "rejected",
        reason: "inactive_session_run",
        targetStatus,
      };
    }
  }

  if (activeConnection === null) {
    return {
      currentStatus: current.status,
      kind: "rejected",
      reason: "inactive_delivery_connection",
      targetStatus,
    };
  }

  if (
    current.status === "delivered" &&
    current.deliveryConnectionId !== null &&
    current.deliveryConnectionId !== input.connectionId
  ) {
    return {
      currentStatus: current.status,
      kind: "rejected",
      reason: "stale_delivery_connection",
      targetStatus,
    };
  }

  const transition = decideRuntimeCommandTransition(current.status, targetStatus);

  if (transition.kind !== "applied") {
    return transition;
  }

  const activeConnectionQuery = db
    .select({ id: driverInstancesTable.id })
    .from(driverInstancesTable)
    .where(
      and(
        eq(driverInstancesTable.id, input.driverInstanceId),
        eq(driverInstancesTable.connectionId, input.connectionId),
        eq(driverInstancesTable.generation, input.driverGeneration),
      ),
    );
  const result = await db
    .update(driverCommandsTable)
    .set({
      deliveryConnectionId: input.connectionId,
      status: transition.status,
    })
    .where(
      and(
        eq(driverCommandsTable.id, input.commandId),
        eq(driverCommandsTable.driverGeneration, input.driverGeneration),
        eq(driverCommandsTable.driverInstanceId, input.driverInstanceId),
        eq(driverCommandsTable.status, current.status),
        ...(input.expiresAfter === undefined
          ? []
          : [
              or(
                isNull(driverCommandsTable.expiresAt),
                gt(driverCommandsTable.expiresAt, input.expiresAfter),
              )!,
            ]),
        exists(activeConnectionQuery),
        runtimeCommandActiveRunGuard(db),
      ),
    )
    .run();

  return getD1ChangeCount(result) > 0
    ? transition
    : {
        currentStatus: current.status,
        kind: "rejected",
        reason: "illegal_transition",
        targetStatus,
      };
}

export async function getRuntimeCommandRecord(
  database: D1Database,
  driverInstanceId: DriverInstanceId,
  driverGeneration: number,
  commandId: DriverCommandId,
): Promise<RuntimeCommandRecord | null> {
  const stored = await getRuntimeCommandStorageRecord(database, driverInstanceId, commandId);
  return stored?.format === "v3" && stored.driverGeneration === driverGeneration
    ? stored.record
    : null;
}

/** Reads immutable pre-v3 terminal history without making it executable wire data. */
export async function getRuntimeCommandStorageRecord(
  database: D1Database,
  driverInstanceId: DriverInstanceId,
  commandId: DriverCommandId,
): Promise<RuntimeCommandStorageRecord | null> {
  const row =
    (await getAppDatabase(database)
      .select({
        ackedAt: driverCommandsTable.ackedAt,
        completedAt: driverCommandsTable.completedAt,
        driverGeneration: driverCommandsTable.driverGeneration,
        driverInstanceId: driverCommandsTable.driverInstanceId,
        errorJson: driverCommandsTable.errorJson,
        expiresAt: driverCommandsTable.expiresAt,
        id: driverCommandsTable.id,
        issuedAt: driverCommandsTable.issuedAt,
        kind: sql<RuntimeCommandRecordRow["kind"]>`${driverCommandsTable.kind}`,
        payloadJson: driverCommandsTable.payloadJson,
        resultJson: driverCommandsTable.resultJson,
        seq: driverCommandsTable.seq,
        status: driverCommandsTable.status,
      })
      .from(driverCommandsTable)
      .where(
        and(
          eq(driverCommandsTable.driverInstanceId, driverInstanceId),
          eq(driverCommandsTable.id, commandId),
        ),
      )
      .limit(1)
      .get()) ?? null;

  if (!row) {
    return null;
  }

  return toRuntimeCommandStorageRecordFromRow(row);
}

async function expireRuntimeCommandDeliveryLeases(
  database: D1Database,
  driverInstanceId: DriverInstanceId,
  driverGeneration: number,
  nowMs: number,
): Promise<RuntimeCommandBatchTransitionOutcome> {
  const expirableStatuses = getRuntimeCommandDeliveryLeaseExpirableStatuses();
  const queuedStatus = "queued" satisfies RuntimeCommandStatus;
  const targetStatus = "expired" satisfies RuntimeCommandStatus;
  const error = createRuntimeCommandDeliveryExpiredError({ driverInstanceId });

  const result = await getAppDatabase(database)
    .update(driverCommandsTable)
    .set({
      completedAt: sql`COALESCE(${driverCommandsTable.completedAt}, ${nowMs})`,
      errorJson: JSON.stringify(error),
      status: targetStatus,
    })
    .where(
      and(
        eq(driverCommandsTable.driverInstanceId, driverInstanceId),
        eq(driverCommandsTable.driverGeneration, driverGeneration),
        inArray(driverCommandsTable.status, [...expirableStatuses]),
        or(eq(driverCommandsTable.status, queuedStatus), isNull(driverCommandsTable.ackedAt)),
        lte(driverCommandsTable.expiresAt, nowMs),
      ),
    )
    .run();

  return createRuntimeCommandBatchTransitionOutcome(targetStatus, getD1ChangeCount(result));
}

export async function expireUndeliveredInputStartCommandsForRun(
  database: D1Database,
  input: {
    driverInstanceId: DriverInstanceId;
    nowMs?: number;
    runId: SessionRunId;
  },
): Promise<RuntimeCommandBatchTransitionOutcome> {
  const nowMs = input.nowMs ?? currentTimestampMs();
  const expirableStatuses = getRuntimeCommandDeliveryLeaseExpirableStatuses();
  const queuedStatus = "queued" satisfies RuntimeCommandStatus;
  const targetStatus = "expired" satisfies RuntimeCommandStatus;
  const error = createRuntimeCommandDeliveryExpiredError({
    driverInstanceId: input.driverInstanceId,
    runId: input.runId,
  });

  const result = await getAppDatabase(database)
    .update(driverCommandsTable)
    .set({
      completedAt: sql`COALESCE(${driverCommandsTable.completedAt}, ${nowMs})`,
      errorJson: JSON.stringify(error),
      status: targetStatus,
    })
    .where(
      and(
        eq(driverCommandsTable.driverInstanceId, input.driverInstanceId),
        eq(driverCommandsTable.kind, "input.start"),
        sql`json_extract(${driverCommandsTable.payloadJson}, '$.runId') = ${input.runId}`,
        inArray(driverCommandsTable.status, [...expirableStatuses]),
        or(eq(driverCommandsTable.status, queuedStatus), isNull(driverCommandsTable.ackedAt)),
      ),
    )
    .run();

  return createRuntimeCommandBatchTransitionOutcome(targetStatus, getD1ChangeCount(result));
}

async function expireRuntimeCommandDeliveryLeasesGlobally(
  database: D1Database,
  nowMs: number,
): Promise<RuntimeCommandBatchTransitionOutcome> {
  const expirableStatuses = getRuntimeCommandDeliveryLeaseExpirableStatuses();
  const queuedStatus = "queued" satisfies RuntimeCommandStatus;
  const targetStatus = "expired" satisfies RuntimeCommandStatus;
  const error = createRuntimeCommandDeliveryExpiredError({});

  const result = await getAppDatabase(database)
    .update(driverCommandsTable)
    .set({
      completedAt: sql`COALESCE(${driverCommandsTable.completedAt}, ${nowMs})`,
      errorJson: JSON.stringify(error),
      status: targetStatus,
    })
    .where(
      and(
        inArray(driverCommandsTable.status, [...expirableStatuses]),
        or(eq(driverCommandsTable.status, queuedStatus), isNull(driverCommandsTable.ackedAt)),
        lte(driverCommandsTable.expiresAt, nowMs),
      ),
    )
    .run();

  return createRuntimeCommandBatchTransitionOutcome(targetStatus, getD1ChangeCount(result));
}

async function recoverRuntimeCommandsDeliveredToStaleConnections(
  database: D1Database,
  input: {
    connectionId: string;
    driverGeneration: number;
    driverInstanceId: DriverInstanceId;
  },
): Promise<RuntimeCommandBatchTransitionOutcome> {
  const recoverableStatuses = getRuntimeCommandPreviousStatuses("queued");
  const targetStatus = "queued" satisfies RuntimeCommandStatus;

  const result = await getAppDatabase(database)
    .update(driverCommandsTable)
    .set({
      deliveryConnectionId: null,
      status: targetStatus,
    })
    .where(
      and(
        eq(driverCommandsTable.driverInstanceId, input.driverInstanceId),
        eq(driverCommandsTable.driverGeneration, input.driverGeneration),
        inArray(driverCommandsTable.status, [...recoverableStatuses]),
        isNull(driverCommandsTable.ackedAt),
        or(
          isNull(driverCommandsTable.deliveryConnectionId),
          ne(driverCommandsTable.deliveryConnectionId, input.connectionId),
        ),
      ),
    )
    .run();

  return createRuntimeCommandBatchTransitionOutcome(targetStatus, getD1ChangeCount(result));
}

async function recoverRuntimeCommandsDeliveredToStaleConnectionsGlobally(
  database: D1Database,
): Promise<RuntimeCommandBatchTransitionOutcome> {
  const recoverableStatuses = getRuntimeCommandPreviousStatuses("queued");
  const targetStatus = "queued" satisfies RuntimeCommandStatus;
  const db = getAppDatabase(database);
  const staleDriverConnectionQuery = db
    .select({ id: driverInstancesTable.id })
    .from(driverInstancesTable)
    .where(
      and(
        eq(driverInstancesTable.id, driverCommandsTable.driverInstanceId),
        eq(driverInstancesTable.generation, driverCommandsTable.driverGeneration),
        inArray(driverInstancesTable.status, [...LIVE_DRIVER_INSTANCE_STATUSES]),
        or(
          isNull(driverCommandsTable.deliveryConnectionId),
          isNull(driverInstancesTable.connectionId),
          ne(driverCommandsTable.deliveryConnectionId, driverInstancesTable.connectionId),
        ),
      ),
    );

  const result = await db
    .update(driverCommandsTable)
    .set({
      deliveryConnectionId: null,
      status: targetStatus,
    })
    .where(
      and(
        inArray(driverCommandsTable.status, [...recoverableStatuses]),
        isNull(driverCommandsTable.ackedAt),
        exists(staleDriverConnectionQuery),
      ),
    )
    .run();

  return createRuntimeCommandBatchTransitionOutcome(targetStatus, getD1ChangeCount(result));
}

/** Returns accepted input commands whose authoritative Session Run is terminal. */
export async function listAcceptedInputStartCommandRepairsForTerminalDriver(
  database: D1Database,
  input: {
    driverGeneration: number;
    driverInstanceId: DriverInstanceId;
  },
): Promise<AcceptedInputStartCommandRepair[]> {
  const rows = await getAppDatabase(database)
    .select({
      commandId: driverCommandsTable.id,
      payloadJson: driverCommandsTable.payloadJson,
      run: {
        errorCode: sessionRunsTable.errorCode,
        errorDetailsJson: sessionRunsTable.errorDetailsJson,
        errorMessage: sessionRunsTable.errorMessage,
        errorRetryable: sessionRunsTable.errorRetryable,
        sessionId: sessionRunsTable.sessionId,
        status: sessionRunsTable.status,
      },
      runtimeId: sql<string>`COALESCE(${sessionRunsTable.runtimeId}, ${sessionsTable.runtimeId})`,
    })
    .from(driverCommandsTable)
    .innerJoin(
      sessionRunsTable,
      and(
        sql`json_extract(${driverCommandsTable.payloadJson}, '$.runId') = ${sessionRunsTable.id}`,
        eq(sessionRunsTable.driverInstanceId, driverCommandsTable.driverInstanceId),
      ),
    )
    .innerJoin(sessionsTable, eq(sessionsTable.id, sessionRunsTable.sessionId))
    .where(
      and(
        eq(driverCommandsTable.driverInstanceId, input.driverInstanceId),
        eq(driverCommandsTable.driverGeneration, input.driverGeneration),
        eq(driverCommandsTable.kind, "input.start"),
        eq(driverCommandsTable.status, "accepted"),
      ),
    )
    .orderBy(asc(driverCommandsTable.seq))
    .all();

  const repairs: AcceptedInputStartCommandRepair[] = [];
  for (const row of rows) {
    const command = parseSchemaValue(RuntimeCommand, JSON.parse(row.payloadJson));
    if (command.kind !== "input.start" || command.commandId !== row.commandId) {
      throw new Error("Input command repair does not match its immutable command intent.");
    }
    if (row.runtimeId.length === 0) {
      throw new Error("Input command repair is missing its durable completion identity.");
    }

    const runError = parseSessionRunRepairError(row.run);
    const common = {
      command,
      commandId: row.commandId,
      runtimeId: row.runtimeId,
      sessionId: row.run.sessionId,
    };

    if (row.run.status === "completed") {
      if (runError !== null) {
        throw new Error("Completed Session Run unexpectedly contains a durable error.");
      }
      repairs.push({
        ...common,
        terminal: {
          result: { requestId: command.requestId },
          status: "completed" as const,
        },
      });
      continue;
    }
    if (row.run.status === "cancelled" || row.run.status === "expired") {
      repairs.push({ ...common, terminal: { status: "cancelled" as const } });
      continue;
    }
    if (row.run.status === "failed") {
      if (runError === null) {
        throw new Error("Failed Session Run is missing its authoritative durable error.");
      }
      repairs.push({ ...common, terminal: { error: runError, status: "failed" as const } });
      continue;
    }

    throw new Error("Input command repair requires an authoritative terminal Session Run.");
  }
  return repairs;
}

/** Returns canonical repairs that still need a durable terminal tool event. */
export async function listAcceptedMcpCommandRepairsForTerminalDriver(
  database: D1Database,
  input: {
    driverGeneration: number;
    driverInstanceId: DriverInstanceId;
  },
): Promise<AcceptedMcpCommandRepair[]> {
  const rows = await getAppDatabase(database)
    .select({
      commandId: driverCommandsTable.id,
      effectId: externalToolEffectsTable.id,
      effectStatus: externalToolEffectsTable.status,
      payloadJson: driverCommandsTable.payloadJson,
      resultJson: externalToolEffectsTable.resultJson,
      runtimeId: sql<string>`COALESCE(${sessionRunsTable.runtimeId}, ${sessionsTable.runtimeId})`,
      sessionId: sessionRunsTable.sessionId,
    })
    .from(driverCommandsTable)
    .innerJoin(
      externalToolEffectsTable,
      and(
        eq(externalToolEffectsTable.commandId, driverCommandsTable.id),
        eq(externalToolEffectsTable.driverInstanceId, driverCommandsTable.driverInstanceId),
      ),
    )
    .innerJoin(sessionRunsTable, eq(sessionRunsTable.id, externalToolEffectsTable.sessionRunId))
    .innerJoin(sessionsTable, eq(sessionsTable.id, sessionRunsTable.sessionId))
    .where(
      and(
        eq(driverCommandsTable.driverInstanceId, input.driverInstanceId),
        eq(driverCommandsTable.driverGeneration, input.driverGeneration),
        eq(driverCommandsTable.kind, "mcp.execute"),
        eq(driverCommandsTable.status, "accepted"),
        sql`json_extract(${driverCommandsTable.payloadJson}, '$.runId') = ${externalToolEffectsTable.sessionRunId}`,
        sql`json_extract(${driverCommandsTable.payloadJson}, '$.serverId') = ${externalToolEffectsTable.serverId}`,
        sql`json_extract(${driverCommandsTable.payloadJson}, '$.toolName') = ${externalToolEffectsTable.toolName}`,
      ),
    )
    .orderBy(asc(driverCommandsTable.seq))
    .all();

  const repairs: AcceptedMcpCommandRepair[] = [];
  for (const row of rows) {
    if (row.runtimeId.length === 0) {
      throw new Error("MCP command repair is missing its durable completion identity.");
    }

    const command = parseSchemaValue(RuntimeCommand, JSON.parse(row.payloadJson));
    if (command.kind !== "mcp.execute" || command.commandId !== row.commandId) {
      throw new Error("MCP command repair does not match its immutable command intent.");
    }

    if (row.effectStatus === "claimed") {
      throw new Error("Terminal Driver repair must fence claimed MCP effects before listing them.");
    }

    const common = {
      command,
      commandId: row.commandId,
      effectId: row.effectId,
      effectStatus: row.effectStatus,
      runtimeId: row.runtimeId,
      sessionId: row.sessionId,
    };

    if (row.effectStatus === "succeeded") {
      if (row.resultJson === null) {
        throw new Error("Succeeded MCP command is missing its durable result.");
      }
      const result = parseSchemaValue(McpExecuteCommandResult, JSON.parse(row.resultJson));
      if (
        result.requestId !== command.requestId ||
        result.serverId !== command.serverId ||
        result.toolName !== command.toolName
      ) {
        throw new Error("Succeeded MCP result does not match its immutable command intent.");
      }
      repairs.push({ ...common, terminal: { result, status: "completed" as const } });
      continue;
    }

    if (row.resultJson !== null) {
      throw new Error("Unresolved MCP command unexpectedly contains a durable result.");
    }
    const error =
      row.effectStatus === "unknown"
        ? createRuntimeCommandExternalToolEffectUnknownError({
            command,
            effectId: row.effectId,
          })
        : createRuntimeCommandExternalToolEffectNotExecutedError({
            commandId: row.commandId,
            driverInstanceId: input.driverInstanceId,
            effectId: row.effectId,
          });
    repairs.push({ ...common, terminal: { error, status: "failed" as const } });
  }
  return repairs;
}

export async function repairAcceptedRuntimeCommandsForTerminalDriver(
  database: D1Database,
  input: {
    driverGeneration: number;
    driverInstanceId: DriverInstanceId;
    nowMs?: number;
  },
): Promise<RuntimeCommandTerminalRepairOutcome> {
  const nowMs = input.nowMs ?? currentTimestampMs();
  const db = getAppDatabase(database);
  const unacceptedIntents = await db
    .select({
      commandId: driverCommandsTable.id,
      effectId: externalToolEffectsTable.id,
    })
    .from(driverCommandsTable)
    .innerJoin(
      externalToolEffectsTable,
      and(
        eq(externalToolEffectsTable.commandId, driverCommandsTable.id),
        eq(externalToolEffectsTable.driverInstanceId, driverCommandsTable.driverInstanceId),
      ),
    )
    .where(
      and(
        eq(driverCommandsTable.driverInstanceId, input.driverInstanceId),
        eq(driverCommandsTable.driverGeneration, input.driverGeneration),
        inArray(driverCommandsTable.status, ["queued", "delivered"]),
        eq(externalToolEffectsTable.status, "intent"),
      ),
    )
    .all();

  let failedCount = 0;
  for (const effect of unacceptedIntents) {
    const result = await db
      .update(driverCommandsTable)
      .set({
        completedAt: sql`COALESCE(${driverCommandsTable.completedAt}, ${nowMs})`,
        errorJson: JSON.stringify(
          createRuntimeCommandExternalToolEffectNotExecutedError({
            commandId: effect.commandId,
            driverInstanceId: input.driverInstanceId,
            effectId: effect.effectId,
          }),
        ),
        status: "failed",
      })
      .where(
        and(
          eq(driverCommandsTable.id, effect.commandId),
          eq(driverCommandsTable.driverGeneration, input.driverGeneration),
          eq(driverCommandsTable.driverInstanceId, input.driverInstanceId),
          inArray(driverCommandsTable.status, ["queued", "delivered"]),
          exists(
            db
              .select({ id: externalToolEffectsTable.id })
              .from(externalToolEffectsTable)
              .where(
                and(
                  eq(externalToolEffectsTable.id, effect.effectId),
                  eq(externalToolEffectsTable.commandId, effect.commandId),
                  eq(externalToolEffectsTable.driverInstanceId, input.driverInstanceId),
                  eq(externalToolEffectsTable.status, "intent"),
                ),
              ),
          ),
        ),
      )
      .run();
    failedCount += getD1ChangeCount(result);
  }

  const pendingEventFirstCommand =
    (await db
      .select({ id: driverCommandsTable.id })
      .from(driverCommandsTable)
      .where(
        and(
          eq(driverCommandsTable.driverInstanceId, input.driverInstanceId),
          eq(driverCommandsTable.driverGeneration, input.driverGeneration),
          or(
            and(
              eq(driverCommandsTable.kind, "mcp.execute"),
              inArray(driverCommandsTable.status, ["queued", "delivered", "accepted"]),
            ),
            and(
              eq(driverCommandsTable.kind, "input.start"),
              eq(driverCommandsTable.status, "accepted"),
            ),
          ),
        ),
      )
      .limit(1)
      .get()) ?? null;
  if (pendingEventFirstCommand !== null) {
    throw new Error("Accepted input and MCP commands require event-first terminal reconciliation.");
  }

  const genericResult = await db
    .update(driverCommandsTable)
    .set({
      completedAt: sql`COALESCE(${driverCommandsTable.completedAt}, ${nowMs})`,
      errorJson: JSON.stringify(
        createRuntimeCommandDriverTerminalError({
          driverInstanceId: input.driverInstanceId,
        }),
      ),
      status: "failed",
    })
    .where(
      and(
        eq(driverCommandsTable.driverInstanceId, input.driverInstanceId),
        eq(driverCommandsTable.driverGeneration, input.driverGeneration),
        ne(driverCommandsTable.kind, "mcp.execute"),
        or(
          inArray(driverCommandsTable.status, ["queued", "delivered"]),
          and(
            eq(driverCommandsTable.status, "accepted"),
            ne(driverCommandsTable.kind, "input.start"),
          ),
        ),
      ),
    )
    .run();
  failedCount += getD1ChangeCount(genericResult);

  return {
    completed: createRuntimeCommandBatchTransitionOutcome("completed", 0),
    failed: createRuntimeCommandBatchTransitionOutcome("failed", failedCount),
  };
}

export async function listTerminalDriversWithPendingRuntimeCommands(
  database: D1Database,
): Promise<readonly { generation: number; id: DriverInstanceId }[]> {
  const db = getAppDatabase(database);
  const pendingCommand = db
    .select({ id: driverCommandsTable.id })
    .from(driverCommandsTable)
    .where(
      and(
        eq(driverCommandsTable.driverInstanceId, driverInstancesTable.id),
        eq(driverCommandsTable.driverGeneration, driverInstancesTable.generation),
        inArray(driverCommandsTable.status, ["queued", "delivered", "accepted"]),
      ),
    );
  const claimedEffect = db
    .select({ id: externalToolEffectsTable.id })
    .from(externalToolEffectsTable)
    .where(
      and(
        eq(externalToolEffectsTable.driverInstanceId, driverInstancesTable.id),
        eq(externalToolEffectsTable.status, "claimed"),
        exists(
          db
            .select({ id: driverCommandsTable.id })
            .from(driverCommandsTable)
            .where(
              and(
                eq(driverCommandsTable.id, externalToolEffectsTable.commandId),
                eq(driverCommandsTable.driverGeneration, driverInstancesTable.generation),
              ),
            ),
        ),
      ),
    );

  return db
    .select({ generation: driverInstancesTable.generation, id: driverInstancesTable.id })
    .from(driverInstancesTable)
    .where(
      and(
        inArray(driverInstancesTable.status, ["failed", "stopped"]),
        or(exists(pendingCommand), exists(claimedEffect)),
      ),
    )
    .all();
}

export async function maintainRuntimeCommandRecords(
  database: D1Database,
  input: {
    connectionId: string;
    driverGeneration: number;
    driverInstanceId: DriverInstanceId;
    nowMs?: number;
  },
): Promise<RuntimeCommandMaintenanceOutcome> {
  const nowMs = input.nowMs ?? currentTimestampMs();

  const recovered = await recoverRuntimeCommandsDeliveredToStaleConnections(database, {
    connectionId: input.connectionId,
    driverGeneration: input.driverGeneration,
    driverInstanceId: input.driverInstanceId,
  });
  const expired = await expireRuntimeCommandDeliveryLeases(
    database,
    input.driverInstanceId,
    input.driverGeneration,
    nowMs,
  );

  return {
    expired,
    recovered,
  };
}

export async function repairRuntimeCommandRecords(
  database: D1Database,
  input: {
    nowMs?: number;
  } = {},
): Promise<RuntimeCommandMaintenanceOutcome> {
  const nowMs = input.nowMs ?? currentTimestampMs();

  const recovered = await recoverRuntimeCommandsDeliveredToStaleConnectionsGlobally(database);
  const expired = await expireRuntimeCommandDeliveryLeasesGlobally(database, nowMs);

  return {
    expired,
    recovered,
  };
}

export async function claimNextQueuedRuntimeCommandRecord(
  database: D1Database,
  driverInstanceId: DriverInstanceId,
  driverGeneration: number,
  connectionId: string,
): Promise<RuntimeCommandRecord | null> {
  const nowMs = currentTimestampMs();
  const db = getAppDatabase(database);

  await maintainRuntimeCommandRecords(database, {
    connectionId,
    driverGeneration,
    driverInstanceId,
    nowMs,
  });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const nextQueued =
      (await db
        .select({ id: driverCommandsTable.id })
        .from(driverCommandsTable)
        .where(
          and(
            eq(driverCommandsTable.driverInstanceId, driverInstanceId),
            eq(driverCommandsTable.driverGeneration, driverGeneration),
            eq(driverCommandsTable.status, "queued"),
            runtimeCommandActiveRunGuard(db),
            or(isNull(driverCommandsTable.expiresAt), gt(driverCommandsTable.expiresAt, nowMs)),
          ),
        )
        .orderBy(asc(driverCommandsTable.seq))
        .limit(1)
        .get()) ?? null;

    if (nextQueued === null) {
      return null;
    }

    const deliveryOutcome = await markRuntimeCommandRecordDelivered(database, {
      commandId: nextQueued.id,
      connectionId,
      driverGeneration,
      driverInstanceId,
      expiresAfter: nowMs,
    });

    if (
      deliveryOutcome.kind === "rejected" &&
      deliveryOutcome.reason === "inactive_delivery_connection"
    ) {
      return null;
    }

    const claimed =
      deliveryOutcome.kind === "applied"
        ? await getRuntimeCommandRecord(database, driverInstanceId, driverGeneration, nextQueued.id)
        : null;

    if (claimed !== null) {
      return claimed;
    }
  }

  return null;
}
