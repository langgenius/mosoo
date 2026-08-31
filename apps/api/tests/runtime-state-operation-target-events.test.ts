import { describe, expect, test } from "bun:test";

import { sandboxSessionsTable } from "@mosoo/db";
import {
  createRuntimeEventSemanticHash,
  parseRuntimeEventEnvelope,
  stringifyRuntimeEventSemanticValue,
} from "@mosoo/runtime-events";

import { toRuntimeDiagnosticBaseValue } from "../src/modules/runtime/application/runtime-diagnostic-events";
import { buildRuntimeStateOperationEvents } from "../src/modules/runtime/application/runtime-state-operation-events";
import {
  appendRuntimeDriverRestartAttemptedEvents,
  appendRuntimeSubjectTerminatedEvents,
  commitRuntimeOperationReadySnapshots,
  writeRuntimeOperationInterruptedSnapshots,
  writeRuntimeOperationTimedOutSnapshots,
} from "../src/modules/runtime/application/runtime-state-operation-target-events";
import {
  adoptRuntimeOperationReadyReceipt,
  claimRuntimeOperationTargets,
} from "../src/modules/runtime/application/runtime-state-operation-target-store";
import type { RuntimeSessionTarget } from "../src/modules/runtime/application/runtime-state-operation-target-store";
import { recordCanonicalSessionRunTerminal } from "../src/modules/runtime/application/session-runs/session-run-terminal-failure.service";
import { createSessionRuntimeEventProjection } from "../src/modules/sessions/domain/session-runtime-event-projection";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  PUBLIC_API_TEST_IDS,
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  insertActiveSandboxSessionFixture,
  insertNonOwnerSession,
  insertOwnerSession,
  nowMsForTest,
} from "./helpers/public-api-http-test-fixture";

