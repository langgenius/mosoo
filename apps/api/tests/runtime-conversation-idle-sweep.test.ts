import { describe, expect, test } from "bun:test";

import { listIdleSessionScopedConversationSessions } from "../src/modules/runtime/infrastructure/runtime-subject-lifecycle/runtime-conversation-session-store";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const NOW = 1_000_000;
const GRACE_MS = 90_000;

function createDatabase(): SqliteD1Database {
  const database = new SqliteD1Database();

  database.execute(`
    CREATE TABLE sandbox_session (
      cloudflare_session_id text NOT NULL,
      created_at integer NOT NULL,
      cwd text NOT NULL,
      origin_json text NOT NULL,
      sandbox_id text NOT NULL,
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
      status text NOT NULL
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
      `INSERT INTO sandbox_session (
        cloudflare_session_id, created_at, cwd, origin_json, sandbox_id, session_id, status, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      `cf-${input.sessionId}`,
      1,
      "cwd",
      "{}",
      input.sandboxId,
      input.sessionId,
      input.status,
      input.updatedAt,
    )
    .run();
}

async function insertActiveRunLease(
  database: D1Database,
  input: { readonly runId: string; readonly sandboxId: string },
): Promise<void> {
  await database
    .prepare("INSERT INTO driver_instance (id, sandbox_id) VALUES (?, ?)")
    .bind(`driver-${input.runId}`, input.sandboxId)
    .run();
  await database
    .prepare("INSERT INTO session_run (id, driver_instance_id, status) VALUES (?, ?, ?)")
    .bind(input.runId, `driver-${input.runId}`, "running")
    .run();
}

describe("idle session-scoped conversation sweep", () => {
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
    await insertActiveRunLease(database, { runId: "run-busy", sandboxId: "sb-busy" });

    const idle = await listIdleSessionScopedConversationSessions(database, {
      idleSinceLte: NOW - GRACE_MS,
      limit: 10,
    });

    expect(idle).toEqual([{ sandboxId: "sb-idle", sessionId: "session-idle" }]);
  });
});
