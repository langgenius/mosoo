import { describe, expect, test } from "bun:test";

import type { RuntimeOperationId } from "@mosoo/id";

import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import type { SandboxHandle } from "../src/modules/runtime/infrastructure/sandbox-handles";
import { setSessionRunStatus } from "../src/modules/runtime/infrastructure/session-runs/session-run-store.repository";
import {
  deleteSessionCascade,
  repairStaleSessionDeleteCleanups,
} from "../src/modules/sessions/application/session-cleanup.service";
import {
  archiveAgentSession,
  deleteAgentSession,
  repairStaleSessionArchiveCleanups,
  unarchiveAgentSession,
} from "../src/modules/sessions/application/session-lifecycle-mutation.service";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import { applyDrizzleMigration } from "./helpers/drizzle-migrations";
import {
  PUBLIC_API_TEST_IDS,
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  insertActiveSandboxSessionFixture,
  insertOwnerSession,
  insertNonOwnerSession,
} from "./helpers/public-api-http-test-fixture";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const OWNER_VIEWER: AuthenticatedViewer = {
  email: "owner@example.com",
  emailVerified: true,
  id: PUBLIC_API_TEST_IDS.ownerAccount,
  imageUrl: null,
  name: "Org Owner",
};

const FAILED_DRIVER_ID = "01J0000000000000000000000G";
const SESSION_FILE_ID = "01J0000000000000000000000H";

class RetriableSessionFileBucket {
  readonly deletedKeys: string[] = [];
  failDelete = true;

  async delete(key: string): Promise<void> {
    this.deletedKeys.push(key);

    if (this.failDelete) {
      throw new Error("R2 delete interrupted.");
    }
  }
}

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

