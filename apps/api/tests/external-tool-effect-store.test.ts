import { describe, expect, test } from "bun:test";

import {
  MCP_EXTERNAL_TOOL_EFFECT_SETTLEMENT_MAX_UTF8_BYTES,
  measureMcpExternalToolEffectSettlement,
} from "@mosoo/contracts/external-tool-effect";
import {
  RUNTIME_COMMAND_MAX_UTF8_BYTES,
  measureRuntimeCommandJson,
} from "@mosoo/contracts/runtime-command";
import type { RuntimeCommand } from "@mosoo/contracts/runtime-command";
import type {
  DriverCommandId,
  DriverInstanceId,
  ExternalToolEffectId,
  SessionRunId,
} from "@mosoo/id";

import {
  claimExternalToolEffect as claimExternalToolEffectRecord,
  getExternalToolEffectForCommand as getExternalToolEffectForCommandRecord,
  markClaimedExternalToolEffectsUnknownForDriver,
  settleExternalToolEffect as settleExternalToolEffectRecord,
} from "../src/modules/runtime/infrastructure/session-runs/external-tool-effect-store.repository";
import {
  createRuntimeCommandRecord as persistRuntimeCommandRecord,
  getRuntimeCommandRecord as readRuntimeCommandRecord,
  listAcceptedInputStartCommandRepairsForTerminalDriver,
  listAcceptedMcpCommandRepairsForTerminalDriver,
  repairAcceptedRuntimeCommandsForTerminalDriver,
} from "../src/modules/runtime/infrastructure/session-runs/runtime-command-store.repository";
import {
  createPublicHttpContractDatabase,
  insertActiveSandboxSessionFixture,
  insertOwnerSession,
  PUBLIC_API_TEST_IDS,
} from "./helpers/public-api-http-test-fixture";
import type { SqliteD1Database } from "./helpers/public-api-http-test-fixture";

const RUN_ID = "01J0000000000000000000000T" as SessionRunId;
const NEXT_RUN_ID = "01J0000000000000000000000V" as SessionRunId;
const COMMAND_ID = "01J0000000000000000000000X" as DriverCommandId;
const BOUNDARY_COMMAND_ID = "01J0000000000000000000000Z" as DriverCommandId;
const OVERSIZED_COMMAND_ID = "01J00000000000000000000010" as DriverCommandId;
const DRIVER_INSTANCE_ID = PUBLIC_API_TEST_IDS.driverOwner as DriverInstanceId;
const DRIVER_GENERATION = 0;
const CLAIM_TOKEN = "123e4567-e89b-42d3-a456-426614174000";

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

function claimExternalToolEffect(
  database: D1Database,
  input: Omit<Parameters<typeof claimExternalToolEffectRecord>[1], "driverGeneration">,
) {
  return claimExternalToolEffectRecord(database, { ...input, driverGeneration: DRIVER_GENERATION });
}

function settleExternalToolEffect(
  database: D1Database,
  input: Omit<Parameters<typeof settleExternalToolEffectRecord>[1], "driverGeneration">,
) {
  return settleExternalToolEffectRecord(database, {
    ...input,
    driverGeneration: DRIVER_GENERATION,
  });
}

function getExternalToolEffectForCommand(
  database: D1Database,
  input: Omit<Parameters<typeof getExternalToolEffectForCommandRecord>[1], "driverGeneration">,
) {
  return getExternalToolEffectForCommandRecord(database, {
    ...input,
    driverGeneration: DRIVER_GENERATION,
  });
}

function mcpExecuteCommand(
  runId: SessionRunId,
  commandId: DriverCommandId = COMMAND_ID,
): Extract<RuntimeCommand, { kind: "mcp.execute" }> {
  return {
    argumentsJson: '{"title":"durable"}',
    commandId,
    kind: "mcp.execute",
    requestId: "request-1",
    runId,
    serverId: "01J0000000000000000000000Y",
    toolCallId: "tool-1",
    toolName: "createIssue",
  };
}

function mcpExecuteCommandAtSize(
  targetBytes: number,
  commandId: DriverCommandId = BOUNDARY_COMMAND_ID,
) {
  const command = {
    ...mcpExecuteCommand(RUN_ID, commandId),
    argumentsJson: "",
  };
  return {
    ...command,
    argumentsJson: "x".repeat(targetBytes - measureRuntimeCommandJson(command)),
  };
}

