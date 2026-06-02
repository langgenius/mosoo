import { describe, expect, test } from "bun:test";

import { getRuntimeSessionLink } from "../src/modules/runtime/infrastructure/driver-instance/session-link.repository";
import { SqliteD1Database } from "./helpers/sqlite-d1";

function createRuntimeSessionLinkDatabase(): SqliteD1Database {
  const database = new SqliteD1Database();

  database.execute(`
    CREATE TABLE driver_instance (
      id text PRIMARY KEY NOT NULL,
      sandbox_id text NOT NULL,
      sandbox_session_id text NOT NULL
    );

    CREATE TABLE session_run (
      driver_instance_id text,
      id text PRIMARY KEY NOT NULL,
      session_id text NOT NULL,
      created_by_account_id text NOT NULL,
      trace_id text,
      status text NOT NULL
    );

    CREATE TABLE session (
      id text PRIMARY KEY NOT NULL,
      agent_id text NOT NULL,
      creator_account_id text NOT NULL,
      organization_id text NOT NULL
    );

    CREATE TABLE agent (
      id text PRIMARY KEY NOT NULL,
      owner_account_id text NOT NULL
    );

    CREATE TABLE sandbox (
      id text PRIMARY KEY NOT NULL,
      kind text NOT NULL,
      subject_kind text NOT NULL
    );

    CREATE TABLE sandbox_session (
      session_id text PRIMARY KEY NOT NULL,
      origin_json text
    );

    INSERT INTO agent (id, owner_account_id)
    VALUES ('01J00000000000000000000009', '01J00000000000000000000001');

    INSERT INTO session (id, agent_id, creator_account_id, organization_id)
    VALUES ('session-1', '01J00000000000000000000009', 'creator-1', '01J00000000000000000000006');

    INSERT INTO session_run (driver_instance_id, id, session_id, created_by_account_id, trace_id, status)
    VALUES ('driver-1', 'run-1', 'session-1', 'caller-1', 'trace-1', 'running');

    INSERT INTO sandbox (id, kind, subject_kind)
    VALUES ('01J0000000000000000000000D', 'pet', 'agent');

    INSERT INTO sandbox_session (session_id, origin_json)
    VALUES ('sandbox-session-1', '');

    INSERT INTO driver_instance (id, sandbox_id, sandbox_session_id)
    VALUES ('driver-1', '01J0000000000000000000000D', 'sandbox-session-1');
  `);

  return database;
}

describe("runtime session link", () => {
  test("carries linked Session Run status", async () => {
    const link = await getRuntimeSessionLink(createRuntimeSessionLinkDatabase(), "driver-1");

    expect(link).toMatchObject({
      agentId: "01J00000000000000000000009",
      callerId: "caller-1",
      sessionId: "session-1",
      sessionRunId: "run-1",
      sessionRunStatus: "running",
    });
  });
});
