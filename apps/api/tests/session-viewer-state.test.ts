import { describe, expect, test } from "bun:test";

import { loadSessionViewerState } from "../src/modules/sessions/infrastructure/session-viewer-live-snapshot.repository";
import { loadViewerLiveState } from "../src/modules/sessions/infrastructure/session/viewer-live-state";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const VIEWER = {
  email: "viewer@example.com",
  emailVerified: true,
  id: "viewer-1",
  imageUrl: null,
  name: "Viewer",
};

function createSessionViewerStateDatabase(): SqliteD1Database {
  const database = new SqliteD1Database({ foreignKeys: false });

  database.execute(`
    CREATE TABLE session (
      archived_at integer,
      id text PRIMARY KEY NOT NULL,
      last_run_id text,
      runtime_event_seq_cursor integer NOT NULL DEFAULT 0,
      status text NOT NULL,
      title text,
      updated_at integer NOT NULL
    );

    CREATE TABLE session_run (
      completed_at integer,
      created_at integer NOT NULL,
      deployment_version_id text,
      deployment_version_number integer,
      driver_instance_id text,
      error_code text,
      error_details_json text,
      error_message text,
      error_retryable integer,
      id text PRIMARY KEY NOT NULL,
      model text,
      provider text,
      session_id text NOT NULL,
      started_at integer,
      status text NOT NULL,
      trace_id text NOT NULL,
      trigger text NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE TABLE session_agent_task_snapshot (
      driver_instance_id text NOT NULL,
      run_id text NOT NULL,
      seq integer NOT NULL,
      session_id text PRIMARY KEY NOT NULL,
      tasks_json text NOT NULL
    );

    CREATE TABLE session_message (
      content_text text NOT NULL,
      created_at integer NOT NULL,
      id text PRIMARY KEY NOT NULL,
      plan_json text,
      projection_format text NOT NULL DEFAULT 'materialized',
      role text NOT NULL,
      segments_json text,
      seq integer NOT NULL,
      session_id text NOT NULL,
      session_run_id text
    );

    CREATE TABLE file_record (
      committed integer NOT NULL,
      created_at integer NOT NULL,
      created_by_account_id text NOT NULL,
      etag text,
      expires_at integer,
      id text PRIMARY KEY NOT NULL,
      mime_type text,
      name text NOT NULL,
      object_key text NOT NULL,
      owner_id text NOT NULL,
      owner_kind text NOT NULL,
      parent_path text NOT NULL,
      path text NOT NULL,
      purpose text NOT NULL,
      runtime_event_seq integer,
      scope_id text NOT NULL,
      scope_kind text NOT NULL,
      session_kind text,
      size integer NOT NULL,
      status text NOT NULL,
      updated_at integer NOT NULL,
      version integer NOT NULL
    );

    CREATE TABLE session_artifact_head (
      file_id text,
      runtime_event_seq integer NOT NULL,
      session_id text NOT NULL,
      source_event_id text NOT NULL,
      source_path text NOT NULL,
      updated_at integer NOT NULL,
      UNIQUE (session_id, source_path)
    );

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

    INSERT INTO session (
      id,
      last_run_id,
      status,
      title,
      updated_at
    )
    VALUES ('session-1', 'run-1', 'RUNNING', 'Investigate issue', 30);

    INSERT INTO session_run (
      completed_at,
      created_at,
      driver_instance_id,
      id,
      model,
      provider,
      session_id,
      started_at,
      status,
      trace_id,
      trigger,
      updated_at
    )
    VALUES (
      NULL,
      10,
      'driver-1',
      'run-1',
      'gpt-5.4',
      'openai',
      'session-1',
      11,
      'running',
      'trace-1',
      'user_message',
      20
    );

    INSERT INTO session_message (
      content_text,
      created_at,
      id,
      plan_json,
      role,
      segments_json,
      seq,
      session_id
    )
    VALUES ('hello', 12, 'message-1', NULL, 'user', NULL, 1, 'session-1');

    INSERT INTO file_record (
      committed,
      created_at,
      created_by_account_id,
      etag,
      expires_at,
      id,
      mime_type,
      name,
      object_key,
      owner_id,
      owner_kind,
      parent_path,
      path,
      purpose,
      scope_id,
      scope_kind,
      session_kind,
      size,
      status,
      updated_at,
      version
    )
    VALUES (
      1,
      13,
      'viewer-1',
      NULL,
      NULL,
      'file-1',
      'text/plain',
      'notes.txt',
      'objects/file-1',
      'session-1',
      'session',
      '/',
      '/notes.txt',
      'session_attachment',
      'session-1',
      'session',
      'attachment',
      42,
      'ready',
      13,
      1
    );
  `);

  return database;
}

