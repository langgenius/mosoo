import { driverRuntimeRpcSchemas } from "@mosoo/agent-driver/orpc";
import type {
  DriverExternalToolEffectClaimOutput,
  DriverExternalToolEffectSettleInput,
  DriverExternalToolEffectState,
  DriverNextCommandOutput,
} from "@mosoo/agent-driver/orpc";
import { createPlatformId, parsePlatformId } from "@mosoo/id";
import type {
  DriverCommandId,
  DriverInstanceId,
  ExternalToolEffectId,
  McpServerId,
  SessionRunId,
} from "@mosoo/id";

interface EffectIdentity {
  commandId: DriverCommandId;
  connectionId: string;
  driverInstanceId: DriverInstanceId;
}

type McpCommand = Extract<DriverNextCommandOutput["command"], { kind: "mcp.execute" }>;

interface EffectCommand {
  command: McpCommand;
  payloadJson: string;
}

interface EffectRow {
  attempt_count: number;
  id: ExternalToolEffectId;
  idempotency_key: string;
  result_json: string | null;
  status: "intent" | "executing" | "succeeded" | "unknown";
}

async function loadEffectCommand(
  database: D1Database,
  input: EffectIdentity,
): Promise<EffectCommand> {
  const row = await database
    .prepare(
      `SELECT payload_json FROM driver_command
       WHERE id = ? AND driver_instance_id = ? AND kind = 'mcp.execute'`,
    )
    .bind(input.commandId, input.driverInstanceId)
    .first<{ payload_json: string }>();
  if (row === null) {
    throw new Error("External effect requires an MCP command owned by this Driver.");
  }
  const { command } = driverRuntimeRpcSchemas.driverInstance.nextCommand.output.parse({
    command: JSON.parse(row.payload_json),
  });
  if (command?.kind !== "mcp.execute" || command.commandId !== input.commandId) {
    throw new Error("External effect command identity does not match its record.");
  }
  parsePlatformId<SessionRunId>(command.runId, "MCP command Run ID");
  parsePlatformId<McpServerId>(command.serverId, "MCP command server ID");
  return { command, payloadJson: row.payload_json };
}

function ownershipGuard(
  database: D1Database,
  input: EffectIdentity,
  { command, payloadJson }: EffectCommand,
): D1PreparedStatement {
  // The check shares the write transaction, so a replaced connection cannot claim work.
  return database
    .prepare(
      `SELECT CASE WHEN EXISTS (
         SELECT 1 FROM driver_command c
         JOIN driver_instance d ON d.id = c.driver_instance_id
         JOIN session_run r ON r.id = ? AND r.driver_instance_id = d.id
           AND r.session_id = d.sandbox_session_id
         WHERE c.id = ? AND c.driver_instance_id = ? AND c.payload_json = ?
           AND c.kind = 'mcp.execute' AND d.connection_id = ?
       ) AND NOT EXISTS (
         SELECT 1 FROM external_tool_effect e WHERE e.command_id = ?
           AND (e.driver_instance_id != ? OR e.session_run_id != ?
             OR e.server_id != ? OR e.tool_name != ?)
       ) THEN 1 ELSE json('External effect ownership or connection changed') END`,
    )
    .bind(
      command.runId,
      input.commandId,
      input.driverInstanceId,
      payloadJson,
      input.connectionId,
      input.commandId,
      input.driverInstanceId,
      command.runId,
      command.serverId,
      command.toolName,
    );
}

function admissionGuard(
  database: D1Database,
  input: EffectIdentity,
  existingStatuses: readonly EffectRow["status"][],
): D1PreparedStatement {
  return database
    .prepare(
      `SELECT CASE WHEN EXISTS (
         SELECT 1 FROM external_tool_effect WHERE command_id = ?
           AND status IN (SELECT value FROM json_each(?))
       ) OR EXISTS (
         SELECT 1 FROM driver_command c
         JOIN driver_instance d ON d.id = c.driver_instance_id
         JOIN session_run r ON r.id = json_extract(c.payload_json, '$.runId')
         WHERE c.id = ? AND c.status IN ('delivered', 'accepted') AND d.status = 'ready'
           AND r.status IN ('queued', 'booting', 'running', 'waiting_input')
       ) THEN 1 ELSE json('External effect cannot start for an inactive command or Run') END`,
    )
    .bind(input.commandId, JSON.stringify(existingStatuses), input.commandId);
}

function insertIntent(
  database: D1Database,
  input: EffectIdentity,
  { command }: EffectCommand,
): D1PreparedStatement {
  const effectId = createPlatformId<ExternalToolEffectId>();
  const now = Date.now();
  return database
    .prepare(
      `INSERT INTO external_tool_effect
       (id, command_id, driver_instance_id, session_run_id, server_id, tool_name,
        idempotency_key, status, attempt_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'intent', 0, ?, ?)
       ON CONFLICT(command_id) DO NOTHING`,
    )
    .bind(
      effectId,
      input.commandId,
      input.driverInstanceId,
      command.runId,
      command.serverId,
      command.toolName,
      effectId,
      now,
      now,
    );
}

