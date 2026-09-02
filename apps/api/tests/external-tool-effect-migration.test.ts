import { describe, expect, test } from "bun:test";

import {
  RUNTIME_COMMAND_MAX_UTF8_BYTES,
  RUNTIME_COMMAND_TERMINAL_PAYLOAD_MAX_UTF8_BYTES,
  measureRuntimeCommandJson,
} from "@mosoo/contracts/runtime-command";
import type { DriverCommandId, DriverInstanceId, SessionRunId } from "@mosoo/id";

import {
  acquireProdDeployLeaseStatements,
  assertProdDeployLeaseOwned,
  PROD_DEPLOY_LEASE_TABLE,
} from "../bin/prod-deploy-lease";
import {
  assertProtocolV3LossyMigrationInventory,
  authorizeProtocolV3LegacyRewriteSql,
  ENABLE_PROTOCOL_V3_COMMAND_FREEZE_SQL,
  installProtocolV3CutoverSql,
  parseProtocolV3LossyMigrationInventory,
  parseProtocolV3LegacyTerminalIntegrity,
  PROTOCOL_V3_CUTOVER_OBJECT_COUNT,
  PROTOCOL_V3_CUTOVER_OBJECTS_SQL,
  PROTOCOL_V3_CUTOVER_TABLE,
  PROTOCOL_V3_LEGACY_TERMINAL_INTEGRITY_SQL,
  PROTOCOL_V3_LOSSY_MIGRATION_INVENTORY_SQL,
  REMOVE_PROTOCOL_V3_CUTOVER_SQL,
  storeProtocolV3CutoverBookmarkSql,
} from "../bin/protocol-v3-cutover";
import {
  createRuntimeCommandRecord,
  getRuntimeCommandRecord,
  getRuntimeCommandStorageRecord,
  updateRuntimeCommandRecord,
} from "../src/modules/runtime/infrastructure/session-runs/runtime-command-store.repository";
import {
  applyDrizzleMigrationAsync as applyMigration,
  applyDrizzleMigrationsThrough,
} from "./helpers/drizzle-migrations";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const OLD_V2_PAYLOAD_MAX_UTF8_BYTES = 1024 * 1024;
const RELEASE_TREE_OID = "0123456789abcdef0123456789abcdef01234567";
const INSTALL_PROTOCOL_V3_CUTOVER_SQL = installProtocolV3CutoverSql(RELEASE_TREE_OID);

const EFFECT_UNKNOWN_ID = "01J0000000000000000000001A";
const EFFECT_SUCCEEDED_ID = "01J0000000000000000000001B";
const COMMAND_UNKNOWN_ID = "01J0000000000000000000001C" as DriverCommandId;
const DRIVER_ID = "01J0000000000000000000001D" as DriverInstanceId;
const SERVER_ID = "01J0000000000000000000001E";
const RUN_ID = "01J0000000000000000000001F" as SessionRunId;
const COMMAND_SUCCEEDED_ID = "01J0000000000000000000001G" as DriverCommandId;
const SESSION_ID = "01J0000000000000000000001H";
const AGENT_ID = "01J0000000000000000000001J";
const ACCOUNT_ID = "01J0000000000000000000001K";
const PROJECT_ID = "01J0000000000000000000001M";
const SANDBOX_ID = "01J0000000000000000000001N";
const SANDBOX_SESSION_ID = "01J0000000000000000000001P";
const COMMAND_ERROR_ID = "01J0000000000000000000001Q" as DriverCommandId;
const COMMAND_CANONICAL_BOUNDARY_ID = "01J0000000000000000000001R" as DriverCommandId;
const EFFECT_CANONICAL_BOUNDARY_ID = "01J0000000000000000000001S";
const EFFECT_PROVIDER_RECEIPT_ID = "01J0000000000000000000001T";
const COMMAND_PROVIDER_RECEIPT_ID = "01J0000000000000000000001V" as DriverCommandId;
const COMMAND_CONTROL_ID = "01J0000000000000000000001W" as DriverCommandId;
const COMMAND_PERMISSION_ID = "01J0000000000000000000001X" as DriverCommandId;
const COMMAND_GENERATION_SEVEN_ID = "01J0000000000000000000001Y" as DriverCommandId;
const COMMAND_GENERATION_EIGHT_ID = "01J0000000000000000000001Z" as DriverCommandId;
const LEGACY_MESSAGE_ID = "01J00000000000000000000020";
const LEGACY_TERMINAL_EVENT_ID = "01J00000000000000000000021";
const V3_REFERENCE_MESSAGE_ID = "01J00000000000000000000022";
const DEPLOY_OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_DEPLOY_OWNER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const utf8Encoder = new TextEncoder();

function jsonAtUtf8Size<Value>(
  targetBytes: number,
  createValue: (padding: string) => Value,
): string {
  const empty = JSON.stringify(createValue(""));
  const paddingBytes = targetBytes - utf8Encoder.encode(empty).byteLength;
  if (paddingBytes < 0) {
    throw new Error("JSON fixture base exceeds its requested byte size.");
  }

  const value = JSON.stringify(createValue("x".repeat(paddingBytes)));
  if (utf8Encoder.encode(value).byteLength !== targetBytes) {
    throw new Error("JSON fixture did not reach its requested UTF-8 byte size.");
  }
  return value;
}

function padJsonObjectToUtf8Size(value: string, targetBytes: number): string {
  if (!value.endsWith("}")) throw new Error("JSON fixture must be an object.");
  const paddingBytes = targetBytes - utf8Encoder.encode(value).byteLength;
  if (paddingBytes < 0) throw new Error("JSON fixture base exceeds its requested byte size.");
  const padded = `${value.slice(0, -1)}${" ".repeat(paddingBytes)}}`;
  if (utf8Encoder.encode(padded).byteLength !== targetBytes) {
    throw new Error("JSON fixture did not reach its requested UTF-8 byte size.");
  }
  return padded;
}

async function readLegacyTerminalIntegrity(database: SqliteD1Database) {
  const integrityRow = await database
    .prepare(PROTOCOL_V3_LEGACY_TERMINAL_INTEGRITY_SQL)
    .first<Record<string, unknown>>();
  return parseProtocolV3LegacyTerminalIntegrity(
    JSON.stringify([{ results: [integrityRow], success: true }]),
  );
}

async function readLossyMigrationInventory(database: SqliteD1Database) {
  const row = await database
    .prepare(PROTOCOL_V3_LOSSY_MIGRATION_INVENTORY_SQL)
    .first<Record<string, unknown>>();
  if (row === null) throw new Error("Lossy migration inventory returned no row.");
  return parseProtocolV3LossyMigrationInventory(
    JSON.stringify([{ results: [row], success: true }]),
  );
}

function installLegacyRewriteAuthorizationInfrastructure(database: SqliteD1Database): void {
  database.execute(INSTALL_PROTOCOL_V3_CUTOVER_SQL);
  database.execute(ENABLE_PROTOCOL_V3_COMMAND_FREEZE_SQL);
  database.execute(storeProtocolV3CutoverBookmarkSql("test-bookmark"));
  for (const statement of acquireProdDeployLeaseStatements(DEPLOY_OWNER)) {
    database.execute(statement);
  }
}

async function authorizeLegacyTerminalRewrite(database: SqliteD1Database): Promise<void> {
  installLegacyRewriteAuthorizationInfrastructure(database);
  const integrity = await readLegacyTerminalIntegrity(database);
  database.execute(
    authorizeProtocolV3LegacyRewriteSql(
      DEPLOY_OWNER,
      integrity.noncanonicalTerminalSources,
      integrity.rewriteCandidateManifestJson,
    ),
  );
}

async function createV2Database(): Promise<SqliteD1Database> {
  const database = new SqliteD1Database();
  applyDrizzleMigrationsThrough(database, "0013_agent-task-snapshot-state");

  return database;
}

async function insertV2Owners(database: SqliteD1Database): Promise<void> {
  database.execute(`
    INSERT INTO driver_instance (
      boot_token_expires_at, boot_token_hash, created_at, expires_at,
      heartbeat_count, id, protocol, protocol_version, runtime, sandbox_id,
      sandbox_session_id, status, updated_at
    ) VALUES (
      1000, x'01', 1, 1000, 0, '${DRIVER_ID}', 'rpc', 2, 'codex',
      '${SANDBOX_ID}', '${SANDBOX_SESSION_ID}', 'failed', 10
    );

    INSERT INTO session (
      agent_id, created_at, creator_account_id, id, kind, model, project_id,
      provider, renamed, runtime_id, status, updated_at
    ) VALUES (
      '${AGENT_ID}', 1, '${ACCOUNT_ID}', '${SESSION_ID}', 'agent', 'model',
      '${PROJECT_ID}', 'provider', 0, 'codex', 'TERMINATED', 10
    );

    INSERT INTO session_run (
      agent_id, completed_at, created_at, created_by_account_id,
      driver_instance_id, error_code, error_details_json, error_message, id,
      session_id, status, trace_id, trigger, updated_at
    ) VALUES (
      '${AGENT_ID}', 10, 1, '${ACCOUNT_ID}', '${DRIVER_ID}', NULL, NULL, NULL,
      '${RUN_ID}', '${SESSION_ID}', 'failed', 'trace-1', 'user_prompt', 10
    );
  `);
}

async function insertLegacySessionTerminal(
  database: SqliteD1Database,
  input: {
    eventId: string;
    eventType: "run.cancelled" | "run.completed" | "run.failed";
    runId?: string;
    seq?: number;
    sessionId?: string;
    sourceEventId: string;
  },
): Promise<void> {
  await database
    .prepare(
      `INSERT INTO session_event (
        agent_id, content_text, created_at, ended_at, event_type, family, id,
        occurred_at, process_status, process_type, run_id, seq, session_id,
        source_event_id, source, visibility
      ) VALUES (?, ?, 3, 3, ?, 'run', ?, 3, 'available', ?, ?, ?, ?, ?, 'api', 'all_consumers')`,
    )
    .bind(
      AGENT_ID,
      input.eventType,
      input.eventType,
      input.eventId,
      input.eventType,
      input.runId ?? RUN_ID,
      input.seq ?? 1,
      input.sessionId ?? SESSION_ID,
      input.sourceEventId,
    )
    .run();
}

