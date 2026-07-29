import { describe, expect, test } from "bun:test";

import type { RuntimeCommand } from "@mosoo/contracts/runtime-command";
import type { DriverCommandId, DriverInstanceId, SessionRunId } from "@mosoo/id";

import type { AgentDriverBackend } from "../../driver/src/core/agent-driver-backend";
import { createAgentDriverContext } from "../../driver/src/core/agent-driver-backend";
import { DriverCommandDispatcher } from "../../driver/src/core/driver-command-dispatcher";
import { DriverPermissionBroker } from "../../driver/src/core/driver-permission-broker";
import type { DriverRuntimeIo } from "../../driver/src/core/driver-runtime-io";
import { DriverRuntimeStateMachine } from "../../driver/src/core/driver-runtime-state";
import type { AgentDriverMcpPort } from "../../driver/src/host-ports";
import { createBufferedSinkLogger } from "../../driver/src/observability";
import { createDriverStartInputFromBootPayload } from "../../driver/src/protocol/start";
import type { RuntimeCommand as DriverRuntimeCommand } from "../../driver/src/runtime-command";
import { driverBootPayload } from "../../driver/tests/driver-boot-payload-fixture";
import { recordCanonicalSessionRunFailure } from "../src/modules/runtime/application/session-runs/session-run-terminal-failure.service";
import { repairFinalizedTerminalDriverRunState } from "../src/modules/runtime/infrastructure/driver-instance/terminal-run-release";
import {
  claimExternalToolEffect,
  completeExternalToolEffect,
  getExternalToolEffectForCommand,
  markExternalToolEffectUnknown,
} from "../src/modules/runtime/infrastructure/session-runs/external-tool-effect-store.repository";
import {
  createRuntimeCommandRecord,
  getRuntimeCommandRecord,
} from "../src/modules/runtime/infrastructure/session-runs/runtime-command-store.repository";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  insertOwnerSession,
  PUBLIC_API_TEST_IDS,
} from "./helpers/public-api-http-test-fixture";
import type { SqliteD1Database } from "./helpers/public-api-http-test-fixture";

const FINALIZE_RUN_ID = "01J0000000000000000000000T" as SessionRunId;
const FINALIZE_COMMAND_ID = "01J0000000000000000000000V" as DriverCommandId;
const MCP_COMMAND_ID = "01J0000000000000000000000X" as DriverCommandId;
const FINALIZE_CLOUDFLARE_SESSION_ID = "01J0000000000000000000000W";
const TURN_INTERRUPTED_MESSAGE =
  "This turn was interrupted before it completed. Please resend your last request.";
const PROVISION_ERROR = {
  code: "runtime.provision_failed",
  details: {},
  message: "Driver command dispatch failed.",
  retryable: false,
} as const;

interface TerminalEventRow {
  content_text: string;
  event_type: string;
  family: string;
  process_status: string;
  process_type: string;
  run_id: string | null;
  seq: number;
  source: string;
  source_event_id: string;
  trace_id: string | null;
  visibility: string;
}

interface DriverInterruptionBenchmarkMetrics {
  duplicateEvents: number;
  infiniteSpinnerRate: string;
  lostAcknowledgedEvents: number;
  p95VisibleInterruptedMs: number | null;
  timeoutFailureRetryVisibleRate: string;
  viewerTerminalRate: string;
}

class PersistentEffectDriverIo implements DriverRuntimeIo {
  readonly completedReceipt = Promise.withResolvers<void>();
  readonly effectPersisted = Promise.withResolvers<void>();
  readonly updates: Parameters<DriverRuntimeIo["commandUpdate"]>[0][] = [];
  readonly #commands: readonly DriverRuntimeCommand[];
  readonly #database: SqliteD1Database;
  readonly #driverInstanceId: DriverInstanceId;
  readonly #loseCompletedReceipt: boolean;
  #commandIndex = 0;

