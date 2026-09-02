import { describe, expect, test } from "bun:test";

import {
  claimIdleSessionScopedConversationForClose,
  listIdleSessionScopedConversationSessions,
} from "../src/modules/runtime/infrastructure/runtime-subject-lifecycle/runtime-conversation-session-store";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const NOW = 1_000_000;
const GRACE_MS = 90_000;

function createDatabase(): SqliteD1Database {
  const database = new SqliteD1Database();

  database.execute(`
    CREATE TABLE sandbox_session (
      cloudflare_session_id text NOT NULL,
      cleanup_operation_id text,
      created_at integer NOT NULL,
      cwd text NOT NULL,
      origin_json text NOT NULL,
      sandbox_id text NOT NULL,
      sandbox_incarnation integer DEFAULT 0 NOT NULL,
      session_id text PRIMARY KEY NOT NULL,
      status text NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE TABLE sandbox (
      id text PRIMARY KEY NOT NULL,
      kind text NOT NULL
    );

    CREATE TABLE driver_instance (
      id text PRIMARY KEY NOT NULL,
      sandbox_id text NOT NULL
    );

    CREATE TABLE session_run (
      id text PRIMARY KEY NOT NULL,
      driver_instance_id text,
      session_id text NOT NULL,
      status text NOT NULL
    );

    CREATE TABLE session (
      id text PRIMARY KEY NOT NULL,
      kind text NOT NULL,
      last_run_id text,
      runtime_provisioning_operation_id text,
      workspace_checkpoint_required integer DEFAULT 0 NOT NULL
    );

    CREATE TABLE sandbox_backup (
      dir text NOT NULL,
      id text PRIMARY KEY NOT NULL,
      sandbox_id text NOT NULL,
      sandbox_incarnation integer NOT NULL,
      session_run_id text,
      status text NOT NULL,
      workspace_session_id text
    );
  `);

  return database;
}

