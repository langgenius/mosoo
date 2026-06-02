import { describe, expect, test } from "bun:test";

import { loadSessionViewerState } from "../src/modules/sessions/infrastructure/session-viewer-live-snapshot.repository";
import { SqliteD1Database } from "./helpers/sqlite-d1";

function createSessionViewerStateDatabase(): SqliteD1Database {
  const database = new SqliteD1Database({ foreignKeys: false });

  database.execute(`
    CREATE TABLE session (
      id text PRIMARY KEY NOT NULL,
      last_run_id text,
      status text NOT NULL,
      title text,
      updated_at integer NOT NULL
    );

    CREATE TABLE session_run (
      completed_at integer,
      created_at integer NOT NULL,
      deployment_version_id text,
      deployment_version_number integer,
      error_code text,
      error_details_json text,
      error_message text,
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

    CREATE TABLE session_message (
      content_text text NOT NULL,
      created_at integer NOT NULL,
      id text PRIMARY KEY NOT NULL,
      plan_json text,
      role text NOT NULL,
      segments_json text,
      seq integer NOT NULL,
      session_id text NOT NULL
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
      scope_id text NOT NULL,
      scope_kind text NOT NULL,
      session_kind text,
      size integer NOT NULL,
      status text NOT NULL,
      updated_at integer NOT NULL,
      version integer NOT NULL
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
