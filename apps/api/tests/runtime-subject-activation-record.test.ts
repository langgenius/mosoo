import { describe, expect, test } from "bun:test";

import { RuntimeSubjectBackupNotReadyError } from "../src/modules/runtime/infrastructure/runtime-subject-lifecycle/runtime-subject-errors";
import { selectRuntimeSubjectRestoreBackup } from "../src/modules/runtime/infrastructure/runtime-subject-lifecycle/runtime-subject-lifecycle.service";
import { getRuntimeSubjectActivationRecord } from "../src/modules/runtime/infrastructure/runtime-subject-lifecycle/runtime-subject-store";
import { SqliteD1Database } from "./helpers/sqlite-d1";

function createRuntimeSubjectDatabase(): SqliteD1Database {
  const database = new SqliteD1Database();

  database.execute(`
    CREATE TABLE sandbox (
      claim_expires_at integer,
      claim_owner text,
      global_mounts_json text NOT NULL,
      id text PRIMARY KEY NOT NULL,
      kind text NOT NULL,
      last_backup_id text,
      last_error text,
      last_error_code text,
      status text NOT NULL
    );

    CREATE TABLE sandbox_backup (
      dir text NOT NULL,
      id text PRIMARY KEY NOT NULL,
      sandbox_id text NOT NULL,
      status text NOT NULL
    );
  `);

  return database;
}

async function insertRuntimeSubject(
  database: D1Database,
  input: {
    readonly lastBackupId?: string;
    readonly runtimeSubjectId: string;
  },
): Promise<void> {
  await database
    .prepare(
      `
        INSERT INTO sandbox (
          claim_expires_at,
          claim_owner,
          global_mounts_json,
          id,
          kind,
          last_backup_id,
          last_error,
          last_error_code,
          status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .bind(
      null,
      "claim-owner",
      JSON.stringify(["space-1"]),
      input.runtimeSubjectId,
      "pet",
      input.lastBackupId ?? null,
      null,
      null,
      "cold",
    )
    .run();
}

async function insertSandboxBackup(
  database: D1Database,
  input: {
    readonly backupId: string;
    readonly runtimeSubjectId: string;
    readonly status: string;
  },
): Promise<void> {
  await database
    .prepare("INSERT INTO sandbox_backup (dir, id, sandbox_id, status) VALUES (?, ?, ?, ?)")
    .bind("/memory", input.backupId, input.runtimeSubjectId, input.status)
    .run();
}

describe("runtime subject activation record", () => {
  test("loads the ready last backup on the activation snapshot", async () => {
    const database = createRuntimeSubjectDatabase();
    await insertRuntimeSubject(database, {
      lastBackupId: "backup-ready",
      runtimeSubjectId: "01J0000000000000000000000D",
    });
    await insertSandboxBackup(database, {
      backupId: "backup-ready",
      runtimeSubjectId: "01J0000000000000000000000D",
      status: "ready",
    });

    const record = await getRuntimeSubjectActivationRecord(database, "01J0000000000000000000000D");

    expect(record?.lastBackup).toEqual({
      dir: "/memory",
      id: "backup-ready",
      status: "ready",
    });
    expect(record?.lastReadyBackup).toEqual({
      dir: "/memory",
      id: "backup-ready",
    });
    expect(
      selectRuntimeSubjectRestoreBackup({
        kind: "pet",
        record: record ?? null,
        runtimeSubjectId: "01J0000000000000000000000D",
      }),
    ).toEqual({
      dir: "/memory",
      id: "backup-ready",
    });
    expect([...(record?.mountedSpaceIds ?? [])]).toEqual(["space-1"]);
  });

  test("selects no restore backup for a fresh runtime subject", async () => {
    const database = createRuntimeSubjectDatabase();
    await insertRuntimeSubject(database, {
      runtimeSubjectId: "01J0000000000000000000000D",
    });

    const record = await getRuntimeSubjectActivationRecord(database, "01J0000000000000000000000D");

    expect(
      selectRuntimeSubjectRestoreBackup({
        kind: "pet",
        record,
        runtimeSubjectId: "01J0000000000000000000000D",
      }),
    ).toBeNull();
  });

  test("loads non-ready last backups without treating them as ready", async () => {
    const database = createRuntimeSubjectDatabase();
    await insertRuntimeSubject(database, {
      lastBackupId: "backup-pruned",
      runtimeSubjectId: "01J0000000000000000000000D",
    });
    await insertSandboxBackup(database, {
      backupId: "backup-pruned",
      runtimeSubjectId: "01J0000000000000000000000D",
      status: "pruned",
    });

    const record = await getRuntimeSubjectActivationRecord(database, "01J0000000000000000000000D");

    expect(record?.lastBackup).toEqual({
      dir: "/memory",
      id: "backup-pruned",
      status: "pruned",
    });
    expect(record?.lastReadyBackup).toBeNull();
    expect(() =>
      selectRuntimeSubjectRestoreBackup({
        kind: "pet",
        record: record ?? null,
        runtimeSubjectId: "01J0000000000000000000000D",
      }),
    ).toThrow(RuntimeSubjectBackupNotReadyError);
  });
});
