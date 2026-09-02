import { describe, expect, test } from "bun:test";

import { buildRuntimeStateOperationEvents } from "../src/modules/runtime/application/runtime-state-operation-events";
import { commitRuntimeOperationReadySnapshots } from "../src/modules/runtime/application/runtime-state-operation-target-events";
import { claimRuntimeOperationTargets } from "../src/modules/runtime/application/runtime-state-operation-target-store";
import { recordCanonicalSessionRunTerminal } from "../src/modules/runtime/application/session-runs/session-run-terminal-failure.service";
import {
  expireStaleReschedulingSessions,
  repairStaleRuntimeOperationTargets,
  runSandboxMaintenance,
} from "../src/modules/runtime/infrastructure/runtime-subject-lifecycle/runtime-subject-maintenance.service";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  PUBLIC_API_TEST_IDS,
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  insertActiveSandboxSessionFixture,
  insertNonOwnerSession,
  insertOwnerSession,
} from "./helpers/public-api-http-test-fixture";
import type { SqliteD1Database } from "./helpers/sqlite-d1";

const RESCHEDULING_RUN_ID = "01J0000000000000000000000R";

async function insertRunningSessionRun(database: D1Database): Promise<void> {
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
      RESCHEDULING_RUN_ID,
      "01J0000000000000000000000B",
      "01J00000000000000000000009",
      "01J00000000000000000000002",
      "user_prompt",
      "running",
      "openai",
      "gpt-5.4",
      "openai-runtime",
      "trace-rescheduling",
      1,
      1,
    )
    .run();
  await database
    .prepare("UPDATE session SET last_run_id = ?, status = ?, updated_at = ? WHERE id = ?")
    .bind(RESCHEDULING_RUN_ID, "RESCHEDULING", 1, "01J0000000000000000000000B")
    .run();
}

async function insertSandboxSession(database: SqliteD1Database): Promise<void> {
  await insertActiveSandboxSessionFixture(database, {
    cwd: "/workspace",
    ownerAccountId: PUBLIC_API_TEST_IDS.nonOwnerAccount,
    sandboxId: PUBLIC_API_TEST_IDS.sandbox,
    sandboxSessionId: "01J0000000000000000000000S",
    sessionId: PUBLIC_API_TEST_IDS.nonOwnerSession,
    timestampMs: 1,
  });
}