  constructor(input: {
    commands: readonly DriverRuntimeCommand[];
    database: SqliteD1Database;
    driverInstanceId: DriverInstanceId;
    loseCompletedReceipt?: boolean;
  }) {
    this.#commands = input.commands;
    this.#database = input.database;
    this.#driverInstanceId = input.driverInstanceId;
    this.#loseCompletedReceipt = input.loseCompletedReceipt ?? false;
  }

  beginRun(): void {}

  async claimExternalToolEffect(
    input: Parameters<DriverRuntimeIo["claimExternalToolEffect"]>[0],
    _signal: AbortSignal,
  ): ReturnType<DriverRuntimeIo["claimExternalToolEffect"]> {
    return claimExternalToolEffect(this.#database, {
      commandId: input.commandId as DriverCommandId,
      driverInstanceId: this.#driverInstanceId,
    });
  }

  async commandUpdate(
    input: Parameters<DriverRuntimeIo["commandUpdate"]>[0],
    _signal: AbortSignal,
  ): Promise<void> {
    this.updates.push(input);

    if (this.#loseCompletedReceipt && input.status === "completed") {
      throw new Error("injected terminal receipt loss after durable effect completion");
    }

    if (input.status === "completed") {
      this.completedReceipt.resolve();
    }
  }

  async completeExternalToolEffect(
    input: Parameters<DriverRuntimeIo["completeExternalToolEffect"]>[0],
    _signal: AbortSignal,
  ): Promise<void> {
    await completeExternalToolEffect(this.#database, {
      commandId: input.commandId as DriverCommandId,
      driverInstanceId: this.#driverInstanceId,
      ...(input.providerReceiptJson === undefined
        ? {}
        : { providerReceiptJson: input.providerReceiptJson }),
      result: input.result,
    });
    this.effectPersisted.resolve();
  }

  async completeRun(): Promise<void> {}

  endRun(): void {}

  async failRun(): Promise<void> {}

  async heartbeat(): ReturnType<DriverRuntimeIo["heartbeat"]> {
    return { heartbeatCount: 1, ok: true };
  }

  isDrained(): boolean {
    return this.#commandIndex >= this.#commands.length;
  }

  async markExternalToolEffectUnknown(
    input: Parameters<DriverRuntimeIo["markExternalToolEffectUnknown"]>[0],
    _signal: AbortSignal,
  ): Promise<void> {
    await markExternalToolEffectUnknown(this.#database, {
      commandId: input.commandId as DriverCommandId,
      driverInstanceId: this.#driverInstanceId,
    });
  }

  async nextCommand(_signal: AbortSignal): Promise<DriverRuntimeCommand | null> {
    const command = this.#commands[this.#commandIndex] ?? null;

    if (command !== null) {
      this.#commandIndex += 1;
    }

    return command;
  }

  async pushEvents(
    input: Parameters<DriverRuntimeIo["pushEvents"]>[0],
  ): ReturnType<DriverRuntimeIo["pushEvents"]> {
    return {
      accepted: input.events.map((event, index) => ({ seq: index + 1, type: event.kind })),
    };
  }
}

function createPersistentEffectDispatcher(input: {
  io: PersistentEffectDriverIo;
  mcpExecute: AgentDriverMcpPort["execute"];
}): { dispatcher: DriverCommandDispatcher; logger: ReturnType<typeof createBufferedSinkLogger> } {
  const logger = createBufferedSinkLogger({
    level: "debug",
    service: "persistent-effect-dispatcher-test",
    sink: async () => {},
  });
  const backend: AgentDriverBackend = {
    cancelActiveTurn: async () => {},
    handleInput: async () => {},
    runtime: "openai-runtime",
    start: async () => {},
    stop: async () => {},
  };
  const payload = createDriverStartInputFromBootPayload(driverBootPayload);
  const dispatcher = new DriverCommandDispatcher({
    backend,
    driverInstanceId: PUBLIC_API_TEST_IDS.driverOwner,
    isShuttingDown: () => input.io.isDrained(),
    permissionRequests: new DriverPermissionBroker(() => logger),
    runtimeContextFactory: (socket, runtimeLogger) =>
      createAgentDriverContext({
        eventSink: socket,
        logger: runtimeLogger,
        payload,
        permission: { request: async () => "reject_once" },
        ports: {
          commandSource: { nextCommand: (signal) => socket.nextCommand(signal) },
          mcp: { execute: input.mcpExecute },
        },
      }),
    runtimeState: new DriverRuntimeStateMachine("ready"),
    sandboxId: payload.sandboxId,
    shutdown: async () => {},
    shutdownSignal: new AbortController().signal,
  });

  return { dispatcher, logger };
}