async function insertConversation(
  database: D1Database,
  input: {
    readonly kind: string;
    readonly sandboxId: string;
    readonly sessionId: string;
    readonly status: string;
    readonly updatedAt: number;
  },
): Promise<void> {
  await database
    .prepare(
      `INSERT INTO sandbox (id, kind) VALUES (?, ?)
        ON CONFLICT (id) DO NOTHING`,
    )
    .bind(input.sandboxId, input.kind)
    .run();
  await database
    .prepare(
      `INSERT INTO session (id, kind, last_run_id) VALUES (?, ?, NULL)
        ON CONFLICT (id) DO NOTHING`,
    )
    .bind(input.sessionId, input.kind)
    .run();
  await database
    .prepare(
      `INSERT INTO sandbox_session (
        cloudflare_session_id, created_at, cwd, origin_json, sandbox_id, sandbox_incarnation,
        session_id, status, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      `cf-${input.sessionId}`,
      1,
      "cwd",
      "{}",
      input.sandboxId,
      1,
      input.sessionId,
      input.status,
      input.updatedAt,
    )
    .run();
}

async function insertActiveRunLease(
  database: D1Database,
  input: { readonly runId: string; readonly sandboxId: string; readonly sessionId: string },
): Promise<void> {
  await database
    .prepare("INSERT INTO driver_instance (id, sandbox_id) VALUES (?, ?)")
    .bind(`driver-${input.runId}`, input.sandboxId)
    .run();
  await database
    .prepare(
      "INSERT INTO session_run (id, driver_instance_id, session_id, status) VALUES (?, ?, ?, ?)",
    )
    .bind(input.runId, `driver-${input.runId}`, input.sessionId, "running")
    .run();
}

describe("idle session-scoped conversation sweep", () => {
  test("keeps a completed cattle turn alive until its workspace checkpoint is ready", async () => {
    const database = createDatabase();
    await insertConversation(database, {
      kind: "cattle",
      sandboxId: "sb-checkpoint",
      sessionId: "session-checkpoint",
      status: "active",
      updatedAt: NOW - GRACE_MS - 1,
    });
    await database
      .prepare(
        "INSERT INTO session_run (id, driver_instance_id, session_id, status) VALUES (?, NULL, ?, ?)",
      )
      .bind("run-checkpoint", "session-checkpoint", "completed")
      .run();
    await database
      .prepare("UPDATE session SET last_run_id = ?, workspace_checkpoint_required = 1 WHERE id = ?")
      .bind("run-checkpoint", "session-checkpoint")
      .run();

    await expect(
      listIdleSessionScopedConversationSessions(database, {
        idleSinceLte: NOW - GRACE_MS,
        limit: 10,
      }),
    ).resolves.toEqual([]);
    await expect(
      claimIdleSessionScopedConversationForClose(database, {
        idleSinceLte: NOW - GRACE_MS,
        now: NOW,
        runtimeSubjectId: "sb-checkpoint" as never,
        sandboxIncarnation: 1,
        sandboxSessionId: "cf-session-checkpoint" as never,
        sessionId: "session-checkpoint" as never,
      }),
    ).resolves.toBeNull();

    await database
      .prepare(
        `INSERT INTO sandbox_backup (
          dir, id, sandbox_id, sandbox_incarnation, session_run_id, status, workspace_session_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        "cwd",
        "backup-checkpoint",
        "sb-checkpoint",
        1,
        "run-checkpoint",
        "ready",
        "session-checkpoint",
      )
      .run();

    await expect(
      listIdleSessionScopedConversationSessions(database, {
        idleSinceLte: NOW - GRACE_MS,
        limit: 10,
      }),
    ).resolves.toEqual([{ sandboxId: "sb-checkpoint", sessionId: "session-checkpoint" }]);
  });

  test("lets the idle sweep recycle a pre-rollout cattle conversation", async () => {
    const database = createDatabase();
    await insertConversation(database, {
      kind: "cattle",
      sandboxId: "sb-legacy",
      sessionId: "session-legacy",
      status: "active",
      updatedAt: NOW - GRACE_MS - 1,
    });
    await database
      .prepare(
        "INSERT INTO session_run (id, driver_instance_id, session_id, status) VALUES (?, NULL, ?, ?)",
      )
      .bind("run-legacy", "session-legacy", "completed")
      .run();
    await database
      .prepare("UPDATE session SET last_run_id = ? WHERE id = ?")
      .bind("run-legacy", "session-legacy")
      .run();

    await expect(
      listIdleSessionScopedConversationSessions(database, {
        idleSinceLte: NOW - GRACE_MS,
        limit: 10,
      }),
    ).resolves.toEqual([{ sandboxId: "sb-legacy", sessionId: "session-legacy" }]);
    await expect(
      claimIdleSessionScopedConversationForClose(database, {
        idleSinceLte: NOW - GRACE_MS,
        now: NOW,
        runtimeSubjectId: "sb-legacy" as never,
        sandboxIncarnation: 1,
        sandboxSessionId: "cf-session-legacy" as never,
        sessionId: "session-legacy" as never,
      }),
    ).resolves.not.toBeNull();
  });

  test("lists only idle active cattle conversations without a run lease", async () => {
    const database = createDatabase();
    await insertConversation(database, {
      kind: "cattle",
      sandboxId: "sb-idle",
      sessionId: "session-idle",
      status: "active",
      updatedAt: NOW - GRACE_MS - 1,
    });
    await insertConversation(database, {
      kind: "cattle",
      sandboxId: "sb-fresh",
      sessionId: "session-fresh",
      status: "active",
      updatedAt: NOW - 1_000,
    });
    await insertConversation(database, {
      kind: "pet",
      sandboxId: "sb-pet",
      sessionId: "session-pet",
      status: "active",
      updatedAt: NOW - GRACE_MS - 1,
    });
    await insertConversation(database, {
      kind: "cattle",
      sandboxId: "sb-closed",
      sessionId: "session-closed",
      status: "closed",
      updatedAt: NOW - GRACE_MS - 1,
    });
    await insertConversation(database, {
      kind: "cattle",
      sandboxId: "sb-busy",
      sessionId: "session-busy",
      status: "active",
      updatedAt: NOW - GRACE_MS - 1,
    });
    await insertActiveRunLease(database, {
      runId: "run-busy",
      sandboxId: "sb-busy",
      sessionId: "session-busy",
    });

    const idle = await listIdleSessionScopedConversationSessions(database, {
      idleSinceLte: NOW - GRACE_MS,
      limit: 10,
    });

    expect(idle).toEqual([{ sandboxId: "sb-idle", sessionId: "session-idle" }]);
  });

  test("atomic claim schedules an idle conversation cleanup but loses to any re-activation", async () => {
    const database = createDatabase();
    const idleSinceLte = NOW - GRACE_MS;
    const claim = (sandboxId: string, sessionId: string, sandboxSessionId: string) =>
      claimIdleSessionScopedConversationForClose(database, {
        idleSinceLte,
        now: NOW,
        runtimeSubjectId: sandboxId as never,
        sandboxIncarnation: 1,
        sandboxSessionId: sandboxSessionId as never,
        sessionId: sessionId as never,
      });
    const statusOf = async (sessionId: string) =>
      (
        await database
          .prepare("SELECT status FROM sandbox_session WHERE session_id = ?")
          .bind(sessionId)
          .first<{ status: string }>()
      )?.status;

    // (1) still-idle, same session instance, no lease → claim wins.
    await insertConversation(database, {
      kind: "cattle",
      sandboxId: "sb-a",
      sessionId: "sess-a",
      status: "active",
      updatedAt: NOW - GRACE_MS - 1,
    });
    expect(await claim("sb-a", "sess-a", "cf-sess-a")).not.toBeNull();
    expect(await statusOf("sess-a")).toBe("cleanup_pending");

    // (2) a follow-up refreshed updated_at past the grace → claim loses, untouched.
    await insertConversation(database, {
      kind: "cattle",
      sandboxId: "sb-b",
      sessionId: "sess-b",
      status: "active",
      updatedAt: NOW, // refreshed by ensureSandboxConversationSession
    });
    expect(await claim("sb-b", "sess-b", "cf-sess-b")).toBeNull();
    expect(await statusOf("sess-b")).toBe("active");

    // (3) the session was rebuilt (new cloudflare_session_id) → claim loses.
    await insertConversation(database, {
      kind: "cattle",
      sandboxId: "sb-c",
      sessionId: "sess-c",
      status: "active",
      updatedAt: NOW - GRACE_MS - 1,
    });
    expect(await claim("sb-c", "sess-c", "cf-STALE")).toBeNull();
    expect(await statusOf("sess-c")).toBe("active");

    // (4) an active run lease appeared → claim loses.
    await insertConversation(database, {
      kind: "cattle",
      sandboxId: "sb-d",
      sessionId: "sess-d",
      status: "active",
      updatedAt: NOW - GRACE_MS - 1,
    });
    await insertActiveRunLease(database, {
      runId: "run-d",
      sandboxId: "sb-d",
      sessionId: "sess-d",
    });
    expect(await claim("sb-d", "sess-d", "cf-sess-d")).toBeNull();
    expect(await statusOf("sess-d")).toBe("active");
  });
});
