import { describe, expect, test } from "bun:test";

import { stopDriverSession } from "../src/modules/runtime/infrastructure/driver-session-stop.service";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import { SqliteD1Database } from "./helpers/sqlite-d1";

function createDriverStopDatabase(): SqliteD1Database {
  const database = new SqliteD1Database();

  database.execute(`
    CREATE TABLE driver_instance (
      id text PRIMARY KEY NOT NULL,
      sandbox_id text NOT NULL,
      sandbox_session_id text NOT NULL,
      status text NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE TABLE session_run (
      driver_instance_id text,
      id text PRIMARY KEY NOT NULL,
      session_id text NOT NULL,
      agent_id text NOT NULL,
      created_at integer NOT NULL,
      created_by_account_id text NOT NULL,
      deployment_version_id text,
      deployment_version_number integer,
      status text NOT NULL,
      model text,
      provider text,
      trace_id text NOT NULL,
      trigger text NOT NULL,
      error_code text,
      error_message text,
      error_details_json text,
      started_at integer,
      completed_at integer,
      status_changed_at integer DEFAULT 0 NOT NULL,
      status_event text DEFAULT 'run.queue' NOT NULL,
      status_operation_id text,
      status_seq integer DEFAULT 0 NOT NULL,
      status_source text DEFAULT 'system' NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE TABLE session (
      id text PRIMARY KEY NOT NULL,
      last_run_id text,
      status text NOT NULL,
      status_operation_id text,
      status_seq integer DEFAULT 0 NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE TABLE sandbox (
      id text PRIMARY KEY NOT NULL,
      kind text NOT NULL,
      inactive_deadline_at integer,
      updated_at integer NOT NULL
    );

    CREATE TABLE sandbox_session (
      session_id text PRIMARY KEY NOT NULL,
      sandbox_id text NOT NULL,
      status text NOT NULL
    );

    INSERT INTO sandbox (id, kind, inactive_deadline_at, updated_at)
    VALUES ('01J0000000000000000000000D', 'pet', NULL, 1);

    INSERT INTO session (id, last_run_id, status, updated_at)
    VALUES ('session-1', 'run-1', 'RUNNING', 1);

    INSERT INTO session_run (
      id,
      driver_instance_id,
      session_id,
      agent_id,
      created_at,
      created_by_account_id,
      deployment_version_id,
      deployment_version_number,
      status,
      model,
      provider,
      trace_id,
      trigger,
      error_code,
      error_message,
      error_details_json,
      started_at,
      completed_at,
      updated_at
    )
    VALUES (
      'run-1',
      'driver-1',
      'session-1',
      '01J00000000000000000000009',
      1,
      'account-1',
      NULL,
      NULL,
      'running',
      NULL,
      NULL,
      'trace-1',
      'user_prompt',
      NULL,
      NULL,
      NULL,
      1,
      NULL,
      1
    );

    INSERT INTO driver_instance (
      id,
      sandbox_id,
      sandbox_session_id,
      status,
      updated_at
    )
    VALUES ('driver-1', '01J0000000000000000000000D', 'sandbox-session-1', 'failed', 1);
  `);

  return database;
}

describe("driver session stop", () => {
  test("releases linked runs and records the terminal status", async () => {
    const database = createDriverStopDatabase();

    await stopDriverSession({ DB: database } as ApiBindings, {
      driverInstanceId: "driver-1",
      reason: "test.stop",
      terminalRun: {
        error: {
          code: "agent.runtime_state_operation",
          details: {},
          message: "Stopped by runtime operation.",
          retryable: false,
        },
        status: "cancelled",
      },
    });

    const run = await database
      .prepare("SELECT error_code, status FROM session_run WHERE id = ?")
      .bind("run-1")
      .first<{ error_code: string | null; status: string }>();
    expect(run).toEqual({
      error_code: "agent.runtime_state_operation",
      status: "cancelled",
    });

    const session = await database
      .prepare("SELECT status FROM session WHERE id = ?")
      .bind("session-1")
      .first<{ status: string }>();
    expect(session).toEqual({ status: "IDLE" });

    const runLink = await database
      .prepare("SELECT driver_instance_id FROM session_run WHERE id = ?")
      .bind("run-1")
      .first<{ driver_instance_id: string | null }>();
    expect(runLink).toEqual({ driver_instance_id: "driver-1" });
  });
});