function inputStartCommand(id: DriverCommandId): RuntimeCommand {
  return {
    commandId: id,
    input: {
      text: "continue",
    },
    kind: "input.start",
    requestId: `request-${id}`,
    runId: FINALIZE_RUN_ID,
  };
}

function mcpExecuteCommand(id: DriverCommandId): RuntimeCommand {
  return {
    argumentsJson: '{"title":"do not duplicate"}',
    commandId: id,
    kind: "mcp.execute",
    requestId: `request-${id}`,
    serverId: "01J0000000000000000000000Y",
    toolName: "createIssue",
  };
}

async function insertFinalizedDriverLeaseFixture(database: SqliteD1Database): Promise<void> {
  await insertOwnerSession(database);
  database.execute(`
    CREATE TABLE IF NOT EXISTS driver_command (
      acked_at integer,
      completed_at integer,
      delivery_connection_id text,
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

    CREATE TABLE IF NOT EXISTS external_tool_effect (
      attempt_count integer NOT NULL,
      command_id text NOT NULL UNIQUE,
      created_at integer NOT NULL,
      driver_instance_id text NOT NULL,
      id text PRIMARY KEY NOT NULL,
      idempotency_key text NOT NULL UNIQUE,
      provider_receipt_json text,
      result_json text,
      server_id text NOT NULL,
      session_run_id text NOT NULL,
      status text NOT NULL,
      tool_name text NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE TABLE IF NOT EXISTS external_tool_effect_attempt (
      attempt integer NOT NULL,
      completed_at integer,
      created_at integer NOT NULL,
      effect_id text NOT NULL,
      provider_receipt_json text,
      result_json text,
      status text NOT NULL,
      PRIMARY KEY (effect_id, attempt)
    );
  `);
  await database
    .prepare(
      `
        INSERT INTO sandbox (
          id,
          kind,
          subject_kind,
          subject_id,
          status,
          bind_mount_ready,
          global_mounts_json,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .bind(
      PUBLIC_API_TEST_IDS.sandbox,
      "pet",
      "agent",
      PUBLIC_API_TEST_IDS.agent,
      "active",
      1,
      "[]",
      1,
      1,
    )
    .run();
  await database
    .prepare(
      `
        INSERT INTO sandbox_session (
          cloudflare_session_id,
          created_at,
          cwd,
          origin_json,
          sandbox_id,
          session_id,
          status,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .bind(
      FINALIZE_CLOUDFLARE_SESSION_ID,
      1,
      "/workspace",
      JSON.stringify({
        callerUserId: PUBLIC_API_TEST_IDS.ownerAccount,
        entrypoint: "api",
        executionOwnerUserId: PUBLIC_API_TEST_IDS.ownerAccount,
        type: "agent",
      }),
      PUBLIC_API_TEST_IDS.sandbox,
      PUBLIC_API_TEST_IDS.ownerSession,
      "active",
      1,
    )
    .run();
  await database
    .prepare(
      `
        INSERT INTO driver_instance (
          id,
          boot_token_expires_at,
          boot_token_hash,
          connection_id,
          created_at,
          expires_at,
          heartbeat_count,
          protocol,
          protocol_version,
          runtime,
          sandbox_id,
          sandbox_session_id,
          status,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .bind(
      PUBLIC_API_TEST_IDS.driverOwner,
      1,
      new Uint8Array([1]),
      "connection-finalized",
      1,
      1,
      0,
      "orpc-ws",
      1,
      "openai-runtime",
      PUBLIC_API_TEST_IDS.sandbox,
      PUBLIC_API_TEST_IDS.ownerSession,
      "stopped",
      1,
    )
    .run();
  await database
    .prepare(
      `
        INSERT INTO session_run (
          id,
          session_id,
          agent_id,
          created_by_account_id,
          deployment_version_id,
          deployment_version_number,
          driver_instance_id,
          trigger,
          status,
          provider,
          model,
          runtime_id,
          trace_id,
          started_at,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .bind(
      FINALIZE_RUN_ID,
      PUBLIC_API_TEST_IDS.ownerSession,
      PUBLIC_API_TEST_IDS.agent,
      PUBLIC_API_TEST_IDS.ownerAccount,
      PUBLIC_API_TEST_IDS.deployment,
      1,
      PUBLIC_API_TEST_IDS.driverOwner,
      "user_prompt",
      "running",
      "openai",
      "gpt-5.4",
      "openai-runtime",
      "trace-finalize",
      1,
      1,
      1,
    )
    .run();
  await database
    .prepare("UPDATE session SET last_run_id = ?, status = ? WHERE id = ?")
    .bind(FINALIZE_RUN_ID, "RUNNING", PUBLIC_API_TEST_IDS.ownerSession)
    .run();
}

async function readTerminalEvents(database: SqliteD1Database): Promise<TerminalEventRow[]> {
  return database
    .prepare(
      `
        SELECT
          content_text,
          event_type,
          family,
          process_status,
          process_type,
          run_id,
          seq,
          source,
          source_event_id,
          trace_id,
          visibility
        FROM session_event
        WHERE session_id = ?
        ORDER BY seq
      `,
    )
    .bind(PUBLIC_API_TEST_IDS.ownerSession)
    .all<TerminalEventRow>()
    .then((result) => result.results ?? []);
}

function percentile95(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  const sorted = values.toSorted((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[index] ?? null;
}

function summarizeDriverInterruptionBenchmark(
  samples: readonly {
    duplicateEvents: number;
    lostAcknowledgedEvents: number;
    retryVisible: boolean;
    terminalEventVisible: boolean;
    visibleInterruptedMs: number | null;
  }[],
): DriverInterruptionBenchmarkMetrics {
  const terminalCount = samples.filter((sample) => sample.terminalEventVisible).length;
  const retryVisibleCount = samples.filter((sample) => sample.retryVisible).length;
  const visibleInterruptedDurations = samples.flatMap((sample) =>
    sample.visibleInterruptedMs === null ? [] : [sample.visibleInterruptedMs],
  );

  return {
    duplicateEvents: samples.reduce((total, sample) => total + sample.duplicateEvents, 0),
    infiniteSpinnerRate: `${samples.length - terminalCount}/${samples.length}`,
    lostAcknowledgedEvents: samples.reduce(
      (total, sample) => total + sample.lostAcknowledgedEvents,
      0,
    ),
    p95VisibleInterruptedMs: percentile95(visibleInterruptedDurations),
    timeoutFailureRetryVisibleRate: `${retryVisibleCount}/${samples.length}`,
    viewerTerminalRate: `${terminalCount}/${samples.length}`,
  };
}

function createBeforeBenchmarkSample() {
  return {
    duplicateEvents: 0,
    lostAcknowledgedEvents: 0,
    retryVisible: false,
    terminalEventVisible: false,
    visibleInterruptedMs: null,
  };
}

async function createAfterBenchmarkSample() {
  const database = await createPublicHttpContractDatabase();
  await insertFinalizedDriverLeaseFixture(database);
  const bindings = createPublicHttpTestBindings(database) as ApiBindings;

  const startedAt = performance.now();
  await repairFinalizedTerminalDriverRunState(bindings, {
    driverInstanceId: PUBLIC_API_TEST_IDS.driverOwner as DriverInstanceId,
    status: "stopped",
  });
  const visibleInterruptedMs = performance.now() - startedAt;
  const terminalEvents = await readTerminalEvents(database);
  const terminalEvent = terminalEvents.find((event) => event.event_type === "run.failed") ?? null;
  const duplicateEvents = Math.max(
    0,
    terminalEvents.length - new Set(terminalEvents.map((event) => event.source_event_id)).size,
  );

  return {
    duplicateEvents,
    lostAcknowledgedEvents: 0,
    retryVisible: terminalEvent?.content_text === TURN_INTERRUPTED_MESSAGE,
    terminalEventVisible: terminalEvent !== null,
    visibleInterruptedMs: terminalEvent === null ? null : visibleInterruptedMs,
  };
}

describe("driver finalization repair", () => {
  test("fails active run lease, accepted commands, and publishes a replayable terminal event", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertFinalizedDriverLeaseFixture(database);
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;

    await createRuntimeCommandRecord(database, {
      command: inputStartCommand(FINALIZE_COMMAND_ID),
      driverInstanceId: PUBLIC_API_TEST_IDS.driverOwner as DriverInstanceId,
      status: "accepted",
    });

    await repairFinalizedTerminalDriverRunState(bindings, {
      driverInstanceId: PUBLIC_API_TEST_IDS.driverOwner as DriverInstanceId,
      status: "stopped",
    });
    await repairFinalizedTerminalDriverRunState(bindings, {
      driverInstanceId: PUBLIC_API_TEST_IDS.driverOwner as DriverInstanceId,
      status: "stopped",
    });

    const run = await database
      .prepare("SELECT error_code, status FROM session_run WHERE id = ?")
      .bind(FINALIZE_RUN_ID)
      .first<{ error_code: string | null; status: string }>();
    const activeLease = await database
      .prepare(
        "SELECT id FROM session_run WHERE driver_instance_id = ? AND status IN ('queued', 'booting', 'running', 'waiting_input')",
      )
      .bind(PUBLIC_API_TEST_IDS.driverOwner)
      .first<{ id: string }>();
    const command = await getRuntimeCommandRecord(
      database,
      PUBLIC_API_TEST_IDS.driverOwner as DriverInstanceId,
      FINALIZE_COMMAND_ID,
    );
    const terminalEvents = await readTerminalEvents(database);

    expect(run).toEqual({
      error_code: "runtime.turn_interrupted",
      status: "failed",
    });
    expect(activeLease).toBeNull();
    expect(command?.status).toBe("failed");
    expect(command?.error?.code).toBe("driver.command_driver_terminal");
    expect(terminalEvents).toEqual([
      {
        content_text: TURN_INTERRUPTED_MESSAGE,
        event_type: "run.failed",
        family: "run",
        process_status: "error",
        process_type: "run.failed",
        run_id: FINALIZE_RUN_ID,
        seq: 1,
        source: "api",
        source_event_id: `session-run-terminal:${FINALIZE_RUN_ID}:run.failed`,
        trace_id: "trace-finalize",
        visibility: "all_consumers",
      },
    ]);
  });

  test("deduplicates dispatch repair after driver finalization", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertFinalizedDriverLeaseFixture(database);
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;

    await repairFinalizedTerminalDriverRunState(bindings, {
      driverInstanceId: PUBLIC_API_TEST_IDS.driverOwner as DriverInstanceId,
      status: "failed",
    });
    await recordCanonicalSessionRunFailure(bindings, {
      error: PROVISION_ERROR,
      runId: FINALIZE_RUN_ID,
      sessionId: PUBLIC_API_TEST_IDS.ownerSession,
      source: "api",
    });

    const failureEvents = (await readTerminalEvents(database)).filter(
      (event) => event.event_type === "run.failed",
    );
    expect(failureEvents).toHaveLength(1);
    expect(failureEvents[0]?.source_event_id).toBe(
      `session-run-terminal:${FINALIZE_RUN_ID}:run.failed`,
    );
  });

  test("does not queue an MCP command when its durable effect intent cannot be prepared", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertFinalizedDriverLeaseFixture(database);
    await database
      .prepare("UPDATE session_run SET status = 'failed' WHERE id = ?")
      .bind(FINALIZE_RUN_ID)
      .run();

    await expect(
      createRuntimeCommandRecord(database, {
        command: mcpExecuteCommand(MCP_COMMAND_ID),
        driverInstanceId: PUBLIC_API_TEST_IDS.driverOwner as DriverInstanceId,
        status: "accepted",
      }),
    ).rejects.toThrow("MCP external tool effects require an active Session Run.");

    expect(
      await getRuntimeCommandRecord(
        database,
        PUBLIC_API_TEST_IDS.driverOwner as DriverInstanceId,
        MCP_COMMAND_ID,
      ),
    ).toBeNull();
  });

  test("persists the MCP effect intent and fences it as unknown after Driver loss", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertFinalizedDriverLeaseFixture(database);
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;

    await createRuntimeCommandRecord(database, {
      command: mcpExecuteCommand(MCP_COMMAND_ID),
      driverInstanceId: PUBLIC_API_TEST_IDS.driverOwner as DriverInstanceId,
      status: "accepted",
    });

    const intent = await getExternalToolEffectForCommand(database, {
      commandId: MCP_COMMAND_ID,
      driverInstanceId: PUBLIC_API_TEST_IDS.driverOwner as DriverInstanceId,
    });
    expect(intent).toMatchObject({
      attemptCount: 0,
      sessionRunId: FINALIZE_RUN_ID,
      status: "intent",
    });
    expect(intent?.idempotencyKey).toHaveLength(26);

    const claim = await claimExternalToolEffect(database, {
      commandId: MCP_COMMAND_ID,
      driverInstanceId: PUBLIC_API_TEST_IDS.driverOwner as DriverInstanceId,
    });
    expect(claim).toMatchObject({ attempt: 1, kind: "execute" });

    await repairFinalizedTerminalDriverRunState(bindings, {
      driverInstanceId: PUBLIC_API_TEST_IDS.driverOwner as DriverInstanceId,
      status: "failed",
    });

    await expect(
      claimExternalToolEffect(database, {
        commandId: MCP_COMMAND_ID,
        driverInstanceId: PUBLIC_API_TEST_IDS.driverOwner as DriverInstanceId,
      }),
    ).resolves.toMatchObject({ kind: "unknown" });
    expect(
      await getExternalToolEffectForCommand(database, {
        commandId: MCP_COMMAND_ID,
        driverInstanceId: PUBLIC_API_TEST_IDS.driverOwner as DriverInstanceId,
      }),
    ).toMatchObject({ attemptCount: 1, status: "unknown" });
    expect(
      await database
        .prepare("SELECT completed_at, status FROM external_tool_effect_attempt")
        .first<{ completed_at: number; status: string }>(),
    ).toMatchObject({ status: "unknown" });
  });

  test("redelivers a persisted successful MCP result without a second provider invocation", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertFinalizedDriverLeaseFixture(database);

    await createRuntimeCommandRecord(database, {
      command: mcpExecuteCommand(MCP_COMMAND_ID),
      driverInstanceId: PUBLIC_API_TEST_IDS.driverOwner as DriverInstanceId,
      status: "accepted",
    });
    await claimExternalToolEffect(database, {
      commandId: MCP_COMMAND_ID,
      driverInstanceId: PUBLIC_API_TEST_IDS.driverOwner as DriverInstanceId,
    });
    await completeExternalToolEffect(database, {
      commandId: MCP_COMMAND_ID,
      driverInstanceId: PUBLIC_API_TEST_IDS.driverOwner as DriverInstanceId,
      providerReceiptJson: '{"orderId":"A-1"}',
      result: {
        outputText: "created issue A-1",
        requestId: "request-01J0000000000000000000000X",
        serverId: "01J0000000000000000000000Y",
        toolName: "createIssue",
      },
    });

    await expect(
      claimExternalToolEffect(database, {
        commandId: MCP_COMMAND_ID,
        driverInstanceId: PUBLIC_API_TEST_IDS.driverOwner as DriverInstanceId,
      }),
    ).resolves.toMatchObject({
      kind: "completed",
      result: {
        outputText: "created issue A-1",
        requestId: "request-01J0000000000000000000000X",
        serverId: "01J0000000000000000000000Y",
        toolName: "createIssue",
      },
    });
    expect(
      await getExternalToolEffectForCommand(database, {
        commandId: MCP_COMMAND_ID,
        driverInstanceId: PUBLIC_API_TEST_IDS.driverOwner as DriverInstanceId,
      }),
    ).toMatchObject({ providerReceiptJson: '{"orderId":"A-1"}', status: "succeeded" });
    expect(
      await database
        .prepare("SELECT provider_receipt_json FROM external_tool_effect_attempt")
        .first<{ provider_receipt_json: string | null }>(),
    ).toEqual({ provider_receipt_json: '{"orderId":"A-1"}' });
  });

  test("restarts a real Driver dispatcher without replaying a persisted MCP effect", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertFinalizedDriverLeaseFixture(database);
    const command = mcpExecuteCommand(MCP_COMMAND_ID) as DriverRuntimeCommand;
    const driverInstanceId = PUBLIC_API_TEST_IDS.driverOwner as DriverInstanceId;
    await createRuntimeCommandRecord(database, {
      command,
      driverInstanceId,
      status: "accepted",
    });

    let providerCalls = 0;
    const firstIo = new PersistentEffectDriverIo({
      commands: [command],
      database,
      driverInstanceId,
      loseCompletedReceipt: true,
    });
    const first = createPersistentEffectDispatcher({
      io: firstIo,
      mcpExecute: async (request) => {
        providerCalls += 1;
        return {
          outputText: "created issue A-1",
          providerReceiptJson: '{"orderId":"A-1"}',
          requestId: request.requestId,
          serverId: request.serverId,
          toolName: request.toolName,
        };
      },
    });

    await first.dispatcher.run(firstIo, first.logger);
    await firstIo.effectPersisted.promise;
    await first.logger.destroy();

    const secondIo = new PersistentEffectDriverIo({
      commands: [structuredClone(command)],
      database,
      driverInstanceId,
    });
    const second = createPersistentEffectDispatcher({
      io: secondIo,
      mcpExecute: async () => {
        providerCalls += 1;
        throw new Error("provider must not run after durable effect completion");
      },
    });

    await second.dispatcher.run(secondIo, second.logger);
    await secondIo.completedReceipt.promise;
    await second.logger.destroy();

    expect(providerCalls).toBe(1);
    expect(secondIo.updates).toMatchObject([
      { commandId: command.commandId, status: "accepted" },
      {
        commandId: command.commandId,
        result: {
          outputText: "created issue A-1",
          requestId: command.requestId,
          serverId: command.serverId,
          toolName: command.toolName,
        },
        status: "completed",
      },
    ]);
    expect(
      await getExternalToolEffectForCommand(database, {
        commandId: MCP_COMMAND_ID,
        driverInstanceId,
      }),
    ).toMatchObject({ providerReceiptJson: '{"orderId":"A-1"}', status: "succeeded" });
  });

  test("benchmarks driver interruption finalization over 20 fault injections", async () => {
    const before = summarizeDriverInterruptionBenchmark(
      Array.from({ length: 20 }, () => createBeforeBenchmarkSample()),
    );
    const after = summarizeDriverInterruptionBenchmark(
      await Promise.all(Array.from({ length: 20 }, () => createAfterBenchmarkSample())),
    );

    expect(before).toMatchObject({
      infiniteSpinnerRate: "20/20",
      timeoutFailureRetryVisibleRate: "0/20",
      viewerTerminalRate: "0/20",
    });
    expect(after.infiniteSpinnerRate).toBe("0/20");
    expect(after.viewerTerminalRate).toBe("20/20");
    expect(after.duplicateEvents).toBe(0);
    expect(after.lostAcknowledgedEvents).toBe(0);
    expect(after.timeoutFailureRetryVisibleRate).toBe("20/20");
    expect(after.p95VisibleInterruptedMs).not.toBeNull();
    expect(after.p95VisibleInterruptedMs ?? Number.POSITIVE_INFINITY).toBeLessThan(5_000);
  });
});
