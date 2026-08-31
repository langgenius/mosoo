import { describe, expect, test } from "bun:test";

import { RUNTIME_COMMAND_MAX_UTF8_BYTES } from "@mosoo/contracts/runtime-command";
import type { RuntimeCommand, RuntimeCommandStatus } from "@mosoo/contracts/runtime-command";
import type { RunError } from "@mosoo/contracts/session-run";
import { parsePlatformId } from "@mosoo/id";
import type { DriverCommandId, DriverInstanceId, SessionRunId } from "@mosoo/id";

import {
  claimNextQueuedRuntimeCommandRecord as claimNextQueuedRuntimeCommand,
  createRuntimeCommandRecord as persistRuntimeCommandRecord,
  expireUndeliveredInputStartCommandsForRun,
  getRuntimeCommandRecord as readRuntimeCommandRecord,
  maintainRuntimeCommandRecords as maintainRuntimeCommands,
  markRuntimeCommandRecordDelivered as markRuntimeCommandDelivered,
  repairRuntimeCommandRecords,
  updateRuntimeCommandRecord as updateStoredRuntimeCommandRecord,
} from "../src/modules/runtime/infrastructure/session-runs/runtime-command-store.repository";
import {
  decideRuntimeCommandTransition,
  getRuntimeCommandDeliveryLeaseExpirableStatuses,
  getRuntimeCommandPreviousStatuses,
  isRuntimeCommandAcknowledgedStatus,
  isRuntimeCommandTerminalStatus,
} from "../src/modules/runtime/infrastructure/session-runs/runtime-command-transition";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const DRIVER_INSTANCE_ID = parsePlatformId<DriverInstanceId>("01J00000000000000000000009");
const TERMINAL_DRIVER_INSTANCE_ID = parsePlatformId<DriverInstanceId>("01J0000000000000000000000G");
const SESSION_RUN_ID = parsePlatformId<SessionRunId>("01J0000000000000000000000N");
const DRIVER_GENERATION = 0;
const COMMAND_IDS = {
  accepted: parsePlatformId<DriverCommandId>("01J00000000000000000000015"),
  current: parsePlatformId<DriverCommandId>("01J00000000000000000000017"),
  currentRunQueued: parsePlatformId<DriverCommandId>("01J00000000000000000000026"),
  delivered: parsePlatformId<DriverCommandId>("01J00000000000000000000014"),
  expired: parsePlatformId<DriverCommandId>("01J00000000000000000000013"),
  first: parsePlatformId<DriverCommandId>("01J00000000000000000000011"),
  globalAccepted: parsePlatformId<DriverCommandId>("01J00000000000000000000025"),
  globalExpired: parsePlatformId<DriverCommandId>("01J00000000000000000000023"),
  globalStale: parsePlatformId<DriverCommandId>("01J00000000000000000000024"),
  illegal: parsePlatformId<DriverCommandId>("01J00000000000000000000018"),
  maintenanceExpired: parsePlatformId<DriverCommandId>("01J00000000000000000000021"),
  maintenanceStale: parsePlatformId<DriverCommandId>("01J00000000000000000000022"),
  redelivery: parsePlatformId<DriverCommandId>("01J00000000000000000000020"),
  second: parsePlatformId<DriverCommandId>("01J00000000000000000000012"),
  stale: parsePlatformId<DriverCommandId>("01J00000000000000000000016"),
  otherRunQueued: parsePlatformId<DriverCommandId>("01J00000000000000000000027"),
  staleUpdate: parsePlatformId<DriverCommandId>("01J00000000000000000000019"),
} as const;
const RUNTIME_COMMAND_STATUSES = [
  "queued",
  "delivered",
  "accepted",
  "completed",
  "failed",
  "expired",
  "cancelled",
] as const satisfies readonly RuntimeCommandStatus[];
const EXPECTED_PREVIOUS_STATUSES = {
  accepted: ["delivered"],
  cancelled: ["queued", "delivered", "accepted"],
  completed: ["delivered", "accepted"],
  delivered: ["queued"],
  expired: ["queued", "delivered", "accepted"],
  failed: ["queued", "delivered", "accepted"],
  queued: ["delivered"],
} as const satisfies Record<RuntimeCommandStatus, readonly RuntimeCommandStatus[]>;

function createRuntimeCommandRecord(
  database: D1Database,
  input: Omit<Parameters<typeof persistRuntimeCommandRecord>[1], "driverGeneration">,
) {
  return persistRuntimeCommandRecord(database, { ...input, driverGeneration: DRIVER_GENERATION });
}

function getRuntimeCommandRecord(
  database: D1Database,
  driverInstanceId: DriverInstanceId,
  commandId: DriverCommandId,
) {
  return readRuntimeCommandRecord(database, driverInstanceId, DRIVER_GENERATION, commandId);
}

function updateRuntimeCommandRecord(
  database: D1Database,
  input: Omit<Parameters<typeof updateStoredRuntimeCommandRecord>[1], "driverGeneration">,
) {
  return updateStoredRuntimeCommandRecord(database, {
    ...input,
    driverGeneration: DRIVER_GENERATION,
  });
}

function markRuntimeCommandRecordDelivered(
  database: D1Database,
  input: Omit<Parameters<typeof markRuntimeCommandDelivered>[1], "driverGeneration">,
) {
  return markRuntimeCommandDelivered(database, { ...input, driverGeneration: DRIVER_GENERATION });
}

function maintainRuntimeCommandRecords(
  database: D1Database,
  input: Omit<Parameters<typeof maintainRuntimeCommands>[1], "driverGeneration">,
) {
  return maintainRuntimeCommands(database, { ...input, driverGeneration: DRIVER_GENERATION });
}

