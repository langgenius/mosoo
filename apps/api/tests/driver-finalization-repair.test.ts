import { describe, expect, test } from "bun:test";

import { createMcpExecuteFailedEventIdentity } from "@mosoo/agent-driver/events";
import {
  ExternalToolEffectSettlement,
  MCP_EXTERNAL_TOOL_EFFECT_SETTLEMENT_MAX_UTF8_BYTES,
  measureMcpExternalToolEffectSettlement,
} from "@mosoo/contracts/external-tool-effect";
import {
  RUNTIME_COMMAND_MAX_UTF8_BYTES,
  RUNTIME_COMMAND_TERMINAL_PAYLOAD_MAX_UTF8_BYTES,
  measureRuntimeCommandJson,
} from "@mosoo/contracts/runtime-command";
import type { RuntimeCommand } from "@mosoo/contracts/runtime-command";
import { DURABLE_RUN_ERROR_MAX_UTF8_BYTES } from "@mosoo/contracts/session-run";
import type { RunError } from "@mosoo/contracts/session-run";
import type {
  DriverCommandId,
  DriverInstanceId,
  ExternalToolEffectId,
  SessionRunId,
} from "@mosoo/id";

import type { DriverRuntimeIo } from "../../driver/src/core/driver-runtime-io";
import { DriverRuntimeStateMachine } from "../../driver/src/core/driver-runtime-state";
import type { AgentDriverMcpExecution } from "../../driver/src/host-ports";
import { parseRunId } from "../../driver/src/protocol/id";
import type { RuntimeCommand as DriverRuntimeCommand } from "../../driver/src/runtime-command";
import { promiseWithTimeout } from "../../driver/src/utils/async";
import {
  createBackend,
  createDispatcher,
  FakeDriverRuntimeIo,
} from "../../driver/tests/driver-runtime-boundary-fixtures";
import { recordCanonicalSessionRunFailure } from "../src/modules/runtime/application/session-runs/session-run-terminal-failure.service";
import {
  createFailedSessionRunRuntimeEvent,
  createSessionRunUpdatedEvent,
} from "../src/modules/runtime/application/session-runs/session-run-view-events.service";
import { createSessionRunTerminalSourceId } from "../src/modules/runtime/domain/session-run-terminal-event-id";
import { commitTerminalRunProjection } from "../src/modules/runtime/infrastructure/driver-instance/completed-run-commit.repository";
import { cleanupDriverInstances } from "../src/modules/runtime/infrastructure/driver-instance/maintenance";
import { repairFinalizedTerminalDriverRunState as repairFinalizedTerminalDriverRunStateForGeneration } from "../src/modules/runtime/infrastructure/driver-instance/terminal-run-release";
import {
  claimExternalToolEffect as claimExternalToolEffectRecord,
  getExternalToolEffectForCommand as getExternalToolEffectForCommandRecord,
  observeExternalToolEffect as observeExternalToolEffectRecord,
  settleExternalToolEffect as settleExternalToolEffectRecord,
} from "../src/modules/runtime/infrastructure/session-runs/external-tool-effect-store.repository";
import {
  createRuntimeCommandRecord as createRuntimeCommandRecordForGeneration,
  getRuntimeCommandRecord as getRuntimeCommandRecordForGeneration,
  updateRuntimeCommandRecord as updateRuntimeCommandRecordForGeneration,
} from "../src/modules/runtime/infrastructure/session-runs/runtime-command-store.repository";
import { getSessionRunSummary } from "../src/modules/runtime/infrastructure/session-runs/session-run-store.repository";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  insertOwnerSession,
  PUBLIC_API_TEST_IDS,
} from "./helpers/public-api-http-test-fixture";
import type { SqliteD1Database } from "./helpers/public-api-http-test-fixture";

const FINALIZE_RUN_ID = "01J0000000000000000000000T" as SessionRunId;
const DRIVER_GENERATION = 0;
const FINALIZE_COMMAND_ID = "01J0000000000000000000000V" as DriverCommandId;
const MCP_COMMAND_ID = "01J0000000000000000000000X" as DriverCommandId;
const MCP_CLAIM_TOKEN = "00000000-0000-4000-8000-000000000001";
const MCP_OTHER_CLAIM_TOKEN = "00000000-0000-4000-8000-000000000002";
const DISPATCHER_TEST_PHASE_TIMEOUT_MS = 1_500;
const FINALIZE_CLOUDFLARE_SESSION_ID = "01J0000000000000000000000W";
const TURN_INTERRUPTED_MESSAGE =
  "This turn was interrupted before it completed. Please resend your last request.";
const PROVISION_ERROR = {
  code: "runtime.provision_failed",
  details: {},
  message: "Driver command dispatch failed.",
  retryable: false,
} as const;
const MCP_SUCCESS_RESULT = {
  outputText: "created issue A-1",
  requestId: "request-01J0000000000000000000000X",
  serverId: "01J0000000000000000000000Y",
  toolName: "createIssue",
} as const;

const repairFinalizedTerminalDriverRunState = (
  bindings: ApiBindings,
  input: Omit<
    Parameters<typeof repairFinalizedTerminalDriverRunStateForGeneration>[1],
    "driverGeneration" | "sessionRunId"
  >,
) =>
  bindings.DB.prepare("UPDATE driver_instance SET status = ? WHERE id = ?")
    .bind(input.status, PUBLIC_API_TEST_IDS.driverOwner)
    .run()
    .then(() =>
      repairFinalizedTerminalDriverRunStateForGeneration(bindings, {
        ...input,
        driverGeneration: DRIVER_GENERATION,
        sessionRunId: FINALIZE_RUN_ID,
      }),
    );

const createRuntimeCommandRecord = (
  database: D1Database,
  input: Omit<Parameters<typeof createRuntimeCommandRecordForGeneration>[1], "driverGeneration">,
) =>
  createRuntimeCommandRecordForGeneration(database, {
    ...input,
    driverGeneration: DRIVER_GENERATION,
  });

