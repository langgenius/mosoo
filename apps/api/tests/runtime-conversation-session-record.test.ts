import { describe, expect, test } from "bun:test";

import { getRuntimeConversationSession } from "../src/modules/runtime/infrastructure/runtime-subject-lifecycle/runtime-subject-store";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const SESSION_CWD = "session-cwd";
const OTHER_CWD = "other-cwd";

function createConversationSessionDatabase(): SqliteD1Database {
  const database = new SqliteD1Database();

  database.execute(`
    CREATE TABLE sandbox_session (
      cloudflare_session_id text NOT NULL,
      cwd text NOT NULL,
      origin_json text NOT NULL,
      sandbox_id text NOT NULL,
      session_id text PRIMARY KEY NOT NULL,
      status text NOT NULL
    );

    CREATE TABLE sandbox_backup (
      created_at integer NOT NULL,
      dir text NOT NULL,
      id text PRIMARY KEY NOT NULL,
      sandbox_id text NOT NULL,
      status text NOT NULL
    );
  `);

  return database;
}

async function insertConversationSession(database: D1Database): Promise<void> {
  await database
    .prepare(
      `
        INSERT INTO sandbox_session (
          cloudflare_session_id,
          cwd,
          origin_json,
          sandbox_id,
          session_id,
          status
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `,
    )
    .bind(
      "01J00000000000000000000001",
      SESSION_CWD,
      JSON.stringify({ type: "runtime" }),
      "01J0000000000000000000000D",
      "session-1",
      "closed",
    )
    .run();
}

async function insertBackup(
  database: D1Database,
  input: {
    readonly createdAt: number;
    readonly dir: string;
    readonly id: string;
    readonly status: string;
  },
): Promise<void> {
  await database
    .prepare(
      "INSERT INTO sandbox_backup (created_at, dir, id, sandbox_id, status) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(input.createdAt, input.dir, input.id, "01J0000000000000000000000D", input.status)
    .run();
}

describe("runtime conversation session record", () => {
  test("loads the latest ready cwd backup with the session snapshot", async () => {
    const database = createConversationSessionDatabase();
    await insertConversationSession(database);
    await insertBackup(database, {
      createdAt: 1,
      dir: SESSION_CWD,
      id: "backup-old",
      status: "ready",
    });
    await insertBackup(database, {
      createdAt: 2,
      dir: SESSION_CWD,
      id: "backup-new",
      status: "ready",
    });
    await insertBackup(database, {
      createdAt: 3,
      dir: SESSION_CWD,
      id: "backup-pruned",
      status: "pruned",
    });
    await insertBackup(database, {
      createdAt: 4,
      dir: OTHER_CWD,
      id: "backup-other",
      status: "ready",
    });

    const record = await getRuntimeConversationSession(database, "session-1");

    expect(record?.cwd).toBe(SESSION_CWD);
    expect(record?.latestReadyBackup).toEqual({
      dir: SESSION_CWD,
      id: "backup-new",
    });
  });

  test("returns null backup when the cwd has no ready backup", async () => {
    const database = createConversationSessionDatabase();
    await insertConversationSession(database);
    await insertBackup(database, {
      createdAt: 1,
      dir: SESSION_CWD,
      id: "backup-pruned",
      status: "pruned",
    });

    const record = await getRuntimeConversationSession(database, "session-1");

    expect(record?.latestReadyBackup).toBeNull();
  });
});