function claimNextQueuedRuntimeCommandRecord(
  database: D1Database,
  driverInstanceId: DriverInstanceId,
  connectionId: string,
) {
  return claimNextQueuedRuntimeCommand(database, driverInstanceId, DRIVER_GENERATION, connectionId);
}

function createRuntimeCommandDatabase(): SqliteD1Database {
  const database = new SqliteD1Database({ foreignKeys: false });

  database.execute(`
    CREATE TABLE driver_instance (
      command_seq_cursor integer DEFAULT 0 NOT NULL,
      connection_id text,
      generation integer DEFAULT 0 NOT NULL,
      id text PRIMARY KEY NOT NULL,
      status text DEFAULT 'ready' NOT NULL
    );

    CREATE TABLE driver_command (
      acked_at integer,
      completed_at integer,
      delivery_connection_id text,
      driver_generation integer,
      driver_instance_id text NOT NULL,
      error_json text,
      expires_at integer,
      id text PRIMARY KEY NOT NULL,
      issued_at integer NOT NULL,
      kind text NOT NULL,
      payload_json text NOT NULL,
      result_json text,
      seq integer NOT NULL,
      status text NOT NULL
    );

    CREATE TABLE session_run (
      driver_instance_id text,
      error_code text,
      error_details_json text,
      error_message text,
      error_retryable integer,
      id text PRIMARY KEY NOT NULL,
      session_id text NOT NULL DEFAULT 'session-1',
      status text NOT NULL
    );

    CREATE TABLE session_event (
      event_type text NOT NULL,
      id text PRIMARY KEY NOT NULL,
      mcp_command_id text,
      run_id text,
      source_event_id text NOT NULL,
      tool_call_id text,
      tool_input_json text,
      tool_name text,
      tool_output_text text,
      tool_status text
    );

    CREATE TABLE external_tool_effect (
      attempt_count integer DEFAULT 0 NOT NULL,
      claim_token text,
      command_id text NOT NULL,
      driver_instance_id text NOT NULL,
      id text PRIMARY KEY NOT NULL,
      idempotency_key text NOT NULL,
      provider_receipt_json text,
      result_json text,
      status text NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE TABLE external_tool_effect_attempt (
      attempt integer NOT NULL,
      claim_token text NOT NULL,
      completed_at integer,
      created_at integer NOT NULL,
      effect_id text NOT NULL,
      provider_receipt_json text,
      result_json text,
      status text NOT NULL,
      PRIMARY KEY (effect_id, attempt)
    );

    INSERT INTO driver_instance (id, connection_id, status)
    VALUES ('${DRIVER_INSTANCE_ID}', 'connection-1', 'ready');

    INSERT INTO session_run (driver_instance_id, id, status)
    VALUES ('${DRIVER_INSTANCE_ID}', '${SESSION_RUN_ID}', 'running');
  `);

  return database;
}

function inputStartCommand(id: DriverCommandId): RuntimeCommand {
  return {
    commandId: id,
    input: {
      text: `hello from ${id}`,
    },
    kind: "input.start",
    requestId: `request-${id}`,
    runId: SESSION_RUN_ID,
  };
}

function sessionStopCommand(id: DriverCommandId): RuntimeCommand {
  return {
    commandId: id,
    kind: "session.stop",
    reason: "terminal Driver repair",
  };
}

function mcpExecuteCommand(id: DriverCommandId): Extract<RuntimeCommand, { kind: "mcp.execute" }> {
  return {
    argumentsJson: '{"title":"durable"}',
    commandId: id,
    kind: "mcp.execute",
    requestId: "request-1",
    runId: SESSION_RUN_ID,
    serverId: "01J0000000000000000000000Y",
    toolCallId: "tool-1",
    toolName: "createIssue",
  };
}

function insertInputTerminalFact(
  database: SqliteD1Database,
  input:
    | { error: RunError; status: "failed" }
    | { error?: RunError; status: "cancelled" | "expired" }
    | { status: "completed" },
): void {
  const error = "error" in input ? (input.error ?? null) : null;
  const eventType =
    input.status === "failed"
      ? "run.failed"
      : input.status === "completed"
        ? "run.completed"
        : "run.cancelled";
  database
    .prepare(
      `UPDATE session_run
       SET error_code = ?, error_details_json = ?, error_message = ?, error_retryable = ?, status = ?
       WHERE id = ?`,
    )
    .bind(
      error?.code ?? null,
      error === null ? null : JSON.stringify(error.details),
      error?.message ?? null,
      error === null ? null : Number(error.retryable),
      input.status,
      SESSION_RUN_ID,
    )
    .run();
  database
    .prepare(
      `INSERT INTO session_event (event_type, id, run_id, source_event_id)
       VALUES (?, ?, ?, ?)`,
    )
    .bind(
      eventType,
      `event-input-${input.status}`,
      SESSION_RUN_ID,
      `session-run-terminal:${SESSION_RUN_ID}:${eventType}`,
    )
    .run();
}