const getRuntimeCommandRecord = (
  database: D1Database,
  driverInstanceId: DriverInstanceId,
  commandId: DriverCommandId,
) => getRuntimeCommandRecordForGeneration(database, driverInstanceId, DRIVER_GENERATION, commandId);

const updateRuntimeCommandRecord = (
  database: D1Database,
  input: Omit<Parameters<typeof updateRuntimeCommandRecordForGeneration>[1], "driverGeneration">,
) =>
  updateRuntimeCommandRecordForGeneration(database, {
    ...input,
    driverGeneration: DRIVER_GENERATION,
  });

type EffectLookupInput<Operation extends (database: D1Database, input: never) => unknown> = Omit<
  Parameters<Operation>[1],
  "driverGeneration"
>;

const claimExternalToolEffect = (
  database: D1Database,
  input: EffectLookupInput<typeof claimExternalToolEffectRecord>,
) => claimExternalToolEffectRecord(database, { ...input, driverGeneration: DRIVER_GENERATION });

const getExternalToolEffectForCommand = (
  database: D1Database,
  input: EffectLookupInput<typeof getExternalToolEffectForCommandRecord>,
) =>
  getExternalToolEffectForCommandRecord(database, {
    ...input,
    driverGeneration: DRIVER_GENERATION,
  });

const observeExternalToolEffect = (
  database: D1Database,
  input: EffectLookupInput<typeof observeExternalToolEffectRecord>,
) => observeExternalToolEffectRecord(database, { ...input, driverGeneration: DRIVER_GENERATION });

const settleExternalToolEffect = (
  database: D1Database,
  input: EffectLookupInput<typeof settleExternalToolEffectRecord>,
) => settleExternalToolEffectRecord(database, { ...input, driverGeneration: DRIVER_GENERATION });

function succeededSettlementAtSize(byteLength: number) {
  const empty = {
    kind: "succeeded",
    result: { ...MCP_SUCCESS_RESULT, outputText: "" },
  } as const;
  const outputBytes = byteLength - measureMcpExternalToolEffectSettlement(empty);

  if (outputBytes < 0) {
    throw new Error("Requested settlement size is smaller than its fixed fields.");
  }

  return {
    kind: "succeeded" as const,
    result: { ...MCP_SUCCESS_RESULT, outputText: "x".repeat(outputBytes) },
  };
}

function textFieldAtJsonSize<Value>(byteLength: number, create: (text: string) => Value): Value {
  const empty = create("");
  const value = create("x".repeat(byteLength - measureRuntimeCommandJson(empty)));

  expect(measureRuntimeCommandJson(value)).toBe(byteLength);
  return value;
}

function mcpCommandAtSize(byteLength: number) {
  return textFieldAtJsonSize(byteLength, (argumentsJson) => ({
    ...mcpExecuteCommand(MCP_COMMAND_ID),
    argumentsJson,
  }));
}

function inputStartCommandAtSize(byteLength: number) {
  return textFieldAtJsonSize(byteLength, (text) => ({
    ...inputStartCommand(MCP_COMMAND_ID),
    input: { text },
  }));
}

async function commitInputCommandTerminalAuthority(
  database: D1Database,
  input: { error: RunError; status: "failed" } | { error: null; status: "completed" },
): Promise<void> {
  const current = await getSessionRunSummary(database, FINALIZE_RUN_ID);
  if (current === null) {
    throw new Error("Missing Session Run fixture.");
  }

  const timestampMs = Date.now();
  const timestamp = new Date(timestampMs).toISOString();
  const run = {
    ...current,
    completedAt: timestamp,
    error: input.error,
    startedAt: current.startedAt ?? timestamp,
    status: input.status,
    updatedAt: timestamp,
  };
  const kind = input.status === "completed" ? "run.completed" : "run.failed";
  const sourceEventId = createSessionRunTerminalSourceId(FINALIZE_RUN_ID, kind);
  const event =
    input.status === "completed"
      ? createSessionRunUpdatedEvent(run, PUBLIC_API_TEST_IDS.ownerSession, "IDLE", sourceEventId)
      : createFailedSessionRunRuntimeEvent({
          run,
          runError: input.error,
          sessionId: PUBLIC_API_TEST_IDS.ownerSession,
          sourceEventId,
        });

  const outcome = await commitTerminalRunProjection(database, {
    assistantMessage: null,
    error: input.error,
    runId: FINALIZE_RUN_ID,
    sessionId: PUBLIC_API_TEST_IDS.ownerSession,
    source: "api",
    targetStatus: input.status,
    terminalEvent: { event, occurredAt: timestampMs, sourceEventId },
    timestampMs,
  });
  if (outcome.kind === "stale") {
    throw new Error("Session Run terminal authority lost its test setup race.");
  }
}

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

class PersistentEffectDriverIo extends FakeDriverRuntimeIo {
  readonly completedReceipt = Promise.withResolvers<void>();
  readonly effectPersisted = Promise.withResolvers<void>();
  readonly lostCompletedReceipt = Promise.withResolvers<void>();
  readonly #database: SqliteD1Database;
  readonly #driverInstanceId: DriverInstanceId;
  readonly #loseCompletedReceipt: boolean;
  #terminalReceiptObserved = false;

  constructor(input: {
    commands: readonly DriverRuntimeCommand[];
    database: SqliteD1Database;
    driverInstanceId: DriverInstanceId;
    loseCompletedReceipt?: boolean;
  }) {
    super(input.commands, parseRunId(FINALIZE_RUN_ID));
    this.#database = input.database;
    this.#driverInstanceId = input.driverInstanceId;
    this.#loseCompletedReceipt = input.loseCompletedReceipt ?? false;
  }