function beforeFirstBatch(database: D1Database, action: () => Promise<void>): D1Database {
  let raced = false;

  return new Proxy(database, {
    get(target, property) {
      if (property === "batch") {
        return async (statements: D1PreparedStatement[]) => {
          if (!raced) {
            raced = true;
            await action();
          }
          return target.batch(statements);
        };
      }

      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

describe("runtime subject maintenance", () => {
  test("continues later maintenance after a terminal projection is poisoned", async () => {
    const database = await createPublicHttpContractDatabase();
    await Promise.all([insertOwnerSession(database), insertNonOwnerSession(database)]);
    await database
      .prepare(
        `INSERT INTO session_run (
           id, session_id, agent_id, created_by_account_id, trigger, status,
           provider, model, runtime_id, trace_id, started_at, completed_at,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, 'user_prompt', 'completed', 'openai', 'gpt-5.4',
                   'openai-runtime', 'trace-poisoned-terminal', 1, 1, 1, 1)`,
      )
      .bind(
        PUBLIC_API_TEST_IDS.run,
        PUBLIC_API_TEST_IDS.ownerSession,
        PUBLIC_API_TEST_IDS.agent,
        PUBLIC_API_TEST_IDS.ownerAccount,
      )
      .run();
    await database
      .prepare(
        `INSERT INTO session_message (
           content_text, created_at, created_by_account_id, id, plan_json,
           projection_format, role, segments_json, seq, session_id, session_run_id
         ) VALUES ('invalid carrier', 1, ?, ?, NULL, 'materialized', 'assistant',
                   NULL, 1, ?, ?)`,
      )
      .bind(
        PUBLIC_API_TEST_IDS.ownerAccount,
        PUBLIC_API_TEST_IDS.run,
        PUBLIC_API_TEST_IDS.ownerSession,
        PUBLIC_API_TEST_IDS.run,
      )
      .run();
    await database
      .prepare("UPDATE session SET last_run_id = ?, status = 'IDLE' WHERE id = ?")
      .bind(PUBLIC_API_TEST_IDS.run, PUBLIC_API_TEST_IDS.ownerSession)
      .run();
    await database
      .prepare("UPDATE session SET status = 'RESCHEDULING', updated_at = 1 WHERE id = ?")
      .bind(PUBLIC_API_TEST_IDS.nonOwnerSession)
      .run();

    await runSandboxMaintenance(createPublicHttpTestBindings(database) as ApiBindings);

    await expect(
      database
        .prepare("SELECT status FROM session WHERE id = ?")
        .bind(PUBLIC_API_TEST_IDS.nonOwnerSession)
        .first(),
    ).resolves.toEqual({ status: "TERMINATED" });
    await expect(
      database
        .prepare("SELECT terminal_reconciliation_attempted_at FROM session_run WHERE id = ?")
        .bind(PUBLIC_API_TEST_IDS.run)
        .first(),
    ).resolves.toMatchObject({
      terminal_reconciliation_attempted_at: expect.any(Number),
    });
  });

  test("expires stale rescheduling sessions", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(database);
    await insertRunningSessionRun(database);

    const bindings = createPublicHttpTestBindings(database) as ApiBindings;

    await expireStaleReschedulingSessions(bindings);
    await expireStaleReschedulingSessions(bindings);

    const run = await database
      .prepare("SELECT error_code, status FROM session_run WHERE id = ?")
      .bind(RESCHEDULING_RUN_ID)
      .first<{ error_code: string | null; status: string }>();
    expect(run).toEqual({
      error_code: "session.rescheduling_timeout",
      status: "failed",
    });
    const session = await database
      .prepare("SELECT status FROM session WHERE id = ?")
      .bind("01J0000000000000000000000B")
      .first<{ status: string }>();
    const terminalEvents = await database
      .prepare("SELECT COUNT(*) AS count FROM session_event WHERE run_id = ? AND event_type = ?")
      .bind(RESCHEDULING_RUN_ID, "run.failed")
      .first<{ count: number }>();
    expect(session).toEqual({ status: "TERMINATED" });
    expect(terminalEvents).toEqual({ count: 1 });
  });

  test("does not expire runtime operation owned rescheduling sessions", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(database);
    await insertRunningSessionRun(database);
    await database
      .prepare("UPDATE session SET status_operation_id = ? WHERE id = ?")
      .bind("01J0000000000000000000000R", "01J0000000000000000000000B")
      .run();
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;

    await expireStaleReschedulingSessions(bindings);

    const session = await database
      .prepare("SELECT status, status_operation_id FROM session WHERE id = ?")
      .bind("01J0000000000000000000000B")
      .first<{ status: string; status_operation_id: string | null }>();
    const run = await database
      .prepare("SELECT error_code, status FROM session_run WHERE id = ?")
      .bind(RESCHEDULING_RUN_ID)
      .first<{ error_code: string | null; status: string }>();

    expect(session).toEqual({
      status: "RESCHEDULING",
      status_operation_id: "01J0000000000000000000000R",
    });
    expect(run).toEqual({
      error_code: null,
      status: "running",
    });
  });

  test("does not append a lifecycle timeout after a no-Run Session reconnects", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(database);
    await database
      .prepare(
        `UPDATE session
            SET status = 'RESCHEDULING', status_seq = 1, updated_at = 1
          WHERE id = ?`,
      )
      .bind(PUBLIC_API_TEST_IDS.nonOwnerSession)
      .run();
    const racingDatabase = beforeFirstBatch(database, async () => {
      await database
        .prepare(
          `UPDATE session
              SET status = 'RUNNING', status_seq = status_seq + 1, updated_at = 2
            WHERE id = ?`,
        )
        .bind(PUBLIC_API_TEST_IDS.nonOwnerSession)
        .run();
    });

    await expireStaleReschedulingSessions({
      ...(createPublicHttpTestBindings(database) as ApiBindings),
      DB: racingDatabase,
    });

    await expect(
      database
        .prepare("SELECT status, status_seq, updated_at FROM session WHERE id = ?")
        .bind(PUBLIC_API_TEST_IDS.nonOwnerSession)
        .first(),
    ).resolves.toEqual({ status: "RUNNING", status_seq: 2, updated_at: 2 });
    await expect(
      database.prepare("SELECT COUNT(*) AS count FROM session_event").first(),
    ).resolves.toEqual({ count: 0 });
  });

  test("does not fail an active Run after its stale Session reconnects", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(database);
    await insertRunningSessionRun(database);
    const racingDatabase = beforeFirstBatch(database, async () => {
      await database
        .prepare(
          `UPDATE session
              SET status = 'RUNNING', status_seq = status_seq + 1, updated_at = 2
            WHERE id = ?`,
        )
        .bind(PUBLIC_API_TEST_IDS.nonOwnerSession)
        .run();
    });

    await expireStaleReschedulingSessions({
      ...(createPublicHttpTestBindings(database) as ApiBindings),
      DB: racingDatabase,
    });

    await expect(
      database
        .prepare("SELECT error_code, status FROM session_run WHERE id = ?")
        .bind(RESCHEDULING_RUN_ID)
        .first(),
    ).resolves.toEqual({ error_code: null, status: "running" });
    await expect(
      database
        .prepare("SELECT status, status_seq, updated_at FROM session WHERE id = ?")
        .bind(PUBLIC_API_TEST_IDS.nonOwnerSession)
        .first(),
    ).resolves.toEqual({ status: "RUNNING", status_seq: 1, updated_at: 2 });
    await expect(
      database.prepare("SELECT COUNT(*) AS count FROM session_event").first(),
    ).resolves.toEqual({ count: 0 });
  });

  test("converges an operation target after the atomic start claim crashes", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(database);
    await insertRunningSessionRun(database);
    await insertSandboxSession(database);
    await database
      .prepare("UPDATE session SET status = 'RUNNING' WHERE id = ?")
      .bind(PUBLIC_API_TEST_IDS.nonOwnerSession)
      .run();
    const operationId = PUBLIC_API_TEST_IDS.operation;
    const [updatingEvent] = buildRuntimeStateOperationEvents({
      agentId: PUBLIC_API_TEST_IDS.agent,
      operation: "restartDriver",
      readyAt: "1970-01-01T00:00:00.002Z",
      startedAt: "1970-01-01T00:00:00.001Z",
    });
    const claimed = await claimRuntimeOperationTargets(database, {
      event: updatingEvent,
      operationId,
      targets: [
        {
          agentId: PUBLIC_API_TEST_IDS.agent,
          creatorAccountId: PUBLIC_API_TEST_IDS.nonOwnerAccount,
          lastRunId: RESCHEDULING_RUN_ID,
          sandboxId: PUBLIC_API_TEST_IDS.sandbox,
          sessionId: PUBLIC_API_TEST_IDS.nonOwnerSession,
          sessionRuntimeEventSeqCursor: 0,
          sessionStatus: "RUNNING",
          sessionStatusOperationId: null,
          sessionStatusSeq: 0,
          sessionUpdatedAt: 1,
        },
      ],
    });
    expect(claimed).toHaveLength(1);
    expect(
      await database
        .prepare("SELECT status, status_operation_id, updated_at FROM session WHERE id = ?")
        .bind(PUBLIC_API_TEST_IDS.nonOwnerSession)
        .first(),
    ).toEqual({
      status: "RESCHEDULING",
      status_operation_id: operationId,
      updated_at: 1,
    });
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;

    expect(
      await repairStaleRuntimeOperationTargets(bindings, {
        limit: 10,
        staleUpdatedAtLte: 1,
      }),
    ).toBe(1);
    expect(
      await repairStaleRuntimeOperationTargets(bindings, {
        limit: 10,
        staleUpdatedAtLte: 1,
      }),
    ).toBe(0);

    expect(
      await database
        .prepare(
          `SELECT session.status AS session_status,
                  session.status_operation_id,
                  session_run.completed_at,
                  session_run.error_code,
                  session_run.status AS run_status
             FROM session
             JOIN session_run ON session_run.id = session.last_run_id
            WHERE session.id = ?`,
        )
        .bind(PUBLIC_API_TEST_IDS.nonOwnerSession)
        .first(),
    ).toEqual({
      completed_at: 120_001,
      error_code: "agent.runtime_state_operation_timeout",
      run_status: "expired",
      session_status: "TERMINATED",
      status_operation_id: null,
    });
    expect(
      await database
        .prepare(
          `SELECT event_type, occurred_at
             FROM session_event
            WHERE run_id = ? OR event_type = 'agent.task.updated'
            ORDER BY seq`,
        )
        .bind(RESCHEDULING_RUN_ID)
        .all(),
    ).toMatchObject({
      results: [
        { event_type: "agent.task.updated", occurred_at: 1 },
        { event_type: "run.cancelled", occurred_at: 120_001 },
      ],
    });
  });

  test("leaves a durable ready winner unchanged during maintenance", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(database);
    await insertSandboxSession(database);
    await database
      .prepare("UPDATE session SET updated_at = 1 WHERE id = ?")
      .bind(PUBLIC_API_TEST_IDS.nonOwnerSession)
      .run();
    const operationId = PUBLIC_API_TEST_IDS.operation;
    const [updatingEvent, readyEvent] = buildRuntimeStateOperationEvents({
      agentId: PUBLIC_API_TEST_IDS.agent,
      operation: "restartDriver",
      readyAt: "1970-01-01T00:00:00.002Z",
      startedAt: "1970-01-01T00:00:00.001Z",
    });
    const [claimed] = await claimRuntimeOperationTargets(database, {
      event: updatingEvent,
      operationId,
      targets: [
        {
          agentId: PUBLIC_API_TEST_IDS.agent,
          creatorAccountId: PUBLIC_API_TEST_IDS.nonOwnerAccount,
          lastRunId: null,
          sandboxId: PUBLIC_API_TEST_IDS.sandbox,
          sessionId: PUBLIC_API_TEST_IDS.nonOwnerSession,
          sessionRuntimeEventSeqCursor: 0,
          sessionStatus: "IDLE",
          sessionStatusOperationId: null,
          sessionStatusSeq: 0,
          sessionUpdatedAt: 1,
        },
      ],
    });
    if (claimed === undefined) {
      throw new Error("Missing runtime operation claim fixture.");
    }
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;
    await commitRuntimeOperationReadySnapshots(bindings, {
      event: readyEvent,
      operationId,
      targets: [claimed.current],
    });

    expect(
      await repairStaleRuntimeOperationTargets(bindings, {
        limit: 10,
        staleUpdatedAtLte: 1,
      }),
    ).toBe(0);
    await expect(
      database
        .prepare(
          `SELECT runtime_event_seq_cursor, status, status_operation_id, updated_at
             FROM session
            WHERE id = ?`,
        )
        .bind(PUBLIC_API_TEST_IDS.nonOwnerSession)
        .first(),
    ).resolves.toEqual({
      runtime_event_seq_cursor: 2,
      status: "IDLE",
      status_operation_id: null,
      updated_at: 2,
    });
    await expect(
      database.prepare("SELECT event_type, source_event_id FROM session_event ORDER BY seq").all(),
    ).resolves.toMatchObject({
      results: [
        {
          event_type: "agent.task.updated",
          source_event_id: `runtime-operation:${operationId}:${PUBLIC_API_TEST_IDS.nonOwnerSession}:updating`,
        },
        {
          event_type: "agent.task.updated",
          source_event_id: `runtime-operation:${operationId}:${PUBLIC_API_TEST_IDS.nonOwnerSession}:ready`,
        },
      ],
    });
  });

  test("does not adopt archive or delete cleanup ownership as a runtime operation", async () => {
    for (const cleanupOperationKind of ["archive", "delete"] as const) {
      const database = await createPublicHttpContractDatabase();
      await insertNonOwnerSession(database);
      await insertSandboxSession(database);
      await database
        .prepare(
          `UPDATE session
              SET archived_at = 1,
                  cleanup_operation_kind = ?,
                  status = 'RESCHEDULING',
                  status_operation_id = ?,
                  updated_at = 1
            WHERE id = ?`,
        )
        .bind(
          cleanupOperationKind,
          PUBLIC_API_TEST_IDS.operation,
          PUBLIC_API_TEST_IDS.nonOwnerSession,
        )
        .run();

      expect(
        await repairStaleRuntimeOperationTargets(
          createPublicHttpTestBindings(database) as ApiBindings,
          { limit: 10, staleUpdatedAtLte: 1 },
        ),
      ).toBe(0);
      expect(
        await database
          .prepare(
            "SELECT cleanup_operation_kind, status, status_operation_id FROM session WHERE id = ?",
          )
          .bind(PUBLIC_API_TEST_IDS.nonOwnerSession)
          .first(),
      ).toEqual({
        cleanup_operation_kind: cleanupOperationKind,
        status: "RESCHEDULING",
        status_operation_id: PUBLIC_API_TEST_IDS.operation,
      });
    }
  });

  test("releases a crashed operation fence when a canonical Driver terminal already won", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(database);
    await insertRunningSessionRun(database);
    await insertSandboxSession(database);
    await database
      .prepare("UPDATE session SET status = 'RUNNING' WHERE id = ?")
      .bind(PUBLIC_API_TEST_IDS.nonOwnerSession)
      .run();
    const operationId = PUBLIC_API_TEST_IDS.operation;
    const [updatingEvent] = buildRuntimeStateOperationEvents({
      agentId: PUBLIC_API_TEST_IDS.agent,
      operation: "restartDriver",
      readyAt: "1970-01-01T00:00:00.002Z",
      startedAt: "1970-01-01T00:00:00.001Z",
    });
    await claimRuntimeOperationTargets(database, {
      event: updatingEvent,
      operationId,
      targets: [
        {
          agentId: PUBLIC_API_TEST_IDS.agent,
          creatorAccountId: PUBLIC_API_TEST_IDS.nonOwnerAccount,
          lastRunId: RESCHEDULING_RUN_ID,
          sandboxId: PUBLIC_API_TEST_IDS.sandbox,
          sessionId: PUBLIC_API_TEST_IDS.nonOwnerSession,
          sessionRuntimeEventSeqCursor: 0,
          sessionStatus: "RUNNING",
          sessionStatusOperationId: null,
          sessionStatusSeq: 0,
          sessionUpdatedAt: 1,
        },
      ],
    });
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;
    await recordCanonicalSessionRunTerminal(bindings, {
      assistantMessage: null,
      error: null,
      expectedSessionOperationId: operationId,
      runId: RESCHEDULING_RUN_ID,
      sessionId: PUBLIC_API_TEST_IDS.nonOwnerSession,
      source: "driver",
      status: "cancelled",
    });

    expect(
      await repairStaleRuntimeOperationTargets(bindings, {
        limit: 10,
        staleUpdatedAtLte: Number.MAX_SAFE_INTEGER,
      }),
    ).toBe(1);

    expect(
      await database
        .prepare(
          `SELECT session.status AS session_status,
                  session.status_operation_id,
                  session_run.status AS run_status,
                  session_run.status_source
             FROM session
             JOIN session_run ON session_run.id = session.last_run_id
            WHERE session.id = ?`,
        )
        .bind(PUBLIC_API_TEST_IDS.nonOwnerSession)
        .first(),
    ).toEqual({
      run_status: "cancelled",
      session_status: "IDLE",
      status_operation_id: null,
      status_source: "driver",
    });
    expect(
      await database
        .prepare(
          "SELECT COUNT(*) AS count FROM session_event WHERE event_type = 'session.lifecycle.updated'",
        )
        .first(),
    ).toEqual({ count: 0 });
  });
});