async function insertV2Command(
  database: SqliteD1Database,
  input: {
    errorJson?: string | null;
    id: DriverCommandId;
    kind: string;
    payloadJson: string;
    resultJson?: string | null;
    seq: number;
    status: string;
  },
): Promise<void> {
  await database
    .prepare(
      `INSERT INTO driver_command (
        acked_at, completed_at, driver_instance_id, error_json, id, issued_at,
        kind, payload_json, result_json, seq, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      2,
      3,
      DRIVER_ID,
      input.errorJson ?? null,
      input.id,
      1,
      input.kind,
      input.payloadJson,
      input.resultJson ?? null,
      input.seq,
      input.status,
    )
    .run();
}

async function insertV2Effect(
  database: SqliteD1Database,
  input: {
    commandId: DriverCommandId;
    effectId: string;
    providerReceiptJson?: string | null;
    resultJson: string | null;
    status: "executing" | "succeeded";
    toolName: string;
  },
): Promise<void> {
  await database
    .prepare(
      `INSERT INTO external_tool_effect (
        attempt_count, command_id, created_at, driver_instance_id, id,
        idempotency_key, provider_receipt_json, result_json, server_id,
        session_run_id, status, tool_name, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      1,
      input.commandId,
      1,
      DRIVER_ID,
      input.effectId,
      input.effectId,
      input.providerReceiptJson === undefined
        ? input.status === "succeeded"
          ? '{"receipt":"legacy"}'
          : null
        : input.providerReceiptJson,
      input.resultJson,
      SERVER_ID,
      RUN_ID,
      input.status,
      input.toolName,
      2,
    )
    .run();
}

async function readMigratedEffectState(
  database: SqliteD1Database,
  commandId: DriverCommandId,
): Promise<Record<string, unknown>> {
  const row = await database
    .prepare("SELECT id, result_json, status FROM external_tool_effect WHERE command_id = ?")
    .bind(commandId)
    .first<{ id: string; result_json: string | null; status: string }>();
  if (row === null) {
    throw new Error("Migrated external tool effect was not found.");
  }

  return row.status === "succeeded"
    ? { effectId: row.id, kind: row.status, result: JSON.parse(row.result_json ?? "null") }
    : { effectId: row.id, kind: row.status };
}

async function insertV2Attempt(
  database: SqliteD1Database,
  input: {
    effectId: string;
    providerReceiptJson?: string | null;
    resultJson: string | null;
    status: "executing" | "succeeded";
  },
): Promise<void> {
  await database
    .prepare(
      `INSERT INTO external_tool_effect_attempt (
        attempt, completed_at, created_at, effect_id, provider_receipt_json,
        result_json, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      1,
      input.status === "succeeded" ? 3 : null,
      2,
      input.effectId,
      input.providerReceiptJson === undefined
        ? input.status === "succeeded"
          ? '{"receipt":"legacy"}'
          : null
        : input.providerReceiptJson,
      input.resultJson,
      input.status,
    )
    .run();
}

async function expectV2MigrationRejection(
  seed: (database: SqliteD1Database) => Promise<void>,
): Promise<SqliteD1Database> {
  const database = await createV2Database();
  await insertV2Owners(database);
  await seed(database);
  await expect(applyMigration(database, "0014_durable-mcp-effect-v3")).rejects.toThrow();
  return database;
}

describe("durable MCP effect v3 migration", () => {
  test("rejects every lossy v2 rewrite before changing schema or history", async () => {
    const database = await createV2Database();
    await insertV2Owners(database);

    const unknownPayloadJson = jsonAtUtf8Size(OLD_V2_PAYLOAD_MAX_UTF8_BYTES, (argumentsJson) => ({
      argumentsJson,
      commandId: COMMAND_UNKNOWN_ID,
      kind: "mcp.execute",
      requestId: "legacy-unknown-request",
      serverId: SERVER_ID,
      toolCallId: "legacy-unknown-tool-call",
      toolName: "createIssue",
    }));
    await insertV2Command(database, {
      id: COMMAND_UNKNOWN_ID,
      kind: "mcp.execute",
      payloadJson: unknownPayloadJson,
      seq: 1,
      status: "failed",
    });
    await insertV2Effect(database, {
      commandId: COMMAND_UNKNOWN_ID,
      effectId: EFFECT_UNKNOWN_ID,
      resultJson: null,
      status: "executing",
      toolName: "createIssue",
    });
    await insertV2Attempt(database, {
      effectId: EFFECT_UNKNOWN_ID,
      resultJson: null,
      status: "executing",
    });

    const succeededPayloadJson = jsonAtUtf8Size(
      RUNTIME_COMMAND_MAX_UTF8_BYTES + 1,
      (argumentsJson) => ({
        argumentsJson,
        commandId: COMMAND_SUCCEEDED_ID,
        kind: "mcp.execute",
        requestId: "legacy-succeeded-request",
        serverId: SERVER_ID,
        toolCallId: "legacy-succeeded-tool-call",
        toolName: "createIssue",
      }),
    );
    const historicalToolName = "createIssue";
    const createSucceededResult = (targetBytes: number) =>
      jsonAtUtf8Size(targetBytes, (outputText) => ({
        outputText,
        requestId: "legacy-succeeded-request",
        serverId: SERVER_ID,
        toolName: historicalToolName,
      }));
    const effectResultJson = createSucceededResult(OLD_V2_PAYLOAD_MAX_UTF8_BYTES);
    const attemptResultJson = createSucceededResult(OLD_V2_PAYLOAD_MAX_UTF8_BYTES - 1);
    const commandResultJson = createSucceededResult(OLD_V2_PAYLOAD_MAX_UTF8_BYTES - 2);
    await insertV2Command(database, {
      id: COMMAND_SUCCEEDED_ID,
      kind: "mcp.execute",
      payloadJson: succeededPayloadJson,
      resultJson: commandResultJson,
      seq: 2,
      status: "completed",
    });
    await insertV2Effect(database, {
      commandId: COMMAND_SUCCEEDED_ID,
      effectId: EFFECT_SUCCEEDED_ID,
      resultJson: effectResultJson,
      status: "succeeded",
      toolName: historicalToolName,
    });
    await insertV2Attempt(database, {
      effectId: EFFECT_SUCCEEDED_ID,
      resultJson: attemptResultJson,
      status: "succeeded",
    });

    const canonicalBoundaryPayloadJson = jsonAtUtf8Size(
      RUNTIME_COMMAND_MAX_UTF8_BYTES + 1,
      (argumentsJson) => ({
        argumentsJson,
        commandId: COMMAND_CANONICAL_BOUNDARY_ID,
        kind: "mcp.execute",
        requestId: "legacy-boundary-request",
        serverId: SERVER_ID,
        toolCallId: "legacy-boundary-tool-call",
        toolName: "createIssue",
      }),
    );
    const canonicalBoundaryResultJson = jsonAtUtf8Size(
      RUNTIME_COMMAND_TERMINAL_PAYLOAD_MAX_UTF8_BYTES,
      (outputText) => ({
        outputText,
        requestId: "legacy-boundary-request",
        serverId: SERVER_ID,
        toolName: "createIssue",
      }),
    );
    await insertV2Command(database, {
      errorJson: JSON.stringify({
        code: "legacy.finalization_race",
        details: {},
        message: "The old finalizer raced the durable effect.",
        retryable: false,
      }),
      id: COMMAND_CANONICAL_BOUNDARY_ID,
      kind: "mcp.execute",
      payloadJson: canonicalBoundaryPayloadJson,
      resultJson: canonicalBoundaryResultJson,
      seq: 3,
      status: "failed",
    });
    await insertV2Effect(database, {
      commandId: COMMAND_CANONICAL_BOUNDARY_ID,
      effectId: EFFECT_CANONICAL_BOUNDARY_ID,
      resultJson: canonicalBoundaryResultJson,
      status: "succeeded",
      toolName: "createIssue",
    });
    await insertV2Attempt(database, {
      effectId: EFFECT_CANONICAL_BOUNDARY_ID,
      resultJson: canonicalBoundaryResultJson,
      status: "succeeded",
    });

    const providerReceiptResult = JSON.stringify({
      outputText: "provider response",
      requestId: "legacy-provider-request",
      serverId: SERVER_ID,
      toolName: "createIssue",
    });
    const oversizedProviderReceipt = "x".repeat(RUNTIME_COMMAND_TERMINAL_PAYLOAD_MAX_UTF8_BYTES);
    await insertV2Command(database, {
      id: COMMAND_PROVIDER_RECEIPT_ID,
      kind: "mcp.execute",
      payloadJson: JSON.stringify({
        argumentsJson: "{}",
        commandId: COMMAND_PROVIDER_RECEIPT_ID,
        kind: "mcp.execute",
        requestId: "legacy-provider-request",
        serverId: SERVER_ID,
        toolCallId: "legacy-provider-tool-call",
        toolName: "createIssue",
      }),
      resultJson: providerReceiptResult,
      seq: 4,
      status: "completed",
    });
    await insertV2Effect(database, {
      commandId: COMMAND_PROVIDER_RECEIPT_ID,
      effectId: EFFECT_PROVIDER_RECEIPT_ID,
      providerReceiptJson: oversizedProviderReceipt,
      resultJson: providerReceiptResult,
      status: "succeeded",
      toolName: "createIssue",
    });
    await insertV2Attempt(database, {
      effectId: EFFECT_PROVIDER_RECEIPT_ID,
      providerReceiptJson: oversizedProviderReceipt,
      resultJson: providerReceiptResult,
      status: "succeeded",
    });

    const commandErrorJson = jsonAtUtf8Size(OLD_V2_PAYLOAD_MAX_UTF8_BYTES, (context) => ({
      code: "legacy.command_error",
      details: { context },
      message: "Legacy command failed.",
      retryable: false,
    }));
    await insertV2Command(database, {
      errorJson: commandErrorJson,
      id: COMMAND_ERROR_ID,
      kind: "input.start",
      payloadJson: JSON.stringify({
        commandId: COMMAND_ERROR_ID,
        input: { text: "hello" },
        kind: "input.start",
        requestId: "legacy-input-request",
        runId: RUN_ID,
      }),
      seq: 5,
      status: "failed",
    });
    await insertV2Command(database, {
      id: COMMAND_CONTROL_ID,
      kind: "turn.cancel",
      payloadJson: JSON.stringify({ commandId: COMMAND_CONTROL_ID, kind: "turn.cancel" }),
      resultJson: "null",
      seq: 6,
      status: "completed",
    });
    await insertV2Command(database, {
      id: COMMAND_PERMISSION_ID,
      kind: "permission.resolve",
      payloadJson: JSON.stringify({
        commandId: COMMAND_PERMISSION_ID,
        decision: "allow_once",
        kind: "permission.resolve",
        requestId: "legacy-permission-request",
      }),
      seq: 7,
      status: "completed",
    });

    const sessionErrorJson = jsonAtUtf8Size(OLD_V2_PAYLOAD_MAX_UTF8_BYTES, (context) => ({
      code: "legacy.session_error",
      details: { context },
      message: "Legacy Session Run failed.",
      retryable: false,
    }));
    const sessionError = JSON.parse(sessionErrorJson) as {
      code: string;
      details: Record<string, string>;
      message: string;
    };
    await database
      .prepare(
        "UPDATE session_run SET error_code = ?, error_details_json = ?, error_message = ? WHERE id = ?",
      )
      .bind(sessionError.code, JSON.stringify(sessionError.details), sessionError.message, RUN_ID)
      .run();

    // The same Driver instance may have been reused after these terminal commands.
    // Its current generation is not evidence of the historical command generation.
    await database
      .prepare("UPDATE driver_instance SET generation = ? WHERE id = ?")
      .bind(7, DRIVER_ID)
      .run();

    const inventory = await readLossyMigrationInventory(database);
    expect(inventory).toEqual({
      attemptCompletionTimeFabrications: 0,
      candidateIds: [
        { category: "command_error_omission", id: COMMAND_ERROR_ID },
        { category: "mcp_argument_omission", id: COMMAND_UNKNOWN_ID },
        { category: "mcp_argument_omission", id: COMMAND_SUCCEEDED_ID },
        { category: "mcp_argument_omission", id: COMMAND_CANONICAL_BOUNDARY_ID },
        { category: "mcp_command_terminal_conflict", id: EFFECT_CANONICAL_BOUNDARY_ID },
        { category: "mcp_result_omission", id: EFFECT_SUCCEEDED_ID },
        { category: "mcp_result_omission", id: EFFECT_CANONICAL_BOUNDARY_ID },
        { category: "provider_receipt_loss", id: EFFECT_PROVIDER_RECEIPT_ID },
        { category: "session_run_error_omission", id: RUN_ID },
      ],
      commandErrorOmissions: 1,
      commandPayloadConflicts: 0,
      controlReasonOmissions: 0,
      inputStartResultOmissions: 0,
      inputTextOmissions: 0,
      mcpArgumentOmissions: 3,
      mcpCommandTerminalConflicts: 1,
      mcpResultConflicts: 0,
      mcpResultOmissions: 2,
      orphanEffects: 0,
      providerReceiptLosses: 1,
      permissionPayloadRewrites: 0,
      sessionRunErrorOmissions: 1,
      totalCandidates: 9,
    });
    expect(() => assertProtocolV3LossyMigrationInventory(inventory)).toThrow(
      "No lossy migration candidates are authorized",
    );

    await expect(applyMigration(database, "0014_durable-mcp-effect-v3")).rejects.toThrow();

    await expect(
      database
        .prepare("SELECT payload_json FROM driver_command WHERE id = ?")
        .bind(COMMAND_UNKNOWN_ID)
        .first(),
    ).resolves.toEqual({ payload_json: unknownPayloadJson });
    await expect(
      database
        .prepare("SELECT error_json FROM driver_command WHERE id = ?")
        .bind(COMMAND_ERROR_ID)
        .first(),
    ).resolves.toEqual({ error_json: commandErrorJson });
    await expect(
      database
        .prepare("SELECT provider_receipt_json FROM external_tool_effect WHERE id = ?")
        .bind(EFFECT_PROVIDER_RECEIPT_ID)
        .first(),
    ).resolves.toEqual({ provider_receipt_json: oversizedProviderReceipt });
    await expect(
      database
        .prepare(
          "SELECT error_code, error_details_json, error_message FROM session_run WHERE id = ?",
        )
        .bind(RUN_ID)
        .first(),
    ).resolves.toEqual({
      error_code: sessionError.code,
      error_details_json: JSON.stringify(sessionError.details),
      error_message: sessionError.message,
    });
    await expect(
      database
        .prepare(
          "SELECT count(*) AS count FROM pragma_table_info('driver_command') WHERE name = 'driver_generation'",
        )
        .first(),
    ).resolves.toEqual({ count: 0 });
  });

  test("rejects a real v2 database with an old-limit nonterminal command", async () => {
    const database = await createV2Database();
    await insertV2Owners(database);
    const payloadJson = jsonAtUtf8Size(OLD_V2_PAYLOAD_MAX_UTF8_BYTES, (text) => ({
      commandId: COMMAND_ERROR_ID,
      input: { text },
      kind: "input.start",
      requestId: "legacy-input-request",
      runId: RUN_ID,
    }));
    await insertV2Command(database, {
      id: COMMAND_ERROR_ID,
      kind: "input.start",
      payloadJson,
      seq: 1,
      status: "accepted",
    });
    await expect(
      database
        .prepare("SELECT COUNT(*) AS count FROM driver_command WHERE status = 'accepted'")
        .first(),
    ).resolves.toEqual({ count: 1 });
    await expect(database.prepare("PRAGMA ignore_check_constraints").first()).resolves.toEqual({
      ignore_check_constraints: 0,
    });

    await expect(applyMigration(database, "0014_durable-mcp-effect-v3")).rejects.toThrow();
    await expect(
      database
        .prepare("SELECT payload_json, status FROM driver_command WHERE id = ?")
        .bind(COMMAND_ERROR_ID)
        .first(),
    ).resolves.toEqual({ payload_json: payloadJson, status: "accepted" });
  });

  test("rejects an orphan effect before its inner-join rebuild can delete it", async () => {
    const database = new SqliteD1Database({ foreignKeys: false });
    applyDrizzleMigrationsThrough(database, "0013_agent-task-snapshot-state");
    await database
      .prepare(
        `INSERT INTO external_tool_effect (
          attempt_count, command_id, created_at, driver_instance_id, id,
          idempotency_key, provider_receipt_json, result_json, server_id,
          session_run_id, status, tool_name, updated_at
        ) VALUES (0, ?, 1, ?, ?, ?, NULL, NULL, ?, ?, 'intent', 'createIssue', 2)`,
      )
      .bind(COMMAND_UNKNOWN_ID, DRIVER_ID, EFFECT_UNKNOWN_ID, EFFECT_UNKNOWN_ID, SERVER_ID, RUN_ID)
      .run();
    database.execute("PRAGMA foreign_keys = ON");
    await expect(database.prepare("PRAGMA foreign_keys").first()).resolves.toEqual({
      foreign_keys: 1,
    });

    const inventory = await readLossyMigrationInventory(database);
    expect(inventory.orphanEffects).toBe(1);
    expect(inventory.candidateIds).toEqual([{ category: "orphan_effect", id: EFFECT_UNKNOWN_ID }]);
    await expect(applyMigration(database, "0014_durable-mcp-effect-v3")).rejects.toThrow();
    await expect(
      database
        .prepare("SELECT command_id, status FROM external_tool_effect WHERE id = ?")
        .bind(EFFECT_UNKNOWN_ID)
        .first(),
    ).resolves.toEqual({ command_id: COMMAND_UNKNOWN_ID, status: "intent" });
  });

  test("rejects missing terminal attempt times instead of fabricating migration time", async () => {
    for (const status of ["succeeded", "unknown"] as const) {
      const database = await createV2Database();
      await insertV2Owners(database);
      const payloadJson = JSON.stringify({
        argumentsJson: "{}",
        commandId: COMMAND_SUCCEEDED_ID,
        kind: "mcp.execute",
        requestId: "legacy-request",
        serverId: SERVER_ID,
        toolCallId: "legacy-tool-call",
        toolName: "createIssue",
      });
      const resultJson =
        status === "succeeded"
          ? JSON.stringify({
              outputText: "done",
              requestId: "legacy-request",
              serverId: SERVER_ID,
              toolName: "createIssue",
            })
          : null;
      await insertV2Command(database, {
        id: COMMAND_SUCCEEDED_ID,
        kind: "mcp.execute",
        payloadJson,
        resultJson,
        seq: 1,
        status: status === "succeeded" ? "completed" : "failed",
      });
      await insertV2Effect(database, {
        commandId: COMMAND_SUCCEEDED_ID,
        effectId: EFFECT_SUCCEEDED_ID,
        providerReceiptJson: status === "succeeded" ? '{"receipt":"legacy"}' : null,
        resultJson,
        status: status === "succeeded" ? "succeeded" : "executing",
        toolName: "createIssue",
      });
      await insertV2Attempt(database, {
        effectId: EFFECT_SUCCEEDED_ID,
        providerReceiptJson: status === "succeeded" ? '{"receipt":"legacy"}' : null,
        resultJson,
        status: status === "succeeded" ? "succeeded" : "executing",
      });
      await database
        .prepare("UPDATE external_tool_effect SET status = ? WHERE id = ?")
        .bind(status, EFFECT_SUCCEEDED_ID)
        .run();
      await database
        .prepare(
          "UPDATE external_tool_effect_attempt SET completed_at = NULL, status = ? WHERE effect_id = ?",
        )
        .bind(status, EFFECT_SUCCEEDED_ID)
        .run();

      const inventory = await readLossyMigrationInventory(database);
      expect(inventory.attemptCompletionTimeFabrications).toBe(1);
      expect(inventory.candidateIds).toEqual([
        { category: "attempt_completion_time_fabrication", id: EFFECT_SUCCEEDED_ID },
      ]);
      await expect(applyMigration(database, "0014_durable-mcp-effect-v3")).rejects.toThrow();
      await expect(
        database
          .prepare(
            "SELECT completed_at, status FROM external_tool_effect_attempt WHERE effect_id = ?",
          )
          .bind(EFFECT_SUCCEEDED_ID)
          .first(),
      ).resolves.toEqual({ completed_at: null, status });
    }
  });

  test("keeps the executing-to-unknown transition time monotonic", async () => {
    const database = await createV2Database();
    await insertV2Owners(database);
    await insertV2Command(database, {
      id: COMMAND_UNKNOWN_ID,
      kind: "mcp.execute",
      payloadJson: JSON.stringify({
        argumentsJson: "{}",
        commandId: COMMAND_UNKNOWN_ID,
        kind: "mcp.execute",
        requestId: "legacy-request",
        serverId: SERVER_ID,
        toolCallId: "legacy-tool-call",
        toolName: "createIssue",
      }),
      seq: 1,
      status: "failed",
    });
    await insertV2Effect(database, {
      commandId: COMMAND_UNKNOWN_ID,
      effectId: EFFECT_UNKNOWN_ID,
      providerReceiptJson: null,
      resultJson: null,
      status: "executing",
      toolName: "createIssue",
    });
    await insertV2Attempt(database, {
      effectId: EFFECT_UNKNOWN_ID,
      providerReceiptJson: null,
      resultJson: null,
      status: "executing",
    });
    const futureTimestamp = 9_007_199_254_740_000;
    await database
      .prepare("UPDATE external_tool_effect SET updated_at = ? WHERE id = ?")
      .bind(futureTimestamp, EFFECT_UNKNOWN_ID)
      .run();
    await database
      .prepare("UPDATE external_tool_effect_attempt SET created_at = ? WHERE effect_id = ?")
      .bind(futureTimestamp, EFFECT_UNKNOWN_ID)
      .run();
    const inventory = await readLossyMigrationInventory(database);
    expect(inventory.totalCandidates).toBe(0);

    await applyMigration(database, "0014_durable-mcp-effect-v3");
    const transition = await database
      .prepare(
        `SELECT
          "attempt"."completed_at",
          "attempt"."status" AS "attempt_status",
          "effect"."status" AS "effect_status",
          "effect"."updated_at"
        FROM "external_tool_effect_attempt" AS "attempt"
        INNER JOIN "external_tool_effect" AS "effect" ON "effect"."id" = "attempt"."effect_id"
        WHERE "attempt"."effect_id" = ?`,
      )
      .bind(EFFECT_UNKNOWN_ID)
      .first();
    expect(transition).toEqual({
      attempt_status: "unknown",
      completed_at: futureTimestamp,
      effect_status: "unknown",
      updated_at: futureTimestamp,
    });
  });

  test("keeps legacy terminal history separate from two new Driver generations", async () => {
    const database = await createV2Database();
    await insertV2Owners(database);
    await insertV2Command(database, {
      id: COMMAND_CONTROL_ID,
      kind: "turn.cancel",
      payloadJson: JSON.stringify({ commandId: COMMAND_CONTROL_ID, kind: "turn.cancel" }),
      seq: 1,
      status: "completed",
    });
    database.execute(`
      UPDATE session
      SET runtime_event_seq_cursor = 1
      WHERE id = '${SESSION_ID}';
      UPDATE session_run
      SET error_code = 'legacy.failed',
          error_details_json = '{}',
          error_message = 'Legacy failure.',
          status_event = 'run.fail'
      WHERE id = '${RUN_ID}';
    `);
    await insertLegacySessionTerminal(database, {
      eventId: LEGACY_TERMINAL_EVENT_ID,
      eventType: "run.failed",
      sourceEventId: `session-run-terminal:${RUN_ID}:run.failed`,
    });
    const inventory = await readLossyMigrationInventory(database);
    expect(inventory.totalCandidates).toBe(0);
    expect(() => assertProtocolV3LossyMigrationInventory(inventory)).not.toThrow();
    await applyMigration(database, "0014_durable-mcp-effect-v3");
    await applyMigration(database, "0015_session-event-stream-identity");
    await database
      .prepare(
        "UPDATE driver_instance SET command_seq_cursor = 10, connection_id = ?, generation = 7, status = 'ready' WHERE id = ?",
      )
      .bind("generation-7", DRIVER_ID)
      .run();
    await database
      .prepare("UPDATE session_run SET completed_at = NULL, status = 'running' WHERE id = ?")
      .bind(RUN_ID)
      .run();

    await createRuntimeCommandRecord(database, {
      command: {
        commandId: COMMAND_GENERATION_SEVEN_ID,
        kind: "turn.cancel",
        reason: "generation seven",
        runId: RUN_ID,
      },
      driverGeneration: 7,
      driverInstanceId: DRIVER_ID,
      status: "accepted",
    });
    await updateRuntimeCommandRecord(database, {
      commandId: COMMAND_GENERATION_SEVEN_ID,
      driverGeneration: 7,
      driverInstanceId: DRIVER_ID,
      status: "cancelled",
    });
    await database
      .prepare("UPDATE driver_instance SET connection_id = ?, generation = 8 WHERE id = ?")
      .bind("generation-8", DRIVER_ID)
      .run();
    await createRuntimeCommandRecord(database, {
      command: {
        commandId: COMMAND_GENERATION_EIGHT_ID,
        input: { text: "generation eight" },
        kind: "input.start",
        requestId: "generation-8-request",
        runId: RUN_ID,
      },
      driverGeneration: 8,
      driverInstanceId: DRIVER_ID,
    });

    await expect(
      getRuntimeCommandStorageRecord(database, DRIVER_ID, COMMAND_CONTROL_ID),
    ).resolves.toMatchObject({ driverGeneration: null, format: "legacy-v2-terminal" });
    await expect(
      getRuntimeCommandRecord(database, DRIVER_ID, 7, COMMAND_GENERATION_SEVEN_ID),
    ).resolves.toMatchObject({ status: "cancelled" });
    await expect(
      getRuntimeCommandRecord(database, DRIVER_ID, 8, COMMAND_GENERATION_SEVEN_ID),
    ).resolves.toBeNull();
    await expect(
      getRuntimeCommandRecord(database, DRIVER_ID, 8, COMMAND_GENERATION_EIGHT_ID),
    ).resolves.toMatchObject({ status: "queued" });
    await expect(
      updateRuntimeCommandRecord(database, {
        commandId: COMMAND_GENERATION_SEVEN_ID,
        driverGeneration: 8,
        driverInstanceId: DRIVER_ID,
        status: "failed",
      }),
    ).resolves.toMatchObject({ kind: "rejected", reason: "command_not_found" });
    await expect(
      database
        .prepare(
          "SELECT driver_generation, status FROM driver_command ORDER BY driver_generation, id",
        )
        .all(),
    ).resolves.toMatchObject({
      results: [
        { driver_generation: null, status: "completed" },
        { driver_generation: 7, status: "cancelled" },
        { driver_generation: 8, status: "queued" },
      ],
    });
  });

  test("preserves bounded MCP identities without inventing a 256-byte contract", async () => {
    const database = await createV2Database();
    await insertV2Owners(database);
    const toolName = "t".repeat(300);
    const payloadJson = JSON.stringify({
      argumentsJson: "{}",
      commandId: COMMAND_SUCCEEDED_ID,
      kind: "mcp.execute",
      requestId: "legacy-request",
      serverId: SERVER_ID,
      toolCallId: "legacy-tool-call",
      toolName,
    });
    const result = {
      outputText: "done",
      requestId: "legacy-request",
      serverId: SERVER_ID,
      toolName,
    };
    const resultJson = JSON.stringify(result);
    await insertV2Command(database, {
      id: COMMAND_SUCCEEDED_ID,
      kind: "mcp.execute",
      payloadJson,
      resultJson,
      seq: 1,
      status: "completed",
    });
    await insertV2Effect(database, {
      commandId: COMMAND_SUCCEEDED_ID,
      effectId: EFFECT_SUCCEEDED_ID,
      resultJson,
      status: "succeeded",
      toolName,
    });
    await insertV2Attempt(database, {
      effectId: EFFECT_SUCCEEDED_ID,
      resultJson,
      status: "succeeded",
    });

    await applyMigration(database, "0014_durable-mcp-effect-v3");

    await expect(readMigratedEffectState(database, COMMAND_SUCCEEDED_ID)).resolves.toEqual({
      effectId: EFFECT_SUCCEEDED_ID,
      kind: "succeeded",
      result,
    });
    const command = await getRuntimeCommandStorageRecord(database, DRIVER_ID, COMMAND_SUCCEEDED_ID);
    expect(command?.record).toMatchObject({ payload: { toolName }, result: { toolName } });
    expect(measureRuntimeCommandJson(command?.record.payload)).toBeLessThanOrEqual(
      RUNTIME_COMMAND_MAX_UTF8_BYTES,
    );
  });

  test("rejects an identity-only oversized MCP record instead of replacing its identity", async () => {
    const payloadJson = jsonAtUtf8Size(RUNTIME_COMMAND_MAX_UTF8_BYTES + 1, (requestId) => ({
      argumentsJson: "{}",
      commandId: COMMAND_UNKNOWN_ID,
      kind: "mcp.execute",
      requestId,
      serverId: SERVER_ID,
      toolCallId: "legacy-tool-call",
      toolName: "createIssue",
    }));
    const database = await expectV2MigrationRejection(async (fixture) => {
      await insertV2Command(fixture, {
        id: COMMAND_UNKNOWN_ID,
        kind: "mcp.execute",
        payloadJson,
        seq: 1,
        status: "failed",
      });
      await insertV2Effect(fixture, {
        commandId: COMMAND_UNKNOWN_ID,
        effectId: EFFECT_UNKNOWN_ID,
        resultJson: null,
        status: "executing",
        toolName: "createIssue",
      });
      await insertV2Attempt(fixture, {
        effectId: EFFECT_UNKNOWN_ID,
        resultJson: null,
        status: "executing",
      });
    });

    await expect(
      database
        .prepare("SELECT payload_json FROM driver_command WHERE id = ?")
        .bind(COMMAND_UNKNOWN_ID)
        .first(),
    ).resolves.toEqual({ payload_json: payloadJson });
  });

  test("rejects oversized input text without changing attachments or Run identity", async () => {
    const payloadJson = jsonAtUtf8Size(RUNTIME_COMMAND_MAX_UTF8_BYTES + 1, (text) => ({
      commandId: COMMAND_ERROR_ID,
      input: { attachmentIds: ["file-1", "file-2"], text },
      kind: "input.start",
      requestId: "legacy-input-request",
      runId: RUN_ID,
    }));
    const database = await createV2Database();
    await insertV2Owners(database);
    await insertV2Command(database, {
      id: COMMAND_ERROR_ID,
      kind: "input.start",
      payloadJson,
      seq: 1,
      status: "failed",
    });

    const inventory = await readLossyMigrationInventory(database);
    expect(inventory.inputTextOmissions).toBe(1);
    expect(inventory.candidateIds).toEqual([
      { category: "input_text_omission", id: COMMAND_ERROR_ID },
    ]);
    await expect(applyMigration(database, "0014_durable-mcp-effect-v3")).rejects.toThrow();

    await expect(
      database
        .prepare("SELECT payload_json FROM driver_command WHERE id = ?")
        .bind(COMMAND_ERROR_ID)
        .first(),
    ).resolves.toEqual({ payload_json: payloadJson });
  });

  test("rejects an oversized input result even when its command payload is bounded", async () => {
    const resultJson = jsonAtUtf8Size(
      RUNTIME_COMMAND_TERMINAL_PAYLOAD_MAX_UTF8_BYTES + 1,
      (requestId) => ({ requestId }),
    );
    const database = await createV2Database();
    await insertV2Owners(database);
    await insertV2Command(database, {
      id: COMMAND_ERROR_ID,
      kind: "input.start",
      payloadJson: JSON.stringify({
        commandId: COMMAND_ERROR_ID,
        input: { text: "hello" },
        kind: "input.start",
        requestId: "legacy-input-request",
        runId: RUN_ID,
      }),
      resultJson,
      seq: 1,
      status: "completed",
    });

    const inventory = await readLossyMigrationInventory(database);
    expect(inventory.inputStartResultOmissions).toBe(1);
    expect(inventory.candidateIds).toEqual([
      { category: "input_start_result_omission", id: COMMAND_ERROR_ID },
    ]);
    await expect(applyMigration(database, "0014_durable-mcp-effect-v3")).rejects.toThrow();
    await expect(
      database
        .prepare("SELECT result_json FROM driver_command WHERE id = ?")
        .bind(COMMAND_ERROR_ID)
        .first(),
    ).resolves.toEqual({ result_json: resultJson });
  });

  test("rejects oversized control reasons instead of replacing them", async () => {
    const database = await createV2Database();
    await insertV2Owners(database);
    const fixtures = [
      { id: COMMAND_CONTROL_ID, kind: "turn.cancel" },
      { id: COMMAND_PERMISSION_ID, kind: "session.stop" },
    ] as const;
    for (const [index, fixture] of fixtures.entries()) {
      await insertV2Command(database, {
        id: fixture.id,
        kind: fixture.kind,
        payloadJson: jsonAtUtf8Size(RUNTIME_COMMAND_MAX_UTF8_BYTES + 1, (reason) => ({
          commandId: fixture.id,
          kind: fixture.kind,
          reason,
        })),
        seq: index + 1,
        status: "failed",
      });
    }

    const inventory = await readLossyMigrationInventory(database);
    expect(inventory.controlReasonOmissions).toBe(2);
    expect(inventory.candidateIds).toEqual([
      { category: "control_reason_omission", id: COMMAND_CONTROL_ID },
      { category: "control_reason_omission", id: COMMAND_PERMISSION_ID },
    ]);
    await expect(applyMigration(database, "0014_durable-mcp-effect-v3")).rejects.toThrow();
  });

  test("rejects duplicate command payload keys before SQLite can choose a different copy", async () => {
    const database = await createV2Database();
    await insertV2Owners(database);
    const inputPayloadJson = `{"commandId":"${COMMAND_ERROR_ID}","input":{"text":"first","text":"last"},"kind":"input.start","requestId":"legacy-input-request","runId":"${RUN_ID}"}`;
    const permissionPayloadJson = padJsonObjectToUtf8Size(
      `{"commandId":"${COMMAND_PERMISSION_ID}","decision":"allow_once","decision":"reject_once","kind":"permission.resolve","requestId":"legacy-permission-request"}`,
      RUNTIME_COMMAND_MAX_UTF8_BYTES + 1,
    );
    expect(JSON.parse(inputPayloadJson)).toMatchObject({ input: { text: "last" } });
    expect(JSON.parse(permissionPayloadJson)).toMatchObject({ decision: "reject_once" });

    await insertV2Command(database, {
      id: COMMAND_ERROR_ID,
      kind: "input.start",
      payloadJson: inputPayloadJson,
      seq: 1,
      status: "failed",
    });
    await insertV2Command(database, {
      id: COMMAND_PERMISSION_ID,
      kind: "permission.resolve",
      payloadJson: permissionPayloadJson,
      seq: 2,
      status: "completed",
    });

    const inventory = await readLossyMigrationInventory(database);
    expect(inventory.commandPayloadConflicts).toBe(2);
    expect(inventory.permissionPayloadRewrites).toBe(1);
    expect(inventory.candidateIds).toEqual([
      { category: "command_payload_conflict", id: COMMAND_ERROR_ID },
      { category: "command_payload_conflict", id: COMMAND_PERMISSION_ID },
      { category: "permission_payload_rewrite", id: COMMAND_PERMISSION_ID },
    ]);
    await expect(applyMigration(database, "0014_durable-mcp-effect-v3")).rejects.toThrow();
    await expect(
      database
        .prepare("SELECT payload_json FROM driver_command WHERE id = ?")
        .bind(COMMAND_ERROR_ID)
        .first(),
    ).resolves.toEqual({ payload_json: inputPayloadJson });
    await expect(
      database
        .prepare("SELECT payload_json FROM driver_command WHERE id = ?")
        .bind(COMMAND_PERMISSION_ID)
        .first(),
    ).resolves.toEqual({ payload_json: permissionPayloadJson });
  });

  test("rejects duplicate MCP result keys before SQLite can erase JS-visible conflicts", async () => {
    const database = await createV2Database();
    await insertV2Owners(database);
    const payloadJson = JSON.stringify({
      argumentsJson: "{}",
      commandId: COMMAND_SUCCEEDED_ID,
      kind: "mcp.execute",
      requestId: "legacy-request",
      serverId: SERVER_ID,
      toolCallId: "legacy-tool-call",
      toolName: "createIssue",
    });
    const result = (lastOutput: string) =>
      `{"outputText":"shared-first","outputText":"${lastOutput}","requestId":"legacy-request","serverId":"${SERVER_ID}","toolName":"createIssue"}`;
    const commandResultJson = result("command-last");
    const effectResultJson = result("effect-last");
    const attemptResultJson = result("attempt-last");

    await insertV2Command(database, {
      id: COMMAND_SUCCEEDED_ID,
      kind: "mcp.execute",
      payloadJson,
      resultJson: commandResultJson,
      seq: 1,
      status: "completed",
    });
    await insertV2Effect(database, {
      commandId: COMMAND_SUCCEEDED_ID,
      effectId: EFFECT_SUCCEEDED_ID,
      resultJson: effectResultJson,
      status: "succeeded",
      toolName: "createIssue",
    });
    await insertV2Attempt(database, {
      effectId: EFFECT_SUCCEEDED_ID,
      resultJson: attemptResultJson,
      status: "succeeded",
    });

    const inventory = await readLossyMigrationInventory(database);
    expect(inventory.mcpResultConflicts).toBe(1);
    expect(inventory.candidateIds).toEqual([
      { category: "mcp_result_conflict", id: EFFECT_SUCCEEDED_ID },
    ]);
    await expect(applyMigration(database, "0014_durable-mcp-effect-v3")).rejects.toThrow();
    expect(JSON.parse(commandResultJson)).toMatchObject({ outputText: "command-last" });
    expect(JSON.parse(effectResultJson)).toMatchObject({ outputText: "effect-last" });
    expect(JSON.parse(attemptResultJson)).toMatchObject({ outputText: "attempt-last" });
    await expect(
      database
        .prepare("SELECT result_json FROM driver_command WHERE id = ?")
        .bind(COMMAND_SUCCEEDED_ID)
        .first(),
    ).resolves.toEqual({ result_json: commandResultJson });
    await expect(
      database
        .prepare("SELECT result_json FROM external_tool_effect WHERE id = ?")
        .bind(EFFECT_SUCCEEDED_ID)
        .first(),
    ).resolves.toEqual({ result_json: effectResultJson });
    await expect(
      database
        .prepare("SELECT result_json FROM external_tool_effect_attempt WHERE effect_id = ?")
        .bind(EFFECT_SUCCEEDED_ID)
        .first(),
    ).resolves.toEqual({ result_json: attemptResultJson });
  });

  test("preserves the authoritative MCP result without a SQLite JSON round trip", async () => {
    const database = await createV2Database();
    await insertV2Owners(database);
    const payloadJson = JSON.stringify({
      argumentsJson: "{}",
      commandId: COMMAND_SUCCEEDED_ID,
      kind: "mcp.execute",
      requestId: "legacy-request",
      serverId: SERVER_ID,
      toolCallId: "legacy-tool-call",
      toolName: "createIssue",
    });
    const resultJson = JSON.stringify({
      outputText: "\ud800",
      requestId: "legacy-request",
      serverId: SERVER_ID,
      toolName: "createIssue",
    });
    expect((JSON.parse(resultJson) as { outputText: string }).outputText.charCodeAt(0)).toBe(
      0xd800,
    );
    await insertV2Command(database, {
      id: COMMAND_SUCCEEDED_ID,
      kind: "mcp.execute",
      payloadJson,
      resultJson,
      seq: 1,
      status: "completed",
    });
    await insertV2Effect(database, {
      commandId: COMMAND_SUCCEEDED_ID,
      effectId: EFFECT_SUCCEEDED_ID,
      resultJson,
      status: "succeeded",
      toolName: "createIssue",
    });
    await insertV2Attempt(database, {
      effectId: EFFECT_SUCCEEDED_ID,
      resultJson,
      status: "succeeded",
    });
    expect((await readLossyMigrationInventory(database)).totalCandidates).toBe(0);

    await applyMigration(database, "0014_durable-mcp-effect-v3");
    for (const [table, predicate] of [
      ["driver_command", "id"],
      ["external_tool_effect", "id"],
      ["external_tool_effect_attempt", "effect_id"],
    ] as const) {
      const row = await database
        .prepare(`SELECT result_json FROM ${table} WHERE ${predicate} = ?`)
        .bind(table === "driver_command" ? COMMAND_SUCCEEDED_ID : EFFECT_SUCCEEDED_ID)
        .first<{ result_json: string }>();
      expect(row?.result_json).toBe(resultJson);
      expect(
        (JSON.parse(row?.result_json ?? "null") as { outputText: string }).outputText.charCodeAt(0),
      ).toBe(0xd800);
    }
  });

  test("rejects conflicting MCP result and provider-receipt histories", async () => {
    const database = await createV2Database();
    await insertV2Owners(database);
    const payloadJson = JSON.stringify({
      argumentsJson: "{}",
      commandId: COMMAND_SUCCEEDED_ID,
      kind: "mcp.execute",
      requestId: "legacy-request",
      serverId: SERVER_ID,
      toolCallId: "legacy-tool-call",
      toolName: "createIssue",
    });
    const result = (outputText: string) =>
      JSON.stringify({
        outputText,
        requestId: "legacy-request",
        serverId: SERVER_ID,
        toolName: "createIssue",
      });
    await insertV2Command(database, {
      id: COMMAND_SUCCEEDED_ID,
      kind: "mcp.execute",
      payloadJson,
      resultJson: result("command"),
      seq: 1,
      status: "completed",
    });
    await insertV2Effect(database, {
      commandId: COMMAND_SUCCEEDED_ID,
      effectId: EFFECT_SUCCEEDED_ID,
      providerReceiptJson: "effect-receipt",
      resultJson: result("effect"),
      status: "succeeded",
      toolName: "createIssue",
    });
    await insertV2Attempt(database, {
      effectId: EFFECT_SUCCEEDED_ID,
      providerReceiptJson: "attempt-receipt",
      resultJson: result("attempt"),
      status: "succeeded",
    });

    const inventory = await readLossyMigrationInventory(database);
    expect(inventory.mcpResultConflicts).toBe(1);
    expect(inventory.providerReceiptLosses).toBe(1);
    expect(inventory.candidateIds).toEqual([
      { category: "mcp_result_conflict", id: EFFECT_SUCCEEDED_ID },
      { category: "provider_receipt_loss", id: EFFECT_SUCCEEDED_ID },
    ]);
    await expect(applyMigration(database, "0014_durable-mcp-effect-v3")).rejects.toThrow();
  });

  test("rejects result and receipt data attached to an unsettled MCP effect", async () => {
    const database = await createV2Database();
    await insertV2Owners(database);
    const resultJson = JSON.stringify({
      outputText: "unsettled output",
      requestId: "legacy-request",
      serverId: SERVER_ID,
      toolName: "createIssue",
    });
    await insertV2Command(database, {
      id: COMMAND_UNKNOWN_ID,
      kind: "mcp.execute",
      payloadJson: JSON.stringify({
        argumentsJson: "{}",
        commandId: COMMAND_UNKNOWN_ID,
        kind: "mcp.execute",
        requestId: "legacy-request",
        serverId: SERVER_ID,
        toolCallId: "legacy-tool-call",
        toolName: "createIssue",
      }),
      seq: 1,
      status: "failed",
    });
    await insertV2Effect(database, {
      commandId: COMMAND_UNKNOWN_ID,
      effectId: EFFECT_UNKNOWN_ID,
      providerReceiptJson: "unsettled-effect-receipt",
      resultJson,
      status: "executing",
      toolName: "createIssue",
    });
    await insertV2Attempt(database, {
      effectId: EFFECT_UNKNOWN_ID,
      providerReceiptJson: "unsettled-attempt-receipt",
      resultJson,
      status: "executing",
    });

    const inventory = await readLossyMigrationInventory(database);
    expect(inventory.mcpResultConflicts).toBe(1);
    expect(inventory.providerReceiptLosses).toBe(1);
    await expect(applyMigration(database, "0014_durable-mcp-effect-v3")).rejects.toThrow();
  });

  test("rejects a real v2 terminal MCP command without its effect fence", async () => {
    const database = await createV2Database();
    await insertV2Owners(database);
    const payloadJson = JSON.stringify({
      argumentsJson: "{}",
      commandId: COMMAND_UNKNOWN_ID,
      kind: "mcp.execute",
      requestId: "legacy-request",
      serverId: SERVER_ID,
      toolCallId: "legacy-tool-call",
      toolName: "createIssue",
    });
    await insertV2Command(database, {
      id: COMMAND_UNKNOWN_ID,
      kind: "mcp.execute",
      payloadJson,
      seq: 1,
      status: "failed",
    });
    await expect(
      database
        .prepare(
          "SELECT COUNT(*) AS count FROM driver_command AS command WHERE command.kind = 'mcp.execute' AND NOT EXISTS (SELECT 1 FROM external_tool_effect AS effect WHERE effect.command_id = command.id)",
        )
        .first(),
    ).resolves.toEqual({ count: 1 });

    await expect(applyMigration(database, "0014_durable-mcp-effect-v3")).rejects.toThrow();
    await expect(
      database
        .prepare("SELECT payload_json FROM driver_command WHERE id = ?")
        .bind(COMMAND_UNKNOWN_ID)
        .first(),
    ).resolves.toEqual({ payload_json: payloadJson });
  });

  test("rejects an oversized source error with non-primitive details before omission", async () => {
    const errorJson = jsonAtUtf8Size(OLD_V2_PAYLOAD_MAX_UTF8_BYTES, (padding) => ({
      code: "legacy.invalid_error",
      details: { nested: { padding } },
      message: "Invalid legacy error.",
      retryable: false,
    }));
    const database = await expectV2MigrationRejection(async (fixture) => {
      await insertV2Command(fixture, {
        errorJson,
        id: COMMAND_ERROR_ID,
        kind: "input.start",
        payloadJson: JSON.stringify({
          commandId: COMMAND_ERROR_ID,
          input: { text: "hello" },
          kind: "input.start",
          requestId: "legacy-input-request",
          runId: RUN_ID,
        }),
        seq: 1,
        status: "failed",
      });
    });

    await expect(
      database
        .prepare("SELECT error_json FROM driver_command WHERE id = ?")
        .bind(COMMAND_ERROR_ID)
        .first(),
    ).resolves.toEqual({ error_json: errorJson });
  });

  test("rejects one malformed MCP result copy before authoritative synchronization", async () => {
    const payloadJson = JSON.stringify({
      argumentsJson: "{}",
      commandId: COMMAND_SUCCEEDED_ID,
      kind: "mcp.execute",
      requestId: "legacy-request",
      serverId: SERVER_ID,
      toolCallId: "legacy-tool-call",
      toolName: "createIssue",
    });
    const validResultJson = JSON.stringify({
      outputText: "done",
      requestId: "legacy-request",
      serverId: SERVER_ID,
      toolName: "createIssue",
    });
    const invalidAttemptResultJson = JSON.stringify({
      requestId: "legacy-request",
      serverId: SERVER_ID,
      toolName: "createIssue",
    });
    const database = await expectV2MigrationRejection(async (fixture) => {
      await insertV2Command(fixture, {
        id: COMMAND_SUCCEEDED_ID,
        kind: "mcp.execute",
        payloadJson,
        resultJson: validResultJson,
        seq: 1,
        status: "completed",
      });
      await insertV2Effect(fixture, {
        commandId: COMMAND_SUCCEEDED_ID,
        effectId: EFFECT_SUCCEEDED_ID,
        resultJson: validResultJson,
        status: "succeeded",
        toolName: "createIssue",
      });
      await insertV2Attempt(fixture, {
        effectId: EFFECT_SUCCEEDED_ID,
        resultJson: invalidAttemptResultJson,
        status: "succeeded",
      });
    });

    await expect(
      database
        .prepare("SELECT result_json FROM external_tool_effect_attempt WHERE effect_id = ?")
        .bind(EFFECT_SUCCEEDED_ID)
        .first(),
    ).resolves.toEqual({ result_json: invalidAttemptResultJson });
  });

  test("rejects undeclared MCP result fields before authoritative synchronization", async () => {
    const payloadJson = JSON.stringify({
      argumentsJson: "{}",
      commandId: COMMAND_SUCCEEDED_ID,
      kind: "mcp.execute",
      requestId: "legacy-request",
      serverId: SERVER_ID,
      toolCallId: "legacy-tool-call",
      toolName: "createIssue",
    });
    const resultJson = JSON.stringify({
      debug: "provider-specific data must not enter the public result",
      outputText: "done",
      requestId: "legacy-request",
      serverId: SERVER_ID,
      toolName: "createIssue",
    });
    await expectV2MigrationRejection(async (fixture) => {
      await insertV2Command(fixture, {
        id: COMMAND_SUCCEEDED_ID,
        kind: "mcp.execute",
        payloadJson,
        resultJson,
        seq: 1,
        status: "completed",
      });
      await insertV2Effect(fixture, {
        commandId: COMMAND_SUCCEEDED_ID,
        effectId: EFFECT_SUCCEEDED_ID,
        resultJson,
        status: "succeeded",
        toolName: "createIssue",
      });
      await insertV2Attempt(fixture, {
        effectId: EFFECT_SUCCEEDED_ID,
        resultJson,
        status: "succeeded",
      });
    });
  });

  test("rejects a missing input Run identity instead of fabricating one", async () => {
    const payloadJson = jsonAtUtf8Size(OLD_V2_PAYLOAD_MAX_UTF8_BYTES, (text) => ({
      commandId: COMMAND_ERROR_ID,
      input: { text },
      kind: "input.start",
      requestId: "legacy-input-request",
    }));
    await expectV2MigrationRejection(async (fixture) => {
      await insertV2Command(fixture, {
        id: COMMAND_ERROR_ID,
        kind: "input.start",
        payloadJson,
        seq: 1,
        status: "failed",
      });
    });
  });

  test("rejects empty input attachment identities that Driver cannot execute", async () => {
    await expectV2MigrationRejection(async (fixture) => {
      await insertV2Command(fixture, {
        id: COMMAND_ERROR_ID,
        kind: "input.start",
        payloadJson: JSON.stringify({
          commandId: COMMAND_ERROR_ID,
          input: { attachmentIds: [""], text: "hello" },
          kind: "input.start",
          requestId: "legacy-input-request",
          runId: RUN_ID,
        }),
        seq: 1,
        status: "failed",
      });
    });
  });

  test("rejects an invalid effect attempt audit instead of inventing a current claim", async () => {
    const payloadJson = JSON.stringify({
      argumentsJson: "{}",
      commandId: COMMAND_UNKNOWN_ID,
      kind: "mcp.execute",
      requestId: "legacy-request",
      serverId: SERVER_ID,
      toolCallId: "legacy-tool-call",
      toolName: "createIssue",
    });
    await expectV2MigrationRejection(async (fixture) => {
      await insertV2Command(fixture, {
        id: COMMAND_UNKNOWN_ID,
        kind: "mcp.execute",
        payloadJson,
        seq: 1,
        status: "failed",
      });
      await insertV2Effect(fixture, {
        commandId: COMMAND_UNKNOWN_ID,
        effectId: EFFECT_UNKNOWN_ID,
        resultJson: null,
        status: "executing",
        toolName: "createIssue",
      });
      await insertV2Attempt(fixture, {
        effectId: EFFECT_UNKNOWN_ID,
        resultJson: null,
        status: "executing",
      });
      await fixture
        .prepare("UPDATE external_tool_effect SET attempt_count = 2 WHERE id = ?")
        .bind(EFFECT_UNKNOWN_ID)
        .run();
    });
  });

  test("rejects a completed command whose effect remains unknown", async () => {
    const payloadJson = JSON.stringify({
      argumentsJson: "{}",
      commandId: COMMAND_UNKNOWN_ID,
      kind: "mcp.execute",
      requestId: "legacy-request",
      serverId: SERVER_ID,
      toolCallId: "legacy-tool-call",
      toolName: "createIssue",
    });
    const resultJson = JSON.stringify({
      outputText: "unproven",
      requestId: "legacy-request",
      serverId: SERVER_ID,
      toolName: "createIssue",
    });
    await expectV2MigrationRejection(async (fixture) => {
      await insertV2Command(fixture, {
        id: COMMAND_UNKNOWN_ID,
        kind: "mcp.execute",
        payloadJson,
        resultJson,
        seq: 1,
        status: "completed",
      });
      await insertV2Effect(fixture, {
        commandId: COMMAND_UNKNOWN_ID,
        effectId: EFFECT_UNKNOWN_ID,
        resultJson: null,
        status: "executing",
        toolName: "createIssue",
      });
      await insertV2Attempt(fixture, {
        effectId: EFFECT_UNKNOWN_ID,
        resultJson: null,
        status: "executing",
      });
    });
  });

  test("rejects nested Session Run error details before oversized repair", async () => {
    await expectV2MigrationRejection(async (fixture) => {
      await fixture
        .prepare(
          "UPDATE session_run SET error_code = ?, error_details_json = ?, error_message = ? WHERE id = ?",
        )
        .bind(
          "legacy.invalid_session_error",
          JSON.stringify({ nested: { invalid: true } }),
          "Invalid Session Run error.",
          RUN_ID,
        )
        .run();
    });
  });

  test("rejects missing permission decisions and RunError retryability", async () => {
    await expectV2MigrationRejection(async (fixture) => {
      await insertV2Command(fixture, {
        errorJson: JSON.stringify({
          code: "legacy.missing_retryable",
          details: {},
          message: "Missing retryability.",
        }),
        id: COMMAND_ERROR_ID,
        kind: "permission.resolve",
        payloadJson: JSON.stringify({
          commandId: COMMAND_ERROR_ID,
          kind: "permission.resolve",
          requestId: "legacy-permission-request",
        }),
        seq: 1,
        status: "failed",
      });
    });
  });
});

describe("session event v3 migration", () => {
  test("leaves the canonical deploy lease table on a direct no-candidate migration", async () => {
    const database = await createV2Database();
    await applyMigration(database, "0014_durable-mcp-effect-v3");
    await applyMigration(database, "0015_session-event-stream-identity");

    const results = await database.batch(
      acquireProdDeployLeaseStatements(DEPLOY_OWNER).map((sql) => database.prepare(sql)),
    );
    expect(() => assertProdDeployLeaseOwned(JSON.stringify(results), DEPLOY_OWNER)).not.toThrow();
  });

  for (const fixture of [
    { eventType: "run.completed", status: "completed", statusEvent: "run.complete" },
    { eventType: "run.cancelled", status: "cancelled", statusEvent: "run.cancel" },
    { eventType: "run.failed", status: "failed", statusEvent: "run.fail" },
  ] as const) {
    test(`normalizes a provider-source ${fixture.eventType} through the exact cutover gate`, async () => {
      const database = await createV2Database();
      await insertV2Owners(database);
      await database
        .prepare(
          `UPDATE session_run
           SET error_code = ?,
               error_details_json = ?,
               error_message = ?,
               status = ?,
               status_event = ?
           WHERE id = ?`,
        )
        .bind(
          fixture.status === "failed" ? "legacy.failed" : null,
          fixture.status === "failed" ? "{}" : null,
          fixture.status === "failed" ? "Legacy failure." : null,
          fixture.status,
          fixture.statusEvent,
          RUN_ID,
        )
        .run();
      database.execute(
        `UPDATE session SET runtime_event_seq_cursor = 1 WHERE id = '${SESSION_ID}'`,
      );
      await insertLegacySessionTerminal(database, {
        eventId: LEGACY_TERMINAL_EVENT_ID,
        eventType: fixture.eventType,
        sourceEventId: `provider-${fixture.status}-event`,
      });

      await applyMigration(database, "0014_durable-mcp-effect-v3");
      await authorizeLegacyTerminalRewrite(database);
      await applyMigration(database, "0015_session-event-stream-identity");

      await expect(database.prepare(PROTOCOL_V3_CUTOVER_OBJECTS_SQL).first()).resolves.toEqual({
        exact_object_count: PROTOCOL_V3_CUTOVER_OBJECT_COUNT,
        object_count: PROTOCOL_V3_CUTOVER_OBJECT_COUNT,
      });

      await expect(
        database
          .prepare(
            "SELECT count(*) AS count FROM sqlite_master WHERE name = '__protocol_v3_legacy_rewrite_authorization'",
          )
          .first(),
      ).resolves.toEqual({ count: 0 });

      await expect(
        database
          .prepare("SELECT id, semantic_hash, seq, source_event_id FROM session_event WHERE id = ?")
          .bind(LEGACY_TERMINAL_EVENT_ID)
          .first(),
      ).resolves.toEqual({
        id: LEGACY_TERMINAL_EVENT_ID,
        semantic_hash: null,
        seq: 1,
        source_event_id: `session-run-terminal:${RUN_ID}:${fixture.eventType}`,
      });
    });
  }

  test("rejects an otherwise valid provider-source rewrite without deploy authorization", async () => {
    const database = await createV2Database();
    await insertV2Owners(database);
    database.execute(`
      UPDATE session SET runtime_event_seq_cursor = 1 WHERE id = '${SESSION_ID}';
      UPDATE session_run
      SET error_code = NULL, error_details_json = NULL, error_message = NULL,
          status = 'completed', status_event = 'run.complete'
      WHERE id = '${RUN_ID}';
    `);
    await insertLegacySessionTerminal(database, {
      eventId: LEGACY_TERMINAL_EVENT_ID,
      eventType: "run.completed",
      sourceEventId: "provider-completed-event",
    });
    await applyMigration(database, "0014_durable-mcp-effect-v3");

    await expect(applyMigration(database, "0015_session-event-stream-identity")).rejects.toThrow();
    await expect(
      database
        .prepare("SELECT source_event_id FROM session_event WHERE id = ?")
        .bind(LEGACY_TERMINAL_EVENT_ID)
        .first(),
    ).resolves.toEqual({ source_event_id: "provider-completed-event" });
  });

  test("does not authorize a candidate set that changed after the integrity preflight", async () => {
    const database = await createV2Database();
    await insertV2Owners(database);
    database.execute(`
      UPDATE session SET runtime_event_seq_cursor = 1 WHERE id = '${SESSION_ID}';
      UPDATE session_run
      SET error_code = NULL, error_details_json = NULL, error_message = NULL,
          status = 'completed', status_event = 'run.complete'
      WHERE id = '${RUN_ID}';
    `);
    await insertLegacySessionTerminal(database, {
      eventId: LEGACY_TERMINAL_EVENT_ID,
      eventType: "run.completed",
      sourceEventId: "provider-completed-event",
    });
    await applyMigration(database, "0014_durable-mcp-effect-v3");
    const integrity = await readLegacyTerminalIntegrity(database);
    installLegacyRewriteAuthorizationInfrastructure(database);

    database.execute(
      `UPDATE session_event SET source_event_id = 'provider-changed-event' WHERE id = '${LEGACY_TERMINAL_EVENT_ID}'`,
    );
    database.execute(
      authorizeProtocolV3LegacyRewriteSql(
        DEPLOY_OWNER,
        integrity.noncanonicalTerminalSources,
        integrity.rewriteCandidateManifestJson,
      ),
    );

    await expect(
      database
        .prepare(
          "SELECT count(*) AS count FROM __protocol_v3_legacy_rewrite_authorization WHERE id = 1",
        )
        .first(),
    ).resolves.toEqual({ count: 0 });
    await expect(applyMigration(database, "0015_session-event-stream-identity")).rejects.toThrow();
  });

  test("revokes stale authorization when a retry no longer proves the frozen gate", async () => {
    const database = await createV2Database();
    await insertV2Owners(database);
    database.execute(`
      UPDATE session SET runtime_event_seq_cursor = 1 WHERE id = '${SESSION_ID}';
      UPDATE session_run
      SET error_code = NULL, error_details_json = NULL, error_message = NULL,
          status = 'completed', status_event = 'run.complete'
      WHERE id = '${RUN_ID}';
    `);
    await insertLegacySessionTerminal(database, {
      eventId: LEGACY_TERMINAL_EVENT_ID,
      eventType: "run.completed",
      sourceEventId: "provider-completed-event",
    });
    await applyMigration(database, "0014_durable-mcp-effect-v3");
    installLegacyRewriteAuthorizationInfrastructure(database);
    const integrity = await readLegacyTerminalIntegrity(database);
    const authorizationSql = authorizeProtocolV3LegacyRewriteSql(
      DEPLOY_OWNER,
      integrity.noncanonicalTerminalSources,
      integrity.rewriteCandidateManifestJson,
    );
    database.execute(authorizationSql);
    database.execute(`UPDATE "${PROTOCOL_V3_CUTOVER_TABLE}" SET "command_freeze" = 0`);
    database.execute(authorizationSql);

    await expect(
      database
        .prepare(
          "SELECT count(*) AS count FROM __protocol_v3_legacy_rewrite_authorization WHERE id = 1",
        )
        .first(),
    ).resolves.toEqual({ count: 0 });
    await expect(applyMigration(database, "0015_session-event-stream-identity")).rejects.toThrow();
  });

  for (const fixture of [
    {
      authorizationRemains: true,
      label: "the authorized candidate identity changes",
      mutate: (database: SqliteD1Database) =>
        database.execute(
          `UPDATE session_event SET source_event_id = 'provider-changed-event' WHERE id = '${LEGACY_TERMINAL_EVENT_ID}'`,
        ),
    },
    {
      authorizationRemains: true,
      label: "the durable deploy mutex owner changes",
      mutate: (database: SqliteD1Database) =>
        database.execute(
          `UPDATE "${PROD_DEPLOY_LEASE_TABLE}" SET "owner" = '${OTHER_DEPLOY_OWNER}'`,
        ),
    },
    {
      authorizationRemains: true,
      label: "the rewrite authorization expires",
      mutate: (database: SqliteD1Database) =>
        database.execute(
          "UPDATE __protocol_v3_legacy_rewrite_authorization SET expires_at = 0 WHERE id = 1",
        ),
    },
    {
      authorizationRemains: true,
      label: "the terminal projection falls behind its Session cursor proof",
      mutate: (database: SqliteD1Database) =>
        database.execute(
          `UPDATE session SET runtime_event_seq_cursor = 0 WHERE id = '${SESSION_ID}'`,
        ),
    },
    {
      authorizationRemains: false,
      label: "the admission freeze is disabled",
      mutate: (database: SqliteD1Database) =>
        database.execute(`UPDATE "${PROTOCOL_V3_CUTOVER_TABLE}" SET command_freeze = 0`),
    },
    {
      authorizationRemains: false,
      label: "the bound bookmark changes",
      mutate: (database: SqliteD1Database) =>
        database.execute(
          `UPDATE "${PROTOCOL_V3_CUTOVER_TABLE}" SET pre_migration_bookmark = 'changed-bookmark'`,
        ),
    },
    {
      authorizationRemains: false,
      label: "the bound release tree changes",
      mutate: (database: SqliteD1Database) =>
        database.execute(
          `UPDATE "${PROTOCOL_V3_CUTOVER_TABLE}" SET release_tree_oid = '89abcdef0123456789abcdef0123456789abcdef'`,
        ),
    },
    {
      authorizationRemains: false,
      label: "the admission gate is removed",
      mutate: (database: SqliteD1Database) => database.execute(REMOVE_PROTOCOL_V3_CUTOVER_SQL),
    },
    {
      authorizationRemains: true,
      label: "an extra trigger is attached to an admission table",
      mutate: (database: SqliteD1Database) =>
        database.execute(`
          CREATE TRIGGER disable_protocol_v3_gate
          BEFORE INSERT ON session_run
          WHEN 0
          BEGIN
            SELECT 1;
          END
        `),
    },
    {
      authorizationRemains: true,
      label: "an extra trigger is attached to retired Project Deployment admission",
      mutate: (database: SqliteD1Database) =>
        database.execute(`
          CREATE TRIGGER disable_project_deployment_gate
          BEFORE INSERT ON project_deployment_run
          WHEN 0
          BEGIN
            SELECT 1;
          END
        `),
    },
    {
      authorizationRemains: true,
      label: "an extra trigger is attached to the rewrite authorization table",
      mutate: (database: SqliteD1Database) =>
        database.execute(`
          CREATE TRIGGER retain_protocol_v3_authorization
          AFTER DELETE ON __protocol_v3_legacy_rewrite_authorization
          WHEN 0
          BEGIN
            SELECT 1;
          END
        `),
    },
    {
      authorizationRemains: true,
      label: "an extra trigger is attached to the deploy lease table",
      mutate: (database: SqliteD1Database) =>
        database.execute(`
          CREATE TRIGGER spoof_protocol_v3_deploy_lease
          AFTER UPDATE ON "${PROD_DEPLOY_LEASE_TABLE}"
          WHEN 0
          BEGIN
            SELECT 1;
          END
        `),
    },
    {
      authorizationRemains: true,
      label: "a canonical admission trigger is replaced by WHEN 0",
      mutate: (database: SqliteD1Database) =>
        database.execute(`
          DROP TRIGGER "__protocol_v3_cutover_session_run_insert";
          CREATE TRIGGER "__protocol_v3_cutover_session_run_insert"
          BEFORE INSERT ON session_run
          WHEN 0
          BEGIN
            SELECT 1;
          END
        `),
    },
  ]) {
    test(`rejects the legacy rewrite after ${fixture.label}`, async () => {
      const database = await createV2Database();
      await insertV2Owners(database);
      database.execute(`
        UPDATE session SET runtime_event_seq_cursor = 1 WHERE id = '${SESSION_ID}';
        UPDATE session_run
        SET error_code = NULL, error_details_json = NULL, error_message = NULL,
            status = 'completed', status_event = 'run.complete'
        WHERE id = '${RUN_ID}';
      `);
      await insertLegacySessionTerminal(database, {
        eventId: LEGACY_TERMINAL_EVENT_ID,
        eventType: "run.completed",
        sourceEventId: "provider-completed-event",
      });
      await applyMigration(database, "0014_durable-mcp-effect-v3");
      await authorizeLegacyTerminalRewrite(database);
      fixture.mutate(database);

      await expect(
        applyMigration(database, "0015_session-event-stream-identity"),
      ).rejects.toThrow();
      await expect(
        database
          .prepare(
            "SELECT candidate_count FROM __protocol_v3_legacy_rewrite_authorization WHERE id = 1",
          )
          .first(),
      ).resolves.toEqual(fixture.authorizationRemains ? { candidate_count: 1 } : null);
    });
  }

  test("leaves an already-canonical legacy terminal identity unchanged", async () => {
    const database = await createV2Database();
    await insertV2Owners(database);
    await database
      .prepare(
        `UPDATE session_run
         SET error_code = 'legacy.failed', error_details_json = '{}',
             error_message = 'Legacy failure.', status_event = 'run.fail'
         WHERE id = ?`,
      )
      .bind(RUN_ID)
      .run();
    database.execute(`UPDATE session SET runtime_event_seq_cursor = 1 WHERE id = '${SESSION_ID}'`);
    const canonicalSource = `session-run-terminal:${RUN_ID}:run.failed`;
    await insertLegacySessionTerminal(database, {
      eventId: LEGACY_TERMINAL_EVENT_ID,
      eventType: "run.failed",
      sourceEventId: canonicalSource,
    });

    await applyMigration(database, "0014_durable-mcp-effect-v3");
    await applyMigration(database, "0015_session-event-stream-identity");

    await expect(
      database
        .prepare("SELECT id, semantic_hash, seq, source_event_id FROM session_event WHERE id = ?")
        .bind(LEGACY_TERMINAL_EVENT_ID)
        .first(),
    ).resolves.toEqual({
      id: LEGACY_TERMINAL_EVENT_ID,
      semantic_hash: null,
      seq: 1,
      source_event_id: canonicalSource,
    });
  });

  test("rejects a legacy terminal source rewrite collision atomically", async () => {
    const database = await createV2Database();
    await insertV2Owners(database);
    await database
      .prepare(
        "UPDATE session_run SET status = 'completed', status_event = 'run.complete' WHERE id = ?",
      )
      .bind(RUN_ID)
      .run();
    await insertLegacySessionTerminal(database, {
      eventId: LEGACY_TERMINAL_EVENT_ID,
      eventType: "run.completed",
      sourceEventId: "provider-completed-event",
    });
    await database
      .prepare(
        `INSERT INTO session_event (
          agent_id, content_text, created_at, ended_at, event_type, family, id,
          occurred_at, process_status, process_type, run_id, seq, session_id,
          source_event_id, source, visibility
        ) VALUES (?, '', 4, 4, 'message.added', 'message', ?, 4, 'available',
          'agent.message.delta', ?, 2, ?, ?, 'api', 'all_consumers')`,
      )
      .bind(
        AGENT_ID,
        "01J00000000000000000000022",
        RUN_ID,
        SESSION_ID,
        `session-run-terminal:${RUN_ID}:run.completed`,
      )
      .run();

    await applyMigration(database, "0014_durable-mcp-effect-v3");
    await expect(applyMigration(database, "0015_session-event-stream-identity")).rejects.toThrow();
    await expect(
      database
        .prepare("SELECT source_event_id FROM session_event WHERE id = ?")
        .bind(LEGACY_TERMINAL_EVENT_ID)
        .first(),
    ).resolves.toEqual({ source_event_id: "provider-completed-event" });
  });

  test("rejects multiple legacy terminal winners before rewriting either source", async () => {
    const database = await createV2Database();
    await insertV2Owners(database);
    await database
      .prepare(
        "UPDATE session_run SET status = 'completed', status_event = 'run.complete' WHERE id = ?",
      )
      .bind(RUN_ID)
      .run();
    await insertLegacySessionTerminal(database, {
      eventId: LEGACY_TERMINAL_EVENT_ID,
      eventType: "run.completed",
      sourceEventId: "provider-completed-event-1",
    });
    await insertLegacySessionTerminal(database, {
      eventId: "01J00000000000000000000022",
      eventType: "run.completed",
      seq: 2,
      sourceEventId: "provider-completed-event-2",
    });

    await applyMigration(database, "0014_durable-mcp-effect-v3");
    await expect(applyMigration(database, "0015_session-event-stream-identity")).rejects.toThrow();
    await expect(
      database
        .prepare("SELECT source_event_id FROM session_event WHERE run_id = ? ORDER BY seq")
        .bind(RUN_ID)
        .all(),
    ).resolves.toMatchObject({
      results: [
        { source_event_id: "provider-completed-event-1" },
        { source_event_id: "provider-completed-event-2" },
      ],
    });
  });

  for (const fixture of [
    {
      eventType: "run.completed",
      label: "a terminal kind that conflicts with the Run status",
      runId: RUN_ID,
    },
    {
      eventType: "run.failed",
      label: "a terminal event whose Run link does not exist",
      runId: "01J00000000000000000000023",
    },
  ] as const) {
    test(`rejects ${fixture.label} before source normalization`, async () => {
      const database = await createV2Database();
      await insertV2Owners(database);
      await database
        .prepare("UPDATE session_run SET status_event = 'run.fail' WHERE id = ?")
        .bind(RUN_ID)
        .run();
      await insertLegacySessionTerminal(database, {
        eventId: LEGACY_TERMINAL_EVENT_ID,
        eventType: fixture.eventType,
        runId: fixture.runId,
        sourceEventId: "provider-terminal-event",
      });

      await applyMigration(database, "0014_durable-mcp-effect-v3");
      await expect(
        applyMigration(database, "0015_session-event-stream-identity"),
      ).rejects.toThrow();
      await expect(
        database
          .prepare("SELECT source_event_id FROM session_event WHERE id = ?")
          .bind(LEGACY_TERMINAL_EVENT_ID)
          .first(),
      ).resolves.toEqual({ source_event_id: "provider-terminal-event" });
    });
  }

  test("labels legacy projections and backfills retryable Run errors without inventing receipts", async () => {
    const database = await createV2Database();
    await insertV2Owners(database);
    database.execute(`
      INSERT INTO session_message (
        content_text, created_at, created_by_account_id, id, plan_json, role,
        segments_json, seq, session_id, session_run_id
      ) VALUES (
        'legacy materialized message', 2, '${ACCOUNT_ID}', '${LEGACY_MESSAGE_ID}',
        NULL, 'user', NULL, 1, '${SESSION_ID}', NULL
      );

      UPDATE session_run
      SET error_code = 'legacy.failed',
          error_details_json = NULL,
          error_message = 'Legacy failure.',
          status_event = 'run.fail'
      WHERE id = '${RUN_ID}';

      INSERT INTO session_event (
        agent_id, content_text, created_at, ended_at, event_type, family, id,
        occurred_at, process_status, process_type, run_id, seq, session_id,
        source_event_id, source, visibility
      ) VALUES (
        '${AGENT_ID}', 'Legacy failure.', 3, 3, 'run.failed', 'run',
        '${LEGACY_TERMINAL_EVENT_ID}', 3, 'error', 'run.failed', '${RUN_ID}', 1,
        '${SESSION_ID}', 'legacy-terminal-source', 'api', 'all_consumers'
      );
      UPDATE session SET runtime_event_seq_cursor = 1 WHERE id = '${SESSION_ID}';
    `);

    await applyMigration(database, "0014_durable-mcp-effect-v3");
    await authorizeLegacyTerminalRewrite(database);
    await applyMigration(database, "0015_session-event-stream-identity");

    await expect(
      database
        .prepare("SELECT projection_format FROM session_message WHERE id = ?")
        .bind(LEGACY_MESSAGE_ID)
        .first(),
    ).resolves.toEqual({ projection_format: "materialized" });
    await expect(
      database
        .prepare("SELECT error_details_json, error_retryable FROM session_run WHERE id = ?")
        .bind(RUN_ID)
        .first(),
    ).resolves.toEqual({ error_details_json: "{}", error_retryable: 0 });
    await expect(
      database
        .prepare("SELECT semantic_hash, source_event_id FROM session_event WHERE id = ?")
        .bind(LEGACY_TERMINAL_EVENT_ID)
        .first(),
    ).resolves.toEqual({
      semantic_hash: null,
      source_event_id: `session-run-terminal:${RUN_ID}:run.failed`,
    });
    await expect(
      database
        .prepare("UPDATE session_message SET projection_format = 'invalid' WHERE id = ?")
        .bind(LEGACY_MESSAGE_ID)
        .run(),
    ).rejects.toThrow();
    await database
      .prepare(
        `INSERT INTO session_message (
           content_text, created_at, created_by_account_id, id, plan_json,
           projection_format, role, segments_json, seq, session_id, session_run_id
         ) VALUES ('', 4, ?, ?, NULL, 'event_stream_v3', 'assistant', NULL, 2, ?, ?)`,
      )
      .bind(ACCOUNT_ID, V3_REFERENCE_MESSAGE_ID, SESSION_ID, RUN_ID)
      .run();
    for (const statement of [
      "UPDATE session_message SET role = 'user' WHERE id = ?",
      "UPDATE session_message SET session_run_id = NULL WHERE id = ?",
      "UPDATE session_message SET content_text = 'materialized' WHERE id = ?",
      "UPDATE session_message SET plan_json = '{}' WHERE id = ?",
      "UPDATE session_message SET segments_json = '[]' WHERE id = ?",
    ]) {
      await expect(
        database.prepare(statement).bind(V3_REFERENCE_MESSAGE_ID).run(),
      ).rejects.toThrow();
    }
    await expect(database.prepare("PRAGMA foreign_key_check").all()).resolves.toMatchObject({
      results: [],
      success: true,
    });
  });
});