  override async claimExternalToolEffect(
    input: Parameters<DriverRuntimeIo["claimExternalToolEffect"]>[0],
    _signal: AbortSignal,
  ): ReturnType<DriverRuntimeIo["claimExternalToolEffect"]> {
    return claimExternalToolEffect(this.#database, {
      claimToken: input.claimToken,
      commandId: input.commandId as DriverCommandId,
      driverInstanceId: this.#driverInstanceId,
    });
  }

  override async commandUpdate(
    input: Parameters<DriverRuntimeIo["commandUpdate"]>[0],
    _signal: AbortSignal,
  ): Promise<void> {
    this.updates.push(input);

    if (input.status !== "completed") {
      return;
    }

    this.#terminalReceiptObserved = true;
    if (this.#loseCompletedReceipt) {
      this.lostCompletedReceipt.resolve();
      throw new Error("injected terminal receipt loss after durable effect completion");
    }

    this.completedReceipt.resolve();
  }

  terminalReceiptObserved(): boolean {
    return this.#terminalReceiptObserved;
  }

  override async observeExternalToolEffect(
    input: Parameters<DriverRuntimeIo["observeExternalToolEffect"]>[0],
    _signal: AbortSignal,
  ): ReturnType<DriverRuntimeIo["observeExternalToolEffect"]> {
    return observeExternalToolEffect(this.#database, {
      commandId: input.commandId as DriverCommandId,
      driverInstanceId: this.#driverInstanceId,
    });
  }

  override async settleExternalToolEffect(
    input: Parameters<DriverRuntimeIo["settleExternalToolEffect"]>[0],
    _signal: AbortSignal,
  ): ReturnType<DriverRuntimeIo["settleExternalToolEffect"]> {
    const state = await settleExternalToolEffect(this.#database, {
      claimToken: input.claimToken,
      commandId: input.commandId as DriverCommandId,
      driverInstanceId: this.#driverInstanceId,
      effectId: input.effectId as ExternalToolEffectId,
      settlement: input.settlement,
    });
    if (state.kind === "succeeded") {
      this.effectPersisted.resolve();
    }
    return state;
  }
}

function createPersistentEffectDispatcher(input: {
  io: PersistentEffectDriverIo;
  mcpExecute: AgentDriverMcpExecution["execute"];
}) {
  return createDispatcher({
    backend: createBackend(),
    isShuttingDown: () => input.io.terminalReceiptObserved(),
    mcpExecute: (_command, effect) => input.mcpExecute(effect),
    runtimeState: new DriverRuntimeStateMachine("ready"),
  });
}

