import { describe, expect, test } from "bun:test";

import { createRuntimeEvent, createRuntimeEventSemanticHash } from "@mosoo/runtime-events";
import type {
  RuntimeEventEnvelope,
  RuntimeEventKind,
  RuntimeEventOrigin,
} from "@mosoo/runtime-events";

import { loadSessionAgentTaskSnapshot } from "../src/modules/sessions/infrastructure/session-agent-task-snapshot.repository";
import {
  persistOneRuntimeEventPerSession,
  persistSessionRuntimeEvents,
} from "../src/modules/sessions/infrastructure/session-runtime-event-store.repository";
import { applyDrizzleMigration } from "./helpers/drizzle-migrations";
import { SqliteD1Database } from "./helpers/sqlite-d1";

function runtimeEvent(input: {
  driverInstanceId?: string;
  id: string;
  kind: RuntimeEventKind;
  occurredAtMs: number;
  origin?: RuntimeEventOrigin;
  payload?: unknown;
  runId?: string;
  sessionId?: string;
  traceId?: string;
}): RuntimeEventEnvelope {
  return createRuntimeEvent({
    actor: input.origin === "driver" ? "driver" : "api",
    ...(input.driverInstanceId === undefined ? {} : { driverInstanceId: input.driverInstanceId }),
    id: input.id,
    kind: input.kind,
    occurredAt: new Date(input.occurredAtMs).toISOString(),
    origin: input.origin ?? "api",
    payload: input.payload ?? {},
    ...(input.runId === undefined ? {} : { runId: input.runId }),
    sessionId: input.sessionId ?? "session-1",
    ...(input.traceId === undefined ? {} : { traceId: input.traceId }),
  });
}

function agentTasksEvent(input: {
  driverInstanceId: string;
  id: string;
  occurredAtMs: number;
  runId: string;
  taskId?: string;
}): RuntimeEventEnvelope {
  return runtimeEvent({
    driverInstanceId: input.driverInstanceId,
    id: input.id,
    kind: "agent.tasks.replaced",
    occurredAtMs: input.occurredAtMs,
    payload: { tasks: input.taskId === undefined ? [] : [{ taskId: input.taskId }] },
    runId: input.runId,
  });
}

function activateRun(
  database: SqliteD1Database,
  input: { driverInstanceId: string; runId: string },
): void {
  database
    .prepare("UPDATE session SET last_run_id = ?, status = 'RUNNING' WHERE id = 'session-1'")
    .bind(input.runId)
    .run();
  database
    .prepare("UPDATE session_run SET driver_instance_id = ?, status = 'running' WHERE id = ?")
    .bind(input.driverInstanceId, input.runId)
    .run();
}

async function insertConcurrentMessageReceipt(
  database: SqliteD1Database,
  input: { event: RuntimeEventEnvelope; sourceEventId: string },
): Promise<void> {
  const semanticHash = await createRuntimeEventSemanticHash(input.event);
  database.execute("UPDATE session SET runtime_event_seq_cursor = 1 WHERE id = 'session-1'");
  await database
    .prepare(
      `INSERT INTO session_event (
         agent_id, content_text, created_at, ended_at, event_type, family, id,
         occurred_at, process_status, process_type, run_id, semantic_hash, seq,
         session_id, source_event_id, source, stream_id, visibility
       ) VALUES (?, ?, 1000, 1000, 'message.delta', 'message', ?, 1000,
                 'available', 'agent.message.delta', 'run-1', ?, 1, 'session-1',
                 ?, 'driver', 'message-1', 'all_consumers')`,
    )
    .bind(
      "01J00000000000000000000009",
      (input.event.payload as { contentDelta: string }).contentDelta,
      `winner:${input.sourceEventId}`,
      semanticHash,
      input.sourceEventId,
    )
    .run();
}