function succeededSettlementAtSize(targetBytes: number) {
  const settlement = {
    kind: "succeeded" as const,
    result: {
      outputText: "",
      requestId: "request-1",
      serverId: "01J0000000000000000000000Y",
      toolName: "createIssue",
    },
  };
  return {
    ...settlement,
    result: {
      ...settlement.result,
      outputText: "x".repeat(targetBytes - measureMcpExternalToolEffectSettlement(settlement)),
    },
  };
}

async function insertSessionRun(database: SqliteD1Database, runId: SessionRunId): Promise<void> {
  await database
    .prepare(
      "INSERT INTO session_run (id, session_id, agent_id, created_by_account_id, driver_instance_id, trigger, status, trace_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      runId,
      PUBLIC_API_TEST_IDS.ownerSession,
      PUBLIC_API_TEST_IDS.agent,
      PUBLIC_API_TEST_IDS.ownerAccount,
      DRIVER_INSTANCE_ID,
      "user_prompt",
      "running",
      `trace-${runId}`,
      1,
      1,
    )
    .run();
}

async function createEffectStoreFixture(): Promise<SqliteD1Database> {
  const database = await createPublicHttpContractDatabase();
  await insertOwnerSession(database);
  await insertActiveSandboxSessionFixture(database, {
    ownerAccountId: PUBLIC_API_TEST_IDS.ownerAccount,
    sandboxId: PUBLIC_API_TEST_IDS.sandbox,
    sandboxSessionId: "01J0000000000000000000000W",
    sessionId: PUBLIC_API_TEST_IDS.ownerSession,
  });
  await database
    .prepare(
      "INSERT INTO driver_instance (id, boot_token_expires_at, boot_token_hash, connection_id, created_at, expires_at, heartbeat_count, protocol, protocol_version, runtime, sandbox_id, sandbox_incarnation, sandbox_session_id, status, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      DRIVER_INSTANCE_ID,
      1,
      new Uint8Array([1]),
      "connection-current",
      1,
      Date.now() + 60_000,
      0,
      "orpc-ws",
      3,
      "openai-runtime",
      PUBLIC_API_TEST_IDS.sandbox,
      1,
      PUBLIC_API_TEST_IDS.ownerSession,
      "ready",
      1,
    )
    .run();
  await insertSessionRun(database, RUN_ID);
  return database;
}