describe("session viewer state", () => {
  test("loads session, latest run, files, and messages", async () => {
    const database = createSessionViewerStateDatabase();

    const state = await loadSessionViewerState(database, {
      sessionId: "session-1",
      viewerId: "viewer-1",
    });

    expect(state.run.id).toBe("run-1");
    expect(state.run.status).toBe("running");
    expect(state.infra.driverInstanceId).toBe("driver-1");
    expect(state.files).toHaveLength(1);
    expect(state.messages).toHaveLength(1);
    expect(state.title).toBe("Investigate issue");
  });

  test("loads an empty file list", async () => {
    const database = createSessionViewerStateDatabase();
    database.execute("DELETE FROM file_record");

    const state = await loadSessionViewerState(database, {
      sessionId: "session-1",
      viewerId: "viewer-1",
    });

    expect(state.files).toEqual([]);
    expect(state.messages).toHaveLength(1);
  });

  test("loads the schema-validated current task snapshot from the same canonical read", async () => {
    const database = createSessionViewerStateDatabase();
    database.execute(`
      INSERT INTO session_agent_task_snapshot (
        driver_instance_id,
        run_id,
        seq,
        session_id,
        tasks_json
      )
      VALUES (
        'driver-1',
        'run-1',
        7,
        'session-1',
        '{"tasks":[{"taskId":"task-1","title":"Inspect"}]}'
      );
    `);

    const state = await loadSessionViewerState(database, {
      sessionId: "session-1",
      viewerId: "viewer-1",
    });

    expect(state.taskSnapshot).toEqual({
      driverInstanceId: "driver-1",
      runId: "run-1",
      tasks: [{ taskId: "task-1", title: "Inspect" }],
    });
  });

  test("refreshes the independently durable task snapshot when the live-state cache is stale", async () => {
    const database = createSessionViewerStateDatabase();
    database.execute(`
      INSERT INTO session_agent_task_snapshot (
        driver_instance_id,
        run_id,
        seq,
        session_id,
        tasks_json
      )
      VALUES ('driver-1', 'run-1', 7, 'session-1', '{"tasks":[{"taskId":"stale"}]}');
    `);
    const cachedState = await loadSessionViewerState(database, {
      sessionId: "session-1",
      viewerId: VIEWER.id,
    });
    database.execute(`
      UPDATE session_agent_task_snapshot
      SET seq = 8, tasks_json = '{"tasks":[{"taskId":"latest"}]}'
      WHERE session_id = 'session-1';
    `);

    const state = await loadViewerLiveState({
      cachedState,
      database,
      reconciledStaleRun: false,
      sessionId: "session-1",
      viewer: VIEWER,
    });

    expect(state.taskSnapshot?.tasks).toEqual([{ taskId: "latest" }]);
    expect(state.messages).toEqual(cachedState.messages);
  });

  test("reloads the canonical viewer generation when a newer run broadcast was missed", async () => {
    const database = createSessionViewerStateDatabase();
    database.execute(`
      INSERT INTO session_agent_task_snapshot (
        driver_instance_id,
        run_id,
        seq,
        session_id,
        tasks_json
      )
      VALUES ('driver-1', 'run-1', 7, 'session-1', '{"tasks":[{"taskId":"run-1"}]}');
    `);
    const cachedState = await loadSessionViewerState(database, {
      sessionId: "session-1",
      viewerId: VIEWER.id,
    });
    database.execute(`
      INSERT INTO session_run (
        completed_at,
        created_at,
        driver_instance_id,
        id,
        model,
        provider,
        session_id,
        started_at,
        status,
        trace_id,
        trigger,
        updated_at
      )
      VALUES (
        NULL,
        31,
        'driver-2',
        'run-2',
        'gpt-5.4',
        'openai',
        'session-1',
        32,
        'running',
        'trace-2',
        'user_message',
        33
      );
      UPDATE session
      SET last_run_id = 'run-2', updated_at = 34
      WHERE id = 'session-1';
      UPDATE session_agent_task_snapshot
      SET
        driver_instance_id = 'driver-2',
        run_id = 'run-2',
        seq = 8,
        tasks_json = '{"tasks":[{"taskId":"run-2"}]}'
      WHERE session_id = 'session-1';
    `);

    const state = await loadViewerLiveState({
      cachedState,
      database,
      reconciledStaleRun: false,
      sessionId: "session-1",
      viewer: VIEWER,
    });

    expect(state.run).toMatchObject({ id: "run-2", status: "running", traceId: "trace-2" });
    expect(state.infra.driverInstanceId).toBe("driver-2");
    expect(state.taskSnapshot).toEqual({
      driverInstanceId: "driver-2",
      runId: "run-2",
      tasks: [{ taskId: "run-2" }],
    });
  });

  test("reloads canonical terminal state when its live broadcast was missed", async () => {
    const database = createSessionViewerStateDatabase();
    database.execute(`
      INSERT INTO session_agent_task_snapshot (
        driver_instance_id,
        run_id,
        seq,
        session_id,
        tasks_json
      )
      VALUES ('driver-1', 'run-1', 7, 'session-1', '{"tasks":[{"taskId":"running"}]}');
    `);
    const cachedState = await loadSessionViewerState(database, {
      sessionId: "session-1",
      viewerId: VIEWER.id,
    });
    database.execute(`
      UPDATE session
      SET status = 'IDLE', updated_at = 40
      WHERE id = 'session-1';
      UPDATE session_run
      SET completed_at = 39, status = 'completed', updated_at = 39
      WHERE id = 'run-1';
    `);

    const state = await loadViewerLiveState({
      cachedState,
      database,
      reconciledStaleRun: false,
      sessionId: "session-1",
      viewer: VIEWER,
    });

    expect(state.lifecycle).toBe("IDLE");
    expect(state.run).toMatchObject({ id: "run-1", status: "completed" });
    expect(state.infra.driverInstanceId).toBeNull();
    expect(state.taskSnapshot).toBeNull();
  });

  test.each([
    ["canonical row is removed", "DELETE FROM session_agent_task_snapshot"],
    [
      "canonical run becomes terminal",
      "UPDATE session_run SET status = 'completed' WHERE id = 'run-1'",
    ],
  ])("clears a cached task snapshot when the %s", async (_label, boundarySql) => {
    const database = createSessionViewerStateDatabase();
    database.execute(`
      INSERT INTO session_agent_task_snapshot (
        driver_instance_id,
        run_id,
        seq,
        session_id,
        tasks_json
      )
      VALUES ('driver-1', 'run-1', 7, 'session-1', '{"tasks":[{"taskId":"stale"}]}');
    `);
    const cachedState = await loadSessionViewerState(database, {
      sessionId: "session-1",
      viewerId: VIEWER.id,
    });
    database.execute(boundarySql);

    const state = await loadViewerLiveState({
      cachedState,
      database,
      reconciledStaleRun: false,
      sessionId: "session-1",
      viewer: VIEWER,
    });

    expect(state.taskSnapshot).toBeNull();
  });

  test.each([
    ["terminal run", "UPDATE session_run SET status = 'completed' WHERE id = 'run-1'"],
    ["rescheduling session", "UPDATE session SET status = 'RESCHEDULING' WHERE id = 'session-1'"],
    ["archived running session", "UPDATE session SET archived_at = 9 WHERE id = 'session-1'"],
    ["new run", "UPDATE session SET last_run_id = 'run-2' WHERE id = 'session-1'"],
    [
      "new driver generation",
      "UPDATE session_run SET driver_instance_id = 'driver-2' WHERE id = 'run-1'",
    ],
  ])("does not leak task history across a %s boundary", async (_label, boundarySql) => {
    const database = createSessionViewerStateDatabase();
    database.execute(`
      INSERT INTO session_agent_task_snapshot (
        driver_instance_id,
        run_id,
        seq,
        session_id,
        tasks_json
      )
      VALUES ('driver-1', 'run-1', 7, 'session-1', '{"tasks":[{"taskId":"stale"}]}');
      ${boundarySql};
    `);

    const state = await loadSessionViewerState(database, {
      sessionId: "session-1",
      viewerId: "viewer-1",
    });

    expect(state.taskSnapshot).toBeNull();
  });

  test("fails closed when persisted task JSON is malformed", async () => {
    const database = createSessionViewerStateDatabase();
    database.execute(`
      INSERT INTO session_agent_task_snapshot (
        driver_instance_id,
        run_id,
        seq,
        session_id,
        tasks_json
      )
      VALUES ('driver-1', 'run-1', 7, 'session-1', '{"tasks":"invalid"}');
    `);

    const state = await loadSessionViewerState(database, {
      sessionId: "session-1",
      viewerId: "viewer-1",
    });

    expect(state.taskSnapshot).toBeNull();
  });

  test("loads active permissions and readiness projections", async () => {
    const database = createSessionViewerStateDatabase();
    database.execute(`
      INSERT INTO session_permission_request (
        created_at,
        driver_instance_id,
        raw_input,
        request_id,
        run_id,
        session_id,
        title,
        tool_call_id,
        tool_kind,
        updated_at
      )
      VALUES (
        14,
        'driver-1',
        'raw details',
        'permission-1',
        'run-1',
        'session-1',
        'Approve tool',
        'tool-call-1',
        'shell',
        14
      );

      INSERT INTO session_readiness_snapshot (
        readiness_json,
        session_id,
        updated_at
      )
      VALUES (
        '{"checkedAt":"2026-05-08T00:00:00.000Z","issues":[],"ready":true}',
        'session-1',
        15
      );
    `);

    const state = await loadSessionViewerState(database, {
      sessionId: "session-1",
      viewerId: "viewer-1",
    });

    expect(state.permissionRequests).toEqual([
      {
        driverInstanceId: "driver-1",
        rawInput: "raw details",
        requestId: "permission-1",
        runId: "run-1",
        title: "Approve tool",
        toolCallId: "tool-call-1",
        toolKind: "shell",
      },
    ]);
    expect(state.readiness).toEqual({
      checkedAt: "2026-05-08T00:00:00.000Z",
      issues: [],
      ready: true,
    });
  });
});
