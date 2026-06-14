import { describe, expect, test } from "bun:test";

import { runtimeSessionLinkNeedsRefresh } from "../src/modules/runtime/infrastructure/driver-instance/event-types";
import { getRuntimeSessionLink } from "../src/modules/runtime/infrastructure/driver-instance/session-link.repository";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const AGENT_ID = "01J00000000000000000000009";
const CALLER_FROM_ORIGIN_ID = "01J000000000000000000000F1";
const CREATOR_ID = "01J000000000000000000000F2";
const DRIVER_ID = "01J000000000000000000000F3";
const EXECUTION_OWNER_FROM_ORIGIN_ID = "01J000000000000000000000F4";
const OWNER_ID = "01J000000000000000000000F5";
const ORGANIZATION_ID = "01J00000000000000000000006";
const RUN_CALLER_ID = "01J000000000000000000000F6";
const RUN_ID = "01J000000000000000000000F7";
const SANDBOX_ID = "01J0000000000000000000000D";
const SESSION_ID = "01J000000000000000000000F8";

function createDriverSessionLinkDatabase(): SqliteD1Database {
  const database = new SqliteD1Database({ foreignKeys: false });

  database.execute(`
    CREATE TABLE driver_instance (
      id text PRIMARY KEY NOT NULL,
      sandbox_id text NOT NULL,
      sandbox_session_id text NOT NULL
    );

    CREATE TABLE session_run (
      created_by_account_id text,
      driver_instance_id text,
      id text PRIMARY KEY NOT NULL,
      session_id text NOT NULL,
      status text NOT NULL,
      trace_id text
    );

    CREATE TABLE session (
      agent_id text,
      creator_account_id text NOT NULL,
      id text PRIMARY KEY NOT NULL
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
      origin_json text,
      session_id text PRIMARY KEY NOT NULL
    );

    INSERT INTO agent (id, owner_account_id)
    VALUES ('${AGENT_ID}', '${OWNER_ID}');

    INSERT INTO session (agent_id, creator_account_id, id)
    VALUES ('${AGENT_ID}', '${CREATOR_ID}', '${SESSION_ID}');

    INSERT INTO sandbox (id, kind, subject_kind)
    VALUES ('${SANDBOX_ID}', 'cattle', 'session');

    INSERT INTO sandbox_session (origin_json, session_id)
    VALUES (
      '{"callerUserId":"${CALLER_FROM_ORIGIN_ID}","entrypoint":"api","executionOwnerUserId":"${EXECUTION_OWNER_FROM_ORIGIN_ID}","type":"agent"}',
      '${SESSION_ID}'
    );
  `);

  return database;
}

describe("driver runtime session link", () => {
  test("resolves the product session before a run lease is attached", async () => {
    const database = createDriverSessionLinkDatabase();

    database.execute(`
      INSERT INTO driver_instance (id, sandbox_id, sandbox_session_id)
      VALUES ('${DRIVER_ID}', '${SANDBOX_ID}', '${SESSION_ID}')
    `);

    await expect(getRuntimeSessionLink(database, DRIVER_ID)).resolves.toMatchObject({
      agentId: AGENT_ID,
      callerId: CALLER_FROM_ORIGIN_ID,
      executionOwnerId: EXECUTION_OWNER_FROM_ORIGIN_ID,
      sandboxId: SANDBOX_ID,
      sessionId: SESSION_ID,
      sessionRunId: null,
    });
  });

  test("marks cached pre-run links for refresh after a run can attach", () => {
    expect(
      runtimeSessionLinkNeedsRefresh({
        agentId: AGENT_ID,
        callerId: CALLER_FROM_ORIGIN_ID,
        creatorId: CREATOR_ID,
        executionOwnerId: EXECUTION_OWNER_FROM_ORIGIN_ID,
        organizationId: ORGANIZATION_ID,
        sandboxId: SANDBOX_ID,
        sandboxKind: "cattle",
        sandboxSubjectKind: "session",
        sessionId: SESSION_ID,
        sessionRunId: null,
        sessionRunStatus: null,
        traceId: null,
      }),
    ).toBe(true);
  });

  test("resolves the attached run once the Driver lease is bound", async () => {
    const database = createDriverSessionLinkDatabase();

    database.execute(`
      INSERT INTO session_run (
        created_by_account_id,
        driver_instance_id,
        id,
        session_id,
        status,
        trace_id
      )
      VALUES ('${RUN_CALLER_ID}', '${DRIVER_ID}', '${RUN_ID}', '${SESSION_ID}', 'running', 'trace-1');

      INSERT INTO driver_instance (id, sandbox_id, sandbox_session_id)
      VALUES ('${DRIVER_ID}', '${SANDBOX_ID}', '${SESSION_ID}')
    `);

    await expect(getRuntimeSessionLink(database, DRIVER_ID)).resolves.toMatchObject({
      callerId: CALLER_FROM_ORIGIN_ID,
      sessionId: SESSION_ID,
      sessionRunId: RUN_ID,
      sessionRunStatus: "running",
      traceId: "trace-1",
    });
  });
});
