import { describe, expect, test } from "bun:test";

import type { RuntimeOperationId } from "@mosoo/id";

import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import {
  deleteSessionCascade,
  repairStaleSessionDeleteCleanups,
} from "../src/modules/sessions/application/session-cleanup.service";
import {
  archiveAgentSession,
  deleteAgentSession,
  unarchiveAgentSession,
} from "../src/modules/sessions/application/session-lifecycle-mutation.service";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  PUBLIC_API_TEST_IDS,
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  insertOwnerSession,
  insertMemberSession,
} from "./helpers/published-agent-http-test-fixture";

const MEMBER_VIEWER: AuthenticatedViewer = {
  email: "member@example.com",
  emailVerified: true,
  id: PUBLIC_API_TEST_IDS.memberAccount,
  imageUrl: null,
  name: "Org Member",
};

const FAILED_DRIVER_ID = "01J0000000000000000000000G";

function createDriverConnectionBinding(paths: string[]) {
  return {
    get: () => ({
      fetch: async (request: Request) => {
        paths.push(new URL(request.url).pathname);
        return Response.json({ ok: true });
      },
    }),
    idFromName: (name: string) => name,
  };
}

function withDriverConnection(bindings: ApiBindings, paths: string[]): ApiBindings {
  return {
    ...bindings,
    DriverConnection: createDriverConnectionBinding(paths) as ApiBindings["DriverConnection"],
  };
}

function createSessionLifecycleBinding(paths: string[], options: { destroyError?: Error } = {}) {
  return {
    get: () => ({
      closeViewers: async (_sessionId: string, reason: string) => {
        paths.push(`close:${reason}`);
      },
      destroy: async (_sessionId: string, reason: string) => {
        paths.push(`destroy:${reason}`);
        if (options.destroyError !== undefined) {
          throw options.destroyError;
        }
      },
      fetch: async () => new Response(null, { status: 204 }),
      publishEvents: async () => {},
      syncViewers: async () => {},
    }),
    idFromName: (name: string) => name,
  };
}

function withSessionLifecycleBinding(
  bindings: ApiBindings,
  paths: string[] = [],
  options: { destroyError?: Error } = {},
): ApiBindings {
  return {
    ...bindings,
    Session: createSessionLifecycleBinding(paths, options) as ApiBindings["Session"],
  };
}

async function ensureRuntimeLifecycleTables(database: D1Database): Promise<void> {
  await database
    .prepare(
      `
        CREATE TABLE IF NOT EXISTS sandbox (
          id text PRIMARY KEY NOT NULL,
          inactive_deadline_at integer,
          kind text NOT NULL,
          status text DEFAULT 'active' NOT NULL,
          updated_at integer DEFAULT 1 NOT NULL
        )
      `,
    )
    .run();
  await database
    .prepare(
      `
        CREATE TABLE IF NOT EXISTS sandbox_session (
          cloudflare_session_id text NOT NULL,
          created_at integer NOT NULL,
          cwd text NOT NULL,
          origin_json text NOT NULL,
          sandbox_id text NOT NULL,
          session_id text PRIMARY KEY NOT NULL,
          space_aliases_json text NOT NULL,
          status text NOT NULL,
          updated_at integer NOT NULL
        )
      `,
    )
    .run();
  await database
    .prepare(
      `
        CREATE TABLE IF NOT EXISTS sandbox_backup (
          id text PRIMARY KEY NOT NULL,
          dir text NOT NULL,
          sandbox_id text NOT NULL,
          status text NOT NULL,
          created_at integer NOT NULL,
          updated_at integer NOT NULL
        )
      `,
    )
    .run();
}

