import { describe, expect, test } from "bun:test";

import { selectSandboxBackupPruneIds } from "../src/modules/runtime/infrastructure/sandbox-backup-pruning";
import {
  listReadySandboxBackupsForPruning,
  markSandboxBackupsPruned,
  recordCreatedSandboxBackups,
} from "../src/modules/runtime/infrastructure/sandbox-backup-store";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const BACKUP_ID_1 = "01J000000000000000000000H1";
const BACKUP_ID_2 = "01J000000000000000000000H2";
const BACKUP_ID_3 = "01J000000000000000000000H3";
const BACKUP_ID_4 = "01J000000000000000000000H4";
const BACKUP_ID_5 = "01J000000000000000000000H5";
const KEEP_BACKUP_ID = "01J000000000000000000000HZ";
const MEMORY_NEW_BACKUP_ID = "01J000000000000000000000H6";
const MEMORY_OLD_BACKUP_ID = "01J000000000000000000000H7";
const SESSION_BACKUP_ID = "01J000000000000000000000H8";

function createSandboxBackupDatabase(): SqliteD1Database {
  const database = new SqliteD1Database();

  database.execute(`
    CREATE TABLE sandbox (
      id text PRIMARY KEY NOT NULL,
      last_backup_id text,
      status text NOT NULL,
      status_changed_at integer DEFAULT 0 NOT NULL,
      status_event text DEFAULT 'runtime_subject.cold' NOT NULL,
      status_operation_id text,
      status_seq integer DEFAULT 0 NOT NULL,
      status_source text DEFAULT 'system' NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE TABLE sandbox_backup (
      created_at integer NOT NULL,
      dir text NOT NULL,
      error_message text,
      id text PRIMARY KEY NOT NULL,
      keep integer DEFAULT 0 NOT NULL,
      sandbox_id text NOT NULL,
      status text NOT NULL,
      ttl_seconds integer NOT NULL,
      updated_at integer NOT NULL
    );
  `);

  return database;
}

async function insertSandbox(database: D1Database): Promise<void> {
  await database
    .prepare("INSERT INTO sandbox (id, last_backup_id, status, updated_at) VALUES (?, ?, ?, ?)")
    .bind("01J0000000000000000000000D", null, "backing_up", 1)
    .run();
}

async function insertBackup(
  database: D1Database,
  input: {
    createdAt: number;
    id: string;
    keep?: boolean;
  },
): Promise<void> {
  await database
    .prepare(
      `
        INSERT INTO sandbox_backup (
          created_at,
          dir,
          error_message,
          id,
          keep,
          sandbox_id,
          status,
          ttl_seconds,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .bind(
      input.createdAt,
      "/workspace",
      null,
      input.id,
      input.keep === true ? 1 : 0,
      "01J0000000000000000000000D",
      "ready",
      100,
      input.createdAt,
    )
    .run();
}

describe("sandbox backup pruning", () => {
  test("selects pruned backup ids and marks records", async () => {
    const database = createSandboxBackupDatabase();

    await insertBackup(database, { createdAt: 1, id: BACKUP_ID_1 });
    await insertBackup(database, { createdAt: 2, id: BACKUP_ID_2 });
    await insertBackup(database, { createdAt: 3, id: BACKUP_ID_3 });
    await insertBackup(database, { createdAt: 4, id: BACKUP_ID_4 });
    await insertBackup(database, { createdAt: 5, id: BACKUP_ID_5 });
    await insertBackup(database, { createdAt: 0, id: KEEP_BACKUP_ID, keep: true });

    const backups = await listReadySandboxBackupsForPruning(database, "01J0000000000000000000000D");
    const pruneIds = selectSandboxBackupPruneIds(backups);

    await markSandboxBackupsPruned(database, pruneIds);

    expect(pruneIds).toEqual([BACKUP_ID_2, BACKUP_ID_1]);
    const rows = await database
      .prepare("SELECT id, status FROM sandbox_backup ORDER BY id")
      .all<{ id: string; status: string }>();
    expect(rows.results).toEqual([
      { id: BACKUP_ID_1, status: "pruned" },
      { id: BACKUP_ID_2, status: "pruned" },
      { id: BACKUP_ID_3, status: "ready" },
      { id: BACKUP_ID_4, status: "ready" },
      { id: BACKUP_ID_5, status: "ready" },
      { id: KEEP_BACKUP_ID, status: "ready" },
    ]);
  });

  test("records checkpoint backup batch and stores latest subject checkpoint", async () => {
    const database = createSandboxBackupDatabase();
    await insertSandbox(database);

    await recordCreatedSandboxBackups(database, {
      backups: [
        {
          backup: { dir: "/workspace/one", id: SESSION_BACKUP_ID },
          updateSandboxLastBackup: false,
        },
        {
          backup: { dir: "/memory", id: MEMORY_OLD_BACKUP_ID },
          updateSandboxLastBackup: true,
        },
        {
          backup: { dir: "/memory", id: MEMORY_NEW_BACKUP_ID },
          updateSandboxLastBackup: true,
        },
      ],
      sandboxId: "01J0000000000000000000000D",
      ttlSeconds: 100,
    });

    const backupRows = await database
      .prepare("SELECT id, dir, status, ttl_seconds FROM sandbox_backup ORDER BY id")
      .all<{ dir: string; id: string; status: string; ttl_seconds: number }>();
    expect(backupRows.results).toEqual([
      {
        dir: "/memory",
        id: MEMORY_NEW_BACKUP_ID,
        status: "ready",
        ttl_seconds: 100,
      },
      {
        dir: "/memory",
        id: MEMORY_OLD_BACKUP_ID,
        status: "ready",
        ttl_seconds: 100,
      },
      {
        dir: "/workspace/one",
        id: SESSION_BACKUP_ID,
        status: "ready",
        ttl_seconds: 100,
      },
    ]);

    const sandbox = await database
      .prepare("SELECT last_backup_id, status, status_seq FROM sandbox WHERE id = ?")
      .bind("01J0000000000000000000000D")
      .first<{ last_backup_id: string; status: string; status_seq: number }>();
    expect(sandbox).toEqual({
      last_backup_id: MEMORY_NEW_BACKUP_ID,
      status: "backing_up",
      status_seq: 0,
    });
  });
});