describe("external tool effect store", () => {
  test("atomically rejects commands after the exact Driver generation becomes terminal", async () => {
    const database = await createEffectStoreFixture();
    await database
      .prepare("UPDATE driver_instance SET status = 'failed' WHERE id = ?")
      .bind(DRIVER_INSTANCE_ID)
      .run();

    await expect(
      createRuntimeCommandRecord(database, {
        command: {
          commandId: COMMAND_ID,
          kind: "session.stop",
          reason: "already terminal",
        },
        driverInstanceId: DRIVER_INSTANCE_ID,
      }),
    ).rejects.toThrow("Driver generation is no longer current.");
    await expect(
      database
        .prepare(
          "SELECT command_seq_cursor, (SELECT count(*) FROM driver_command) AS command_count FROM driver_instance WHERE id = ?",
        )
        .bind(DRIVER_INSTANCE_ID)
        .first(),
    ).resolves.toEqual({ command_count: 0, command_seq_cursor: 0 });
  });

  test("atomically rejects a command for an inactive exact Run", async () => {
    const database = await createEffectStoreFixture();
    await database
      .prepare("UPDATE session_run SET status = 'failed' WHERE id = ?")
      .bind(RUN_ID)
      .run();
    await insertSessionRun(database, NEXT_RUN_ID);

    await expect(
      createRuntimeCommandRecord(database, {
        command: mcpExecuteCommand(RUN_ID),
        driverInstanceId: DRIVER_INSTANCE_ID,
        status: "accepted",
      }),
    ).rejects.toThrow("MCP external tool effects require the command's active Session Run.");
    await expect(
      getRuntimeCommandRecord(database, DRIVER_INSTANCE_ID, COMMAND_ID),
    ).resolves.toBeNull();
    await expect(
      database.prepare("SELECT COUNT(*) AS count FROM external_tool_effect").first(),
    ).resolves.toEqual({ count: 0 });
  });

  test("does not claim an intent after its exact Run becomes terminal", async () => {
    const database = await createEffectStoreFixture();
    await createRuntimeCommandRecord(database, {
      command: mcpExecuteCommand(RUN_ID),
      driverInstanceId: DRIVER_INSTANCE_ID,
      status: "accepted",
    });
    await database
      .prepare("UPDATE session_run SET status = 'failed' WHERE id = ?")
      .bind(RUN_ID)
      .run();

    await expect(
      claimExternalToolEffect(database, {
        claimToken: CLAIM_TOKEN,
        commandId: COMMAND_ID,
        driverInstanceId: DRIVER_INSTANCE_ID,
      }),
    ).rejects.toThrow("External tool effect claim did not reach a stable state.");
    await expect(
      getExternalToolEffectForCommand(database, {
        commandId: COMMAND_ID,
        driverInstanceId: DRIVER_INSTANCE_ID,
      }),
    ).resolves.toMatchObject({ attemptCount: 0, claimToken: null, status: "intent" });
    await expect(
      database.prepare("SELECT COUNT(*) AS count FROM external_tool_effect_attempt").first(),
    ).resolves.toEqual({ count: 0 });
  });

  test("rejects malformed claim tokens before claim or settlement mutation", async () => {
    const database = await createEffectStoreFixture();
    await createRuntimeCommandRecord(database, {
      command: mcpExecuteCommand(RUN_ID),
      driverInstanceId: DRIVER_INSTANCE_ID,
      status: "accepted",
    });

    await expect(
      claimExternalToolEffect(database, {
        claimToken: "x".repeat(1_000_000),
        commandId: COMMAND_ID,
        driverInstanceId: DRIVER_INSTANCE_ID,
      }),
    ).rejects.toThrow();
    const claim = await claimExternalToolEffect(database, {
      claimToken: CLAIM_TOKEN,
      commandId: COMMAND_ID,
      driverInstanceId: DRIVER_INSTANCE_ID,
    });
    if (claim.kind !== "claimed") {
      throw new Error("Expected the external effect to be claimed.");
    }

    await expect(
      settleExternalToolEffect(database, {
        claimToken: "not-a-uuid",
        commandId: COMMAND_ID,
        driverInstanceId: DRIVER_INSTANCE_ID,
        effectId: claim.effectId as ExternalToolEffectId,
        settlement: { kind: "unknown" },
      }),
    ).rejects.toThrow();
    await expect(
      getExternalToolEffectForCommand(database, {
        commandId: COMMAND_ID,
        driverInstanceId: DRIVER_INSTANCE_ID,
      }),
    ).resolves.toMatchObject({ claimToken: CLAIM_TOKEN, status: "claimed" });
  });

  test("rejects an invalid settlement before mutating the effect or attempt", async () => {
    const database = await createEffectStoreFixture();
    await createRuntimeCommandRecord(database, {
      command: mcpExecuteCommand(RUN_ID),
      driverInstanceId: DRIVER_INSTANCE_ID,
      status: "accepted",
    });
    const claim = await claimExternalToolEffect(database, {
      claimToken: CLAIM_TOKEN,
      commandId: COMMAND_ID,
      driverInstanceId: DRIVER_INSTANCE_ID,
    });
    if (claim.kind !== "claimed") {
      throw new Error("Expected the external effect to be claimed.");
    }

    await expect(
      settleExternalToolEffect(database, {
        claimToken: CLAIM_TOKEN,
        commandId: COMMAND_ID,
        driverInstanceId: DRIVER_INSTANCE_ID,
        effectId: claim.effectId as ExternalToolEffectId,
        settlement: {
          kind: "succeeded",
          result: {
            requestId: "request-1",
            serverId: "01J0000000000000000000000Y",
            toolName: "createIssue",
          },
        } as never,
      }),
    ).rejects.toThrow();
    await expect(
      settleExternalToolEffect(database, {
        claimToken: CLAIM_TOKEN,
        commandId: COMMAND_ID,
        driverInstanceId: DRIVER_INSTANCE_ID,
        effectId: claim.effectId as ExternalToolEffectId,
        settlement: {
          kind: "succeeded",
          result: {
            debug: "must not enter durable state",
            outputText: "done",
            requestId: "request-1",
            serverId: "01J0000000000000000000000Y",
            toolName: "createIssue",
          },
        } as never,
      }),
    ).rejects.toThrow();
    await expect(
      database
        .prepare(
          `SELECT
             command.error_json AS command_error_json,
             command.result_json AS command_result_json,
             command.status AS command_status,
             effect.status,
             effect.result_json,
             attempt.status AS attempt_status,
             attempt.completed_at,
             attempt.result_json AS attempt_result_json
           FROM external_tool_effect AS effect
           JOIN external_tool_effect_attempt AS attempt ON attempt.effect_id = effect.id
           JOIN driver_command AS command ON command.id = effect.command_id
           WHERE effect.command_id = ?`,
        )
        .bind(COMMAND_ID)
        .first(),
    ).resolves.toEqual({
      attempt_result_json: null,
      attempt_status: "claimed",
      command_error_json: null,
      command_result_json: null,
      command_status: "accepted",
      completed_at: null,
      result_json: null,
      status: "claimed",
    });
  });

  test("classifies an intent as unexecuted and fences a claimed effect before repair", async () => {
    const database = await createEffectStoreFixture();
    const command = mcpExecuteCommand(RUN_ID);
    await createRuntimeCommandRecord(database, {
      command,
      driverInstanceId: DRIVER_INSTANCE_ID,
      status: "accepted",
    });

    await expect(
      listAcceptedMcpCommandRepairsForTerminalDriver(database, {
        driverGeneration: DRIVER_GENERATION,
        driverInstanceId: DRIVER_INSTANCE_ID,
      }),
    ).resolves.toMatchObject([
      {
        commandId: COMMAND_ID,
        terminal: {
          error: { code: "driver.external_tool_effect_not_executed", retryable: true },
          status: "failed",
        },
      },
    ]);
    await claimExternalToolEffect(database, {
      claimToken: CLAIM_TOKEN,
      commandId: COMMAND_ID,
      driverInstanceId: DRIVER_INSTANCE_ID,
    });
    await expect(
      listAcceptedMcpCommandRepairsForTerminalDriver(database, {
        driverGeneration: DRIVER_GENERATION,
        driverInstanceId: DRIVER_INSTANCE_ID,
      }),
    ).rejects.toThrow("must fence claimed MCP effects");

    await markClaimedExternalToolEffectsUnknownForDriver(database, {
      driverGeneration: DRIVER_GENERATION + 1,
      driverInstanceId: DRIVER_INSTANCE_ID,
    });
    await expect(
      getExternalToolEffectForCommand(database, {
        commandId: COMMAND_ID,
        driverInstanceId: DRIVER_INSTANCE_ID,
      }),
    ).resolves.toMatchObject({ status: "claimed" });

    await markClaimedExternalToolEffectsUnknownForDriver(database, {
      driverGeneration: DRIVER_GENERATION,
      driverInstanceId: DRIVER_INSTANCE_ID,
    });
    const effect = await getExternalToolEffectForCommand(database, {
      commandId: COMMAND_ID,
      driverInstanceId: DRIVER_INSTANCE_ID,
    });
    if (effect === null) {
      throw new Error("Expected the exact-generation external effect.");
    }
    const message = `External effect ${effect.id} for MCP tool createIssue has an unknown outcome and will not be replayed.`;
    await expect(
      listAcceptedMcpCommandRepairsForTerminalDriver(database, {
        driverGeneration: DRIVER_GENERATION,
        driverInstanceId: DRIVER_INSTANCE_ID,
      }),
    ).resolves.toMatchObject([
      {
        command,
        commandId: COMMAND_ID,
        terminal: {
          error: {
            code: "driver.external_tool_effect_unknown",
            details: {
              commandId: COMMAND_ID,
              effectId: effect.id,
              requestId: "request-1",
              runId: RUN_ID,
              serverId: "01J0000000000000000000000Y",
              toolName: "createIssue",
            },
            message,
            retryable: false,
          },
          status: "failed",
        },
      },
    ]);
  });

  test("stores one maximum command with one maximum settlement", async () => {
    const database = await createEffectStoreFixture();
    const command = mcpExecuteCommandAtSize(RUNTIME_COMMAND_MAX_UTF8_BYTES);
    const settlement = succeededSettlementAtSize(
      MCP_EXTERNAL_TOOL_EFFECT_SETTLEMENT_MAX_UTF8_BYTES,
    );
    expect(measureRuntimeCommandJson(command)).toBe(RUNTIME_COMMAND_MAX_UTF8_BYTES);
    expect(measureMcpExternalToolEffectSettlement(settlement)).toBe(
      MCP_EXTERNAL_TOOL_EFFECT_SETTLEMENT_MAX_UTF8_BYTES,
    );

    await expect(
      createRuntimeCommandRecord(database, {
        command: mcpExecuteCommandAtSize(RUNTIME_COMMAND_MAX_UTF8_BYTES + 1, OVERSIZED_COMMAND_ID),
        driverInstanceId: DRIVER_INSTANCE_ID,
        status: "accepted",
      }),
    ).rejects.toThrow(`${RUNTIME_COMMAND_MAX_UTF8_BYTES} UTF-8 bytes`);
    await expect(
      database
        .prepare(
          "SELECT (SELECT count(*) FROM driver_command WHERE id = ?) AS command_count, (SELECT count(*) FROM external_tool_effect WHERE command_id = ?) AS effect_count",
        )
        .bind(OVERSIZED_COMMAND_ID, OVERSIZED_COMMAND_ID)
        .first(),
    ).resolves.toEqual({ command_count: 0, effect_count: 0 });

    await createRuntimeCommandRecord(database, {
      command,
      driverInstanceId: DRIVER_INSTANCE_ID,
      status: "accepted",
    });
    const claim = await claimExternalToolEffect(database, {
      claimToken: CLAIM_TOKEN,
      commandId: BOUNDARY_COMMAND_ID,
      driverInstanceId: DRIVER_INSTANCE_ID,
    });
    if (claim.kind !== "claimed") {
      throw new Error("Expected the boundary external effect to be claimed.");
    }

    await expect(
      settleExternalToolEffect(database, {
        claimToken: CLAIM_TOKEN,
        commandId: BOUNDARY_COMMAND_ID,
        driverInstanceId: DRIVER_INSTANCE_ID,
        effectId: claim.effectId as ExternalToolEffectId,
        settlement: {
          ...settlement,
          result: { ...settlement.result, outputText: `${settlement.result.outputText}x` },
        },
      }),
    ).rejects.toThrow(`${MCP_EXTERNAL_TOOL_EFFECT_SETTLEMENT_MAX_UTF8_BYTES} UTF-8 bytes`);
    await expect(
      getExternalToolEffectForCommand(database, {
        commandId: BOUNDARY_COMMAND_ID,
        driverInstanceId: DRIVER_INSTANCE_ID,
      }),
    ).resolves.toMatchObject({ status: "claimed" });
    await expect(
      getRuntimeCommandRecord(database, DRIVER_INSTANCE_ID, BOUNDARY_COMMAND_ID),
    ).resolves.toMatchObject({ result: null, status: "accepted" });

    await expect(
      settleExternalToolEffect(database, {
        claimToken: CLAIM_TOKEN,
        commandId: BOUNDARY_COMMAND_ID,
        driverInstanceId: DRIVER_INSTANCE_ID,
        effectId: claim.effectId as ExternalToolEffectId,
        settlement,
      }),
    ).resolves.toMatchObject({ kind: "succeeded", result: settlement.result });
    await expect(
      listAcceptedMcpCommandRepairsForTerminalDriver(database, {
        driverGeneration: DRIVER_GENERATION + 1,
        driverInstanceId: DRIVER_INSTANCE_ID,
      }),
    ).resolves.toEqual([]);
    await expect(
      listAcceptedMcpCommandRepairsForTerminalDriver(database, {
        driverGeneration: DRIVER_GENERATION,
        driverInstanceId: DRIVER_INSTANCE_ID,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        command,
        commandId: BOUNDARY_COMMAND_ID,
        runtimeId: "openai-runtime",
        sessionId: PUBLIC_API_TEST_IDS.ownerSession,
        terminal: { result: settlement.result, status: "completed" },
      }),
    ]);
    await expect(
      database
        .prepare(
          `SELECT
             length(CAST(command.payload_json AS BLOB)) AS payload_bytes,
             effect.result_json = attempt.result_json AS effect_matches_attempt,
             command.status AS command_status,
             effect.status AS effect_status,
             attempt.status AS attempt_status
           FROM driver_command AS command
           JOIN external_tool_effect AS effect ON effect.command_id = command.id
           JOIN external_tool_effect_attempt AS attempt ON attempt.effect_id = effect.id
           WHERE command.id = ?`,
        )
        .bind(BOUNDARY_COMMAND_ID)
        .first(),
    ).resolves.toEqual({
      attempt_status: "succeeded",
      command_status: "accepted",
      effect_matches_attempt: 1,
      effect_status: "succeeded",
      payload_bytes: RUNTIME_COMMAND_MAX_UTF8_BYTES,
    });
  });

  test("derives accepted input completion only from its exact terminal Session Run", async () => {
    const database = await createEffectStoreFixture();
    const command = {
      commandId: COMMAND_ID,
      input: { text: "continue" },
      kind: "input.start" as const,
      requestId: "request-1",
      runId: RUN_ID,
    };
    await createRuntimeCommandRecord(database, {
      command,
      driverInstanceId: DRIVER_INSTANCE_ID,
      status: "accepted",
    });
    await database
      .prepare("UPDATE session_run SET completed_at = 2, status = 'completed' WHERE id = ?")
      .bind(RUN_ID)
      .run();

    await expect(
      listAcceptedInputStartCommandRepairsForTerminalDriver(database, {
        driverGeneration: DRIVER_GENERATION + 1,
        driverInstanceId: DRIVER_INSTANCE_ID,
      }),
    ).resolves.toEqual([]);
    await expect(
      listAcceptedInputStartCommandRepairsForTerminalDriver(database, {
        driverGeneration: DRIVER_GENERATION,
        driverInstanceId: DRIVER_INSTANCE_ID,
      }),
    ).resolves.toEqual([
      {
        command,
        commandId: COMMAND_ID,
        runtimeId: "openai-runtime",
        sessionId: PUBLIC_API_TEST_IDS.ownerSession,
        terminal: { result: { requestId: "request-1" }, status: "completed" },
      },
    ]);

    await database
      .prepare("UPDATE driver_instance SET status = 'failed' WHERE id = ?")
      .bind(DRIVER_INSTANCE_ID)
      .run();
    await expect(
      repairAcceptedRuntimeCommandsForTerminalDriver(database, {
        driverGeneration: DRIVER_GENERATION,
        driverInstanceId: DRIVER_INSTANCE_ID,
      }),
    ).rejects.toThrow("event-first terminal reconciliation");
    await expect(
      getRuntimeCommandRecord(database, DRIVER_INSTANCE_ID, COMMAND_ID),
    ).resolves.toMatchObject({ result: null, status: "accepted" });
  });

  test("requires an authoritative error before repairing an accepted failed input", async () => {
    const database = await createEffectStoreFixture();
    const command = {
      commandId: COMMAND_ID,
      input: { text: "continue" },
      kind: "input.start" as const,
      requestId: "request-1",
      runId: RUN_ID,
    };
    await createRuntimeCommandRecord(database, {
      command,
      driverInstanceId: DRIVER_INSTANCE_ID,
      status: "accepted",
    });
    await database
      .prepare(
        "UPDATE session_run SET completed_at = 2, error_code = 'driver.failed', error_details_json = ?, error_message = 'Driver failed', status = 'failed' WHERE id = ?",
      )
      .bind(JSON.stringify({ driverInstanceId: DRIVER_INSTANCE_ID }), RUN_ID)
      .run();

    await expect(
      listAcceptedInputStartCommandRepairsForTerminalDriver(database, {
        driverGeneration: DRIVER_GENERATION,
        driverInstanceId: DRIVER_INSTANCE_ID,
      }),
    ).resolves.toMatchObject([
      {
        command,
        terminal: {
          error: {
            code: "driver.failed",
            details: { driverInstanceId: DRIVER_INSTANCE_ID },
            message: "Driver failed",
            retryable: false,
          },
          status: "failed",
        },
      },
    ]);

    await database
      .prepare(
        "UPDATE session_run SET error_code = NULL, error_details_json = NULL, error_message = NULL WHERE id = ?",
      )
      .bind(RUN_ID)
      .run();
    await expect(
      listAcceptedInputStartCommandRepairsForTerminalDriver(database, {
        driverGeneration: DRIVER_GENERATION,
        driverInstanceId: DRIVER_INSTANCE_ID,
      }),
    ).rejects.toThrow("missing its authoritative durable error");
  });
});