function createSessionLifecycleBinding(
  paths: string[],
  options: { closeError?: Error; destroyError?: Error } = {},
) {
  return {
    get: () => ({
      closeViewers: async (_sessionId: string, reason: string) => {
        paths.push(`close:${reason}`);
        if (options.closeError !== undefined) {
          throw options.closeError;
        }
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
  options: { closeError?: Error; destroyError?: Error } = {},
): ApiBindings {
  return {
    ...bindings,
    runtimeSubjectHandleFactory: () => createCleanupSandboxHandle(),
    Session: createSessionLifecycleBinding(paths, options) as ApiBindings["Session"],
  };
}

function createCleanupSandboxHandle(): SandboxHandle {
  const unavailable = async (): Promise<never> => {
    throw new Error("Unexpected sandbox test method call.");
  };

  return {
    configureNetworkConstraints: unavailable,
    createBackup: unavailable,
    createSession: unavailable,
    deleteSession: async (sessionId) => ({
      sessionId,
      success: true,
      timestamp: new Date(0).toISOString(),
    }),
    destroy: unavailable,
    exec: unavailable,
    getSession: unavailable,
    mkdir: unavailable,
    mountBucket: unavailable,
    readFile: unavailable,
    restoreBackup: unavailable,
    setKeepAlive: unavailable,
    startProcess: unavailable,
    terminal: unavailable,
    unmountBucket: unavailable,
    watch: unavailable,
    writeFile: unavailable,
    wsConnect: unavailable,
  };
}

async function insertSandboxSession(
  database: SqliteD1Database,
  sessionId: string = PUBLIC_API_TEST_IDS.nonOwnerSession,
): Promise<void> {
  const ownerAccountId =
    sessionId === PUBLIC_API_TEST_IDS.ownerSession
      ? PUBLIC_API_TEST_IDS.ownerAccount
      : PUBLIC_API_TEST_IDS.nonOwnerAccount;
  await insertActiveSandboxSessionFixture(database, {
    cwd: "/workspace/session-cwd",
    ownerAccountId,
    sandboxId: PUBLIC_API_TEST_IDS.sandbox,
    sandboxSessionId: "01J0000000000000000000000S",
    sessionId,
    timestampMs: 1,
  });
  await database
    .prepare("UPDATE sandbox_session SET status = 'closed' WHERE session_id = ?")
    .bind(sessionId)
    .run();
}

async function insertSessionRun(
  database: D1Database,
  input: {
    createdByAccountId?: string;
    runId: string;
    sessionId?: string;
    status?: string;
  },
): Promise<void> {
  const sessionId = input.sessionId ?? PUBLIC_API_TEST_IDS.nonOwnerSession;

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
      sessionId,
      PUBLIC_API_TEST_IDS.agent,
      input.createdByAccountId ?? PUBLIC_API_TEST_IDS.nonOwnerAccount,
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
    .bind(input.runId, input.status === "completed" ? "IDLE" : "RUNNING", sessionId)
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
      input.driverId,
      PUBLIC_API_TEST_IDS.sandbox,
      1,
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

async function insertSessionFileForCleanup(database: D1Database): Promise<void> {
  await database
    .prepare(
      `
        INSERT INTO file_record (
          id,
          scope_kind,
          scope_id,
          session_kind,
          status,
          name,
          path,
          parent_path,
          object_key,
          owner_id,
          owner_kind,
          purpose,
          expires_at,
          mime_type,
          size,
          etag,
          committed,
          version,
          created_by_account_id,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .bind(
      SESSION_FILE_ID,
      "session",
      PUBLIC_API_TEST_IDS.nonOwnerSession,
      "attachment",
      "ready",
      "notes.txt",
      `attachment/${SESSION_FILE_ID}/notes.txt`,
      `attachment/${SESSION_FILE_ID}`,
      `session-files/${SESSION_FILE_ID}/notes.txt`,
      PUBLIC_API_TEST_IDS.nonOwnerSession,
      "session",
      "session_attachment",
      null,
      "text/plain",
      12,
      null,
      1,
      1,
      PUBLIC_API_TEST_IDS.nonOwnerAccount,
      1,
      1,
    )
    .run();
}

describe("session lifecycle mutations", () => {
  test("cleanup migration preserves data without enqueueing external cleanup", async () => {
    const database = new SqliteD1Database();
    database.execute(`
      CREATE TABLE session (
        id text PRIMARY KEY,
        archived_at integer,
        status text NOT NULL,
        status_operation_id text,
        status_seq integer NOT NULL,
        updated_at integer NOT NULL
      );
      CREATE TABLE child (
        session_id text REFERENCES session(id) ON DELETE CASCADE
      );
      INSERT INTO session VALUES ('session-1', NULL, 'IDLE', NULL, 0, 1);
      INSERT INTO session VALUES ('legacy-delete', 2, 'TERMINATED', 'delete-op', 4, 2);
      INSERT INTO session VALUES ('legacy-archive', 3, 'IDLE', NULL, 7, 3);
      INSERT INTO child VALUES ('session-1');
    `);
    applyDrizzleMigration(database, "0016_session-cleanup-operation");

    expect(await database.prepare("SELECT COUNT(*) AS count FROM child").first()).toEqual({
      count: 1,
    });
    expect(
      await database
        .prepare(
          "SELECT cleanup_operation_kind, status, status_operation_id, status_seq FROM session WHERE id = 'legacy-delete'",
        )
        .first(),
    ).toEqual({
      cleanup_operation_kind: null,
      status: "TERMINATED",
      status_operation_id: "delete-op",
      status_seq: 4,
    });
    expect(
      await database
        .prepare(
          "SELECT cleanup_operation_kind, status, status_operation_id, status_seq FROM session WHERE id = 'legacy-archive'",
        )
        .first(),
    ).toEqual({
      cleanup_operation_kind: null,
      status: "IDLE",
      status_operation_id: null,
      status_seq: 7,
    });
    await expect(
      database
        .prepare("UPDATE session SET cleanup_operation_kind = 'archive' WHERE id = 'session-1'")
        .run(),
    ).rejects.toThrow("session_cleanup_operation_kind_check");
    await expect(
      database
        .prepare(
          `UPDATE session
              SET runtime_provisioning_operation_id = '01J0000000000000000000000R',
                  runtime_provisioning_sandbox_id = '01J0000000000000000000000S'
            WHERE id = 'session-1'`,
        )
        .run(),
    ).rejects.toThrow("session_runtime_provisioning_lease_check");
    await expect(
      database
        .prepare(
          `UPDATE session
              SET runtime_provisioning_operation_id = '01J0000000000000000000000R',
                  runtime_provisioning_sandbox_id = '01J0000000000000000000000S',
                  runtime_provisioning_heartbeat_at = 'not-a-timestamp'
            WHERE id = 'session-1'`,
        )
        .run(),
    ).rejects.toThrow("session_runtime_provisioning_lease_check");
    await database
      .prepare(
        `UPDATE session
            SET archived_at = 1,
                cleanup_operation_kind = 'archive',
                status = 'RESCHEDULING',
                status_operation_id = 'operation-1'
          WHERE id = 'session-1'`,
      )
      .run();
    await database
      .prepare(
        `UPDATE session
            SET cleanup_operation_kind = 'archive',
                status = 'IDLE',
                status_operation_id = NULL
          WHERE id = 'session-1'`,
      )
      .run();
  });

  test("maintenance adopts cleanup claims written by an old worker after migration", async () => {
    const archiveDatabase = await createPublicHttpContractDatabase();
    await insertOwnerSession(archiveDatabase);
    await archiveDatabase
      .prepare(
        `UPDATE session
            SET archived_at = 1,
                cleanup_operation_kind = NULL,
                status = 'RESCHEDULING',
                status_operation_id = ?,
                updated_at = 1
          WHERE id = ?`,
      )
      .bind(PUBLIC_API_TEST_IDS.operation, PUBLIC_API_TEST_IDS.ownerSession)
      .run();

    expect(
      await repairStaleSessionArchiveCleanups(
        withSessionLifecycleBinding(createPublicHttpTestBindings(archiveDatabase) as ApiBindings),
        { limit: 10, staleUpdatedAtLte: 1 },
      ),
    ).toBe(1);
    expect(
      await archiveDatabase
        .prepare(
          "SELECT cleanup_operation_kind, status, status_operation_id FROM session WHERE id = ?",
        )
        .bind(PUBLIC_API_TEST_IDS.ownerSession)
        .first(),
    ).toEqual({
      cleanup_operation_kind: "archive",
      status: "IDLE",
      status_operation_id: null,
    });

    const deleteDatabase = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(deleteDatabase);
    await deleteDatabase
      .prepare(
        `UPDATE session
            SET archived_at = 1,
                cleanup_operation_kind = NULL,
                status = 'TERMINATED',
                status_operation_id = ?,
                updated_at = 1
          WHERE id = ?`,
      )
      .bind(PUBLIC_API_TEST_IDS.operation, PUBLIC_API_TEST_IDS.nonOwnerSession)
      .run();

    expect(
      await repairStaleSessionDeleteCleanups(
        withSessionLifecycleBinding(createPublicHttpTestBindings(deleteDatabase) as ApiBindings),
        { limit: 10, staleUpdatedAtLte: 1 },
      ),
    ).toBe(1);
    expect(
      await deleteDatabase
        .prepare("SELECT id FROM session WHERE id = ?")
        .bind(PUBLIC_API_TEST_IDS.nonOwnerSession)
        .first(),
    ).toBeNull();
  });

  test("archive and delete cannot pass an active runtime provisioning fence", async () => {
    for (const action of ["archive", "delete"] as const) {
      const database = await createPublicHttpContractDatabase();
      await insertOwnerSession(database);
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
          PUBLIC_API_TEST_IDS.ownerSession,
        )
        .run();
      const bindings = withSessionLifecycleBinding(
        createPublicHttpTestBindings(database) as ApiBindings,
      );

      const mutation =
        action === "archive"
          ? archiveAgentSession({
              bindings,
              projectId: PUBLIC_API_TEST_IDS.project,
              sessionId: PUBLIC_API_TEST_IDS.ownerSession,
              viewer: OWNER_VIEWER,
            })
          : deleteSessionCascade(bindings, PUBLIC_API_TEST_IDS.ownerSession);
      await expect(mutation).rejects.toThrow();
      expect(
        await database
          .prepare(
            "SELECT archived_at, cleanup_operation_kind, runtime_provisioning_operation_id FROM session WHERE id = ?",
          )
          .bind(PUBLIC_API_TEST_IDS.ownerSession)
          .first(),
      ).toEqual({
        archived_at: null,
        cleanup_operation_kind: null,
        runtime_provisioning_operation_id: PUBLIC_API_TEST_IDS.operation,
      });
    }
  });

  test("failed archive repairs move behind older pending work", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(database);
    await insertOwnerSession(database);
    await database
      .prepare(
        `UPDATE session
            SET archived_at = 1,
                cleanup_operation_kind = 'archive',
                status = 'RESCHEDULING',
                status_operation_id = ?,
                updated_at = 1
          WHERE id = ?`,
      )
      .bind(PUBLIC_API_TEST_IDS.operation, PUBLIC_API_TEST_IDS.nonOwnerSession)
      .run();
    await database
      .prepare(
        `UPDATE session
            SET archived_at = 2,
                cleanup_operation_kind = 'archive',
                status = 'RESCHEDULING',
                status_operation_id = ?,
                updated_at = 2
          WHERE id = ?`,
      )
      .bind(PUBLIC_API_TEST_IDS.operation, PUBLIC_API_TEST_IDS.ownerSession)
      .run();
    const bindings = withSessionLifecycleBinding(
      createPublicHttpTestBindings(database) as ApiBindings,
      [],
      { closeError: new Error("viewer cleanup interrupted") },
    );

    expect(
      await repairStaleSessionArchiveCleanups(bindings, {
        limit: 1,
        staleUpdatedAtLte: 2,
      }),
    ).toBe(1);
    const firstAttempt = await database
      .prepare("SELECT updated_at FROM session WHERE id = ?")
      .bind(PUBLIC_API_TEST_IDS.nonOwnerSession)
      .first<{ updated_at: number }>();
    expect(firstAttempt?.updated_at).toBeGreaterThan(2);
    expect(
      await database
        .prepare("SELECT updated_at FROM session WHERE id = ?")
        .bind(PUBLIC_API_TEST_IDS.ownerSession)
        .first(),
    ).toEqual({ updated_at: 2 });

    expect(
      await repairStaleSessionArchiveCleanups(bindings, {
        limit: 1,
        staleUpdatedAtLte: 2,
      }),
    ).toBe(1);
    const secondAttempt = await database
      .prepare("SELECT updated_at FROM session WHERE id = ?")
      .bind(PUBLIC_API_TEST_IDS.ownerSession)
      .first<{ updated_at: number }>();
    expect(secondAttempt?.updated_at).toBeGreaterThan(2);
  });

  test("delete cascade removes live and terminal driver instances associated with the session", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(database);
    await insertSandboxSession(database);
    await insertSessionRun(database, {
      runId: PUBLIC_API_TEST_IDS.runAlt,
      status: "completed",
    });
    await insertSessionRun(database, { runId: PUBLIC_API_TEST_IDS.run });
    await insertDriverInstance(database, {
      driverId: PUBLIC_API_TEST_IDS.driverNonOwner,
      sandboxSessionId: PUBLIC_API_TEST_IDS.nonOwnerSession,
      sessionRunId: PUBLIC_API_TEST_IDS.run,
      status: "ready",
      tokenByte: 1,
    });
    await insertDriverInstance(database, {
      driverId: PUBLIC_API_TEST_IDS.driverOwner,
      sandboxSessionId: PUBLIC_API_TEST_IDS.nonOwnerSession,
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

    const outcomes = await deleteSessionCascade(bindings, PUBLIC_API_TEST_IDS.nonOwnerSession);

    const remainingDrivers = await database
      .prepare(
        `
          SELECT id
          FROM driver_instance
          WHERE id IN (?, ?, ?)
          ORDER BY id
        `,
      )
      .bind(PUBLIC_API_TEST_IDS.driverNonOwner, PUBLIC_API_TEST_IDS.driverOwner, FAILED_DRIVER_ID)
      .all<{ id: string }>();
    const session = await database
      .prepare("SELECT id FROM session WHERE id = ?")
      .bind(PUBLIC_API_TEST_IDS.nonOwnerSession)
      .first();

    expect(remainingDrivers.results).toEqual([]);
    expect(session).toBeNull();
    expect(driverRequests.length).toBeGreaterThan(0);
    expect(outcomes.every((outcome) => outcome.status === "completed")).toBe(true);
  });

  test("delete cascade completes when the session has no runtime state", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(database);
    const bindings = withSessionLifecycleBinding(
      createPublicHttpTestBindings(database) as ApiBindings,
    );

    const outcomes = await deleteSessionCascade(bindings, PUBLIC_API_TEST_IDS.nonOwnerSession);
    const session = await database
      .prepare("SELECT id FROM session WHERE id = ?")
      .bind(PUBLIC_API_TEST_IDS.nonOwnerSession)
      .first();

    expect(session).toBeNull();
    expect(outcomes.every((outcome) => outcome.status !== "failed")).toBe(true);
  });

  test("delete cleanup keeps a durable anchor and repair resumes after interruption", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(database);
    const operationId = PUBLIC_API_TEST_IDS.operation as RuntimeOperationId;
    const failingBindings = withSessionLifecycleBinding(
      createPublicHttpTestBindings(database) as ApiBindings,
      [],
      { destroyError: new Error("session destroy interrupted") },
    );

    await expect(
      deleteSessionCascade(failingBindings, PUBLIC_API_TEST_IDS.nonOwnerSession, {
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
      .bind(PUBLIC_API_TEST_IDS.nonOwnerSession)
      .first<{
        archived_at: number | null;
        status: string;
        status_operation_id: string | null;
      }>();

    expect(anchoredSession?.archived_at).toBeNumber();
    expect(anchoredSession).toMatchObject({
      status: "IDLE",
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
      .bind(PUBLIC_API_TEST_IDS.nonOwnerSession)
      .first();

    expect(repairedCount).toBe(1);
    expect(session).toBeNull();
  });

  test("retains failed session R2 cleanup for repair instead of dropping its file record", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(database);
    await insertSessionFileForCleanup(database);
    const bucket = new RetriableSessionFileBucket();
    const bindings = withSessionLifecycleBinding(
      createPublicHttpTestBindings(database, {
        fileBucket: bucket as R2Bucket,
      }) as ApiBindings,
    );

    await expect(
      deleteSessionCascade(bindings, PUBLIC_API_TEST_IDS.nonOwnerSession, {
        operationId: PUBLIC_API_TEST_IDS.operation as RuntimeOperationId,
      }),
    ).rejects.toThrow("R2 delete interrupted.");

    const anchoredSession = await database
      .prepare("SELECT status FROM session WHERE id = ?")
      .bind(PUBLIC_API_TEST_IDS.nonOwnerSession)
      .first<{ status: string }>();
    const retainedFile = await database
      .prepare("SELECT status FROM file_record WHERE id = ?")
      .bind(SESSION_FILE_ID)
      .first<{ status: string }>();

    expect(bucket.deletedKeys).toEqual([`session-files/${SESSION_FILE_ID}/notes.txt`]);
    expect(anchoredSession).toEqual({ status: "IDLE" });
    expect(retainedFile).toEqual({ status: "deleting" });

    bucket.failDelete = false;
    const repairedCount = await repairStaleSessionDeleteCleanups(bindings, {
      limit: 10,
      staleUpdatedAtLte: Date.now(),
    });
    const session = await database
      .prepare("SELECT id FROM session WHERE id = ?")
      .bind(PUBLIC_API_TEST_IDS.nonOwnerSession)
      .first();
    const file = await database
      .prepare("SELECT id FROM file_record WHERE id = ?")
      .bind(SESSION_FILE_ID)
      .first();

    expect(repairedCount).toBe(1);
    expect(bucket.deletedKeys).toEqual([
      `session-files/${SESSION_FILE_ID}/notes.txt`,
      `session-files/${SESSION_FILE_ID}/notes.txt`,
    ]);
    expect(session).toBeNull();
    expect(file).toBeNull();
  });

  test("archive cancels active runs and exposes an idle archived session", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertOwnerSession(database);
    await insertSandboxSession(database, PUBLIC_API_TEST_IDS.ownerSession);
    await insertSessionRun(database, {
      createdByAccountId: PUBLIC_API_TEST_IDS.ownerAccount,
      runId: PUBLIC_API_TEST_IDS.run,
      sessionId: PUBLIC_API_TEST_IDS.ownerSession,
    });
    const bindings = withSessionLifecycleBinding(
      createPublicHttpTestBindings(database) as ApiBindings,
    );

    const outcomes = await archiveAgentSession({
      bindings,
      projectId: PUBLIC_API_TEST_IDS.project,
      sessionId: PUBLIC_API_TEST_IDS.ownerSession,
      viewer: OWNER_VIEWER,
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
      .bind(PUBLIC_API_TEST_IDS.ownerSession)
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

  test("maintenance resumes an admitted archive after external cleanup fails", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertOwnerSession(database);
    const baseBindings = createPublicHttpTestBindings(database) as ApiBindings;
    const failingBindings = withSessionLifecycleBinding(baseBindings, [], {
      closeError: new Error("viewer cleanup interrupted"),
    });

    await expect(
      archiveAgentSession({
        bindings: failingBindings,
        projectId: PUBLIC_API_TEST_IDS.project,
        sessionId: PUBLIC_API_TEST_IDS.ownerSession,
        viewer: OWNER_VIEWER,
      }),
    ).rejects.toThrow("viewer cleanup interrupted");

    const admitted = await database
      .prepare(
        "SELECT archived_at, cleanup_operation_kind, status, status_operation_id FROM session WHERE id = ?",
      )
      .bind(PUBLIC_API_TEST_IDS.ownerSession)
      .first<{
        archived_at: number | null;
        cleanup_operation_kind: string | null;
        status: string;
        status_operation_id: string | null;
      }>();
    expect(admitted?.archived_at).toBeNumber();
    expect(admitted).toMatchObject({
      cleanup_operation_kind: "archive",
      status: "RESCHEDULING",
    });
    expect(admitted?.status_operation_id).toBeString();

    const repaired = await repairStaleSessionArchiveCleanups(
      withSessionLifecycleBinding(baseBindings),
      { limit: 10, staleUpdatedAtLte: Date.now() },
    );
    const archived = await database
      .prepare(
        "SELECT archived_at, cleanup_operation_kind, status, status_operation_id FROM session WHERE id = ?",
      )
      .bind(PUBLIC_API_TEST_IDS.ownerSession)
      .first<{
        archived_at: number | null;
        cleanup_operation_kind: string | null;
        status: string;
        status_operation_id: string | null;
      }>();

    expect(repaired).toBe(1);
    expect(archived?.archived_at).toBeNumber();
    expect(archived).toMatchObject({
      cleanup_operation_kind: "archive",
      status: "IDLE",
      status_operation_id: null,
    });
  });

  for (const cleanupOperationKind of ["archive", "delete"] as const) {
    test(`${cleanupOperationKind} ownership rejects duplicate and advancing active Run projections`, async () => {
      for (const initialRunStatus of ["booting", "queued"] as const) {
        const database = await createPublicHttpContractDatabase();
        await insertOwnerSession(database);
        await insertSessionRun(database, {
          createdByAccountId: PUBLIC_API_TEST_IDS.ownerAccount,
          runId: PUBLIC_API_TEST_IDS.run,
          sessionId: PUBLIC_API_TEST_IDS.ownerSession,
          status: initialRunStatus,
        });
        const racingDatabase = claimCleanupAfterLifecycleRead(database, cleanupOperationKind);

        const outcome = await setSessionRunStatus(racingDatabase, {
          runId: PUBLIC_API_TEST_IDS.run,
          status: "booting",
        });

        expect(outcome.kind).toBe(initialRunStatus === "booting" ? "duplicate" : "stale");
        expect(await readCleanupOwnedRunProjection(database)).toEqual({
          archived_at: 2,
          cleanup_operation_kind: cleanupOperationKind,
          run_status: initialRunStatus,
          run_status_seq: 0,
          session_status: "RESCHEDULING",
          session_status_operation_id: PUBLIC_API_TEST_IDS.operation,
          session_status_seq: 1,
        });
      }
    });

    test(`${cleanupOperationKind} ownership rejects a duplicate active projection repair`, async () => {
      const database = await createPublicHttpContractDatabase();
      await insertOwnerSession(database);
      await insertSessionRun(database, {
        createdByAccountId: PUBLIC_API_TEST_IDS.ownerAccount,
        runId: PUBLIC_API_TEST_IDS.run,
        sessionId: PUBLIC_API_TEST_IDS.ownerSession,
        status: "booting",
      });
      await claimCleanup(database, cleanupOperationKind);
      const before = await readCleanupOwnedRunProjection(database);

      const outcome = await setSessionRunStatus(database, {
        runId: PUBLIC_API_TEST_IDS.run,
        status: "booting",
      });

      expect(outcome.kind).toBe("repair_needed");
      expect(await readCleanupOwnedRunProjection(database)).toEqual(before);
    });
  }

  test("unarchive refuses to clear an in-progress cleanup fence", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertOwnerSession(database);
    await insertSessionRun(database, {
      createdByAccountId: PUBLIC_API_TEST_IDS.ownerAccount,
      runId: PUBLIC_API_TEST_IDS.run,
      sessionId: PUBLIC_API_TEST_IDS.ownerSession,
    });
    await database
      .prepare(
        `
          UPDATE session
             SET archived_at = ?,
                 cleanup_operation_kind = ?,
                 status = ?,
                 status_operation_id = ?
           WHERE id = ?
        `,
      )
      .bind(
        1,
        "delete",
        "RESCHEDULING",
        PUBLIC_API_TEST_IDS.operation,
        PUBLIC_API_TEST_IDS.ownerSession,
      )
      .run();

    await expect(
      unarchiveAgentSession({
        database,
        projectId: PUBLIC_API_TEST_IDS.project,
        sessionId: PUBLIC_API_TEST_IDS.ownerSession,
        viewer: OWNER_VIEWER,
      }),
    ).rejects.toThrow("cleanup is still in progress");

    const row = await database
      .prepare(
        `
          SELECT session.archived_at,
                 session.cleanup_operation_kind,
                 session.status AS session_status,
                 session.status_operation_id,
                 session_run.status AS run_status
          FROM session
          INNER JOIN session_run ON session_run.id = session.last_run_id
          WHERE session.id = ?
        `,
      )
      .bind(PUBLIC_API_TEST_IDS.ownerSession)
      .first<{
        archived_at: number | null;
        cleanup_operation_kind: string | null;
        run_status: string;
        session_status: string;
        status_operation_id: string | null;
      }>();

    expect(row).toEqual({
      archived_at: 1,
      cleanup_operation_kind: "delete",
      run_status: "running",
      session_status: "RESCHEDULING",
      status_operation_id: PUBLIC_API_TEST_IDS.operation,
    });
  });

  test("unarchive exposes a stable archived Session with no cleanup owner", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertOwnerSession(database);
    await database
      .prepare(
        "UPDATE session SET archived_at = 1, cleanup_operation_kind = 'archive' WHERE id = ?",
      )
      .bind(PUBLIC_API_TEST_IDS.ownerSession)
      .run();

    await unarchiveAgentSession({
      database,
      projectId: PUBLIC_API_TEST_IDS.project,
      sessionId: PUBLIC_API_TEST_IDS.ownerSession,
      viewer: OWNER_VIEWER,
    });

    expect(
      await database
        .prepare("SELECT archived_at FROM session WHERE id = ?")
        .bind(PUBLIC_API_TEST_IDS.ownerSession)
        .first(),
    ).toEqual({ archived_at: null });
  });

  test("lifecycle mutations reject attributed participants who are not session creators", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertOwnerSession(database);
    await database
      .prepare("UPDATE session SET creator_account_id = ?, attributed_user_id = ? WHERE id = ?")
      .bind(
        PUBLIC_API_TEST_IDS.nonOwnerAccount,
        PUBLIC_API_TEST_IDS.ownerAccount,
        PUBLIC_API_TEST_IDS.ownerSession,
      )
      .run();
    const bindings = withSessionLifecycleBinding(
      createPublicHttpTestBindings(database) as ApiBindings,
    );

    await expect(
      archiveAgentSession({
        bindings,
        projectId: PUBLIC_API_TEST_IDS.project,
        sessionId: PUBLIC_API_TEST_IDS.ownerSession,
        viewer: OWNER_VIEWER,
      }),
    ).rejects.toThrow();

    await database
      .prepare("UPDATE session SET archived_at = ? WHERE id = ?")
      .bind(1, PUBLIC_API_TEST_IDS.ownerSession)
      .run();

    await expect(
      unarchiveAgentSession({
        database,
        projectId: PUBLIC_API_TEST_IDS.project,
        sessionId: PUBLIC_API_TEST_IDS.ownerSession,
        viewer: OWNER_VIEWER,
      }),
    ).rejects.toThrow();

    await expect(
      deleteAgentSession({
        bindings,
        projectId: PUBLIC_API_TEST_IDS.project,
        sessionId: PUBLIC_API_TEST_IDS.ownerSession,
        viewer: OWNER_VIEWER,
      }),
    ).rejects.toThrow();
  });
});

async function readCleanupOwnedRunProjection(database: D1Database) {
  return database
    .prepare(
      `SELECT session.archived_at,
              session.cleanup_operation_kind,
              session.status AS session_status,
              session.status_operation_id AS session_status_operation_id,
              session.status_seq AS session_status_seq,
              session_run.status AS run_status,
              session_run.status_seq AS run_status_seq
         FROM session
         JOIN session_run ON session_run.id = session.last_run_id
        WHERE session.id = ?`,
    )
    .bind(PUBLIC_API_TEST_IDS.ownerSession)
    .first();
}

function claimCleanupAfterLifecycleRead(
  database: D1Database,
  cleanupOperationKind: "archive" | "delete",
): D1Database {
  let claimed = false;
  let interceptedLifecycleRead = false;

  async function claim(): Promise<void> {
    if (claimed) {
      return;
    }
    claimed = true;
    await claimCleanup(database, cleanupOperationKind);
  }

  function injectAfterRead(statement: D1PreparedStatement): D1PreparedStatement {
    return new Proxy(statement, {
      get(target, property, receiver) {
        if (property === "bind") {
          return (...values: unknown[]) => injectAfterRead(target.bind(...values));
        }
        if (property === "all" || property === "first" || property === "raw") {
          return async (...args: unknown[]) => {
            const method = Reflect.get(target, property, receiver) as (
              ...values: unknown[]
            ) => unknown;
            const result = await method.apply(target, args);
            await claim();
            return result;
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }

  return new Proxy(database, {
    get(target, property, receiver) {
      if (property === "prepare") {
        return (query: string) => {
          const statement = target.prepare(query);
          if (interceptedLifecycleRead) {
            return statement;
          }
          interceptedLifecycleRead = true;
          return injectAfterRead(statement);
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

async function claimCleanup(
  database: D1Database,
  cleanupOperationKind: "archive" | "delete",
): Promise<void> {
  await database
    .prepare(
      `UPDATE session
          SET archived_at = 2,
              cleanup_operation_kind = ?,
              status = 'RESCHEDULING',
              status_operation_id = ?,
              status_seq = status_seq + 1,
              updated_at = 2
        WHERE id = ?`,
    )
    .bind(cleanupOperationKind, PUBLIC_API_TEST_IDS.operation, PUBLIC_API_TEST_IDS.ownerSession)
    .run();
}