function createRuntimeEventStoreDatabase(
  input: { maxBoundParams?: number } = {},
): SqliteD1Database {
  const database = new SqliteD1Database({
    foreignKeys: false,
    maxBoundParams: input.maxBoundParams,
  });

  database.execute(`
    CREATE TABLE session (
      id text PRIMARY KEY NOT NULL,
      agent_id text NOT NULL,
      archived_at integer,
      last_run_id text,
      status text NOT NULL,
      runtime_event_seq_cursor integer DEFAULT 0 NOT NULL
    );

    CREATE TABLE session_run (
      completed_at integer,
      id text PRIMARY KEY NOT NULL,
      driver_instance_id text,
      error_code text,
      error_details_json text,
      error_message text,
      error_retryable integer,
      session_id text NOT NULL,
      status text DEFAULT 'running' NOT NULL,
      status_changed_at integer NOT NULL DEFAULT 0,
      status_event text NOT NULL DEFAULT 'run.start',
      status_operation_id text,
      status_seq integer NOT NULL DEFAULT 0,
      status_source text NOT NULL DEFAULT 'driver',
      started_at integer,
      updated_at integer NOT NULL DEFAULT 0
    );

    CREATE TABLE session_agent_task_snapshot (
      driver_instance_id text NOT NULL,
      run_id text NOT NULL,
      seq integer NOT NULL,
      session_id text PRIMARY KEY NOT NULL,
      tasks_json text NOT NULL
    );

    CREATE TABLE session_event (
      agent_id text NOT NULL,
      artifact_attempt_id text,
      artifact_manifest_json text,
      artifact_manifest_sha256 text,
      content_text text NOT NULL,
      created_at integer NOT NULL,
      ended_at integer NOT NULL,
      event_type text NOT NULL,
      family text NOT NULL,
      id text PRIMARY KEY NOT NULL,
      mcp_command_id text,
      occurred_at integer NOT NULL,
      process_status text NOT NULL,
      process_type text NOT NULL,
      run_id text,
      semantic_hash text CHECK (
        semantic_hash IS NULL OR (
          length(semantic_hash) = 64
          AND semantic_hash = lower(semantic_hash)
          AND semantic_hash NOT GLOB '*[^0-9a-f]*'
        )
      ),
      seq integer NOT NULL,
      session_id text NOT NULL,
      source_event_id text NOT NULL,
      source text NOT NULL,
      stream_id text,
      terminal_event_json text,
      tool_call_id text,
      tool_input_delta_json text,
      tool_input_json text,
      tool_name text,
      tool_output_delta_text text,
      tool_output_text text,
      tool_parent_message_id text,
      tool_result_message_id text,
      tool_status text,
      tokens integer,
      trace_id text,
      visibility text NOT NULL,
      CHECK (tool_input_delta_json IS NULL OR tool_input_json IS NULL),
      CHECK (tool_output_delta_text IS NULL OR tool_output_text IS NULL),
      CHECK (
        (terminal_event_json IS NULL AND NOT (semantic_hash IS NOT NULL AND event_type IN ('run.cancelled', 'run.completed', 'run.failed')))
        OR (terminal_event_json IS NOT NULL AND json_valid(terminal_event_json) = 1 AND semantic_hash IS NOT NULL AND event_type IN ('run.cancelled', 'run.completed', 'run.failed'))
      ),
      CHECK (
        (artifact_attempt_id IS NULL AND artifact_manifest_json IS NULL AND artifact_manifest_sha256 IS NULL)
        OR (
          artifact_attempt_id IS NOT NULL
          AND artifact_manifest_json IS NOT NULL
          AND json_valid(artifact_manifest_json) = 1
          AND json_extract(artifact_manifest_json, '$.version') IS 1
          AND json_type(artifact_manifest_json, '$.captureStatus') IS 'text'
          AND json_extract(artifact_manifest_json, '$.captureStatus') IN ('complete', 'omitted_file_limit', 'omitted_runtime_unavailable', 'omitted_size_limit', 'omitted_source_changed', 'omitted_source_missing')
          AND json_type(artifact_manifest_json, '$.mode') IS 'text'
          AND json_extract(artifact_manifest_json, '$.mode') IN ('delta', 'snapshot')
          AND (json_extract(artifact_manifest_json, '$.captureStatus') = 'complete' OR json_array_length(artifact_manifest_json, '$.files') = 0)
          AND json_extract(artifact_manifest_json, '$.sourceEventId') IS source_event_id
          AND json_extract(artifact_manifest_json, '$.semanticHash') IS semantic_hash
          AND json_type(artifact_manifest_json, '$.files') IS 'array'
          AND artifact_manifest_sha256 IS NOT NULL
          AND length(artifact_manifest_sha256) = 64
          AND artifact_manifest_sha256 = lower(artifact_manifest_sha256)
          AND artifact_manifest_sha256 NOT GLOB '*[^0-9a-f]*'
          AND semantic_hash IS NOT NULL
          AND event_type IN ('file.change.updated', 'file.changed', 'run.completed')
        )
      ),
      CHECK (tool_status IS NULL OR tool_status IN ('running', 'completed', 'failed', 'cancelled')),
      CHECK (
        mcp_command_id IS NULL OR (
          mcp_command_id = upper(mcp_command_id)
          AND length(mcp_command_id) = 26
          AND substr(mcp_command_id, 1, 1) GLOB '[0-7]'
          AND mcp_command_id NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'
          AND event_type = 'tool.call.updated'
          AND tool_status IS NOT NULL
          AND tool_status IN ('completed', 'failed', 'cancelled')
        )
      )
    );

    CREATE UNIQUE INDEX session_event_session_seq_idx
      ON session_event (session_id, seq);

    CREATE UNIQUE INDEX session_event_session_source_idx
      ON session_event (session_id, source_event_id);

    CREATE UNIQUE INDEX session_event_artifact_attempt_idx
      ON session_event (artifact_attempt_id)
      WHERE artifact_attempt_id IS NOT NULL;

    CREATE UNIQUE INDEX session_event_mcp_terminal_winner_idx
      ON session_event (session_id, mcp_command_id)
      WHERE mcp_command_id IS NOT NULL;

    CREATE UNIQUE INDEX session_event_run_terminal_winner_idx
      ON session_event (session_id, run_id)
      WHERE semantic_hash IS NOT NULL
        AND run_id IS NOT NULL
        AND event_type IN ('run.cancelled', 'run.completed', 'run.failed');

    CREATE INDEX session_event_run_stream_process_seq_idx
      ON session_event (run_id, stream_id, process_type, seq);

    CREATE INDEX session_event_run_tool_call_seq_idx
      ON session_event (run_id, tool_call_id, seq);

    CREATE TABLE session_permission_request (
      created_at integer NOT NULL,
      driver_instance_id text NOT NULL,
      raw_input text,
      request_id text NOT NULL,
      run_id text NOT NULL,
      session_id text NOT NULL,
      title text NOT NULL,
      tool_call_id text,
      tool_kind text,
      updated_at integer NOT NULL,
      PRIMARY KEY (session_id, request_id)
    );

    CREATE TABLE session_readiness_snapshot (
      readiness_json text NOT NULL,
      session_id text PRIMARY KEY NOT NULL,
      updated_at integer NOT NULL
    );

    INSERT INTO session (id, agent_id, archived_at, status)
    VALUES ('session-1', '01J00000000000000000000009', NULL, 'IDLE');

    INSERT INTO session_run (id, session_id) VALUES
      ('run-1', 'session-1'),
      ('run-2', 'session-2');
  `);
  applyDrizzleMigration(database, "0019_runtime-operation-ready-authority");

  return database;
}