function inputStartCommand(id: DriverCommandId): Extract<RuntimeCommand, { kind: "input.start" }> {
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

function mcpExecuteCommand(id: DriverCommandId): Extract<RuntimeCommand, { kind: "mcp.execute" }> {
  return {
    argumentsJson: '{"title":"do not duplicate"}',
    commandId: id,
    kind: "mcp.execute",
    requestId: `request-${id}`,
    runId: FINALIZE_RUN_ID,
    serverId: "01J0000000000000000000000Y",
    toolCallId: `tool-${id}`,
    toolName: "createIssue",
  };
}

async function insertFinalizedDriverLeaseFixture(database: SqliteD1Database): Promise<void> {
  await insertOwnerSession(database);
  await database
    .prepare(
      `
        INSERT INTO sandbox (
          id,
          agent_id,
          project_id,
          owner_account_id,
          incarnation,
          kind,
          network_constraints_hash,
          subject_kind,
          subject_id,
          status,
          bind_mount_ready,
          global_mounts_json,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .bind(
      PUBLIC_API_TEST_IDS.sandbox,
      PUBLIC_API_TEST_IDS.agent,
      PUBLIC_API_TEST_IDS.project,
      PUBLIC_API_TEST_IDS.ownerAccount,
      1,
      "pet",
      "0".repeat(64),
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
          sandbox_incarnation,
          session_id,
          status,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      1,
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
          sandbox_incarnation,
          sandbox_session_id,
          status,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      1,
      PUBLIC_API_TEST_IDS.ownerSession,
      "ready",
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

async function setDriverStatus(
  database: SqliteD1Database,
  status: "ready" | "failed" | "stopped",
): Promise<void> {
  await database
    .prepare("UPDATE driver_instance SET status = ?, updated_at = ? WHERE id = ?")
    .bind(status, Date.now(), PUBLIC_API_TEST_IDS.driverOwner)
    .run();
}

async function createTerminalDriverFixture() {
  const database = await createPublicHttpContractDatabase();
  await insertFinalizedDriverLeaseFixture(database);

  return {
    bindings: createPublicHttpTestBindings(database) as ApiBindings,
    database,
    driverInstanceId: PUBLIC_API_TEST_IDS.driverOwner as DriverInstanceId,
  };
}

async function createReadyMcpEffectFixture(
  command: RuntimeCommand = mcpExecuteCommand(MCP_COMMAND_ID),
) {
  const fixture = await createTerminalDriverFixture();
  await setDriverStatus(fixture.database, "ready");
  await createRuntimeCommandRecord(fixture.database, {
    command,
    driverInstanceId: fixture.driverInstanceId,
    status: "accepted",
  });

  return fixture;
}

async function createClaimedMcpEffectFixture(
  command: Extract<RuntimeCommand, { kind: "mcp.execute" }> = mcpExecuteCommand(MCP_COMMAND_ID),
) {
  const fixture = await createReadyMcpEffectFixture(command);
  const claim = await claimExternalToolEffect(fixture.database, {
    claimToken: MCP_CLAIM_TOKEN,
    commandId: command.commandId as DriverCommandId,
    driverInstanceId: fixture.driverInstanceId,
  });

  if (claim.kind !== "claimed") {
    throw new Error("Expected the test effect to be claimed.");
  }

  return { ...fixture, claim };
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
  const { bindings, database, driverInstanceId } = await createTerminalDriverFixture();

  const startedAt = performance.now();
  await repairFinalizedTerminalDriverRunState(bindings, {
    driverInstanceId,
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
    const { bindings, database, driverInstanceId } = await createTerminalDriverFixture();

    await createRuntimeCommandRecord(database, {
      command: inputStartCommand(FINALIZE_COMMAND_ID),
      driverInstanceId,
      status: "accepted",
    });

    await repairFinalizedTerminalDriverRunState(bindings, {
      driverInstanceId,
      status: "stopped",
    });
    await repairFinalizedTerminalDriverRunState(bindings, {
      driverInstanceId,
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
    const command = await getRuntimeCommandRecord(database, driverInstanceId, FINALIZE_COMMAND_ID);
    const terminalEvents = await readTerminalEvents(database);

    expect(run).toEqual({
      error_code: "runtime.turn_interrupted",
      status: "failed",
    });
    expect(activeLease).toBeNull();
    expect(command?.status).toBe("failed");
    expect(command?.error?.code).toBe("runtime.turn_interrupted");
    expect(terminalEvents).toEqual([
      {
        content_text: TURN_INTERRUPTED_MESSAGE,
        event_type: "run.failed",
        family: "run",
        process_status: "error",
        process_type: "run.failed",
        run_id: FINALIZE_RUN_ID,
        seq: 1,
        source: "driver",
        source_event_id: `session-run-terminal:${FINALIZE_RUN_ID}:run.failed`,
        trace_id: "trace-finalize",
        visibility: "all_consumers",
      },
    ]);
  });

  test("deduplicates dispatch repair after driver finalization", async () => {
    const { bindings, database, driverInstanceId } = await createTerminalDriverFixture();

    await repairFinalizedTerminalDriverRunState(bindings, {
      driverInstanceId,
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
    const { database, driverInstanceId } = await createTerminalDriverFixture();
    await database
      .prepare("UPDATE session_run SET status = 'failed' WHERE id = ?")
      .bind(FINALIZE_RUN_ID)
      .run();

    await expect(
      createRuntimeCommandRecord(database, {
        command: mcpExecuteCommand(MCP_COMMAND_ID),
        driverInstanceId,
        status: "accepted",
      }),
    ).rejects.toThrow("MCP external tool effects require the command's active Session Run.");

    expect(await getRuntimeCommandRecord(database, driverInstanceId, MCP_COMMAND_ID)).toBeNull();
  });

  for (const repair of ["finalizer", "maintenance"] as const) {
    test(`${repair} reports an unclaimed MCP intent as safely retryable`, async () => {
      const { bindings, database, driverInstanceId } = await createTerminalDriverFixture();
      await createRuntimeCommandRecord(database, {
        command: mcpExecuteCommand(MCP_COMMAND_ID),
        driverInstanceId,
        status: "accepted",
      });
      const effect = await getExternalToolEffectForCommand(database, {
        commandId: MCP_COMMAND_ID,
        driverInstanceId,
      });

      if (repair === "finalizer") {
        await repairFinalizedTerminalDriverRunState(bindings, {
          driverInstanceId,
          status: "stopped",
        });
      } else {
        await database
          .prepare("UPDATE driver_instance SET expires_at = ? WHERE id = ?")
          .bind(Date.now() + 60_000, PUBLIC_API_TEST_IDS.driverOwner)
          .run();
        await cleanupDriverInstances(bindings);
      }

      expect(
        await getRuntimeCommandRecord(database, driverInstanceId, MCP_COMMAND_ID),
      ).toMatchObject({
        error: {
          code: "driver.external_tool_effect_not_executed",
          details: {
            commandId: MCP_COMMAND_ID,
            effectId: effect?.id,
          },
          retryable: true,
        },
        status: "failed",
      });
    });
  }

  test("persists the MCP effect intent and fences it as unknown after Driver loss", async () => {
    const { bindings, database, driverInstanceId } = await createReadyMcpEffectFixture();

    const intent = await getExternalToolEffectForCommand(database, {
      commandId: MCP_COMMAND_ID,
      driverInstanceId,
    });
    expect(intent).toMatchObject({
      attemptCount: 0,
      sessionRunId: FINALIZE_RUN_ID,
      status: "intent",
    });
    expect(intent?.idempotencyKey).toHaveLength(26);

    const claim = await claimExternalToolEffect(database, {
      claimToken: MCP_CLAIM_TOKEN,
      commandId: MCP_COMMAND_ID,
      driverInstanceId,
    });
    expect(claim).toMatchObject({ attempt: 1, kind: "claimed" });

    await setDriverStatus(database, "failed");

    await repairFinalizedTerminalDriverRunState(bindings, {
      driverInstanceId,
      status: "failed",
    });

    await expect(
      claimExternalToolEffect(database, {
        claimToken: MCP_OTHER_CLAIM_TOKEN,
        commandId: MCP_COMMAND_ID,
        driverInstanceId,
      }),
    ).resolves.toMatchObject({ kind: "unknown" });
    expect(
      await getExternalToolEffectForCommand(database, {
        commandId: MCP_COMMAND_ID,
        driverInstanceId,
      }),
    ).toMatchObject({ attemptCount: 1, status: "unknown" });
    expect(
      await database
        .prepare("SELECT completed_at, status FROM external_tool_effect_attempt")
        .first<{ completed_at: number; status: string }>(),
    ).toMatchObject({ status: "unknown" });
    const record = await getRuntimeCommandRecord(database, driverInstanceId, MCP_COMMAND_ID);
    expect(record).toMatchObject({
      error: {
        code: "driver.external_tool_effect_unknown",
        details: { effectId: claim.effectId },
      },
      status: "failed",
    });
    if (record?.status !== "failed") {
      throw new Error("Expected repaired MCP failure.");
    }

    const command = mcpExecuteCommand(MCP_COMMAND_ID);
    const failedEvent = createMcpExecuteFailedEventIdentity({
      commandId: MCP_COMMAND_ID,
      rawInput: command.argumentsJson,
      rawOutput: record.error.message,
      title: command.toolName,
      toolCallId: command.toolCallId,
    });
    expect(
      await database
        .prepare(
          "SELECT source_event_id, tool_input_json, tool_output_text, tool_status FROM session_event WHERE mcp_command_id = ?",
        )
        .bind(MCP_COMMAND_ID)
        .first(),
    ).toEqual({
      source_event_id: failedEvent.sourceEventId,
      tool_input_json: failedEvent.payload.rawInput,
      tool_output_text: failedEvent.payload.rawOutput,
      tool_status: "failed",
    });
  });

  test("recovers a lost claim response only for the same claim token", async () => {
    const { database, driverInstanceId } = await createReadyMcpEffectFixture();

    await expect(
      observeExternalToolEffect(database, {
        commandId: MCP_COMMAND_ID,
        driverInstanceId,
      }),
    ).resolves.toMatchObject({ kind: "intent" });

    const first = await claimExternalToolEffect(database, {
      claimToken: MCP_CLAIM_TOKEN,
      commandId: MCP_COMMAND_ID,
      driverInstanceId,
    });
    await expect(
      claimExternalToolEffect(database, {
        claimToken: MCP_CLAIM_TOKEN,
        commandId: MCP_COMMAND_ID,
        driverInstanceId,
      }),
    ).resolves.toEqual(first);
    await expect(
      observeExternalToolEffect(database, {
        commandId: MCP_COMMAND_ID,
        driverInstanceId,
      }),
    ).resolves.toEqual(first);
    expect(
      await database
        .prepare("SELECT COUNT(*) AS count FROM external_tool_effect_attempt")
        .first<{ count: number }>(),
    ).toEqual({ count: 1 });

    await expect(
      claimExternalToolEffect(database, {
        claimToken: MCP_OTHER_CLAIM_TOKEN,
        commandId: MCP_COMMAND_ID,
        driverInstanceId,
      }),
    ).resolves.toMatchObject({ effectId: first.effectId, kind: "unknown" });
    await expect(
      updateRuntimeCommandRecord(database, {
        commandId: MCP_COMMAND_ID,
        driverInstanceId,
        result: MCP_SUCCESS_RESULT,
        status: "completed",
      }),
    ).resolves.toMatchObject({ kind: "rejected", reason: "illegal_transition" });
    expect(
      await database
        .prepare("SELECT claim_token, status FROM external_tool_effect_attempt")
        .first<{ claim_token: string; status: string }>(),
    ).toEqual({ claim_token: MCP_CLAIM_TOKEN, status: "unknown" });
  });

  test("atomically fences both command-terminal and claim-first interleavings", async () => {
    for (const first of ["command", "claim"] as const) {
      const { bindings, database, driverInstanceId } = await createReadyMcpEffectFixture();

      if (first === "claim") {
        await expect(
          claimExternalToolEffect(database, {
            claimToken: MCP_CLAIM_TOKEN,
            commandId: MCP_COMMAND_ID,
            driverInstanceId,
          }),
        ).resolves.toMatchObject({ kind: "claimed" });
      }

      await setDriverStatus(database, "failed");
      await repairFinalizedTerminalDriverRunState(bindings, {
        driverInstanceId,
        status: "failed",
      });

      await expect(
        observeExternalToolEffect(database, {
          commandId: MCP_COMMAND_ID,
          driverInstanceId,
        }),
      ).resolves.toMatchObject({ kind: first === "claim" ? "unknown" : "intent" });
      const replayClaim = claimExternalToolEffect(database, {
        claimToken: MCP_OTHER_CLAIM_TOKEN,
        commandId: MCP_COMMAND_ID,
        driverInstanceId,
      });
      if (first === "claim") {
        await expect(replayClaim).resolves.toMatchObject({ kind: "unknown" });
      } else {
        await expect(replayClaim).rejects.toThrow("did not reach a stable state");
      }
      expect(
        await getRuntimeCommandRecord(database, driverInstanceId, MCP_COMMAND_ID),
      ).toMatchObject({
        error: {
          code:
            first === "claim"
              ? "driver.external_tool_effect_unknown"
              : "driver.external_tool_effect_not_executed",
        },
        status: "failed",
      });

      const attemptCount = await database
        .prepare("SELECT COUNT(*) AS count FROM external_tool_effect_attempt")
        .first<{ count: number }>();
      expect(attemptCount).toEqual({ count: first === "claim" ? 1 : 0 });
    }
  });

  test("returns stored success when settlement acknowledgement is lost", async () => {
    const { claim, database, driverInstanceId } = await createClaimedMcpEffectFixture();
    const settlement = {
      claimToken: MCP_CLAIM_TOKEN,
      commandId: MCP_COMMAND_ID,
      driverInstanceId,
      effectId: claim.effectId as ExternalToolEffectId,
      settlement: {
        kind: "succeeded" as const,
        providerReceiptJson: '{"orderId":"A-1"}',
        result: MCP_SUCCESS_RESULT,
      },
    };

    await expect(
      settleExternalToolEffect(database, {
        ...settlement,
        claimToken: MCP_OTHER_CLAIM_TOKEN,
        settlement: { kind: "unknown" },
      }),
    ).resolves.toEqual(claim);
    await settleExternalToolEffect(database, settlement);
    await expect(
      settleExternalToolEffect(database, {
        ...settlement,
        settlement: {
          kind: "succeeded",
          result: { ...MCP_SUCCESS_RESULT, outputText: "conflicting retry" },
        },
      }),
    ).resolves.toEqual({
      effectId: claim.effectId,
      kind: "succeeded",
      result: MCP_SUCCESS_RESULT,
    });
  });

  test("rejects an oversized succeeded settlement before its ledger batch", async () => {
    const command = mcpCommandAtSize(RUNTIME_COMMAND_MAX_UTF8_BYTES);
    const exact = succeededSettlementAtSize(MCP_EXTERNAL_TOOL_EFFECT_SETTLEMENT_MAX_UTF8_BYTES);
    const oversized = succeededSettlementAtSize(
      MCP_EXTERNAL_TOOL_EFFECT_SETTLEMENT_MAX_UTF8_BYTES + 1,
    );
    expect(measureMcpExternalToolEffectSettlement(exact)).toBe(
      MCP_EXTERNAL_TOOL_EFFECT_SETTLEMENT_MAX_UTF8_BYTES,
    );
    expect(ExternalToolEffectSettlement.allows(exact)).toBeTrue();
    expect(ExternalToolEffectSettlement.allows(oversized)).toBeFalse();

    expect(measureRuntimeCommandJson(command) + measureMcpExternalToolEffectSettlement(exact)).toBe(
      2_000_000 - 128 * 1_024,
    );

    const { bindings, claim, database, driverInstanceId } =
      await createClaimedMcpEffectFixture(command);
    const originalBatch = database.batch.bind(database);
    let batchCalls = 0;
    database.batch = ((statements: D1PreparedStatement[]) => {
      batchCalls += 1;
      return originalBatch(statements);
    }) as typeof database.batch;

    await expect(
      settleExternalToolEffect(database, {
        claimToken: MCP_CLAIM_TOKEN,
        commandId: MCP_COMMAND_ID,
        driverInstanceId,
        effectId: claim.effectId as ExternalToolEffectId,
        settlement: oversized,
      }),
    ).rejects.toThrow(`${MCP_EXTERNAL_TOOL_EFFECT_SETTLEMENT_MAX_UTF8_BYTES} UTF-8 bytes`);
    expect(batchCalls).toBe(0);
    await expect(
      observeExternalToolEffect(database, { commandId: MCP_COMMAND_ID, driverInstanceId }),
    ).resolves.toEqual(claim);
    expect(
      await database
        .prepare(
          "SELECT completed_at, result_json, status FROM external_tool_effect_attempt WHERE effect_id = ?",
        )
        .bind(claim.effectId)
        .first(),
    ).toEqual({ completed_at: null, result_json: null, status: "claimed" });

    await expect(
      settleExternalToolEffect(database, {
        claimToken: MCP_CLAIM_TOKEN,
        commandId: MCP_COMMAND_ID,
        driverInstanceId,
        effectId: claim.effectId as ExternalToolEffectId,
        settlement: exact,
      }),
    ).resolves.toMatchObject({ kind: "succeeded", result: exact.result });
    expect(batchCalls).toBe(1);
    await setDriverStatus(database, "failed");
    await repairFinalizedTerminalDriverRunState(bindings, {
      driverInstanceId,
      status: "failed",
    });
    await expect(
      updateRuntimeCommandRecord(database, {
        commandId: MCP_COMMAND_ID,
        driverInstanceId,
        result: exact.result,
        status: "completed",
      }),
    ).resolves.toMatchObject({ kind: "duplicate" });

    const row = await database
      .prepare("SELECT payload_json, result_json, status FROM driver_command WHERE id = ?")
      .bind(MCP_COMMAND_ID)
      .first<{ payload_json: string; result_json: string; status: string }>();
    expect(row?.status).toBe("completed");
    expect(measureRuntimeCommandJson(JSON.parse(row!.payload_json))).toBe(
      RUNTIME_COMMAND_MAX_UTF8_BYTES,
    );
    expect(measureRuntimeCommandJson(JSON.parse(row!.result_json))).toBe(
      measureRuntimeCommandJson(exact.result),
    );
  });

  test("rejects an oversized command before allocating sequence or effect state", async () => {
    const { database, driverInstanceId } = await createTerminalDriverFixture();
    await setDriverStatus(database, "ready");
    const command = mcpCommandAtSize(RUNTIME_COMMAND_MAX_UTF8_BYTES + 1);
    const originalPrepare = database.prepare;
    let prepareCalls = 0;
    database.prepare = ((query: string) => {
      prepareCalls += 1;
      return originalPrepare.call(database, query);
    }) as typeof database.prepare;

    try {
      await expect(
        createRuntimeCommandRecord(database, {
          command,
          driverInstanceId,
          status: "accepted",
        }),
      ).rejects.toThrow(`Runtime command exceeds ${RUNTIME_COMMAND_MAX_UTF8_BYTES} UTF-8 bytes.`);
    } finally {
      database.prepare = originalPrepare;
    }

    expect(prepareCalls).toBe(0);
    expect(
      await database
        .prepare("SELECT command_seq_cursor FROM driver_instance WHERE id = ?")
        .bind(driverInstanceId)
        .first(),
    ).toEqual({ command_seq_cursor: 0 });
    expect(await database.prepare("SELECT COUNT(*) AS count FROM driver_command").first()).toEqual({
      count: 0,
    });
    expect(
      await database.prepare("SELECT COUNT(*) AS count FROM external_tool_effect").first(),
    ).toEqual({ count: 0 });
  });

  test("stores the maximum command beside the maximum error payload", async () => {
    expect(DURABLE_RUN_ERROR_MAX_UTF8_BYTES).toBe(RUNTIME_COMMAND_TERMINAL_PAYLOAD_MAX_UTF8_BYTES);
    const createError = (message: string): RunError => ({
      code: "driver.failed",
      details: {},
      message,
      retryable: false,
    });
    const exact = textFieldAtJsonSize(RUNTIME_COMMAND_TERMINAL_PAYLOAD_MAX_UTF8_BYTES, createError);
    const oversized = textFieldAtJsonSize(
      RUNTIME_COMMAND_TERMINAL_PAYLOAD_MAX_UTF8_BYTES + 1,
      createError,
    );
    const command = inputStartCommandAtSize(RUNTIME_COMMAND_MAX_UTF8_BYTES);
    const { database, driverInstanceId } = await createReadyMcpEffectFixture(command);
    const update = (error: RunError) =>
      updateRuntimeCommandRecord(database, {
        commandId: MCP_COMMAND_ID,
        driverInstanceId,
        error,
        status: "failed",
      });
    const originalPrepare = database.prepare;
    let prepareCalls = 0;
    database.prepare = ((query: string) => {
      prepareCalls += 1;
      return originalPrepare.call(database, query);
    }) as typeof database.prepare;

    try {
      await expect(update(oversized)).rejects.toThrow(
        `Runtime command terminal payload exceeds ${RUNTIME_COMMAND_TERMINAL_PAYLOAD_MAX_UTF8_BYTES} UTF-8 bytes.`,
      );
    } finally {
      database.prepare = originalPrepare;
    }

    expect(prepareCalls).toBe(0);
    await commitInputCommandTerminalAuthority(database, { error: exact, status: "failed" });
    await expect(update(exact)).resolves.toMatchObject({ kind: "applied" });

    const row = await database
      .prepare(
        "SELECT error_json, payload_json, result_json, status FROM driver_command WHERE id = ?",
      )
      .bind(MCP_COMMAND_ID)
      .first<{
        error_json: string | null;
        payload_json: string;
        result_json: string | null;
        status: string;
      }>();
    expect(row?.status).toBe("failed");
    expect(measureRuntimeCommandJson(JSON.parse(row!.payload_json))).toBe(
      RUNTIME_COMMAND_MAX_UTF8_BYTES,
    );
    expect(measureRuntimeCommandJson(JSON.parse(row!.error_json))).toBe(
      RUNTIME_COMMAND_TERMINAL_PAYLOAD_MAX_UTF8_BYTES,
    );
    expect(row!.result_json).toBeNull();
  });

  test.each(["requestId", "serverId", "toolName"] as const)(
    "rejects a succeeded settlement whose %s does not match the immutable intent",
    async (field) => {
      const { bindings, claim, database, driverInstanceId } = await createClaimedMcpEffectFixture();

      await expect(
        settleExternalToolEffect(database, {
          claimToken: MCP_CLAIM_TOKEN,
          commandId: MCP_COMMAND_ID,
          driverInstanceId,
          effectId: claim.effectId as ExternalToolEffectId,
          settlement: {
            kind: "succeeded",
            result: { ...MCP_SUCCESS_RESULT, [field]: `wrong-${field}` },
          },
        }),
      ).rejects.toThrow("External tool effect result does not match its immutable command intent.");
      await expect(
        observeExternalToolEffect(database, { commandId: MCP_COMMAND_ID, driverInstanceId }),
      ).resolves.toEqual(claim);

      await setDriverStatus(database, "failed");
      await repairFinalizedTerminalDriverRunState(bindings, {
        driverInstanceId,
        status: "failed",
      });

      await expect(
        observeExternalToolEffect(database, { commandId: MCP_COMMAND_ID, driverInstanceId }),
      ).resolves.toMatchObject({ effectId: claim.effectId, kind: "unknown" });
      expect(
        await getRuntimeCommandRecord(database, driverInstanceId, MCP_COMMAND_ID),
      ).toMatchObject({
        error: { code: "driver.external_tool_effect_unknown" },
        status: "failed",
      });
    },
  );

  test("does not collapse an MCP error result into a successful command result", async () => {
    const { bindings, claim, database, driverInstanceId } = await createClaimedMcpEffectFixture();
    const errorResult = { ...MCP_SUCCESS_RESULT, isError: true } as const;
    await settleExternalToolEffect(database, {
      claimToken: MCP_CLAIM_TOKEN,
      commandId: MCP_COMMAND_ID,
      driverInstanceId,
      effectId: claim.effectId as ExternalToolEffectId,
      settlement: { kind: "succeeded", result: errorResult },
    });
    await setDriverStatus(database, "failed");
    await repairFinalizedTerminalDriverRunState(bindings, {
      driverInstanceId,
      status: "failed",
    });

    await expect(
      updateRuntimeCommandRecord(database, {
        commandId: MCP_COMMAND_ID,
        driverInstanceId,
        result: MCP_SUCCESS_RESULT,
        status: "completed",
      }),
    ).rejects.toThrow("duplicate conflicts with its durable terminal payload");
    await expect(
      updateRuntimeCommandRecord(database, {
        commandId: MCP_COMMAND_ID,
        driverInstanceId,
        result: errorResult,
        status: "completed",
      }),
    ).resolves.toMatchObject({ kind: "duplicate" });
    expect(await getRuntimeCommandRecord(database, driverInstanceId, MCP_COMMAND_ID)).toMatchObject(
      {
        result: errorResult,
        status: "completed",
      },
    );
  });

  test("projects the canonical winner of settlement and terminal repair", async () => {
    const { bindings, claim, database, driverInstanceId } = await createClaimedMcpEffectFixture();
    await setDriverStatus(database, "failed");

    await Promise.all([
      settleExternalToolEffect(database, {
        claimToken: MCP_CLAIM_TOKEN,
        commandId: MCP_COMMAND_ID,
        driverInstanceId,
        effectId: claim.effectId as ExternalToolEffectId,
        settlement: { kind: "succeeded", result: MCP_SUCCESS_RESULT },
      }),
      repairFinalizedTerminalDriverRunState(bindings, { driverInstanceId, status: "failed" }),
    ]);

    const state = await observeExternalToolEffect(database, {
      commandId: MCP_COMMAND_ID,
      driverInstanceId,
    });
    await repairFinalizedTerminalDriverRunState(bindings, { driverInstanceId, status: "failed" });
    const command = await getRuntimeCommandRecord(database, driverInstanceId, MCP_COMMAND_ID);

    if (state.kind === "succeeded") {
      expect(command).toMatchObject({ result: MCP_SUCCESS_RESULT, status: "completed" });
    } else {
      expect(state.kind).toBe("unknown");
      expect(command).toMatchObject({
        error: {
          code: "driver.external_tool_effect_unknown",
          details: { effectId: claim.effectId },
        },
        status: "failed",
      });
    }
    expect(
      await database
        .prepare("SELECT completed_at, status FROM external_tool_effect_attempt")
        .first<{ completed_at: number | null; status: string }>(),
    ).toMatchObject({ completed_at: expect.any(Number), status: state.kind });
  });

  test("retains an unknown MCP effect after terminal Driver maintenance", async () => {
    const { bindings, database, driverInstanceId } = await createClaimedMcpEffectFixture();
    await setDriverStatus(database, "stopped");
    await cleanupDriverInstances(bindings);

    expect(
      await database
        .prepare("SELECT id FROM driver_instance WHERE id = ?")
        .bind(PUBLIC_API_TEST_IDS.driverOwner)
        .first<{ id: string }>(),
    ).toEqual({ id: PUBLIC_API_TEST_IDS.driverOwner });
    expect(
      await getExternalToolEffectForCommand(database, {
        commandId: MCP_COMMAND_ID,
        driverInstanceId,
      }),
    ).toMatchObject({ status: "unknown" });
    expect(await getRuntimeCommandRecord(database, driverInstanceId, MCP_COMMAND_ID)).toMatchObject(
      {
        error: { code: "driver.external_tool_effect_unknown" },
        status: "failed",
      },
    );
  });

  test("redelivers a persisted successful MCP result without a second provider invocation", async () => {
    const { bindings, claim, database, driverInstanceId } = await createClaimedMcpEffectFixture();
    await settleExternalToolEffect(database, {
      claimToken: MCP_CLAIM_TOKEN,
      commandId: MCP_COMMAND_ID,
      driverInstanceId,
      effectId: claim.effectId as ExternalToolEffectId,
      settlement: {
        kind: "succeeded",
        providerReceiptJson: '{"orderId":"A-1"}',
        result: MCP_SUCCESS_RESULT,
      },
    });

    await expect(
      claimExternalToolEffect(database, {
        claimToken: MCP_OTHER_CLAIM_TOKEN,
        commandId: MCP_COMMAND_ID,
        driverInstanceId,
      }),
    ).resolves.toMatchObject({
      kind: "succeeded",
      result: {
        outputText: "created issue A-1",
        requestId: "request-01J0000000000000000000000X",
        serverId: "01J0000000000000000000000Y",
        toolName: "createIssue",
      },
    });
    await expect(
      updateRuntimeCommandRecord(database, {
        commandId: MCP_COMMAND_ID,
        driverInstanceId,
        result: { ...MCP_SUCCESS_RESULT, outputText: "not the stored result" },
        status: "completed",
      }),
    ).resolves.toMatchObject({ kind: "rejected", reason: "illegal_transition" });
    await setDriverStatus(database, "failed");
    await repairFinalizedTerminalDriverRunState(bindings, {
      driverInstanceId,
      status: "failed",
    });
    expect(await getRuntimeCommandRecord(database, driverInstanceId, MCP_COMMAND_ID)).toMatchObject(
      { result: MCP_SUCCESS_RESULT, status: "completed" },
    );
    expect(
      await getExternalToolEffectForCommand(database, {
        commandId: MCP_COMMAND_ID,
        driverInstanceId,
      }),
    ).toMatchObject({ providerReceiptJson: '{"orderId":"A-1"}', status: "succeeded" });
    expect(
      await database
        .prepare("SELECT provider_receipt_json FROM external_tool_effect_attempt")
        .first<{ provider_receipt_json: string | null }>(),
    ).toEqual({ provider_receipt_json: '{"orderId":"A-1"}' });
  });

  test("restarts a real Driver dispatcher without replaying a persisted MCP effect", async () => {
    const command = mcpExecuteCommand(MCP_COMMAND_ID) as DriverRuntimeCommand;
    const { database, driverInstanceId } = await createReadyMcpEffectFixture(command);

    let providerCalls = 0;
    const firstIo = new PersistentEffectDriverIo({
      commands: [command],
      database,
      driverInstanceId,
      loseCompletedReceipt: true,
    });
    const first = createPersistentEffectDispatcher({
      io: firstIo,
      mcpExecute: async () => {
        providerCalls += 1;
        return {
          outputText: "created issue A-1",
          providerReceiptJson: '{"orderId":"A-1"}',
          requestId: command.requestId,
          serverId: command.serverId,
          toolName: command.toolName,
        };
      },
    });

    const firstRun = first.dispatcher.run(firstIo, first.logger);
    await Promise.all([
      expect(firstRun).rejects.toThrow("terminal status could not be delivered"),
      promiseWithTimeout(firstIo.effectPersisted.promise, {
        label: "durable MCP effect persistence",
        timeoutMs: DISPATCHER_TEST_PHASE_TIMEOUT_MS,
      }),
      promiseWithTimeout(firstIo.lostCompletedReceipt.promise, {
        label: "lost MCP completion receipt",
        timeoutMs: DISPATCHER_TEST_PHASE_TIMEOUT_MS,
      }),
    ]);
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
    await promiseWithTimeout(secondIo.completedReceipt.promise, {
      label: "replayed MCP completion receipt",
      timeoutMs: DISPATCHER_TEST_PHASE_TIMEOUT_MS,
    });
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