function insertMcpTerminalFact(
  database: SqliteD1Database,
  command: Extract<RuntimeCommand, { kind: "mcp.execute" }>,
  input:
    | { outputText: string; status: "completed" }
    | { error: RunError; status: "failed" }
    | { status: "cancelled" },
): void {
  const outputText =
    input.status === "completed"
      ? input.outputText
      : input.status === "failed"
        ? input.error.message
        : null;
  database
    .prepare(
      `INSERT INTO session_event (
         event_type, id, mcp_command_id, run_id, source_event_id, tool_call_id,
         tool_input_json, tool_name, tool_output_text, tool_status
       ) VALUES ('tool.call.updated', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      `event-mcp-${input.status}`,
      command.commandId,
      command.runId,
      `mcp.execute.${input.status}:${command.commandId}`,
      command.toolCallId,
      command.argumentsJson,
      command.toolName,
      outputText,
      input.status,
    )
    .run();
}

describe("runtime command store", () => {
  test("measures and writes the same serialized command and terminal payload", async () => {
    const database = createRuntimeCommandDatabase();
    let commandSerializations = 0;
    const command = {
      ...inputStartCommand(COMMAND_IDS.first),
      toJSON() {
        commandSerializations += 1;
        return {
          ...inputStartCommand(COMMAND_IDS.first),
          input: { text: `serialized-${commandSerializations}` },
        };
      },
    };

    await createRuntimeCommandRecord(database, {
      command,
      driverInstanceId: DRIVER_INSTANCE_ID,
      status: "accepted",
    });
    expect(commandSerializations).toBe(1);
    await expect(
      database
        .prepare("SELECT payload_json FROM driver_command WHERE id = ?")
        .bind(COMMAND_IDS.first)
        .first(),
    ).resolves.toEqual({
      payload_json: JSON.stringify({
        ...inputStartCommand(COMMAND_IDS.first),
        input: { text: "serialized-1" },
      }),
    });

    let errorSerializations = 0;
    const error = {
      code: "test.serialized",
      details: {},
      message: "original",
      retryable: false,
      toJSON() {
        errorSerializations += 1;
        return {
          code: "test.serialized",
          details: {},
          message: `serialized-${errorSerializations}`,
          retryable: false,
        };
      },
    };
    insertInputTerminalFact(database, {
      error: {
        code: "test.serialized",
        details: {},
        message: "serialized-1",
        retryable: false,
      },
      status: "failed",
    });
    await expect(
      updateRuntimeCommandRecord(database, {
        commandId: COMMAND_IDS.first,
        driverInstanceId: DRIVER_INSTANCE_ID,
        error,
        status: "failed",
      }),
    ).resolves.toMatchObject({ kind: "applied" });
    expect(errorSerializations).toBe(1);
    await expect(
      database
        .prepare("SELECT error_json FROM driver_command WHERE id = ?")
        .bind(COMMAND_IDS.first)
        .first(),
    ).resolves.toEqual({
      error_json: JSON.stringify({
        code: "test.serialized",
        details: {},
        message: "serialized-1",
        retryable: false,
      }),
    });

    const resultDatabase = createRuntimeCommandDatabase();
    await createRuntimeCommandRecord(resultDatabase, {
      command: { ...inputStartCommand(COMMAND_IDS.second), requestId: "serialized-1" },
      driverInstanceId: DRIVER_INSTANCE_ID,
      status: "accepted",
    });
    insertInputTerminalFact(resultDatabase, { status: "completed" });
    let resultSerializations = 0;
    const result = {
      requestId: "original",
      toJSON() {
        resultSerializations += 1;
        return { requestId: `serialized-${resultSerializations}` };
      },
    };
    await expect(
      updateRuntimeCommandRecord(resultDatabase, {
        commandId: COMMAND_IDS.second,
        driverInstanceId: DRIVER_INSTANCE_ID,
        result,
        status: "completed",
      }),
    ).resolves.toMatchObject({ kind: "applied" });
    expect(resultSerializations).toBe(1);
    await expect(
      resultDatabase
        .prepare("SELECT result_json FROM driver_command WHERE id = ?")
        .bind(COMMAND_IDS.second)
        .first(),
    ).resolves.toEqual({ result_json: '{"requestId":"serialized-1"}' });
  });

  test("rejects invalid command JSON before allocating a sequence or writing a row", async () => {
    const database = createRuntimeCommandDatabase();
    const emptyCommand = {
      ...inputStartCommand(COMMAND_IDS.first),
      input: { text: "" },
    };
    const emptyPayloadBytes = new TextEncoder().encode(JSON.stringify(emptyCommand)).byteLength;
    const oversizedCommand = {
      ...emptyCommand,
      input: {
        text: "x".repeat(RUNTIME_COMMAND_MAX_UTF8_BYTES - emptyPayloadBytes + 1),
      },
    };

    await expect(
      createRuntimeCommandRecord(database, {
        command: { ...emptyCommand, input: { text: "" } },
        driverInstanceId: DRIVER_INSTANCE_ID,
      }),
    ).rejects.toThrow();
    await expect(
      createRuntimeCommandRecord(database, {
        command: oversizedCommand,
        driverInstanceId: DRIVER_INSTANCE_ID,
      }),
    ).rejects.toThrow(`${RUNTIME_COMMAND_MAX_UTF8_BYTES} UTF-8 bytes`);
    await expect(
      createRuntimeCommandRecord(database, {
        command: inputStartCommand(COMMAND_IDS.second),
        driverInstanceId: DRIVER_INSTANCE_ID,
        status: "invalid" as never,
      }),
    ).rejects.toThrow();
    await expect(
      database
        .prepare(
          "SELECT command_seq_cursor, (SELECT count(*) FROM driver_command) AS command_count FROM driver_instance WHERE id = ?",
        )
        .bind(DRIVER_INSTANCE_ID)
        .first(),
    ).resolves.toEqual({ command_count: 0, command_seq_cursor: 0 });
  });

  test("rejects terminal payloads that do not match the command kind without mutating it", async () => {
    const database = createRuntimeCommandDatabase();
    await createRuntimeCommandRecord(database, {
      command: inputStartCommand(COMMAND_IDS.first),
      driverInstanceId: DRIVER_INSTANCE_ID,
      status: "accepted",
    });

    await expect(
      updateRuntimeCommandRecord(database, {
        commandId: COMMAND_IDS.first,
        driverInstanceId: DRIVER_INSTANCE_ID,
        result: {
          outputText: "wrong result kind",
          requestId: "request-1",
          serverId: "server-1",
          toolName: "tool-1",
        },
        status: "completed",
      }),
    ).rejects.toThrow();
    const validError = {
      code: "test.invalid_status_payload",
      details: {},
      message: "must not be stored",
      retryable: false,
    };
    await expect(
      updateRuntimeCommandRecord(database, {
        commandId: COMMAND_IDS.first,
        driverInstanceId: DRIVER_INSTANCE_ID,
        error: validError,
        status: "completed",
      }),
    ).rejects.toThrow();
    await expect(
      updateRuntimeCommandRecord(database, {
        commandId: COMMAND_IDS.first,
        driverInstanceId: DRIVER_INSTANCE_ID,
        result: { requestId: "request-1" },
        status: "failed",
      }),
    ).rejects.toThrow();
    await expect(
      updateRuntimeCommandRecord(database, {
        commandId: COMMAND_IDS.first,
        driverInstanceId: DRIVER_INSTANCE_ID,
        error: validError,
        status: "delivered",
      }),
    ).rejects.toThrow();
    await expect(
      updateRuntimeCommandRecord(database, {
        commandId: COMMAND_IDS.first,
        driverInstanceId: DRIVER_INSTANCE_ID,
        status: "invalid" as never,
      }),
    ).rejects.toThrow();
    await expect(
      updateRuntimeCommandRecord(database, {
        commandId: COMMAND_IDS.first,
        driverInstanceId: DRIVER_INSTANCE_ID,
        error: {
          code: "test.invalid",
          details: { nested: { invalid: true } } as never,
          message: "invalid nested details",
          retryable: false,
        },
        status: "failed",
      }),
    ).rejects.toThrow();
    await expect(
      database
        .prepare("SELECT error_json, result_json, status FROM driver_command WHERE id = ?")
        .bind(COMMAND_IDS.first)
        .first(),
    ).resolves.toEqual({ error_json: null, result_json: null, status: "accepted" });
  });

  test("mirrors the succeeded effect result bytes when completing an MCP command", async () => {
    const database = createRuntimeCommandDatabase();
    const command = mcpExecuteCommand(COMMAND_IDS.first);
    const authoritativeResult =
      '{"toolName":"tool-1","outputText":"done","serverId":"server-1","requestId":"request-1"}';
    database.execute(`
      INSERT INTO driver_command (
        driver_generation, driver_instance_id, id, issued_at, kind, payload_json, seq, status
      ) VALUES (
        ${DRIVER_GENERATION}, '${DRIVER_INSTANCE_ID}', '${COMMAND_IDS.first}', 1, 'mcp.execute', '${JSON.stringify(command)}', 1, 'accepted'
      );
      INSERT INTO external_tool_effect (
        attempt_count, command_id, driver_instance_id, id, idempotency_key,
        result_json, status, updated_at
      ) VALUES (
        1, '${COMMAND_IDS.first}', '${DRIVER_INSTANCE_ID}', 'effect-1',
        'idempotency-1', '${authoritativeResult}', 'succeeded', 1
      );
    `);
    insertMcpTerminalFact(database, command, { outputText: "done", status: "completed" });

    await expect(
      updateRuntimeCommandRecord(database, {
        commandId: COMMAND_IDS.first,
        driverInstanceId: DRIVER_INSTANCE_ID,
        result: {
          isError: false,
          outputText: "done",
          requestId: "request-1",
          serverId: "server-1",
          toolName: "tool-1",
        },
        status: "completed",
      }),
    ).resolves.toMatchObject({ kind: "applied" });
    await expect(
      database
        .prepare("SELECT result_json FROM driver_command WHERE id = ?")
        .bind(COMMAND_IDS.first)
        .first(),
    ).resolves.toEqual({ result_json: authoritativeResult });

    const exactReplay = {
      isError: false,
      outputText: "done",
      requestId: "request-1",
      serverId: "server-1",
      toolName: "tool-1",
    };
    await expect(
      updateRuntimeCommandRecord(database, {
        commandId: COMMAND_IDS.first,
        driverInstanceId: DRIVER_INSTANCE_ID,
        result: exactReplay,
        status: "completed",
      }),
    ).resolves.toEqual({ kind: "duplicate", status: "completed" });
    await expect(
      updateRuntimeCommandRecord(database, {
        commandId: COMMAND_IDS.first,
        driverInstanceId: DRIVER_INSTANCE_ID,
        result: { ...exactReplay, outputText: "changed" },
        status: "completed",
      }),
    ).rejects.toThrow("conflicts with its durable terminal payload");

    database.execute(`
      UPDATE external_tool_effect
      SET result_json = NULL, status = 'unknown'
      WHERE command_id = '${COMMAND_IDS.first}'
    `);
    await expect(
      updateRuntimeCommandRecord(database, {
        commandId: COMMAND_IDS.first,
        driverInstanceId: DRIVER_INSTANCE_ID,
        result: exactReplay,
        status: "completed",
      }),
    ).rejects.toThrow("has no succeeded durable effect");
  });

  test("accepts only exact failed command replays", async () => {
    const database = createRuntimeCommandDatabase();
    const error = {
      code: "test.command_failed",
      details: { attempt: 1, source: "driver" },
      message: "Command failed.",
      retryable: true,
    };
    await createRuntimeCommandRecord(database, {
      command: inputStartCommand(COMMAND_IDS.first),
      driverInstanceId: DRIVER_INSTANCE_ID,
      status: "accepted",
    });
    insertInputTerminalFact(database, { error, status: "failed" });
    await expect(
      updateRuntimeCommandRecord(database, {
        commandId: COMMAND_IDS.first,
        driverInstanceId: DRIVER_INSTANCE_ID,
        error,
        status: "failed",
      }),
    ).resolves.toMatchObject({ kind: "applied" });
    await expect(
      updateRuntimeCommandRecord(database, {
        commandId: COMMAND_IDS.first,
        driverInstanceId: DRIVER_INSTANCE_ID,
        error: {
          message: error.message,
          retryable: error.retryable,
          details: { source: "driver", attempt: 1 },
          code: error.code,
        },
        status: "failed",
      }),
    ).resolves.toEqual({ kind: "duplicate", status: "failed" });
    await expect(
      updateRuntimeCommandRecord(database, {
        commandId: COMMAND_IDS.first,
        driverInstanceId: DRIVER_INSTANCE_ID,
        error: { ...error, retryable: false },
        status: "failed",
      }),
    ).rejects.toThrow("conflicts with its durable terminal payload");
  });

  test("settles cancelled input commands while preserving the Run cancellation error", async () => {
    const database = createRuntimeCommandDatabase();
    const error = {
      code: "runtime.operation_cancelled",
      details: { operationId: "operation-1" },
      message: "The runtime operation cancelled this run.",
      retryable: false,
    };
    await createRuntimeCommandRecord(database, {
      command: inputStartCommand(COMMAND_IDS.first),
      driverInstanceId: DRIVER_INSTANCE_ID,
      status: "accepted",
    });
    insertInputTerminalFact(database, { error, status: "cancelled" });

    await expect(
      updateRuntimeCommandRecord(database, {
        commandId: COMMAND_IDS.first,
        driverInstanceId: DRIVER_INSTANCE_ID,
        status: "cancelled",
      }),
    ).resolves.toEqual({ kind: "applied", status: "cancelled" });
    await expect(
      updateRuntimeCommandRecord(database, {
        commandId: COMMAND_IDS.first,
        driverInstanceId: DRIVER_INSTANCE_ID,
        status: "cancelled",
      }),
    ).resolves.toEqual({ kind: "duplicate", status: "cancelled" });
    await expect(
      database
        .prepare(
          "SELECT error_code, error_message, error_retryable, status FROM session_run WHERE id = ?",
        )
        .bind(SESSION_RUN_ID)
        .first(),
    ).resolves.toEqual({
      error_code: error.code,
      error_message: error.message,
      error_retryable: 0,
      status: "cancelled",
    });
  });

  test("keeps runtime command transitions on the owner matrix", () => {
    for (const targetStatus of RUNTIME_COMMAND_STATUSES) {
      expect(getRuntimeCommandPreviousStatuses(targetStatus)).toEqual(
        EXPECTED_PREVIOUS_STATUSES[targetStatus],
      );
    }

    for (const currentStatus of RUNTIME_COMMAND_STATUSES) {
      for (const targetStatus of RUNTIME_COMMAND_STATUSES) {
        const outcome = decideRuntimeCommandTransition(currentStatus, targetStatus);

        if (currentStatus === targetStatus) {
          expect(outcome).toEqual({
            kind: "duplicate",
            status: currentStatus,
          });
          continue;
        }

        const previousStatuses: readonly RuntimeCommandStatus[] =
          EXPECTED_PREVIOUS_STATUSES[targetStatus];

        if (previousStatuses.includes(currentStatus)) {
          expect(outcome).toEqual({
            kind: "applied",
            status: targetStatus,
          });
          continue;
        }

        expect(outcome).toEqual({
          currentStatus,
          kind: "rejected",
          reason: "illegal_transition",
          targetStatus,
        });
      }
    }
  });

  test("keeps runtime command ack and terminal status classifiers on the owner", () => {
    expect(getRuntimeCommandDeliveryLeaseExpirableStatuses()).toEqual(["queued", "delivered"]);
    expect(RUNTIME_COMMAND_STATUSES.filter(isRuntimeCommandAcknowledgedStatus)).toEqual([
      "accepted",
      "completed",
      "failed",
    ]);
    expect(RUNTIME_COMMAND_STATUSES.filter(isRuntimeCommandTerminalStatus)).toEqual([
      "completed",
      "failed",
      "expired",
      "cancelled",
    ]);
  });

  test("claims queued commands in sequence and marks them delivered", async () => {
    const database = createRuntimeCommandDatabase();
    const expiresAt = Date.now() + 60_000;

    await createRuntimeCommandRecord(database, {
      command: inputStartCommand(COMMAND_IDS.first),
      driverInstanceId: DRIVER_INSTANCE_ID,
      expiresAt,
    });
    await createRuntimeCommandRecord(database, {
      command: inputStartCommand(COMMAND_IDS.second),
      driverInstanceId: DRIVER_INSTANCE_ID,
      expiresAt,
    });

    const first = await claimNextQueuedRuntimeCommandRecord(
      database,
      DRIVER_INSTANCE_ID,
      "connection-1",
    );
    const second = await claimNextQueuedRuntimeCommandRecord(
      database,
      DRIVER_INSTANCE_ID,
      "connection-1",
    );
    const empty = await claimNextQueuedRuntimeCommandRecord(
      database,
      DRIVER_INSTANCE_ID,
      "connection-1",
    );
    const storedFirst = await getRuntimeCommandRecord(
      database,
      DRIVER_INSTANCE_ID,
      COMMAND_IDS.first,
    );

    expect(first?.id).toBe(COMMAND_IDS.first);
    expect(first?.status).toBe("delivered");
    expect(second?.id).toBe(COMMAND_IDS.second);
    expect(second?.status).toBe("delivered");
    expect(empty).toBeNull();
    expect(storedFirst?.status).toBe("delivered");
  });

  test("does not deliver expired queued commands", async () => {
    const database = createRuntimeCommandDatabase();

    await createRuntimeCommandRecord(database, {
      command: inputStartCommand(COMMAND_IDS.expired),
      driverInstanceId: DRIVER_INSTANCE_ID,
      expiresAt: Date.now() - 1_000,
    });

    const claimed = await claimNextQueuedRuntimeCommandRecord(
      database,
      DRIVER_INSTANCE_ID,
      "connection-1",
    );
    const stored = await getRuntimeCommandRecord(database, DRIVER_INSTANCE_ID, COMMAND_IDS.expired);

    expect(claimed).toBeNull();
    expect(stored?.status).toBe("expired");
    expect(stored?.error?.code).toBe("driver.command_delivery_expired");
  });

  test("expires delivered commands that were not accepted before the lease elapsed", async () => {
    const database = createRuntimeCommandDatabase();

    await createRuntimeCommandRecord(database, {
      command: inputStartCommand(COMMAND_IDS.delivered),
      driverInstanceId: DRIVER_INSTANCE_ID,
      expiresAt: Date.now() + 60_000,
    });

    await markRuntimeCommandRecordDelivered(database, {
      commandId: COMMAND_IDS.accepted,
      connectionId: "connection-1",
      driverInstanceId: DRIVER_INSTANCE_ID,
    });
    database.execute(`
      UPDATE driver_command
      SET expires_at = ${Date.now() - 1_000}
      WHERE id = '${COMMAND_IDS.delivered}'
    `);

    const claimed = await claimNextQueuedRuntimeCommandRecord(
      database,
      DRIVER_INSTANCE_ID,
      "connection-1",
    );
    const stored = await getRuntimeCommandRecord(
      database,
      DRIVER_INSTANCE_ID,
      COMMAND_IDS.delivered,
    );

    expect(claimed).toBeNull();
    expect(stored?.status).toBe("expired");
    expect(stored?.ackedAt).toBeNull();
    expect(stored?.error?.code).toBe("driver.command_delivery_expired");
  });

  test("does not expire delivered commands after the driver accepts them", async () => {
    const database = createRuntimeCommandDatabase();

    await createRuntimeCommandRecord(database, {
      command: inputStartCommand(COMMAND_IDS.accepted),
      driverInstanceId: DRIVER_INSTANCE_ID,
      expiresAt: Date.now() + 60_000,
    });

    await markRuntimeCommandRecordDelivered(database, {
      commandId: COMMAND_IDS.accepted,
      connectionId: "connection-1",
      driverInstanceId: DRIVER_INSTANCE_ID,
    });
    await updateRuntimeCommandRecord(database, {
      commandId: COMMAND_IDS.accepted,
      deliveryConnectionId: "connection-1",
      driverInstanceId: DRIVER_INSTANCE_ID,
      status: "accepted",
    });
    database.execute(`
      UPDATE driver_command
      SET expires_at = ${Date.now() - 1_000}
      WHERE id = '${COMMAND_IDS.accepted}'
    `);

    const claimed = await claimNextQueuedRuntimeCommandRecord(
      database,
      DRIVER_INSTANCE_ID,
      "connection-1",
    );
    const stored = await getRuntimeCommandRecord(
      database,
      DRIVER_INSTANCE_ID,
      COMMAND_IDS.accepted,
    );

    expect(claimed).toBeNull();
    expect(stored?.status).toBe("accepted");
    expect(stored?.ackedAt).not.toBeNull();
    expect(stored?.error).toBeNull();
  });

  test("recovers commands delivered to stale connections", async () => {
    const database = createRuntimeCommandDatabase();

    await createRuntimeCommandRecord(database, {
      command: inputStartCommand(COMMAND_IDS.stale),
      driverInstanceId: DRIVER_INSTANCE_ID,
      expiresAt: Date.now() + 60_000,
    });

    await expect(
      markRuntimeCommandRecordDelivered(database, {
        commandId: COMMAND_IDS.stale,
        connectionId: "connection-1",
        driverInstanceId: DRIVER_INSTANCE_ID,
      }),
    ).resolves.toEqual({
      kind: "applied",
      status: "delivered",
    });
    database.execute(`
      UPDATE driver_instance
      SET connection_id = 'connection-2'
      WHERE id = '${DRIVER_INSTANCE_ID}'
    `);

    const claimed = await claimNextQueuedRuntimeCommandRecord(
      database,
      DRIVER_INSTANCE_ID,
      "connection-2",
    );

    expect(claimed?.id).toBe(COMMAND_IDS.stale);
    expect(claimed?.status).toBe("delivered");
  });

  test("returns typed command maintenance batch outcomes", async () => {
    const database = createRuntimeCommandDatabase();
    const nowMs = Date.now();

    await createRuntimeCommandRecord(database, {
      command: inputStartCommand(COMMAND_IDS.maintenanceExpired),
      driverInstanceId: DRIVER_INSTANCE_ID,
      expiresAt: nowMs - 1_000,
    });
    await createRuntimeCommandRecord(database, {
      command: inputStartCommand(COMMAND_IDS.maintenanceStale),
      driverInstanceId: DRIVER_INSTANCE_ID,
      expiresAt: nowMs + 60_000,
    });
    await expect(
      markRuntimeCommandRecordDelivered(database, {
        commandId: COMMAND_IDS.maintenanceStale,
        connectionId: "connection-1",
        driverInstanceId: DRIVER_INSTANCE_ID,
      }),
    ).resolves.toEqual({
      kind: "applied",
      status: "delivered",
    });
    database.execute(`
      UPDATE driver_instance
      SET connection_id = 'connection-2'
      WHERE id = '${DRIVER_INSTANCE_ID}'
    `);

    await expect(
      maintainRuntimeCommandRecords(database, {
        connectionId: "connection-2",
        driverInstanceId: DRIVER_INSTANCE_ID,
        nowMs,
      }),
    ).resolves.toEqual({
      expired: {
        appliedCount: 1,
        kind: "batch_applied",
        status: "expired",
      },
      recovered: {
        appliedCount: 1,
        kind: "batch_applied",
        status: "queued",
      },
    });

    const expired = await getRuntimeCommandRecord(
      database,
      DRIVER_INSTANCE_ID,
      COMMAND_IDS.maintenanceExpired,
    );
    const recovered = await getRuntimeCommandRecord(
      database,
      DRIVER_INSTANCE_ID,
      COMMAND_IDS.maintenanceStale,
    );

    expect(expired?.status).toBe("expired");
    expect(recovered?.status).toBe("queued");
  });

  test("recovers and expires commands globally without bypassing terminal orchestration", async () => {
    const database = createRuntimeCommandDatabase();
    const nowMs = Date.now();

    database.execute(`
      INSERT INTO driver_instance (id, connection_id, status)
      VALUES ('${TERMINAL_DRIVER_INSTANCE_ID}', 'terminal-connection', 'ready')
    `);
    await createRuntimeCommandRecord(database, {
      command: inputStartCommand(COMMAND_IDS.globalExpired),
      driverInstanceId: DRIVER_INSTANCE_ID,
      expiresAt: nowMs - 1_000,
    });
    await createRuntimeCommandRecord(database, {
      command: inputStartCommand(COMMAND_IDS.globalStale),
      driverInstanceId: DRIVER_INSTANCE_ID,
      expiresAt: nowMs + 60_000,
    });
    await createRuntimeCommandRecord(database, {
      command: sessionStopCommand(COMMAND_IDS.globalAccepted),
      driverInstanceId: TERMINAL_DRIVER_INSTANCE_ID,
      expiresAt: nowMs + 60_000,
    });
    await markRuntimeCommandRecordDelivered(database, {
      commandId: COMMAND_IDS.globalStale,
      connectionId: "connection-1",
      driverInstanceId: DRIVER_INSTANCE_ID,
    });
    await markRuntimeCommandRecordDelivered(database, {
      commandId: COMMAND_IDS.globalAccepted,
      connectionId: "terminal-connection",
      driverInstanceId: TERMINAL_DRIVER_INSTANCE_ID,
    });
    await updateRuntimeCommandRecord(database, {
      commandId: COMMAND_IDS.globalAccepted,
      deliveryConnectionId: "terminal-connection",
      driverInstanceId: TERMINAL_DRIVER_INSTANCE_ID,
      status: "accepted",
    });
    database.execute(`
      UPDATE driver_instance
      SET connection_id = 'connection-2'
      WHERE id = '${DRIVER_INSTANCE_ID}'
      ;
      UPDATE driver_instance
      SET status = 'stopped'
      WHERE id = '${TERMINAL_DRIVER_INSTANCE_ID}'
    `);

    const repair = await repairRuntimeCommandRecords(database, { nowMs });
    expect(repair).toEqual({
      expired: {
        appliedCount: 1,
        kind: "batch_applied",
        status: "expired",
      },
      recovered: {
        appliedCount: 1,
        kind: "batch_applied",
        status: "queued",
      },
    });

    await expect(
      getRuntimeCommandRecord(database, TERMINAL_DRIVER_INSTANCE_ID, COMMAND_IDS.globalAccepted),
    ).resolves.toMatchObject({ status: "accepted" });

    const expired = await getRuntimeCommandRecord(
      database,
      DRIVER_INSTANCE_ID,
      COMMAND_IDS.globalExpired,
    );
    const recovered = await getRuntimeCommandRecord(
      database,
      DRIVER_INSTANCE_ID,
      COMMAND_IDS.globalStale,
    );
    const pendingTerminalRepair = await getRuntimeCommandRecord(
      database,
      TERMINAL_DRIVER_INSTANCE_ID,
      COMMAND_IDS.globalAccepted,
    );

    expect(expired?.status).toBe("expired");
    expect(recovered?.status).toBe("queued");
    expect(pendingTerminalRepair?.status).toBe("accepted");
    expect(pendingTerminalRepair?.error).toBeNull();
  });

  test("expires undelivered input commands for one run", async () => {
    const database = createRuntimeCommandDatabase();
    const otherRunId = parsePlatformId<SessionRunId>("01J0000000000000000000000P");
    database.execute(`
      INSERT INTO session_run (driver_instance_id, id, status)
      VALUES ('${DRIVER_INSTANCE_ID}', '${otherRunId}', 'running')
    `);

    await createRuntimeCommandRecord(database, {
      command: inputStartCommand(COMMAND_IDS.currentRunQueued),
      driverInstanceId: DRIVER_INSTANCE_ID,
      expiresAt: Date.now() + 60_000,
    });
    await createRuntimeCommandRecord(database, {
      command: inputStartCommand(COMMAND_IDS.accepted),
      driverInstanceId: DRIVER_INSTANCE_ID,
      expiresAt: Date.now() + 60_000,
    });
    await createRuntimeCommandRecord(database, {
      command: {
        ...inputStartCommand(COMMAND_IDS.otherRunQueued),
        runId: otherRunId,
      },
      driverInstanceId: DRIVER_INSTANCE_ID,
      expiresAt: Date.now() + 60_000,
    });
    await markRuntimeCommandRecordDelivered(database, {
      commandId: COMMAND_IDS.accepted,
      connectionId: "connection-1",
      driverInstanceId: DRIVER_INSTANCE_ID,
    });
    await updateRuntimeCommandRecord(database, {
      commandId: COMMAND_IDS.accepted,
      deliveryConnectionId: "connection-1",
      driverInstanceId: DRIVER_INSTANCE_ID,
      status: "accepted",
    });

    await expect(
      expireUndeliveredInputStartCommandsForRun(database, {
        driverInstanceId: DRIVER_INSTANCE_ID,
        runId: SESSION_RUN_ID,
      }),
    ).resolves.toEqual({
      appliedCount: 1,
      kind: "batch_applied",
      status: "expired",
    });

    const expired = await getRuntimeCommandRecord(
      database,
      DRIVER_INSTANCE_ID,
      COMMAND_IDS.currentRunQueued,
    );
    const accepted = await getRuntimeCommandRecord(
      database,
      DRIVER_INSTANCE_ID,
      COMMAND_IDS.accepted,
    );
    const otherRun = await getRuntimeCommandRecord(
      database,
      DRIVER_INSTANCE_ID,
      COMMAND_IDS.otherRunQueued,
    );

    expect(expired?.status).toBe("expired");
    expect(accepted?.status).toBe("accepted");
    expect(otherRun?.status).toBe("queued");
  });

  test("does not mark commands delivered for stale connections", async () => {
    const database = createRuntimeCommandDatabase();

    await createRuntimeCommandRecord(database, {
      command: inputStartCommand(COMMAND_IDS.current),
      driverInstanceId: DRIVER_INSTANCE_ID,
      expiresAt: Date.now() + 60_000,
    });

    await expect(
      markRuntimeCommandRecordDelivered(database, {
        commandId: COMMAND_IDS.current,
        connectionId: "connection-old",
        driverInstanceId: DRIVER_INSTANCE_ID,
      }),
    ).resolves.toEqual({
      currentStatus: "queued",
      kind: "rejected",
      reason: "inactive_delivery_connection",
      targetStatus: "delivered",
    });

    const stored = await getRuntimeCommandRecord(database, DRIVER_INSTANCE_ID, COMMAND_IDS.current);

    expect(stored?.status).toBe("queued");
  });

  test("rejects delivered command claims from a different active connection", async () => {
    const database = createRuntimeCommandDatabase();

    await createRuntimeCommandRecord(database, {
      command: inputStartCommand(COMMAND_IDS.redelivery),
      driverInstanceId: DRIVER_INSTANCE_ID,
      expiresAt: Date.now() + 60_000,
    });
    await expect(
      markRuntimeCommandRecordDelivered(database, {
        commandId: COMMAND_IDS.redelivery,
        connectionId: "connection-1",
        driverInstanceId: DRIVER_INSTANCE_ID,
      }),
    ).resolves.toEqual({
      kind: "applied",
      status: "delivered",
    });
    database.execute(`
      UPDATE driver_instance
      SET connection_id = 'connection-2'
      WHERE id = '${DRIVER_INSTANCE_ID}'
    `);

    await expect(
      markRuntimeCommandRecordDelivered(database, {
        commandId: COMMAND_IDS.redelivery,
        connectionId: "connection-2",
        driverInstanceId: DRIVER_INSTANCE_ID,
      }),
    ).resolves.toEqual({
      currentStatus: "delivered",
      kind: "rejected",
      reason: "stale_delivery_connection",
      targetStatus: "delivered",
    });
  });

  test("rejects illegal command status rewrites after terminal completion", async () => {
    const database = createRuntimeCommandDatabase();

    await createRuntimeCommandRecord(database, {
      command: inputStartCommand(COMMAND_IDS.illegal),
      driverInstanceId: DRIVER_INSTANCE_ID,
      expiresAt: Date.now() + 60_000,
    });
    await claimNextQueuedRuntimeCommandRecord(database, DRIVER_INSTANCE_ID, "connection-1");
    insertInputTerminalFact(database, { status: "completed" });

    await expect(
      updateRuntimeCommandRecord(database, {
        commandId: COMMAND_IDS.illegal,
        deliveryConnectionId: "connection-1",
        driverInstanceId: DRIVER_INSTANCE_ID,
        result: { requestId: inputStartCommand(COMMAND_IDS.illegal).requestId },
        status: "completed",
      }),
    ).resolves.toEqual({
      kind: "applied",
      status: "completed",
    });

    await expect(
      updateRuntimeCommandRecord(database, {
        commandId: COMMAND_IDS.illegal,
        deliveryConnectionId: "connection-1",
        driverInstanceId: DRIVER_INSTANCE_ID,
        status: "accepted",
      }),
    ).resolves.toMatchObject({
      currentStatus: "completed",
      kind: "rejected",
      reason: "illegal_transition",
      targetStatus: "accepted",
    });

    const stored = await getRuntimeCommandRecord(database, DRIVER_INSTANCE_ID, COMMAND_IDS.illegal);

    expect(stored?.status).toBe("completed");
  });

  test("rejects command updates from stale delivery connections", async () => {
    const database = createRuntimeCommandDatabase();

    await createRuntimeCommandRecord(database, {
      command: inputStartCommand(COMMAND_IDS.staleUpdate),
      driverInstanceId: DRIVER_INSTANCE_ID,
      expiresAt: Date.now() + 60_000,
    });
    await claimNextQueuedRuntimeCommandRecord(database, DRIVER_INSTANCE_ID, "connection-1");

    await expect(
      updateRuntimeCommandRecord(database, {
        commandId: COMMAND_IDS.staleUpdate,
        deliveryConnectionId: "connection-2",
        driverInstanceId: DRIVER_INSTANCE_ID,
        status: "accepted",
      }),
    ).resolves.toMatchObject({
      currentStatus: "delivered",
      kind: "rejected",
      reason: "stale_delivery_connection",
      targetStatus: "accepted",
    });

    const stored = await getRuntimeCommandRecord(
      database,
      DRIVER_INSTANCE_ID,
      COMMAND_IDS.staleUpdate,
    );

    expect(stored?.status).toBe("delivered");
    expect(stored?.ackedAt).toBeNull();
  });
});