describe("session runtime event store", () => {
  test("atomically persists only the latest current-run task snapshot", async () => {
    const database = createRuntimeEventStoreDatabase();
    activateRun(database, { driverInstanceId: "driver-1", runId: "run-1" });

    const result = await persistSessionRuntimeEvents(database, {
      records: [
        {
          event: agentTasksEvent({
            driverInstanceId: "driver-1",
            id: "tasks-1",
            occurredAtMs: 1_000,
            runId: "run-1",
            taskId: "first",
          }),
          occurredAt: 1_000,
          sourceEventId: "source-tasks-1",
        },
        {
          event: agentTasksEvent({
            driverInstanceId: "driver-1",
            id: "tasks-2",
            occurredAtMs: 1_001,
            runId: "run-1",
            taskId: "latest",
          }),
          occurredAt: 1_001,
          sourceEventId: "source-tasks-2",
        },
      ],
      sessionId: "session-1",
    });
    const snapshot = await database
      .prepare(
        "SELECT driver_instance_id, run_id, seq, tasks_json FROM session_agent_task_snapshot",
      )
      .first<{
        driver_instance_id: string;
        run_id: string;
        seq: number;
        tasks_json: string;
      }>();
    const eventRows = await database
      .prepare("SELECT content_text, visibility FROM session_event ORDER BY seq")
      .all<{ content_text: string; visibility: string }>();

    expect(result.persistedCount).toBe(2);
    expect(snapshot).toEqual({
      driver_instance_id: "driver-1",
      run_id: "run-1",
      seq: 2,
      tasks_json: JSON.stringify({ tasks: [{ taskId: "latest" }] }),
    });
    expect(eventRows.results).toEqual([
      { content_text: "1 background task active.", visibility: "owner_debug" },
      { content_text: "1 background task active.", visibility: "owner_debug" },
    ]);
  });

  test("rolls back the task event receipt when snapshot persistence fails", async () => {
    const database = createRuntimeEventStoreDatabase();
    activateRun(database, { driverInstanceId: "driver-1", runId: "run-1" });
    database.execute(`
      CREATE TRIGGER reject_agent_task_snapshot
      BEFORE INSERT ON session_agent_task_snapshot
      BEGIN
        SELECT RAISE(ABORT, 'forced snapshot failure');
      END;
    `);

    await expect(
      persistSessionRuntimeEvents(database, {
        records: [
          {
            event: agentTasksEvent({
              driverInstanceId: "driver-1",
              id: "tasks-1",
              occurredAtMs: 1_000,
              runId: "run-1",
              taskId: "task-1",
            }),
            occurredAt: 1_000,
            sourceEventId: "source-tasks-1",
          },
        ],
        sessionId: "session-1",
      }),
    ).rejects.toThrow("forced snapshot failure");

    expect(await database.prepare("SELECT COUNT(*) AS count FROM session_event").first()).toEqual({
      count: 0,
    });
    expect(
      await database
        .prepare("SELECT runtime_event_seq_cursor FROM session WHERE id = 'session-1'")
        .first(),
    ).toEqual({ runtime_event_seq_cursor: 0 });
  });

  test("rolls back a permission receipt when its viewer projection fails", async () => {
    const database = createRuntimeEventStoreDatabase();
    const event = runtimeEvent({
      driverInstanceId: "driver-1",
      id: "permission-atomic-event",
      kind: "permission.requested",
      occurredAtMs: 1_100,
      payload: {
        requestId: "permission-atomic",
        targetItemId: "tool-call-1",
        title: "Approve command",
        toolCall: { kind: "shell", toolCallId: "tool-call-1" },
      },
      runId: "run-1",
    });
    const persist = () =>
      persistSessionRuntimeEvents(database, {
        records: [{ event, occurredAt: 1_100, sourceEventId: "permission-atomic-source" }],
        sessionId: "session-1",
      });
    database.execute(`
      CREATE TRIGGER reject_permission_projection
      BEFORE INSERT ON session_permission_request
      BEGIN
        SELECT RAISE(ABORT, 'forced permission projection failure');
      END;
    `);

    await expect(persist()).rejects.toThrow("forced permission projection failure");
    expect(await database.prepare("SELECT COUNT(*) AS count FROM session_event").first()).toEqual({
      count: 0,
    });
    expect(
      await database
        .prepare("SELECT runtime_event_seq_cursor FROM session WHERE id = 'session-1'")
        .first(),
    ).toEqual({ runtime_event_seq_cursor: 0 });

    database.execute("DROP TRIGGER reject_permission_projection");
    await expect(persist()).resolves.toMatchObject({ persistedCount: 1 });
    await expect(persist()).resolves.toMatchObject({ persistedCount: 0 });
    expect(
      await database
        .prepare("SELECT request_id FROM session_permission_request")
        .all<{ request_id: string }>(),
    ).toMatchObject({ results: [{ request_id: "permission-atomic" }] });
    expect(
      await database
        .prepare("SELECT runtime_event_seq_cursor FROM session WHERE id = 'session-1'")
        .first(),
    ).toEqual({ runtime_event_seq_cursor: 1 });
  });

  test("atomically rejects the cursor, receipt, and snapshot when archive wins", async () => {
    const database = createRuntimeEventStoreDatabase();
    activateRun(database, { driverInstanceId: "driver-1", runId: "run-1" });
    const persistBatch = database.batch.bind(database) as D1Database["batch"];
    let archivedBeforeBatch = false;

    database.batch = async <T = unknown>(statements: D1PreparedStatement[]) => {
      if (!archivedBeforeBatch) {
        archivedBeforeBatch = true;
        database.execute("UPDATE session SET archived_at = 2 WHERE id = 'session-1'");
      }

      return persistBatch<T>(statements);
    };

    await expect(
      persistSessionRuntimeEvents(database, {
        records: [
          {
            event: agentTasksEvent({
              driverInstanceId: "driver-1",
              id: "tasks-after-archive",
              occurredAtMs: 1_000,
              runId: "run-1",
              taskId: "must-not-land",
            }),
            occurredAt: 1_000,
            sourceEventId: "source-after-archive",
          },
        ],
        sessionId: "session-1",
      }),
    ).rejects.toThrow("not writable for runtime events");
    const session = await database
      .prepare("SELECT archived_at, runtime_event_seq_cursor FROM session WHERE id = 'session-1'")
      .first<{ archived_at: number | null; runtime_event_seq_cursor: number }>();

    expect(archivedBeforeBatch).toBe(true);
    expect(session).toEqual({ archived_at: 2, runtime_event_seq_cursor: 0 });
    expect(await database.prepare("SELECT COUNT(*) AS count FROM session_event").first()).toEqual({
      count: 0,
    });
    expect(
      await database.prepare("SELECT COUNT(*) AS count FROM session_agent_task_snapshot").first(),
    ).toEqual({ count: 0 });
    expect(await loadSessionAgentTaskSnapshot(database, "session-1")).toBeNull();
  });

  test("persists an explicit empty snapshot and hides it after archive", async () => {
    const database = createRuntimeEventStoreDatabase();
    activateRun(database, { driverInstanceId: "driver-1", runId: "run-1" });

    for (const [index, taskId] of ["task-1", undefined].entries()) {
      await persistSessionRuntimeEvents(database, {
        records: [
          {
            event: agentTasksEvent({
              driverInstanceId: "driver-1",
              id: `tasks-${index + 1}`,
              occurredAtMs: 1_000 + index,
              runId: "run-1",
              ...(taskId === undefined ? {} : { taskId }),
            }),
            occurredAt: 1_000 + index,
            sourceEventId: `source-tasks-${index + 1}`,
          },
        ],
        sessionId: "session-1",
      });
    }

    expect(
      await database
        .prepare("SELECT tasks_json FROM session_agent_task_snapshot WHERE session_id = ?")
        .bind("session-1")
        .first<{ tasks_json: string }>(),
    ).toEqual({ tasks_json: JSON.stringify({ tasks: [] }) });
    expect(await loadSessionAgentTaskSnapshot(database, "session-1")).toEqual({
      driverInstanceId: "driver-1",
      runId: "run-1",
      tasks: [],
    });

    database.execute("UPDATE session SET archived_at = 2 WHERE id = 'session-1'");
    expect(await loadSessionAgentTaskSnapshot(database, "session-1")).toBeNull();
  });

  test("does not let exact replay receipts or stale run and driver snapshots replace current state", async () => {
    const database = createRuntimeEventStoreDatabase();
    activateRun(database, { driverInstanceId: "driver-1", runId: "run-1" });

    await persistSessionRuntimeEvents(database, {
      records: [
        {
          event: agentTasksEvent({
            driverInstanceId: "driver-1",
            id: "tasks-1",
            occurredAtMs: 1_000,
            runId: "run-1",
            taskId: "first",
          }),
          occurredAt: 1_000,
          sourceEventId: "source-tasks-1",
        },
      ],
      sessionId: "session-1",
    });
    await persistSessionRuntimeEvents(database, {
      records: [
        {
          event: agentTasksEvent({
            driverInstanceId: "driver-1",
            id: "tasks-replay",
            occurredAtMs: 1_001,
            runId: "run-1",
            taskId: "first",
          }),
          occurredAt: 1_001,
          sourceEventId: "source-tasks-1",
        },
      ],
      sessionId: "session-1",
    });

    database.execute(
      "INSERT INTO session_run (id, driver_instance_id, session_id, status) VALUES ('run-3', 'driver-2', 'session-1', 'running')",
    );
    activateRun(database, { driverInstanceId: "driver-2", runId: "run-3" });
    await persistSessionRuntimeEvents(database, {
      records: [
        {
          event: agentTasksEvent({
            driverInstanceId: "driver-2",
            id: "tasks-current",
            occurredAtMs: 1_002,
            runId: "run-3",
            taskId: "current",
          }),
          occurredAt: 1_002,
          sourceEventId: "source-current",
        },
        {
          event: agentTasksEvent({
            driverInstanceId: "driver-1",
            id: "tasks-old-run",
            occurredAtMs: 1_003,
            runId: "run-1",
            taskId: "old-run",
          }),
          occurredAt: 1_003,
          sourceEventId: "source-old-run",
        },
        {
          event: agentTasksEvent({
            driverInstanceId: "driver-1",
            id: "tasks-old-driver",
            occurredAtMs: 1_004,
            runId: "run-3",
            taskId: "old-driver",
          }),
          occurredAt: 1_004,
          sourceEventId: "source-old-driver",
        },
      ],
      sessionId: "session-1",
    });

    expect(
      await database
        .prepare("SELECT driver_instance_id, run_id, tasks_json FROM session_agent_task_snapshot")
        .first(),
    ).toEqual({
      driver_instance_id: "driver-2",
      run_id: "run-3",
      tasks_json: JSON.stringify({ tasks: [{ taskId: "current" }] }),
    });
  });

  test("keeps runtime event inserts within D1's bound parameter limit", async () => {
    const database = createRuntimeEventStoreDatabase({ maxBoundParams: 100 });
    const records = Array.from({ length: 6 }, (_, index) => {
      const eventId = `event-${index + 1}`;

      return {
        event: runtimeEvent({
          id: eventId,
          kind: "message.delta",
          occurredAtMs: 1_000 + index,
          payload: {
            contentDelta: `${index}`,
            messageId: "message-1",
          },
          runId: "run-1",
        }),
        occurredAt: 1_000 + index,
        sourceEventId: eventId,
      };
    });

    const result = await persistSessionRuntimeEvents(database, {
      records,
      sessionId: "session-1",
    });
    const rows = await database
      .prepare("SELECT seq, source_event_id FROM session_event ORDER BY seq")
      .all<{ seq: number; source_event_id: string }>();

    expect(result.persistedCount).toBe(6);
    expect(rows.results).toEqual(
      records.map((record, index) => ({
        seq: index + 1,
        source_event_id: record.sourceEventId,
      })),
    );

    const failingDatabase = createRuntimeEventStoreDatabase({ maxBoundParams: 100 });
    failingDatabase.execute(`
      CREATE TRIGGER reject_last_event
      BEFORE INSERT ON session_event
      WHEN NEW.source_event_id = 'event-6'
      BEGIN
        SELECT RAISE(ABORT, 'forced event insert failure');
      END;
    `);

    await expect(
      persistSessionRuntimeEvents(failingDatabase, {
        records,
        sessionId: "session-1",
      }),
    ).rejects.toThrow("forced event insert failure");

    const count = await failingDatabase
      .prepare("SELECT COUNT(*) AS count FROM session_event")
      .first<{ count: number }>();

    expect(count?.count).toBe(0);
    expect(
      await failingDatabase
        .prepare("SELECT runtime_event_seq_cursor FROM session WHERE id = 'session-1'")
        .first(),
    ).toEqual({ runtime_event_seq_cursor: 0 });
  });

  test("persists mixed source ids and skips source replays before allocating sequence", async () => {
    const database = createRuntimeEventStoreDatabase();

    await persistSessionRuntimeEvents(database, {
      records: [
        {
          event: runtimeEvent({
            id: "event-1",
            kind: "run.started",
            occurredAtMs: 1_000,
            payload: {
              startedAt: "1970-01-01T00:00:01.000Z",
            },
            runId: "run-1",
          }),
          occurredAt: 1_000,
          sourceEventId: null,
        },
        {
          event: runtimeEvent({
            id: "event-2",
            kind: "runtime.timing.recorded",
            occurredAtMs: 1_120,
            payload: {
              completedAtMs: 1_120,
              path: "cold",
              phases: [],
              runId: "run-1",
              sessionId: "session-1",
              source: "api",
              stage: "prepare_run",
              startedAtMs: 1_000,
              totalMs: 120,
              traceId: "trace-1",
            },
            runId: "run-1",
            traceId: "trace-1",
          }),
          occurredAt: 1_120,
          sourceEventId: "source-1",
        },
      ],
      sessionId: "session-1",
    });

    await persistSessionRuntimeEvents(database, {
      records: [
        {
          event: runtimeEvent({
            id: "event-2-replay",
            kind: "runtime.timing.recorded",
            occurredAtMs: 1_120,
            payload: {
              completedAtMs: 1_120,
              path: "cold",
              phases: [],
              runId: "run-1",
              sessionId: "session-1",
              source: "api",
              stage: "prepare_run",
              startedAtMs: 1_000,
              totalMs: 120,
              traceId: "trace-1",
            },
            runId: "run-1",
            traceId: "trace-1",
          }),
          occurredAt: 1_120,
          sourceEventId: "source-1",
        },
      ],
      sessionId: "session-1",
    });

    await persistSessionRuntimeEvents(database, {
      records: [
        {
          event: runtimeEvent({
            id: "event-3",
            kind: "run.waiting",
            occurredAtMs: 1_200,
            origin: "driver",
            runId: "run-1",
          }),
          occurredAt: 1_200,
          sourceEventId: null,
        },
      ],
      sessionId: "session-1",
    });

    const rows = await database
      .prepare(
        `
          SELECT
            event_type,
            seq,
            source_event_id
          FROM session_event
          ORDER BY seq
        `,
      )
      .all<{
        event_type: string;
        seq: number;
        source_event_id: string | null;
      }>();

    expect(rows.results.map((row) => row.event_type)).toEqual([
      "run.started",
      "runtime.timing.recorded",
      "run.waiting",
    ]);
    expect(rows.results.map((row) => row.seq)).toEqual([1, 2, 3]);
    expect(rows.results.map((row) => row.source_event_id)).toEqual([
      "event-1",
      "source-1",
      "event-3",
    ]);
  });

  test("persists the first source event when a batch contains duplicates", async () => {
    const database = createRuntimeEventStoreDatabase();
    const event = runtimeEvent({
      id: "event-1",
      kind: "runtime.timing.recorded",
      occurredAtMs: 1_120,
      payload: {
        completedAtMs: 1_120,
        path: "cold",
        phases: [],
        runId: "run-1",
        sessionId: "session-1",
        source: "api",
        stage: "prepare_run",
        startedAtMs: 1_000,
        totalMs: 120,
        traceId: "trace-1",
      },
      runId: "run-1",
      traceId: "trace-1",
    });

    await persistSessionRuntimeEvents(database, {
      records: [
        {
          event,
          occurredAt: 1_120,
          sourceEventId: "source-1",
        },
        {
          event,
          occurredAt: 1_121,
          sourceEventId: "source-1",
        },
      ],
      sessionId: "session-1",
    });

    const rows = await database
      .prepare(
        `
          SELECT occurred_at, seq, source_event_id
          FROM session_event
          ORDER BY seq
        `,
      )
      .all<{
        occurred_at: number;
        seq: number;
        source_event_id: string | null;
      }>();

    expect(rows.results).toHaveLength(1);
    expect(rows.results[0]).toMatchObject({
      occurred_at: 1_120,
      seq: 1,
      source_event_id: "source-1",
    });
  });

  test.each([
    ["adopts an exact", false],
    ["rejects a changed", true],
  ] as const)("%s source winner that races the atomic batch", async (_name, changed) => {
    const database = createRuntimeEventStoreDatabase();
    const candidate = runtimeEvent({
      id: "candidate",
      kind: "message.delta",
      occurredAtMs: 1_000,
      payload: { contentDelta: changed ? "changed" : "winner", messageId: "message-1" },
      runId: "run-1",
    });
    const winner = runtimeEvent({
      id: "winner",
      kind: "message.delta",
      occurredAtMs: 999,
      payload: { contentDelta: "winner", messageId: "message-1" },
      runId: "run-1",
    });
    const sourceEventId = "source-race";
    const originalBatch = database.batch.bind(database) as D1Database["batch"];
    let injected = false;
    database.batch = async <T = unknown>(statements: D1PreparedStatement[]) => {
      if (!injected) {
        injected = true;
        await insertConcurrentMessageReceipt(database, { event: winner, sourceEventId });
      }
      return originalBatch<T>(statements);
    };

    const persistence = persistSessionRuntimeEvents(database, {
      records: [{ event: candidate, occurredAt: 1_000, sourceEventId }],
      sessionId: "session-1",
    });
    if (changed) {
      await expect(persistence).rejects.toThrow("conflicts with its durable receipt");
    } else {
      await expect(persistence).resolves.toMatchObject({ persistedCount: 0 });
    }

    expect(
      await database
        .prepare("SELECT runtime_event_seq_cursor FROM session WHERE id = 'session-1'")
        .first(),
    ).toEqual({ runtime_event_seq_cursor: 1 });
    expect(await database.prepare("SELECT COUNT(*) AS count FROM session_event").first()).toEqual({
      count: 1,
    });
  });

  test("adopts an exact receipt after commit succeeds but its ACK is lost", async () => {
    const database = createRuntimeEventStoreDatabase();
    const event = runtimeEvent({
      id: "commit-before-ack",
      kind: "message.delta",
      occurredAtMs: 1_000,
      payload: { contentDelta: "durable", messageId: "message-1" },
      runId: "run-1",
    });
    const input = {
      records: [{ event, occurredAt: 1_000, sourceEventId: "source-commit-before-ack" }],
      sessionId: "session-1" as const,
    };
    const originalBatch = database.batch.bind(database) as D1Database["batch"];
    let disconnected = false;
    database.batch = async <T = unknown>(statements: D1PreparedStatement[]) => {
      const result = await originalBatch<T>(statements);
      if (!disconnected) {
        disconnected = true;
        throw new Error("injected ACK loss");
      }
      return result;
    };

    await expect(persistSessionRuntimeEvents(database, input)).rejects.toThrow("injected ACK loss");
    await expect(persistSessionRuntimeEvents(database, input)).resolves.toMatchObject({
      persistedCount: 0,
    });
    expect(
      await database
        .prepare("SELECT runtime_event_seq_cursor FROM session WHERE id = 'session-1'")
        .first(),
    ).toEqual({ runtime_event_seq_cursor: 1 });
    expect(await database.prepare("SELECT COUNT(*) AS count FROM session_event").first()).toEqual({
      count: 1,
    });
  });

  test("persists terminal tool semantic columns", async () => {
    const database = createRuntimeEventStoreDatabase();

    await persistSessionRuntimeEvents(database, {
      records: [
        {
          event: runtimeEvent({
            id: "tool-completed",
            kind: "tool.call.updated",
            occurredAtMs: 2_050,
            payload: {
              rawInput: '{"query":"mosoo"}',
              rawOutput: "ok",
              status: "completed",
              title: "Search",
              toolCallId: "tool-1",
            },
            runId: "run-1",
          }),
          occurredAt: 2_000,
          sourceEventId: "source-tool-completed",
        },
        {
          event: runtimeEvent({
            id: "tool-cancelled",
            kind: "tool.call.updated",
            occurredAtMs: 2_100,
            payload: {
              status: "cancelled",
              title: "Search",
              toolCallId: "tool-2",
            },
            runId: "run-1",
          }),
          occurredAt: 2_100,
          sourceEventId: "source-tool-cancelled",
        },
      ],
      sessionId: "session-1",
    });

    const rows = await database
      .prepare(
        `
          SELECT
            e.content_text,
            e.event_type,
            e.process_status,
            e.process_type,
            e.tool_call_id,
            e.tool_input_json,
            e.tool_name
          FROM session_event e
          ORDER BY e.seq
        `,
      )
      .all<{
        content_text: string;
        event_type: string;
        process_status: string;
        process_type: string;
        tool_call_id: string | null;
        tool_input_json: string | null;
        tool_name: string | null;
      }>();

    expect(rows.results).toHaveLength(2);
    expect(rows.results[0]).toMatchObject({
      content_text: "ok",
      event_type: "tool.call.updated",
      process_status: "available",
      process_type: "tool.use.completed",
      tool_call_id: "tool-1",
      tool_input_json: '{"query":"mosoo"}',
      tool_name: "Search",
    });
    expect(rows.results[1]).toMatchObject({
      content_text: "",
      event_type: "tool.call.updated",
      process_status: "available",
      process_type: "tool.use.completed",
      tool_call_id: "tool-2",
      tool_input_json: null,
      tool_name: "Search",
    });
  });

  test.each([
    [
      "message.cancelled",
      { messageId: "message-1", role: "agent" },
      "Message updated.",
      "available",
      "agent.message.delta",
      "message-1",
    ],
    [
      "message.failed",
      {
        error: { code: "runtime.failed", message: "Runtime failed." },
        messageId: "message-1",
        role: "agent",
      },
      "Message updated.",
      "error",
      "agent.message.delta",
      "message-1",
    ],
    [
      "thought.cancelled",
      { thoughtId: "thought-1" },
      "Agent thinking updated.",
      "available",
      "agent.thinking.delta",
      "thought-1",
    ],
  ] as const)(
    "persists %s as a terminal semantic row",
    async (kind, payload, contentText, processStatus, processType, streamId) => {
      const database = createRuntimeEventStoreDatabase();

      await persistSessionRuntimeEvents(database, {
        records: [
          {
            event: runtimeEvent({
              id: "terminal-event",
              kind,
              occurredAtMs: 2_000,
              payload,
              runId: "run-1",
            }),
            occurredAt: 2_000,
            sourceEventId: "source-terminal-event",
          },
        ],
        sessionId: "session-1",
      });

      expect(
        await database
          .prepare(
            `
              SELECT content_text, event_type, process_status, process_type, stream_id
              FROM session_event
            `,
          )
          .first(),
      ).toMatchObject({
        content_text: contentText,
        event_type: kind,
        process_status: processStatus,
        process_type: processType,
        stream_id: streamId,
      });
    },
  );

  test("persists replacement tool input snapshots through terminal enrichment", async () => {
    const database = createRuntimeEventStoreDatabase();
    const persistToolEvent = (input: {
      id: string;
      rawInput: string;
      sourceEventId: string;
      status: "completed" | "running";
      title: string;
    }) =>
      persistSessionRuntimeEvents(database, {
        records: [
          {
            event: runtimeEvent({
              id: input.id,
              kind: "tool.call.updated",
              occurredAtMs: 2_000,
              payload: {
                rawInput: input.rawInput,
                status: input.status,
                title: input.title,
                toolCallId: "tool-1",
              },
              runId: "run-1",
            }),
            occurredAt: 2_000,
            sourceEventId: input.sourceEventId,
          },
        ],
        sessionId: "session-1",
      });

    await persistToolEvent({
      id: "tool-start",
      rawInput: '{"cwd":"/workspace"}',
      sourceEventId: "source-tool-start",
      status: "running",
      title: "bash",
    });
    await persistToolEvent({
      id: "tool-enriched",
      rawInput: '{"cwd":"/workspace","command":"python calc_1rm.py"}',
      sourceEventId: "source-tool-enriched",
      status: "running",
      title: "bash",
    });
    await persistToolEvent({
      id: "tool-completed",
      rawInput: '{"command":"python calc_1rm.py","cwd":"/workspace"}',
      sourceEventId: "source-tool-completed",
      status: "completed",
      title: "Command exited 0",
    });

    await persistToolEvent({
      id: "tool-late-enrichment",
      rawInput: '{"command":"python other.py","cwd":"/workspace"}',
      sourceEventId: "source-tool-late-enrichment",
      status: "completed",
      title: "Command exited 0",
    });

    const count = await database
      .prepare("SELECT COUNT(*) AS count FROM session_event")
      .first<{ count: number }>();
    expect(count?.count).toBe(4);
  });

  test("rejects runtime event batches for a different envelope session", async () => {
    const database = createRuntimeEventStoreDatabase();

    await expect(
      persistSessionRuntimeEvents(database, {
        records: [
          {
            event: runtimeEvent({
              id: "wrong-session-event",
              kind: "message.delta",
              occurredAtMs: 2_100,
              payload: {
                contentDelta: "wrong session",
                messageId: "message-1",
              },
              sessionId: "session-2",
            }),
            occurredAt: 2_100,
            sourceEventId: null,
          },
        ],
        sessionId: "session-1",
      }),
    ).rejects.toThrow();
  });

  test("rejects runtime event batches for a run owned by another session", async () => {
    const database = createRuntimeEventStoreDatabase();

    await expect(
      persistSessionRuntimeEvents(database, {
        records: [
          {
            event: runtimeEvent({
              id: "wrong-run-event",
              kind: "message.delta",
              occurredAtMs: 2_110,
              payload: {
                contentDelta: "wrong run",
                messageId: "message-1",
              },
              runId: "run-2",
            }),
            occurredAt: 2_110,
            sourceEventId: null,
          },
        ],
        sessionId: "session-1",
      }),
    ).rejects.toThrow();
  });

  test("updates viewer projections only for inserted runtime events", async () => {
    const database = createRuntimeEventStoreDatabase();
    const permissionEvent = runtimeEvent({
      driverInstanceId: "driver-1",
      id: "permission-event",
      kind: "permission.requested",
      occurredAtMs: 4_000,
      payload: {
        details: "raw input",
        requestId: "permission-1",
        targetItemId: "tool-call-1",
        title: "Approve command",
        toolCall: {
          kind: "shell",
          toolCallId: "tool-call-1",
        },
      },
      runId: "run-1",
    });

    await persistSessionRuntimeEvents(database, {
      records: [
        {
          event: permissionEvent,
          occurredAt: 4_000,
          sourceEventId: "permission-source",
        },
      ],
      sessionId: "session-1",
    });
    await persistSessionRuntimeEvents(database, {
      records: [
        {
          event: permissionEvent,
          occurredAt: 4_001,
          sourceEventId: "permission-source",
        },
      ],
      sessionId: "session-1",
    });
    await persistSessionRuntimeEvents(database, {
      records: [
        {
          event: runtimeEvent({
            id: "readiness-event",
            kind: "session.readiness.updated",
            occurredAtMs: 4_010,
            payload: {
              checkedAt: "2026-05-08T00:00:04.010Z",
              issues: [],
              ready: true,
            },
          }),
          occurredAt: 4_010,
          sourceEventId: "readiness-source",
        },
      ],
      sessionId: "session-1",
    });

    const permissionRows = await database
      .prepare(
        `
          SELECT request_id, run_id, title
          FROM session_permission_request
          ORDER BY request_id
        `,
      )
      .all<{ request_id: string; run_id: string; title: string }>();
    const readiness = await database
      .prepare("SELECT readiness_json FROM session_readiness_snapshot WHERE session_id = ?")
      .bind("session-1")
      .first<{ readiness_json: string }>();

    expect(permissionRows.results).toEqual([
      {
        request_id: "permission-1",
        run_id: "run-1",
        title: "Approve command",
      },
    ]);
    expect(
      await database
        .prepare("SELECT status, status_seq FROM session_run WHERE id = 'run-1'")
        .first(),
    ).toEqual({ status: "waiting_input", status_seq: 1 });
    expect(readiness === null ? null : JSON.parse(readiness.readiness_json)).toEqual({
      checkedAt: "2026-05-08T00:00:04.010Z",
      issues: [],
      ready: true,
    });

    await persistSessionRuntimeEvents(database, {
      records: [
        {
          event: runtimeEvent({
            id: "permission-resolved-event",
            kind: "permission.resolved",
            occurredAtMs: 4_020,
            payload: {
              requestId: "permission-1",
            },
            runId: "run-1",
          }),
          occurredAt: 4_020,
          sourceEventId: "permission-resolved-source",
        },
      ],
      sessionId: "session-1",
    });

    const remainingPermissions = await database
      .prepare("SELECT request_id FROM session_permission_request")
      .all<{ request_id: string }>();

    expect(remainingPermissions.results).toEqual([]);
    expect(
      await database
        .prepare("SELECT status, status_seq FROM session_run WHERE id = 'run-1'")
        .first(),
    ).toEqual({ status: "running", status_seq: 2 });
  });

  test("rejects late event batches for archived sessions without allocating sequence", async () => {
    const database = createRuntimeEventStoreDatabase();
    database.execute("UPDATE session SET archived_at = 123 WHERE id = 'session-1'");

    await expect(
      persistSessionRuntimeEvents(database, {
        records: [
          {
            event: runtimeEvent({
              id: "late-event",
              kind: "message.added",
              occurredAtMs: 4_100,
              payload: {
                content: "late",
                messageId: "message-late",
                role: "assistant",
              },
            }),
            occurredAt: 4_100,
            sourceEventId: null,
          },
        ],
        sessionId: "session-1",
      }),
    ).rejects.toThrow("not writable");

    const session = await database
      .prepare("SELECT runtime_event_seq_cursor FROM session WHERE id = ?")
      .bind("session-1")
      .first<{ runtime_event_seq_cursor: number }>();

    expect(session?.runtime_event_seq_cursor).toBe(0);
  });

  test("rejects ordinary event batches for terminated sessions without allocating sequence", async () => {
    const database = createRuntimeEventStoreDatabase();
    database.execute("UPDATE session SET status = 'TERMINATED' WHERE id = 'session-1'");

    await expect(
      persistSessionRuntimeEvents(database, {
        records: [
          {
            event: runtimeEvent({
              id: "terminated-late-event",
              kind: "message.added",
              occurredAtMs: 4_120,
              payload: {
                content: "late",
                messageId: "message-late",
                role: "assistant",
              },
            }),
            occurredAt: 4_120,
            sourceEventId: null,
          },
        ],
        sessionId: "session-1",
      }),
    ).rejects.toThrow("not writable");

    const session = await database
      .prepare("SELECT runtime_event_seq_cursor FROM session WHERE id = ?")
      .bind("session-1")
      .first<{ runtime_event_seq_cursor: number }>();

    expect(session?.runtime_event_seq_cursor).toBe(0);
  });

  test("persists the terminal lifecycle marker for terminated sessions", async () => {
    const database = createRuntimeEventStoreDatabase();
    database.execute("UPDATE session SET status = 'TERMINATED' WHERE id = 'session-1'");

    const result = await persistSessionRuntimeEvents(database, {
      records: [
        {
          event: runtimeEvent({
            id: "terminal-lifecycle-event",
            kind: "session.lifecycle.updated",
            occurredAtMs: 4_130,
            payload: {
              status: "TERMINATED",
            },
          }),
          occurredAt: 4_130,
          sourceEventId: null,
        },
      ],
      sessionId: "session-1",
    });
    const session = await database
      .prepare("SELECT runtime_event_seq_cursor FROM session WHERE id = ?")
      .bind("session-1")
      .first<{ runtime_event_seq_cursor: number }>();

    expect(result.persistedCount).toBe(1);
    expect(session?.runtime_event_seq_cursor).toBe(1);
  });

  test("reports skipped sessions when one-event batches replay source ids", async () => {
    const database = createRuntimeEventStoreDatabase();
    const event = runtimeEvent({
      id: "event-1",
      kind: "agent.task.updated",
      occurredAtMs: 4_000,
      payload: {
        agentId: "01J00000000000000000000009",
        operation: "restart",
        startedAt: new Date(4_000).toISOString(),
        status: "running",
      },
    });

    const firstResult = await persistOneRuntimeEventPerSession(database, {
      records: [
        {
          event,
          occurredAt: 4_000,
          sessionId: "session-1",
        },
      ],
    });
    const replayResult = await persistOneRuntimeEventPerSession(database, {
      records: [
        {
          event,
          occurredAt: 4_000,
          sessionId: "session-1",
        },
      ],
    });

    expect(firstResult).toMatchObject({
      persistedCount: 1,
      skippedSessionIds: [],
    });
    expect(replayResult).toMatchObject({
      persistedCount: 0,
      skippedSessionIds: ["session-1"],
    });
    expect(
      await database
        .prepare("SELECT runtime_event_seq_cursor FROM session WHERE id = 'session-1'")
        .first(),
    ).toEqual({ runtime_event_seq_cursor: 1 });
  });

  test("does not consume one-event sequence numbers when the active-run fence rejects", async () => {
    const database = createRuntimeEventStoreDatabase();
    database.execute("UPDATE session_run SET status = 'failed' WHERE id = 'run-1'");

    await expect(
      persistOneRuntimeEventPerSession(database, {
        records: [
          {
            event: runtimeEvent({
              id: "late-one-event",
              kind: "agent.task.updated",
              occurredAtMs: 4_050,
              payload: { status: "completed" },
              runId: "run-1",
            }),
            occurredAt: 4_050,
            sessionId: "session-1",
          },
        ],
      }),
    ).rejects.toThrow("atomic session or active-run fence");
    expect(
      await database
        .prepare("SELECT runtime_event_seq_cursor FROM session WHERE id = 'session-1'")
        .first(),
    ).toEqual({ runtime_event_seq_cursor: 0 });
    expect(await database.prepare("SELECT COUNT(*) AS count FROM session_event").first()).toEqual({
      count: 0,
    });
  });

  test("rejects one-event-per-session records for a different envelope session", async () => {
    const database = createRuntimeEventStoreDatabase();

    await expect(
      persistOneRuntimeEventPerSession(database, {
        records: [
          {
            event: runtimeEvent({
              id: "wrong-session-event",
              kind: "agent.task.updated",
              occurredAtMs: 4_100,
              payload: {
                agentId: "01J00000000000000000000009",
                operation: "restart",
                startedAt: new Date(4_100).toISOString(),
                status: "running",
              },
              sessionId: "session-2",
            }),
            occurredAt: 4_100,
            sessionId: "session-1",
          },
        ],
      }),
    ).rejects.toThrow();
  });

  test("rejects one-event-per-session records for a run owned by another session", async () => {
    const database = createRuntimeEventStoreDatabase();

    await expect(
      persistOneRuntimeEventPerSession(database, {
        records: [
          {
            event: runtimeEvent({
              id: "wrong-run-event",
              kind: "agent.task.updated",
              occurredAtMs: 4_110,
              payload: {
                agentId: "01J00000000000000000000009",
                operation: "restart",
                startedAt: new Date(4_110).toISOString(),
                status: "running",
              },
              runId: "run-2",
            }),
            occurredAt: 4_110,
            sessionId: "session-1",
          },
        ],
      }),
    ).rejects.toThrow();
  });
});