async function insertRunningSessionRun(
  database: D1Database,
  input: {
    accountId: string;
    runId: string;
    sessionId: string;
  } = {
    accountId: PUBLIC_API_TEST_IDS.nonOwnerAccount,
    runId: PUBLIC_API_TEST_IDS.run,
    sessionId: PUBLIC_API_TEST_IDS.nonOwnerSession,
  },
): Promise<void> {
  await database
    .prepare(
      `
        INSERT INTO session_run (
          id,
          session_id,
          agent_id,
          created_by_account_id,
          trigger,
          status,
          provider,
          model,
          runtime_id,
          trace_id,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .bind(
      input.runId,
      input.sessionId,
      PUBLIC_API_TEST_IDS.agent,
      input.accountId,
      "user_prompt",
      "running",
      "openai",
      "gpt-5.4",
      "openai-runtime",
      "trace-operation",
      1,
      1,
    )
    .run();
  await database
    .prepare("UPDATE session SET last_run_id = ?, status = ? WHERE id = ?")
    .bind(input.runId, "RUNNING", input.sessionId)
    .run();
}

async function readRuntimeTarget(database: D1Database): Promise<RuntimeSessionTarget> {
  const row = await database
    .prepare(
      `SELECT last_run_id, runtime_event_seq_cursor, status, status_operation_id,
              status_seq, updated_at
         FROM session
        WHERE id = ?`,
    )
    .bind(PUBLIC_API_TEST_IDS.nonOwnerSession)
    .first<{
      last_run_id: RuntimeSessionTarget["lastRunId"];
      runtime_event_seq_cursor: number;
      status: RuntimeSessionTarget["sessionStatus"];
      status_operation_id: RuntimeSessionTarget["sessionStatusOperationId"];
      status_seq: number;
      updated_at: number;
    }>();
  if (row === null) {
    throw new Error("Missing runtime operation target fixture.");
  }
  return createRuntimeTarget({
    agentId: PUBLIC_API_TEST_IDS.agent,
    creatorAccountId: PUBLIC_API_TEST_IDS.nonOwnerAccount,
    lastRunId: row.last_run_id,
    sandboxId: PUBLIC_API_TEST_IDS.sandbox,
    sessionId: PUBLIC_API_TEST_IDS.nonOwnerSession,
    sessionRuntimeEventSeqCursor: row.runtime_event_seq_cursor,
    sessionStatus: row.status,
    sessionStatusOperationId: row.status_operation_id,
    sessionStatusSeq: row.status_seq,
    sessionUpdatedAt: row.updated_at,
  });
}

async function rewriteTerminalAuthority(
  database: D1Database,
  rewrite: (value: Record<string, unknown>) => Record<string, unknown>,
): Promise<void> {
  const row = await database
    .prepare(
      `SELECT terminal_event_json
         FROM session_event
        WHERE run_id = ?
          AND event_type IN ('run.cancelled', 'run.completed', 'run.failed')`,
    )
    .bind(PUBLIC_API_TEST_IDS.run)
    .first<{ terminal_event_json: string | null }>();
  if (row?.terminal_event_json === null || row === null) {
    throw new Error("Missing terminal semantic authority fixture.");
  }
  const event = parseRuntimeEventEnvelope(rewrite(JSON.parse(row.terminal_event_json)));
  const projection = createSessionRuntimeEventProjection(event);
  await database
    .prepare(
      `UPDATE session_event
          SET content_text = ?, semantic_hash = ?, stream_id = ?, terminal_event_json = ?
        WHERE run_id = ?
          AND event_type IN ('run.cancelled', 'run.completed', 'run.failed')`,
    )
    .bind(
      projection.contentText,
      await createRuntimeEventSemanticHash(event),
      projection.streamId,
      stringifyRuntimeEventSemanticValue(event),
      PUBLIC_API_TEST_IDS.run,
    )
    .run();
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected a record fixture value.");
  }
  return value as Record<string, unknown>;
}

function createRuntimeDiagnosticTargets(): RuntimeSessionTarget[] {
  return [
    createRuntimeTarget({
      agentId: PUBLIC_API_TEST_IDS.agent,
      creatorAccountId: PUBLIC_API_TEST_IDS.nonOwnerAccount,
      lastRunId: null,
      sandboxId: PUBLIC_API_TEST_IDS.sandbox,
      sessionId: PUBLIC_API_TEST_IDS.nonOwnerSession,
      sessionStatus: "IDLE",
    }),
    createRuntimeTarget({
      agentId: PUBLIC_API_TEST_IDS.agent,
      creatorAccountId: PUBLIC_API_TEST_IDS.ownerAccount,
      lastRunId: null,
      sandboxId: PUBLIC_API_TEST_IDS.sandbox,
      sessionId: PUBLIC_API_TEST_IDS.ownerSession,
      sessionStatus: "IDLE",
    }),
    createRuntimeTarget({
      agentId: null,
      creatorAccountId: PUBLIC_API_TEST_IDS.nonOwnerAccount,
      lastRunId: null,
      sandboxId: PUBLIC_API_TEST_IDS.sandbox,
      sessionId: "session-without-agent",
      sessionStatus: "IDLE",
    }),
  ];
}

async function insertLiveDriverInstance(
  database: D1Database,
  input: {
    driverInstanceId: string;
    sessionId: string;
    tokenByte: number;
  },
): Promise<void> {
  await database
    .prepare(
      `
        INSERT INTO driver_instance (
          id,
          sandbox_id,
          sandbox_incarnation,
          sandbox_session_id,
          runtime,
          protocol,
          protocol_version,
          status,
          boot_token_hash,
          boot_token_expires_at,
          heartbeat_count,
          expires_at,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .bind(
      input.driverInstanceId,
      PUBLIC_API_TEST_IDS.sandbox,
      1,
      input.sessionId,
      "cloudflare-container",
      "driver-ws",
      1,
      "ready",
      new Uint8Array([input.tokenByte]),
      10_000,
      0,
      20_000,
      1,
      1,
    )
    .run();
}

function createRuntimeTarget(
  input: Omit<
    RuntimeSessionTarget,
    | "sessionRuntimeEventSeqCursor"
    | "sessionStatusOperationId"
    | "sessionStatusSeq"
    | "sessionUpdatedAt"
  > & {
    readonly sessionRuntimeEventSeqCursor?: number;
    readonly sessionStatusOperationId?: RuntimeSessionTarget["sessionStatusOperationId"];
    readonly sessionStatusSeq?: number;
    readonly sessionUpdatedAt?: number;
  },
): RuntimeSessionTarget {
  return {
    ...input,
    sessionRuntimeEventSeqCursor: input.sessionRuntimeEventSeqCursor ?? 0,
    sessionStatusOperationId: input.sessionStatusOperationId ?? null,
    sessionStatusSeq: input.sessionStatusSeq ?? 0,
    sessionUpdatedAt: input.sessionUpdatedAt ?? nowMsForTest(),
  };
}

function createExistingRuntimeDiagnosticTargets(): RuntimeSessionTarget[] {
  return createRuntimeDiagnosticTargets().filter((target) => target.agentId !== null);
}

async function createAdoptableRuntimeOperationReadyReceipt(database: D1Database): Promise<{
  readonly target: RuntimeSessionTarget;
}> {
  await insertNonOwnerSession(database);
  const bindings = createPublicHttpTestBindings(database) as ApiBindings;
  const [updatingEvent, readyEvent] = buildRuntimeStateOperationEvents({
    agentId: PUBLIC_API_TEST_IDS.agent,
    operation: "restartDriver",
    readyAt: "2026-05-08T00:00:01.000Z",
    startedAt: "2026-05-08T00:00:00.000Z",
  });
  const [claimed] = await claimRuntimeOperationTargets(database, {
    event: updatingEvent,
    operationId: PUBLIC_API_TEST_IDS.operation,
    targets: createExistingRuntimeDiagnosticTargets().slice(0, 1),
  });
  if (claimed === undefined) {
    throw new Error("Missing runtime operation claim fixture.");
  }
  await commitRuntimeOperationReadySnapshots(bindings, {
    event: readyEvent,
    operationId: PUBLIC_API_TEST_IDS.operation,
    targets: [claimed.current],
  });
  await database
    .prepare(
      `UPDATE session
          SET status = 'RESCHEDULING',
              status_operation_id = ?,
              status_seq = status_seq + 1
        WHERE id = ?`,
    )
    .bind(PUBLIC_API_TEST_IDS.operation, PUBLIC_API_TEST_IDS.nonOwnerSession)
    .run();

  return { target: await readRuntimeTarget(database) };
}

async function rewriteRuntimeOperationAuthority(
  database: D1Database,
  status: "ready" | "updating",
  rewrite: (event: Record<string, unknown>) => Record<string, unknown>,
): Promise<void> {
  const sourceEventId = `runtime-operation:${PUBLIC_API_TEST_IDS.operation}:${PUBLIC_API_TEST_IDS.nonOwnerSession}:${status}`;
  const row = await database
    .prepare(
      `SELECT runtime_operation_event_json
         FROM session_event
        WHERE session_id = ? AND source_event_id = ?`,
    )
    .bind(PUBLIC_API_TEST_IDS.nonOwnerSession, sourceEventId)
    .first<{ runtime_operation_event_json: string | null }>();
  if (row?.runtime_operation_event_json === null || row === null) {
    throw new Error(`Missing runtime operation ${status} authority fixture.`);
  }
  const event = parseRuntimeEventEnvelope(rewrite(JSON.parse(row.runtime_operation_event_json)));
  await database
    .prepare(
      `UPDATE session_event
          SET runtime_operation_event_json = ?, semantic_hash = ?
        WHERE session_id = ? AND source_event_id = ?`,
    )
    .bind(
      stringifyRuntimeEventSemanticValue(event),
      await createRuntimeEventSemanticHash(event),
      PUBLIC_API_TEST_IDS.nonOwnerSession,
      sourceEventId,
    )
    .run();
}

function raceRuntimeOperationReadyAdoption(
  database: D1Database,
  race: () => Promise<void>,
): { readonly database: D1Database; readonly raced: () => boolean } {
  let raced = false;

  function wrap(statement: D1PreparedStatement, shouldRace: boolean): D1PreparedStatement {
    return new Proxy(statement, {
      get(target, property, receiver) {
        if (property === "bind") {
          return (...values: unknown[]) => wrap(target.bind(...values), shouldRace);
        }
        if (property === "run" && shouldRace) {
          return async () => {
            if (!raced) {
              raced = true;
              await race();
            }
            return target.run();
          };
        }
        return Reflect.get(target, property, receiver);
      },
    });
  }

  return {
    database: new Proxy(database, {
      get(target, property) {
        if (property === "prepare") {
          return (query: string) =>
            wrap(
              target.prepare(query),
              query.includes("UPDATE session") &&
                query.includes("runtime_operation_event_json = ?"),
            );
        }
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }),
    raced: () => raced,
  };
}

describe("runtime state operation target events", () => {
  test("operation events carry the target deployment version", () => {
    const events = buildRuntimeStateOperationEvents({
      agentId: PUBLIC_API_TEST_IDS.agent,
      operation: "restartDriver",
      readyAt: "2026-05-08T00:00:01.000Z",
      startedAt: "2026-05-08T00:00:00.000Z",
      targetVersion: {
        id: PUBLIC_API_TEST_IDS.deployment,
        versionNumber: 1,
      },
    });

    expect(events).toEqual([
      {
        agentId: PUBLIC_API_TEST_IDS.agent,
        deploymentVersionId: PUBLIC_API_TEST_IDS.deployment,
        deploymentVersionNumber: 1,
        observedAt: "2026-05-08T00:00:00.000Z",
        operation: "restartDriver",
        status: "updating",
      },
      {
        agentId: PUBLIC_API_TEST_IDS.agent,
        deploymentVersionId: PUBLIC_API_TEST_IDS.deployment,
        deploymentVersionNumber: 1,
        observedAt: "2026-05-08T00:00:01.000Z",
        operation: "restartDriver",
        status: "ready",
      },
    ]);
  });

  test("diagnostic base values carry the target deployment version", () => {
    expect(
      toRuntimeDiagnosticBaseValue({
        agentId: PUBLIC_API_TEST_IDS.agent,
        deploymentVersion: {
          id: PUBLIC_API_TEST_IDS.deployment,
          versionNumber: 1,
        },
        sessionId: PUBLIC_API_TEST_IDS.nonOwnerSession,
      }),
    ).toEqual({
      agentId: PUBLIC_API_TEST_IDS.agent,
      deploymentVersionId: PUBLIC_API_TEST_IDS.deployment,
      deploymentVersionNumber: 1,
      sessionId: PUBLIC_API_TEST_IDS.nonOwnerSession,
    });
  });

  test("interrupt snapshots cancel running runs with an operation error", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(database);
    await insertRunningSessionRun(database);

    const bindings = createPublicHttpTestBindings(database) as ApiBindings;
    await database
      .prepare("UPDATE session SET status = ?, status_operation_id = ? WHERE id = ?")
      .bind("RESCHEDULING", PUBLIC_API_TEST_IDS.operation, PUBLIC_API_TEST_IDS.nonOwnerSession)
      .run();
    const targets: RuntimeSessionTarget[] = [
      createRuntimeTarget({
        agentId: PUBLIC_API_TEST_IDS.agent,
        creatorAccountId: PUBLIC_API_TEST_IDS.nonOwnerAccount,
        lastRunId: PUBLIC_API_TEST_IDS.run,
        sandboxId: PUBLIC_API_TEST_IDS.sandbox,
        sessionId: PUBLIC_API_TEST_IDS.nonOwnerSession,
        sessionStatus: "RESCHEDULING",
        sessionStatusOperationId: PUBLIC_API_TEST_IDS.operation,
      }),
    ];

    await writeRuntimeOperationInterruptedSnapshots(bindings, {
      operationId: PUBLIC_API_TEST_IDS.operation,
      timestampMs: nowMsForTest(),
      targets,
    });

    const run = await database
      .prepare("SELECT error_code, status FROM session_run WHERE id = ?")
      .bind(PUBLIC_API_TEST_IDS.run)
      .first<{ error_code: string | null; status: string }>();
    expect(run).toEqual({
      error_code: "agent.runtime_state_operation",
      status: "cancelled",
    });
  });

  test("interrupt snapshots persist events for each target session", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(database);
    await insertOwnerSession(database);
    await insertRunningSessionRun(database);
    await insertRunningSessionRun(database, {
      accountId: PUBLIC_API_TEST_IDS.ownerAccount,
      runId: PUBLIC_API_TEST_IDS.runAlt,
      sessionId: PUBLIC_API_TEST_IDS.ownerSession,
    });

    const bindings = createPublicHttpTestBindings(database) as ApiBindings;
    await database
      .prepare("UPDATE session SET status = ?, status_operation_id = ?")
      .bind("RESCHEDULING", PUBLIC_API_TEST_IDS.operation)
      .run();
    const targets: RuntimeSessionTarget[] = [
      createRuntimeTarget({
        agentId: PUBLIC_API_TEST_IDS.agent,
        creatorAccountId: PUBLIC_API_TEST_IDS.nonOwnerAccount,
        lastRunId: PUBLIC_API_TEST_IDS.run,
        sandboxId: PUBLIC_API_TEST_IDS.sandbox,
        sessionId: PUBLIC_API_TEST_IDS.nonOwnerSession,
        sessionStatus: "RESCHEDULING",
        sessionStatusOperationId: PUBLIC_API_TEST_IDS.operation,
      }),
      createRuntimeTarget({
        agentId: PUBLIC_API_TEST_IDS.agent,
        creatorAccountId: PUBLIC_API_TEST_IDS.ownerAccount,
        lastRunId: PUBLIC_API_TEST_IDS.runAlt,
        sandboxId: PUBLIC_API_TEST_IDS.sandbox,
        sessionId: PUBLIC_API_TEST_IDS.ownerSession,
        sessionStatus: "RESCHEDULING",
        sessionStatusOperationId: PUBLIC_API_TEST_IDS.operation,
      }),
    ];

    await writeRuntimeOperationInterruptedSnapshots(bindings, {
      operationId: PUBLIC_API_TEST_IDS.operation,
      timestampMs: nowMsForTest(),
      targets,
    });

    const runs = await database
      .prepare(
        `
          SELECT id, status
          FROM session_run
          ORDER BY id
        `,
      )
      .all<{ id: string; status: string }>();
    expect(runs.results).toEqual([
      { id: PUBLIC_API_TEST_IDS.run, status: "cancelled" },
      { id: PUBLIC_API_TEST_IDS.runAlt, status: "cancelled" },
    ]);
    const events = await database
      .prepare(
        `
          SELECT seq, session_id
          FROM session_event
          ORDER BY session_id
        `,
      )
      .all<{ seq: number; session_id: string }>();
    expect(
      events.results.map((event) => ({ seq: event.seq, sessionId: event.session_id })),
    ).toEqual([
      { seq: 1, sessionId: PUBLIC_API_TEST_IDS.nonOwnerSession },
      { seq: 1, sessionId: PUBLIC_API_TEST_IDS.ownerSession },
    ]);
  });

  test("preserves a terminal lifecycle winner during interrupted recovery", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(database);
    await insertRunningSessionRun(database);
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;
    await recordCanonicalSessionRunTerminal(bindings, {
      assistantMessage: null,
      deliver: false,
      error: {
        code: "driver.command_failed",
        details: {},
        message: "Driver failed before recovery.",
        retryable: false,
      },
      lifecycle: "TERMINATED",
      runId: PUBLIC_API_TEST_IDS.run,
      sessionId: PUBLIC_API_TEST_IDS.nonOwnerSession,
      source: "maintenance",
      status: "failed",
      timestampMs: 2,
    });
    await database
      .prepare(
        `UPDATE session
            SET status = 'RESCHEDULING', status_operation_id = ?,
                status_seq = status_seq + 1, updated_at = 3
          WHERE id = ?`,
      )
      .bind(PUBLIC_API_TEST_IDS.operation, PUBLIC_API_TEST_IDS.nonOwnerSession)
      .run();

    await writeRuntimeOperationInterruptedSnapshots(bindings, {
      operationId: PUBLIC_API_TEST_IDS.operation,
      targets: [await readRuntimeTarget(database)],
      timestampMs: 3,
    });

    await expect(
      database
        .prepare("SELECT status, status_operation_id FROM session WHERE id = ?")
        .bind(PUBLIC_API_TEST_IDS.nonOwnerSession)
        .first(),
    ).resolves.toEqual({ status: "TERMINATED", status_operation_id: null });
  });

  test("terminated subject events are written for target sessions", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(database);
    await insertOwnerSession(database);

    const bindings = createPublicHttpTestBindings(database) as ApiBindings;

    await appendRuntimeSubjectTerminatedEvents(bindings, {
      reason: "runtime_state_operation.recreate",
      runtimeSubjectId: PUBLIC_API_TEST_IDS.sandbox,
      targets: createRuntimeDiagnosticTargets(),
    });

    const rows = await database
      .prepare(
        `
          SELECT event_type, seq, session_id
          FROM session_event
          ORDER BY session_id
        `,
      )
      .all<{
        event_type: string;
        seq: number;
        session_id: string;
      }>();
    expect(rows.results.map((row) => ({ seq: row.seq, sessionId: row.session_id }))).toEqual([
      { seq: 1, sessionId: PUBLIC_API_TEST_IDS.nonOwnerSession },
      { seq: 1, sessionId: PUBLIC_API_TEST_IDS.ownerSession },
    ]);
    expect(rows.results.every((row) => row.event_type === "runtime.sandbox.updated")).toBe(true);
  });

  test("driver restart attempted events are written for target sessions", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(database);
    await insertOwnerSession(database);
    await insertActiveSandboxSessionFixture(database, {
      ownerAccountId: PUBLIC_API_TEST_IDS.nonOwnerAccount,
      sandboxId: PUBLIC_API_TEST_IDS.sandbox,
      sessionId: PUBLIC_API_TEST_IDS.nonOwnerSession,
    });
    await database
      .app()
      .insert(sandboxSessionsTable)
      .values({
        createdAt: nowMsForTest(),
        cwd: `/workspace/se/${PUBLIC_API_TEST_IDS.ownerSession}`,
        originJson: JSON.stringify({
          callerUserId: PUBLIC_API_TEST_IDS.ownerAccount,
          entrypoint: "api",
          executionOwnerUserId: PUBLIC_API_TEST_IDS.ownerAccount,
          type: "agent",
        }),
        sandboxId: PUBLIC_API_TEST_IDS.sandbox,
        sandboxIncarnation: 1,
        sandboxSessionId: PUBLIC_API_TEST_IDS.driverOwner,
        sessionId: PUBLIC_API_TEST_IDS.ownerSession,
        status: "active",
        updatedAt: nowMsForTest(),
      })
      .run();
    await insertLiveDriverInstance(database, {
      driverInstanceId: PUBLIC_API_TEST_IDS.driverNonOwner,
      sessionId: PUBLIC_API_TEST_IDS.nonOwnerSession,
      tokenByte: 1,
    });
    await insertLiveDriverInstance(database, {
      driverInstanceId: PUBLIC_API_TEST_IDS.driverOwner,
      sessionId: PUBLIC_API_TEST_IDS.ownerSession,
      tokenByte: 2,
    });

    const bindings = createPublicHttpTestBindings(database) as ApiBindings;

    await appendRuntimeDriverRestartAttemptedEvents(bindings, {
      targetVersion: null,
      targets: createRuntimeDiagnosticTargets(),
    });

    const rows = await database
      .prepare(
        `
          SELECT event_type, seq, session_id
          FROM session_event
          ORDER BY session_id
        `,
      )
      .all<{
        event_type: string;
        seq: number;
        session_id: string;
      }>();
    expect(rows.results.map((row) => ({ seq: row.seq, sessionId: row.session_id }))).toEqual([
      { seq: 1, sessionId: PUBLIC_API_TEST_IDS.nonOwnerSession },
      { seq: 1, sessionId: PUBLIC_API_TEST_IDS.ownerSession },
    ]);
    expect(rows.results.every((row) => row.event_type === "runtime.driver.updated")).toBe(true);
  });

  test("ready snapshots atomically release operation-owned target sessions", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(database);
    await insertOwnerSession(database);

    const bindings = createPublicHttpTestBindings(database) as ApiBindings;
    const [updatingEvent, readyEvent] = buildRuntimeStateOperationEvents({
      agentId: PUBLIC_API_TEST_IDS.agent,
      operation: "restartDriver",
      readyAt: "2026-05-08T00:00:01.000Z",
      startedAt: "2026-05-08T00:00:00.000Z",
    });

    const claimed = await claimRuntimeOperationTargets(database, {
      event: updatingEvent,
      operationId: PUBLIC_API_TEST_IDS.operation,
      targets: createExistingRuntimeDiagnosticTargets(),
    });
    await commitRuntimeOperationReadySnapshots(bindings, {
      event: readyEvent,
      operationId: PUBLIC_API_TEST_IDS.operation,
      targets: claimed.map((transition) => transition.current),
    });

    const rows = await database
      .prepare(
        `
          SELECT event_type, runtime_operation_event_json, seq, session_id, source_event_id
          FROM session_event
          ORDER BY session_id, seq
        `,
      )
      .all<{
        event_type: string;
        runtime_operation_event_json: string | null;
        seq: number;
        session_id: string;
        source_event_id: string;
      }>();
    expect(rows.results.map((row) => ({ seq: row.seq, sessionId: row.session_id }))).toEqual([
      { seq: 1, sessionId: PUBLIC_API_TEST_IDS.nonOwnerSession },
      { seq: 2, sessionId: PUBLIC_API_TEST_IDS.nonOwnerSession },
      { seq: 1, sessionId: PUBLIC_API_TEST_IDS.ownerSession },
      { seq: 2, sessionId: PUBLIC_API_TEST_IDS.ownerSession },
    ]);
    expect(rows.results.every((row) => row.event_type === "agent.task.updated")).toBe(true);
    expect(
      rows.results.map((row) => ({
        authority: row.runtime_operation_event_json === null ? "legacy" : "canonical",
        source: row.source_event_id.endsWith(":ready") ? "ready" : "updating",
      })),
    ).toEqual([
      { authority: "canonical", source: "updating" },
      { authority: "canonical", source: "ready" },
      { authority: "canonical", source: "updating" },
      { authority: "canonical", source: "ready" },
    ]);
    expect(
      await database.prepare("SELECT status, status_operation_id FROM session ORDER BY id").all(),
    ).toMatchObject({
      results: expect.arrayContaining([
        { status: "IDLE", status_operation_id: null },
        { status: "IDLE", status_operation_id: null },
      ]),
    });
  });

  test("adopts one canonical ready receipt and acknowledges its replay", async () => {
    const database = await createPublicHttpContractDatabase();
    const { target } = await createAdoptableRuntimeOperationReadyReceipt(database);
    const input = { operationId: PUBLIC_API_TEST_IDS.operation, target };

    await expect(adoptRuntimeOperationReadyReceipt(database, input)).resolves.toBe("applied");
    await expect(adoptRuntimeOperationReadyReceipt(database, input)).resolves.toBe("duplicate");
    await expect(
      database
        .prepare("SELECT status, status_operation_id FROM session WHERE id = ?")
        .bind(PUBLIC_API_TEST_IDS.nonOwnerSession)
        .first(),
    ).resolves.toEqual({ status: "IDLE", status_operation_id: null });
  });

  test("rejects an updating event forged behind the ready source receipt", async () => {
    const database = await createPublicHttpContractDatabase();
    const { target } = await createAdoptableRuntimeOperationReadyReceipt(database);
    const sourceEventId = `runtime-operation:${PUBLIC_API_TEST_IDS.operation}:${PUBLIC_API_TEST_IDS.nonOwnerSession}:ready`;
    const row = await database
      .prepare(
        `SELECT runtime_operation_event_json
           FROM session_event
          WHERE session_id = ? AND source_event_id = ?`,
      )
      .bind(PUBLIC_API_TEST_IDS.nonOwnerSession, sourceEventId)
      .first<{ runtime_operation_event_json: string | null }>();
    if (row?.runtime_operation_event_json === null || row === null) {
      throw new Error("Missing runtime operation ready authority fixture.");
    }
    const ready = parseRuntimeEventEnvelope(JSON.parse(row.runtime_operation_event_json));
    const payload = requireRecord(ready.payload);
    const updating = parseRuntimeEventEnvelope({
      ...ready,
      payload: {
        agentId: payload["agentId"],
        operation: payload["operation"],
        operationId: payload["operationId"],
        startedAt: ready.occurredAt,
        status: "updating",
      },
    });
    await database
      .prepare(
        `UPDATE session_event
            SET runtime_operation_event_json = NULL, semantic_hash = ?
          WHERE session_id = ? AND source_event_id = ?`,
      )
      .bind(
        await createRuntimeEventSemanticHash(updating),
        PUBLIC_API_TEST_IDS.nonOwnerSession,
        sourceEventId,
      )
      .run();

    await expect(
      adoptRuntimeOperationReadyReceipt(database, {
        operationId: PUBLIC_API_TEST_IDS.operation,
        target,
      }),
    ).rejects.toThrow("has no semantic authority");
    await expect(
      database
        .prepare("SELECT status, status_operation_id FROM session WHERE id = ?")
        .bind(PUBLIC_API_TEST_IDS.nonOwnerSession)
        .first(),
    ).resolves.toEqual({
      status: "RESCHEDULING",
      status_operation_id: PUBLIC_API_TEST_IDS.operation,
    });
  });

  test("requires the canonical updating claim before adopting ready", async () => {
    const database = await createPublicHttpContractDatabase();
    const { target } = await createAdoptableRuntimeOperationReadyReceipt(database);
    await database
      .prepare(
        `DELETE FROM session_event
          WHERE session_id = ? AND source_event_id LIKE 'runtime-operation:%:updating'`,
      )
      .bind(PUBLIC_API_TEST_IDS.nonOwnerSession)
      .run();

    await expect(
      adoptRuntimeOperationReadyReceipt(database, {
        operationId: PUBLIC_API_TEST_IDS.operation,
        target,
      }),
    ).rejects.toThrow("has no canonical claim");
  });

  test("rejects a self-consistent claim payload mutation", async () => {
    const database = await createPublicHttpContractDatabase();
    const { target } = await createAdoptableRuntimeOperationReadyReceipt(database);
    await rewriteRuntimeOperationAuthority(database, "updating", (event) => ({
      ...event,
      payload: { ...requireRecord(event["payload"]), forged: true },
    }));

    await expect(
      adoptRuntimeOperationReadyReceipt(database, {
        operationId: PUBLIC_API_TEST_IDS.operation,
        target,
      }),
    ).rejects.toThrow("updating source");
  });

  test("fails closed for self-consistent ready authority identity corruption", async () => {
    const corruptions: readonly {
      readonly rewrite: (event: Record<string, unknown>) => Record<string, unknown>;
    }[] = [
      {
        rewrite: (event) => ({
          ...event,
          payload: { ...requireRecord(event["payload"]), forged: true },
        }),
      },
      {
        rewrite: (event) => ({ ...event, sourceEventId: "forged-runtime-operation-ready" }),
      },
      {
        rewrite: (event) => ({ ...event, sessionId: PUBLIC_API_TEST_IDS.ownerSession }),
      },
      {
        rewrite: (event) => ({
          ...event,
          payload: {
            ...requireRecord(event["payload"]),
            operationId: PUBLIC_API_TEST_IDS.deployment,
          },
        }),
      },
      {
        rewrite: (event) => ({
          ...event,
          payload: {
            ...requireRecord(event["payload"]),
            agentId: PUBLIC_API_TEST_IDS.ownerAccount,
          },
        }),
      },
      {
        rewrite: (event) => ({
          ...event,
          payload: {
            ...requireRecord(event["payload"]),
            operation: "recreateSandbox",
          },
        }),
      },
      {
        rewrite: (event) => ({
          ...event,
          payload: {
            ...requireRecord(event["payload"]),
            deploymentVersionId: PUBLIC_API_TEST_IDS.deployment,
            deploymentVersionNumber: 1,
          },
        }),
      },
      {
        rewrite: (event) => ({ ...event, visibility: "owner_debug" }),
      },
      {
        rewrite: (event) => ({ ...event, actor: "system", origin: "system" }),
      },
    ];

    for (const corruption of corruptions) {
      const database = await createPublicHttpContractDatabase();
      const { target } = await createAdoptableRuntimeOperationReadyReceipt(database);
      await rewriteRuntimeOperationAuthority(database, "ready", corruption.rewrite);

      await expect(
        adoptRuntimeOperationReadyReceipt(database, {
          operationId: PUBLIC_API_TEST_IDS.operation,
          target,
        }),
      ).rejects.toThrow("ready source");
      await expect(
        database
          .prepare("SELECT status, status_operation_id FROM session WHERE id = ?")
          .bind(PUBLIC_API_TEST_IDS.nonOwnerSession)
          .first(),
      ).resolves.toEqual({
        status: "RESCHEDULING",
        status_operation_id: PUBLIC_API_TEST_IDS.operation,
      });
    }
  });

  test("recomputes the ready authority hash before adopting it", async () => {
    const database = await createPublicHttpContractDatabase();
    const { target } = await createAdoptableRuntimeOperationReadyReceipt(database);
    await database
      .prepare(
        `UPDATE session_event
            SET semantic_hash = ?
          WHERE session_id = ? AND source_event_id LIKE 'runtime-operation:%:ready'`,
      )
      .bind("0".repeat(64), PUBLIC_API_TEST_IDS.nonOwnerSession)
      .run();

    await expect(
      adoptRuntimeOperationReadyReceipt(database, {
        operationId: PUBLIC_API_TEST_IDS.operation,
        target,
      }),
    ).rejects.toThrow("is not canonical");
  });

  test("does not cross either receipt mutation that races the adoption CAS", async () => {
    for (const status of ["updating", "ready"] as const) {
      const database = await createPublicHttpContractDatabase();
      const { target } = await createAdoptableRuntimeOperationReadyReceipt(database);
      const racing = raceRuntimeOperationReadyAdoption(database, async () => {
        await database
          .prepare(
            `UPDATE session_event
                SET semantic_hash = ?
              WHERE session_id = ? AND source_event_id LIKE ?`,
          )
          .bind(
            "f".repeat(64),
            PUBLIC_API_TEST_IDS.nonOwnerSession,
            `runtime-operation:%:${status}`,
          )
          .run();
      });

      await expect(
        adoptRuntimeOperationReadyReceipt(racing.database, {
          operationId: PUBLIC_API_TEST_IDS.operation,
          target,
        }),
      ).rejects.toThrow("is not canonical");
      expect(racing.raced()).toBe(true);
      await expect(
        database
          .prepare("SELECT status, status_operation_id FROM session WHERE id = ?")
          .bind(PUBLIC_API_TEST_IDS.nonOwnerSession)
          .first(),
      ).resolves.toEqual({
        status: "RESCHEDULING",
        status_operation_id: PUBLIC_API_TEST_IDS.operation,
      });
    }
  });

  test("operation start cannot cross an active runtime provisioning fence", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(database);
    await database
      .prepare(
        `UPDATE session
            SET runtime_provisioning_heartbeat_at = 1,
                runtime_provisioning_operation_id = ?,
                runtime_provisioning_sandbox_id = ?
          WHERE id = ?`,
      )
      .bind(
        PUBLIC_API_TEST_IDS.operation,
        PUBLIC_API_TEST_IDS.sandbox,
        PUBLIC_API_TEST_IDS.nonOwnerSession,
      )
      .run();
    const [updatingEvent] = buildRuntimeStateOperationEvents({
      agentId: PUBLIC_API_TEST_IDS.agent,
      operation: "restartDriver",
      readyAt: "2026-05-08T00:00:01.000Z",
      startedAt: "2026-05-08T00:00:00.000Z",
    });

    expect(
      await claimRuntimeOperationTargets(database, {
        event: updatingEvent,
        operationId: PUBLIC_API_TEST_IDS.operation,
        targets: createExistingRuntimeDiagnosticTargets().slice(0, 1),
      }),
    ).toEqual([]);
    expect(
      await database
        .prepare(
          `SELECT runtime_event_seq_cursor,
                  runtime_provisioning_operation_id,
                  status,
                  status_operation_id
             FROM session
            WHERE id = ?`,
        )
        .bind(PUBLIC_API_TEST_IDS.nonOwnerSession)
        .first(),
    ).toEqual({
      runtime_event_seq_cursor: 0,
      runtime_provisioning_operation_id: PUBLIC_API_TEST_IDS.operation,
      status: "IDLE",
      status_operation_id: null,
    });
    expect(
      await database
        .prepare("SELECT COUNT(*) AS count FROM session_event WHERE session_id = ?")
        .bind(PUBLIC_API_TEST_IDS.nonOwnerSession)
        .first(),
    ).toEqual({ count: 0 });
  });

  test("ready wins atomically when operation timeout races its release", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(database);
    await database
      .prepare("UPDATE session SET updated_at = 1 WHERE id = ?")
      .bind(PUBLIC_API_TEST_IDS.nonOwnerSession)
      .run();
    const [updatingEvent, readyEvent] = buildRuntimeStateOperationEvents({
      agentId: PUBLIC_API_TEST_IDS.agent,
      operation: "restartDriver",
      readyAt: "1970-01-01T00:00:00.002Z",
      startedAt: "1970-01-01T00:00:00.001Z",
    });
    const [claimed] = await claimRuntimeOperationTargets(database, {
      event: updatingEvent,
      operationId: PUBLIC_API_TEST_IDS.operation,
      targets: [
        createRuntimeTarget({
          agentId: PUBLIC_API_TEST_IDS.agent,
          creatorAccountId: PUBLIC_API_TEST_IDS.nonOwnerAccount,
          lastRunId: null,
          sandboxId: PUBLIC_API_TEST_IDS.sandbox,
          sessionId: PUBLIC_API_TEST_IDS.nonOwnerSession,
          sessionStatus: "IDLE",
          sessionUpdatedAt: 1,
        }),
      ],
    });
    if (claimed === undefined) {
      throw new Error("Missing runtime operation claim fixture.");
    }
    const readyBindings = createPublicHttpTestBindings(database) as ApiBindings;
    let raced = false;
    const racingDatabase = new Proxy(database, {
      get(target, property) {
        if (property === "batch") {
          return async (statements: D1PreparedStatement[]) => {
            if (!raced) {
              raced = true;
              await commitRuntimeOperationReadySnapshots(readyBindings, {
                event: readyEvent,
                operationId: PUBLIC_API_TEST_IDS.operation,
                targets: [claimed.current],
              });
            }
            return target.batch(statements);
          };
        }

        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as D1Database;

    await writeRuntimeOperationTimedOutSnapshots(
      {
        ...(createPublicHttpTestBindings(database) as ApiBindings),
        DB: racingDatabase,
      },
      { operationId: PUBLIC_API_TEST_IDS.operation, targets: [claimed.current] },
    );

    expect(raced).toBe(true);
    await expect(
      database
        .prepare("SELECT status, status_operation_id FROM session WHERE id = ?")
        .bind(PUBLIC_API_TEST_IDS.nonOwnerSession)
        .first(),
    ).resolves.toEqual({ status: "IDLE", status_operation_id: null });
    await expect(
      database
        .prepare(
          `SELECT source_event_id
             FROM session_event
            WHERE source_event_id LIKE 'runtime-operation:%'
            ORDER BY seq`,
        )
        .all(),
    ).resolves.toMatchObject({
      results: [
        {
          source_event_id: `runtime-operation:${PUBLIC_API_TEST_IDS.operation}:${PUBLIC_API_TEST_IDS.nonOwnerSession}:updating`,
        },
        {
          source_event_id: `runtime-operation:${PUBLIC_API_TEST_IDS.operation}:${PUBLIC_API_TEST_IDS.nonOwnerSession}:ready`,
        },
      ],
    });
  });

  test("timed out snapshots expire running runs and persist target events", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(database);
    await insertOwnerSession(database);
    await insertRunningSessionRun(database);

    const bindings = createPublicHttpTestBindings(database) as ApiBindings;
    await database
      .prepare("UPDATE session SET status = ?, status_operation_id = ? WHERE id = ?")
      .bind("RESCHEDULING", PUBLIC_API_TEST_IDS.operation, PUBLIC_API_TEST_IDS.nonOwnerSession)
      .run();
    await database
      .prepare("UPDATE session SET status_operation_id = ? WHERE id = ?")
      .bind(PUBLIC_API_TEST_IDS.operation, PUBLIC_API_TEST_IDS.ownerSession)
      .run();
    const targets: RuntimeSessionTarget[] = [
      createRuntimeTarget({
        agentId: PUBLIC_API_TEST_IDS.agent,
        creatorAccountId: PUBLIC_API_TEST_IDS.nonOwnerAccount,
        lastRunId: PUBLIC_API_TEST_IDS.run,
        sandboxId: PUBLIC_API_TEST_IDS.sandbox,
        sessionId: PUBLIC_API_TEST_IDS.nonOwnerSession,
        sessionStatus: "RESCHEDULING",
        sessionStatusOperationId: PUBLIC_API_TEST_IDS.operation,
      }),
      createRuntimeTarget({
        agentId: PUBLIC_API_TEST_IDS.agent,
        creatorAccountId: PUBLIC_API_TEST_IDS.ownerAccount,
        lastRunId: null,
        sandboxId: PUBLIC_API_TEST_IDS.sandbox,
        sessionId: PUBLIC_API_TEST_IDS.ownerSession,
        sessionStatus: "IDLE",
        sessionStatusOperationId: PUBLIC_API_TEST_IDS.operation,
      }),
    ];

    await writeRuntimeOperationTimedOutSnapshots(bindings, {
      operationId: PUBLIC_API_TEST_IDS.operation,
      targets,
    });

    const run = await database
      .prepare("SELECT status FROM session_run WHERE id = ?")
      .bind(PUBLIC_API_TEST_IDS.run)
      .first<{ status: string }>();
    expect(run).toEqual({ status: "expired" });
    const events = await database
      .prepare(
        `
          SELECT seq, session_id
          FROM session_event
          ORDER BY session_id
        `,
      )
      .all<{ seq: number; session_id: string }>();
    expect(
      events.results.map((event) => ({ seq: event.seq, sessionId: event.session_id })),
    ).toEqual([
      { seq: 1, sessionId: PUBLIC_API_TEST_IDS.nonOwnerSession },
      { seq: 1, sessionId: PUBLIC_API_TEST_IDS.ownerSession },
    ]);
  });

  test("preserves a terminal lifecycle winner while releasing its operation fence", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(database);
    await insertRunningSessionRun(database);
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;
    await recordCanonicalSessionRunTerminal(bindings, {
      assistantMessage: null,
      deliver: false,
      error: {
        code: "driver.command_failed",
        details: {},
        message: "Driver failed before the operation completed.",
        retryable: false,
      },
      lifecycle: "TERMINATED",
      runId: PUBLIC_API_TEST_IDS.run,
      sessionId: PUBLIC_API_TEST_IDS.nonOwnerSession,
      source: "maintenance",
      status: "failed",
      timestampMs: 2,
    });
    await database
      .prepare(
        `UPDATE session
            SET status = 'RESCHEDULING', status_operation_id = ?,
                status_seq = status_seq + 1, updated_at = 3
          WHERE id = ?`,
      )
      .bind(PUBLIC_API_TEST_IDS.operation, PUBLIC_API_TEST_IDS.nonOwnerSession)
      .run();

    await writeRuntimeOperationTimedOutSnapshots(bindings, {
      operationId: PUBLIC_API_TEST_IDS.operation,
      targets: [await readRuntimeTarget(database)],
    });

    await expect(
      database
        .prepare("SELECT status, status_operation_id FROM session WHERE id = ?")
        .bind(PUBLIC_API_TEST_IDS.nonOwnerSession)
        .first(),
    ).resolves.toEqual({ status: "TERMINATED", status_operation_id: null });
  });

  test("does not release an operation from a self-consistent missing final authority", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(database);
    await insertRunningSessionRun(database);
    await database
      .prepare("UPDATE session SET status = ?, status_operation_id = ? WHERE id = ?")
      .bind("RESCHEDULING", PUBLIC_API_TEST_IDS.operation, PUBLIC_API_TEST_IDS.nonOwnerSession)
      .run();
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;
    await recordCanonicalSessionRunTerminal(bindings, {
      assistantMessage: null,
      deliver: false,
      error: null,
      lifecycle: "IDLE",
      runId: PUBLIC_API_TEST_IDS.run,
      sessionId: PUBLIC_API_TEST_IDS.nonOwnerSession,
      source: "driver",
      status: "completed",
      timestampMs: 2,
    });
    await rewriteTerminalAuthority(database, (value) => ({
      ...value,
      payload: {
        ...requireRecord(value.payload),
        finalMessageId: "01J0000000000000000000000M",
      },
    }));
    const target = await readRuntimeTarget(database);

    await expect(
      writeRuntimeOperationTimedOutSnapshots(bindings, {
        operationId: PUBLIC_API_TEST_IDS.operation,
        targets: [target],
      }),
    ).rejects.toThrow("Canonical final assistant");
    await expect(
      database
        .prepare("SELECT status, status_operation_id FROM session WHERE id = ?")
        .bind(PUBLIC_API_TEST_IDS.nonOwnerSession)
        .first(),
    ).resolves.toEqual({ status: "IDLE", status_operation_id: PUBLIC_API_TEST_IDS.operation });
  });

  test("does not release an operation from a self-consistent conflicting Run error", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(database);
    await insertRunningSessionRun(database);
    await database
      .prepare("UPDATE session SET status = ?, status_operation_id = ? WHERE id = ?")
      .bind("RESCHEDULING", PUBLIC_API_TEST_IDS.operation, PUBLIC_API_TEST_IDS.nonOwnerSession)
      .run();
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;
    await recordCanonicalSessionRunTerminal(bindings, {
      assistantMessage: null,
      deliver: false,
      error: {
        code: "driver.command_failed",
        details: {},
        message: "A",
        retryable: false,
      },
      lifecycle: "IDLE",
      runId: PUBLIC_API_TEST_IDS.run,
      sessionId: PUBLIC_API_TEST_IDS.nonOwnerSession,
      source: "driver",
      status: "failed",
      timestampMs: 2,
    });
    const conflictingError = {
      code: "driver.command_failed",
      details: {},
      message: "B",
      retryable: false,
    };
    await rewriteTerminalAuthority(database, (value) => {
      const payload = requireRecord(value.payload);
      return {
        ...value,
        payload: {
          ...payload,
          error: conflictingError,
          run: { ...requireRecord(payload.run), error: conflictingError },
        },
      };
    });
    const target = await readRuntimeTarget(database);

    await expect(
      writeRuntimeOperationTimedOutSnapshots(bindings, {
        operationId: PUBLIC_API_TEST_IDS.operation,
        targets: [target],
      }),
    ).rejects.toThrow("persisted RunError");
    await expect(
      database
        .prepare("SELECT status, status_operation_id FROM session WHERE id = ?")
        .bind(PUBLIC_API_TEST_IDS.nonOwnerSession)
        .first(),
    ).resolves.toEqual({ status: "IDLE", status_operation_id: PUBLIC_API_TEST_IDS.operation });
  });

  test("retries a timeout from the fresh target after losing its lifecycle CAS", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(database);
    await database
      .prepare("UPDATE session SET status = ?, status_operation_id = ? WHERE id = ?")
      .bind("RESCHEDULING", PUBLIC_API_TEST_IDS.operation, PUBLIC_API_TEST_IDS.nonOwnerSession)
      .run();
    const target = await readRuntimeTarget(database);
    let raced = false;
    const racingDatabase = new Proxy(database, {
      get(source, property) {
        if (property === "batch") {
          return async (statements: D1PreparedStatement[]) => {
            if (!raced) {
              raced = true;
              await source
                .prepare(
                  `UPDATE session
                      SET runtime_event_seq_cursor = runtime_event_seq_cursor + 1,
                          updated_at = updated_at + 1
                    WHERE id = ?`,
                )
                .bind(PUBLIC_API_TEST_IDS.nonOwnerSession)
                .run();
            }
            return source.batch(statements);
          };
        }
        const value = Reflect.get(source, property);
        return typeof value === "function" ? value.bind(source) : value;
      },
    }) as D1Database;

    await writeRuntimeOperationTimedOutSnapshots(
      {
        ...(createPublicHttpTestBindings(database) as ApiBindings),
        DB: racingDatabase,
      },
      { operationId: PUBLIC_API_TEST_IDS.operation, targets: [target] },
    );
    expect(raced).toBe(true);
    await expect(
      database
        .prepare("SELECT status, status_operation_id FROM session WHERE id = ?")
        .bind(PUBLIC_API_TEST_IDS.nonOwnerSession)
        .first(),
    ).resolves.toEqual({
      status: "TERMINATED",
      status_operation_id: null,
    });
  });
});
