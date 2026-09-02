import { describe, expect, test } from "bun:test";

import { createPlatformId } from "@mosoo/id";
import type { RuntimeOperationId, SandboxBackupId } from "@mosoo/id";

import { selectSandboxBackupPruneIds } from "../src/modules/runtime/infrastructure/sandbox-backup-pruning";
import {
  listReadySandboxBackupsForPruning,
  markSandboxBackupsPruned,
} from "../src/modules/runtime/infrastructure/sandbox-backup-store";
import { applyDrizzleMigrationsThrough } from "./helpers/drizzle-migrations";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const SANDBOX_ID = "01J0000000000000000000000D";
const BACKUP_IDS = [..."12345Z"].map((suffix) => `01J000000000000000000000H${suffix}`);

function createDatabase(): SqliteD1Database {
  const database = new SqliteD1Database();
  applyDrizzleMigrationsThrough(database, "0021_sandbox-backup-object-authority");
  return database;
}

async function insertActiveSandbox(database: D1Database): Promise<void> {
  await database
    .prepare(
      `INSERT INTO sandbox (
         agent_id, project_id, created_at, id, incarnation, kind, network_constraints_hash,
         owner_account_id, status, subject_id, subject_kind, updated_at
       ) VALUES (?, ?, 1, ?, 1, 'pet', ?, ?, 'active', ?, 'agent', 1)`,
    )
    .bind(
      "01J0000000000000000000000E",
      "01J0000000000000000000000F",
      SANDBOX_ID,
      "0".repeat(64),
      "01J0000000000000000000000G",
      "01J0000000000000000000000E",
    )
    .run();
}

async function insertWorkspaceSession(database: D1Database, sessionId: string): Promise<void> {
  await database
    .prepare(
      `INSERT INTO session (
         agent_id, project_id, created_at, creator_account_id, id, kind, model,
         provider, renamed, runtime_id, status, updated_at
       ) VALUES (?, ?, 1, ?, ?, 'pet', 'gpt-5.4', 'openai', 0, 'openai-runtime', 'IDLE', 1)`,
    )
    .bind(
      "01J0000000000000000000000E",
      "01J0000000000000000000000F",
      "01J0000000000000000000000G",
      sessionId,
    )
    .run();
}

async function insertBackup(
  database: D1Database,
  input: { createdAt: number; id: string; keep?: boolean; workspaceSessionId?: string },
): Promise<void> {
  await database
    .prepare(
      `INSERT INTO sandbox_backup (
        created_at, dir, id, keep, operation_id, sandbox_id, sandbox_incarnation,
        session_run_id, staging_id, status, ttl_seconds, updated_at, workspace_session_id
      ) VALUES (?, '/workspace', ?, ?, ?, ?, 1, NULL, ?, 'ready', 100, ?, ?)`,
    )
    .bind(
      input.createdAt,
      input.id,
      input.keep === true ? 1 : 0,
      createPlatformId<RuntimeOperationId>(),
      SANDBOX_ID,
      createPlatformId<SandboxBackupId>(),
      input.createdAt,
      input.workspaceSessionId ?? null,
    )
    .run();
}

describe("sandbox backup pruning", () => {
  test("marks only stable overflow after D1 protection is rechecked", async () => {
    const database = createDatabase();
    await insertActiveSandbox(database);
    for (const [index, id] of BACKUP_IDS.entries()) {
      await insertBackup(database, {
        createdAt: index + 1,
        id,
        keep: index === BACKUP_IDS.length - 1,
      });
    }
    await database
      .prepare("UPDATE sandbox SET last_backup_id = ? WHERE id = ?")
      .bind(BACKUP_IDS[0], SANDBOX_ID)
      .run();

    const backups = await listReadySandboxBackupsForPruning(database, SANDBOX_ID);
    const candidates = selectSandboxBackupPruneIds(backups);
    const pruned = await markSandboxBackupsPruned(database, candidates);

    expect(candidates).toEqual([BACKUP_IDS[1]]);
    expect(pruned).toEqual([BACKUP_IDS[1]]);
    const rows = await database
      .prepare("SELECT id, status FROM sandbox_backup ORDER BY created_at")
      .all<{ id: string; status: string }>();
    expect(rows.results.map((row) => row.status)).toEqual([
      "ready",
      "pruned",
      "ready",
      "ready",
      "ready",
      "ready",
    ]);
  });

  for (const protection of ["last_backup", "restoring", "provisioning"] as const) {
    test(`rechecks ${protection} protection after pruning candidates were listed`, async () => {
      const database = createDatabase();
      const sessionId = "01J0000000000000000000000S";
      await insertActiveSandbox(database);
      if (protection === "provisioning") {
        await insertWorkspaceSession(database, sessionId);
      }
      for (const [index, id] of BACKUP_IDS.slice(0, 5).entries()) {
        await insertBackup(database, {
          createdAt: index + 1,
          id,
          workspaceSessionId: protection === "provisioning" && index === 1 ? sessionId : undefined,
        });
      }

      const listed = await listReadySandboxBackupsForPruning(database, SANDBOX_ID);
      const candidates = selectSandboxBackupPruneIds(listed);
      expect(candidates).toEqual([BACKUP_IDS[1], BACKUP_IDS[0]]);
      const protectedId = candidates[0];
      switch (protection) {
        case "last_backup": {
          await database
            .prepare("UPDATE sandbox SET last_backup_id = ? WHERE id = ?")
            .bind(protectedId, SANDBOX_ID)
            .run();
          break;
        }
        case "restoring": {
          await database
            .prepare(
              `UPDATE sandbox
               SET claim_expires_at = ?, claim_owner = 'restore-owner',
                   last_restore_backup_id = ?, operation_kind = 'activate',
                   status = 'restoring', status_operation_id = ?
               WHERE id = ?`,
            )
            .bind(Date.now() + 60_000, protectedId, "01J0000000000000000000000A", SANDBOX_ID)
            .run();
          break;
        }
        case "provisioning": {
          await database
            .prepare(
              `UPDATE session
               SET runtime_provisioning_heartbeat_at = 1,
                   runtime_provisioning_operation_id = ?,
                   runtime_provisioning_sandbox_id = ?
               WHERE id = ?`,
            )
            .bind("01J0000000000000000000000A", SANDBOX_ID, sessionId)
            .run();
          break;
        }
      }

      expect(await markSandboxBackupsPruned(database, candidates)).toEqual([candidates[1]]);
      await expect(
        database
          .prepare("SELECT status FROM sandbox_backup WHERE id = ?")
          .bind(protectedId)
          .first(),
      ).resolves.toEqual({ status: "ready" });
    });
  }
});