async function insertSandboxSession(database: D1Database): Promise<void> {
  await ensureRuntimeLifecycleTables(database);
  await database
    .prepare(
      `
        INSERT INTO sandbox (
          id,
          kind,
          subject_kind,
          subject_id,
          status,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .bind(PUBLIC_API_TEST_IDS.sandbox, "pet", "agent", PUBLIC_API_TEST_IDS.agent, "active", 1, 1)
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
          session_id,
          space_aliases_json,
          status,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .bind(
      "01J0000000000000000000000S",
      1,
      "session-cwd",
      "{}",
      PUBLIC_API_TEST_IDS.sandbox,
      PUBLIC_API_TEST_IDS.memberSession,
      "[]",
      "closed",
      1,
    )
    .run();
}

async function insertSessionRun(
  database: D1Database,
  input: {
    runId: string;
    status?: string;
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
      PUBLIC_API_TEST_IDS.memberSession,
      PUBLIC_API_TEST_IDS.agent,
      PUBLIC_API_TEST_IDS.memberAccount,
      "user_prompt",
      input.status ?? "running",
      "openai",
      "gpt-5.4",
      "openai-runtime",
      `trace-${input.runId}`,
      1,
      1,
    )
    .run();
  await database
    .prepare("UPDATE session SET last_run_id = ?, status = ? WHERE id = ?")
    .bind(
      input.runId,
      input.status === "completed" ? "IDLE" : "RUNNING",
      PUBLIC_API_TEST_IDS.memberSession,
    )
    .run();
}

async function insertDriverInstance(
  database: D1Database,
  input: {
    driverId: string;
    sandboxSessionId: string;
    sessionRunId: string | null;
    status: string;
    tokenByte: number;
  },
): Promise<void> {
  await database
    .prepare(
      `
        INSERT INTO driver_instance (
          id,
          sandbox_id,
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
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .bind(
      input.driverId,
      PUBLIC_API_TEST_IDS.sandbox,
      input.sandboxSessionId,
      "cloudflare-container",
      "driver-ws",
      1,
      input.status,
      new Uint8Array([input.tokenByte]),
      10_000,
      0,
      20_000,
      1,
      1,
    )
    .run();

  if (input.sessionRunId !== null) {
    await database
      .prepare("UPDATE session_run SET driver_instance_id = ? WHERE id = ?")
      .bind(input.driverId, input.sessionRunId)
      .run();
  }
}

describe("session lifecycle mutations", () => {
  test("delete cascade removes live and terminal driver instances associated with the session", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertMemberSession(database);
    await insertSandboxSession(database);
    await insertSessionRun(database, { runId: PUBLIC_API_TEST_IDS.run });
    await insertSessionRun(database, {
      runId: PUBLIC_API_TEST_IDS.runAlt,
      status: "completed",
    });
    await insertDriverInstance(database, {
      driverId: PUBLIC_API_TEST_IDS.driverMember,
      sandboxSessionId: PUBLIC_API_TEST_IDS.memberSession,
      sessionRunId: PUBLIC_API_TEST_IDS.run,
      status: "ready",
      tokenByte: 1,
    });
    await insertDriverInstance(database, {
      driverId: PUBLIC_API_TEST_IDS.driverOwner,
      sandboxSessionId: PUBLIC_API_TEST_IDS.memberSession,
      sessionRunId: null,
      status: "stopped",
      tokenByte: 2,
    });
    await insertDriverInstance(database, {
      driverId: FAILED_DRIVER_ID,
      sandboxSessionId: PUBLIC_API_TEST_IDS.ownerSession,
      sessionRunId: PUBLIC_API_TEST_IDS.runAlt,
      status: "failed",
      tokenByte: 3,
    });
    const driverRequests: string[] = [];
    const bindings = withSessionLifecycleBinding(
      withDriverConnection(createPublicHttpTestBindings(database) as ApiBindings, driverRequests),
    );

    const outcomes = await deleteSessionCascade(bindings, PUBLIC_API_TEST_IDS.memberSession);

    const remainingDrivers = await database
      .prepare(
        `
          SELECT id
          FROM driver_instance
          WHERE id IN (?, ?, ?)
          ORDER BY id
        `,
      )
      .bind(PUBLIC_API_TEST_IDS.driverMember, PUBLIC_API_TEST_IDS.driverOwner, FAILED_DRIVER_ID)
      .all<{ id: string }>();
    const session = await database
      .prepare("SELECT id FROM session WHERE id = ?")
      .bind(PUBLIC_API_TEST_IDS.memberSession)
      .first();

    expect(remainingDrivers.results).toEqual([]);
    expect(session).toBeNull();
    expect(driverRequests.length).toBeGreaterThan(0);
    expect(outcomes.every((outcome) => outcome.status === "completed")).toBe(true);
  });

  test("delete cascade completes when the session has no runtime state", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertMemberSession(database);
    const bindings = withSessionLifecycleBinding(
      createPublicHttpTestBindings(database) as ApiBindings,
    );

    const outcomes = await deleteSessionCascade(bindings, PUBLIC_API_TEST_IDS.memberSession);
    const session = await database
      .prepare("SELECT id FROM session WHERE id = ?")
      .bind(PUBLIC_API_TEST_IDS.memberSession)
      .first();

    expect(session).toBeNull();
    expect(outcomes.every((outcome) => outcome.status !== "failed")).toBe(true);
  });

  test("delete cleanup keeps a durable anchor and repair resumes after interruption", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertMemberSession(database);
    const operationId = PUBLIC_API_TEST_IDS.operation as RuntimeOperationId;
    const failingBindings = withSessionLifecycleBinding(
      createPublicHttpTestBindings(database) as ApiBindings,
      [],
      { destroyError: new Error("session destroy interrupted") },
    );

    await expect(
      deleteSessionCascade(failingBindings, PUBLIC_API_TEST_IDS.memberSession, {
        operationId,
      }),
    ).rejects.toThrow();

    const anchoredSession = await database
      .prepare(
        `
          SELECT archived_at, status, status_operation_id
          FROM session
          WHERE id = ?
        `,
      )
      .bind(PUBLIC_API_TEST_IDS.memberSession)
      .first<{
        archived_at: number | null;
        status: string;
        status_operation_id: string | null;
      }>();

    expect(anchoredSession?.archived_at).toBeNumber();
    expect(anchoredSession).toMatchObject({
      status: "TERMINATED",
      status_operation_id: operationId,
    });

    const repairedCount = await repairStaleSessionDeleteCleanups(
      withSessionLifecycleBinding(createPublicHttpTestBindings(database) as ApiBindings),
      {
        limit: 10,
        staleUpdatedAtLte: Date.now(),
      },
    );
    const session = await database
      .prepare("SELECT id FROM session WHERE id = ?")
      .bind(PUBLIC_API_TEST_IDS.memberSession)
      .first();

    expect(repairedCount).toBe(1);
    expect(session).toBeNull();
  });

  test("archive cancels active runs and exposes an idle archived session", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertMemberSession(database);
    await ensureRuntimeLifecycleTables(database);
    await insertSessionRun(database, { runId: PUBLIC_API_TEST_IDS.run });
    const bindings = withSessionLifecycleBinding(
      createPublicHttpTestBindings(database) as ApiBindings,
    );

    const outcomes = await archiveAgentSession({
      bindings,
      sessionId: PUBLIC_API_TEST_IDS.memberSession,
      viewer: MEMBER_VIEWER,
    });

    const row = await database
      .prepare(
        `
          SELECT session.archived_at,
                 session.status AS session_status,
                 session_run.status AS run_status
          FROM session
          INNER JOIN session_run ON session_run.id = session.last_run_id
          WHERE session.id = ?
        `,
      )
      .bind(PUBLIC_API_TEST_IDS.memberSession)
      .first<{
        archived_at: number | null;
        run_status: string;
        session_status: string;
      }>();

    expect(row?.archived_at).toBeNumber();
    expect(row).toMatchObject({
      run_status: "cancelled",
      session_status: "IDLE",
    });
    expect(outcomes.every((outcome) => outcome.status !== "failed")).toBe(true);
  });

  test("unarchive normalizes stale rescheduling state before exposing the session", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertMemberSession(database);
    await insertSessionRun(database, { runId: PUBLIC_API_TEST_IDS.run });
    await database
      .prepare(
        `
          UPDATE session
             SET archived_at = ?,
                 status = ?,
                 status_operation_id = ?
           WHERE id = ?
        `,
      )
      .bind(1, "RESCHEDULING", PUBLIC_API_TEST_IDS.operation, PUBLIC_API_TEST_IDS.memberSession)
      .run();

    await unarchiveAgentSession({
      database,
      sessionId: PUBLIC_API_TEST_IDS.memberSession,
      viewer: MEMBER_VIEWER,
    });

    const row = await database
      .prepare(
        `
          SELECT session.archived_at,
                 session.status AS session_status,
                 session.status_operation_id,
                 session_run.status AS run_status
          FROM session
          INNER JOIN session_run ON session_run.id = session.last_run_id
          WHERE session.id = ?
        `,
      )
      .bind(PUBLIC_API_TEST_IDS.memberSession)
      .first<{
        archived_at: number | null;
        run_status: string;
        session_status: string;
        status_operation_id: string | null;
      }>();

    expect(row).toEqual({
      archived_at: null,
      run_status: "cancelled",
      session_status: "IDLE",
      status_operation_id: null,
    });
  });

  test("lifecycle mutations reject attributed participants who are not session creators", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertOwnerSession(database);
    await database
      .prepare("UPDATE session SET attributed_user_id = ? WHERE id = ?")
      .bind(PUBLIC_API_TEST_IDS.memberAccount, PUBLIC_API_TEST_IDS.ownerSession)
      .run();
    const bindings = withSessionLifecycleBinding(
      createPublicHttpTestBindings(database) as ApiBindings,
    );

    await expect(
      archiveAgentSession({
        bindings,
        sessionId: PUBLIC_API_TEST_IDS.ownerSession,
        viewer: MEMBER_VIEWER,
      }),
    ).rejects.toThrow();

    await database
      .prepare("UPDATE session SET archived_at = ? WHERE id = ?")
      .bind(1, PUBLIC_API_TEST_IDS.ownerSession)
      .run();

    await expect(
      unarchiveAgentSession({
        database,
        sessionId: PUBLIC_API_TEST_IDS.ownerSession,
        viewer: MEMBER_VIEWER,
      }),
    ).rejects.toThrow();

    await expect(
      deleteAgentSession({
        bindings,
        sessionId: PUBLIC_API_TEST_IDS.ownerSession,
        viewer: MEMBER_VIEWER,
      }),
    ).rejects.toThrow();
  });
});