async function readEffect(
  database: D1Database,
  input: EffectIdentity,
): Promise<DriverExternalToolEffectState> {
  const row = await database
    .prepare("SELECT * FROM external_tool_effect WHERE command_id = ? AND driver_instance_id = ?")
    .bind(input.commandId, input.driverInstanceId)
    .first<EffectRow>();
  if (row === null) {
    throw new Error("External effect record is missing.");
  }
  if (row.status === "executing") {
    return driverRuntimeRpcSchemas.driver.observeExternalToolEffect.output.parse({
      attempt: row.attempt_count,
      effectId: row.id,
      idempotencyKey: row.idempotency_key,
      kind: "claimed",
    });
  }
  return driverRuntimeRpcSchemas.driver.observeExternalToolEffect.output.parse({
    effectId: row.id,
    kind: row.status,
    ...(row.status === "succeeded" ? { result: JSON.parse(row.result_json ?? "null") } : {}),
  });
}

function settleAttempt(database: D1Database, commandId: DriverCommandId): D1PreparedStatement {
  return database
    .prepare(
      `UPDATE external_tool_effect_attempt AS a
       SET status = e.status, completed_at = e.updated_at,
         result_json = e.result_json, provider_receipt_json = e.provider_receipt_json
       FROM external_tool_effect e
       WHERE e.command_id = ? AND e.id = a.effect_id AND e.attempt_count = a.attempt
         AND e.status IN ('succeeded', 'unknown') AND a.status = 'executing'`,
    )
    .bind(commandId);
}

export async function observeExternalToolEffect(
  database: D1Database,
  input: EffectIdentity,
): Promise<DriverExternalToolEffectState> {
  const command = await loadEffectCommand(database, input);
  await database.batch([
    ownershipGuard(database, input, command),
    admissionGuard(database, input, ["intent", "executing", "succeeded", "unknown"]),
    insertIntent(database, input, command),
  ]);
  return readEffect(database, input);
}

interface EffectClaim extends EffectIdentity {
  claimToken: string;
}

export async function claimExternalToolEffect(
  database: D1Database,
  input: EffectClaim,
): Promise<DriverExternalToolEffectClaimOutput> {
  const command = await loadEffectCommand(database, input);
  const now = Date.now();
  await database.batch([
    ownershipGuard(database, input, command),
    admissionGuard(database, input, ["succeeded", "unknown"]),
    insertIntent(database, input, command),
    database
      .prepare(
        `UPDATE external_tool_effect SET status = 'executing',
           attempt_count = attempt_count + 1, updated_at = ?
         WHERE command_id = ? AND status = 'intent'`,
      )
      .bind(now, input.commandId),
    database
      .prepare(
        `INSERT INTO external_tool_effect_attempt (effect_id, attempt, claim_token, created_at, status)
         SELECT id, attempt_count, ?, ?, 'executing' FROM external_tool_effect
         WHERE command_id = ? AND changes() = 1`,
      )
      .bind(input.claimToken, now, input.commandId),
    database
      .prepare(
        `UPDATE external_tool_effect AS e SET status = 'unknown', updated_at = ?
         WHERE command_id = ? AND status = 'executing' AND NOT EXISTS (
           SELECT 1 FROM external_tool_effect_attempt a WHERE a.effect_id = e.id
             AND a.attempt = e.attempt_count AND a.claim_token = ?
         )`,
      )
      .bind(now, input.commandId, input.claimToken),
    settleAttempt(database, input.commandId),
  ]);
  const state = await readEffect(database, input);
  if (state.kind === "intent") {
    throw new Error("External effect claim did not persist.");
  }
  return state;
}

interface EffectSettlement extends EffectClaim {
  effectId: string;
  settlement: DriverExternalToolEffectSettleInput["settlement"];
}

export async function settleExternalToolEffect(
  database: D1Database,
  input: EffectSettlement,
): Promise<DriverExternalToolEffectState> {
  const command = await loadEffectCommand(database, input);
  const { settlement } = input;
  if (
    settlement.kind === "succeeded" &&
    (settlement.result.requestId !== command.command.requestId ||
      settlement.result.serverId !== command.command.serverId ||
      settlement.result.toolName !== command.command.toolName)
  ) {
    throw new Error("External effect result does not match the MCP command.");
  }
  const now = Date.now();
  await database.batch([
    ownershipGuard(database, input, command),
    database
      .prepare(
        `SELECT CASE WHEN EXISTS (
           SELECT 1 FROM external_tool_effect WHERE command_id = ? AND id = ?
         ) THEN 1 ELSE json('External effect ID does not match the command') END`,
      )
      .bind(input.commandId, input.effectId),
    database
      .prepare(
        `UPDATE external_tool_effect AS e SET status = 'unknown', updated_at = ?
         WHERE command_id = ? AND status = 'executing' AND NOT EXISTS (
           SELECT 1 FROM external_tool_effect_attempt a WHERE a.effect_id = e.id
             AND a.attempt = e.attempt_count AND a.claim_token = ?
         )`,
      )
      .bind(now, input.commandId, input.claimToken),
    database
      .prepare(
        `UPDATE external_tool_effect SET status = ?, result_json = ?,
           provider_receipt_json = ?, updated_at = ?
         WHERE command_id = ? AND status = 'executing'`,
      )
      .bind(
        settlement.kind,
        settlement.kind === "succeeded" ? JSON.stringify(settlement.result) : null,
        settlement.kind === "succeeded" ? (settlement.providerReceiptJson ?? null) : null,
        now,
        input.commandId,
      ),
    settleAttempt(database, input.commandId),
  ]);
  return readEffect(database, input);
}
