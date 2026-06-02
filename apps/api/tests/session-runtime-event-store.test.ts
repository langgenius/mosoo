import { describe, expect, test } from "bun:test";

import { createRuntimeEvent } from "@mosoo/runtime-events";
import type {
  RuntimeEventEnvelope,
  RuntimeEventKind,
  RuntimeEventOrigin,
} from "@mosoo/runtime-events";

import { RuntimeEventPersistenceCompactor } from "../src/modules/runtime/infrastructure/driver-instance/runtime-event-persistence-compactor";
import {
  persistOneRuntimeEventPerSession,
  persistSessionRuntimeEvents,
} from "../src/modules/sessions/infrastructure/session-runtime-event-store.repository";
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

function createRuntimeEventStoreDatabase(): SqliteD1Database {
  const database = new SqliteD1Database({ foreignKeys: false });

  database.execute(`
    CREATE TABLE session (
      id text PRIMARY KEY NOT NULL,
      agent_id text NOT NULL,
      archived_at integer,
      status text NOT NULL,
      runtime_event_seq_cursor integer DEFAULT 0 NOT NULL
    );

    CREATE TABLE session_run (
      id text PRIMARY KEY NOT NULL,
      session_id text NOT NULL
    );

    CREATE TABLE session_event (
      agent_id text NOT NULL,
      content_text text NOT NULL,
      created_at integer NOT NULL,
      ended_at integer NOT NULL,
      event_type text NOT NULL,
      family text NOT NULL,
      id text PRIMARY KEY NOT NULL,
      occurred_at integer NOT NULL,
      process_status text NOT NULL,
      process_type text NOT NULL,
      run_id text,
      seq integer NOT NULL,
      session_id text NOT NULL,
      source_event_id text NOT NULL,
      source text NOT NULL,
      tokens integer,
      trace_id text,
      visibility text NOT NULL
    );

    CREATE UNIQUE INDEX session_event_session_seq_idx
      ON session_event (session_id, seq);

    CREATE UNIQUE INDEX session_event_session_source_idx
      ON session_event (session_id, source_event_id);

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

  return database;
}

describe("session runtime event store", () => {
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
            kind: "run.completed",
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
      "run.completed",
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

  test("persists compacted semantic columns", async () => {
    const database = createRuntimeEventStoreDatabase();

    await persistSessionRuntimeEvents(database, {
      records: [
        {
          event: runtimeEvent({
            id: "tool-completed",
            kind: "tool.call.updated",
            occurredAtMs: 2_050,
            payload: {
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
            e.process_type
          FROM session_event e
        `,
      )
      .all<{
        content_text: string;
        event_type: string;
        process_status: string;
        process_type: string;
      }>();

    expect(rows.results).toHaveLength(1);
    expect(rows.results[0]).toMatchObject({
      content_text: "Search result: ok",
      event_type: "tool.call.updated",
      process_status: "available",
      process_type: "tool.use.completed",
    });
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

  test("persists compacted stream fragments as semantic rows", async () => {
    const database = createRuntimeEventStoreDatabase();
    const compactor = new RuntimeEventPersistenceCompactor();
    const fragments = [
      runtimeEvent({
        id: "message-start",
        kind: "message.started",
        occurredAtMs: 3_000,
        payload: { messageId: "message-1", role: "agent" },
        runId: "run-1",
      }),
      runtimeEvent({
        id: "message-delta-1",
        kind: "message.delta",
        occurredAtMs: 3_010,
        payload: { contentDelta: "Hello ", messageId: "message-1", role: "agent" },
        runId: "run-1",
      }),
      runtimeEvent({
        id: "message-delta-2",
        kind: "message.delta",
        occurredAtMs: 3_020,
        payload: { contentDelta: "world", messageId: "message-1", role: "agent" },
        runId: "run-1",
      }),
      runtimeEvent({
        id: "message-end",
        kind: "message.completed",
        occurredAtMs: 3_030,
        payload: { messageId: "message-1", role: "agent" },
        runId: "run-1",
      }),
    ];
    const compacted = compactor.compact(
      fragments.map((event) => ({
        event,
        occurredAt: Date.parse(event.occurredAt),
        sourceEventId: `source-${event.id}`,
      })),
    );

    await persistSessionRuntimeEvents(database, {
      records: compacted,
      sessionId: "session-1",
    });

    const rows = await database
      .prepare(
        `
          SELECT content_text, event_type, process_type
          FROM session_event
        `,
      )
      .all<{
        content_text: string;
        event_type: string;
        process_type: string;
      }>();

    expect(rows.results).toHaveLength(1);
    expect(rows.results[0]).toMatchObject({
      content_text: "Hello world",
      event_type: "message.added",
      process_type: "agent.message.delta",
    });
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
