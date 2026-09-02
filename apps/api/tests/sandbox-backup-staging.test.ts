import { expect, test } from "bun:test";

import { createPlatformId, parsePlatformId } from "@mosoo/id";
import type { RuntimeOperationId, SandboxBackupId, SandboxId, SessionId } from "@mosoo/id";

import {
  deferSandboxBackupStageRepair,
  listSandboxBackupStages,
  listSandboxSessionBackupCandidates,
  revokeSandboxBackupsForSessionDelete,
  stageSandboxBackupWrites,
} from "../src/modules/runtime/infrastructure/sandbox-backup-store";
import { applyDrizzleMigrationsThrough } from "./helpers/drizzle-migrations";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const SANDBOX_ID = parsePlatformId<SandboxId>("01J0000000000000000000000D");
const SESSION_ID = parsePlatformId<SessionId>("01J0000000000000000000000S");
const NEXT_SESSION_ID = parsePlatformId<SessionId>("01J0000000000000000000000T");
const OPERATION_ID = parsePlatformId<RuntimeOperationId>("01J0000000000000000000000A");

function createDatabase(): SqliteD1Database {
  const database = new SqliteD1Database();
  applyDrizzleMigrationsThrough(database, "0021_sandbox-backup-object-authority");
  return database;
}

async function insertBackingUpSandbox(
  database: D1Database,
  sandboxId: SandboxId = SANDBOX_ID,
): Promise<void> {
  const now = Date.now();
  await database
    .prepare(
      `INSERT INTO sandbox (
         agent_id, project_id, claim_expires_at, claim_owner, created_at, id, incarnation,
         kind, network_constraints_hash, operation_kind, owner_account_id, status, status_operation_id,
         subject_id, subject_kind, updated_at
       ) VALUES (?, ?, ?, 'owner', ?, ?, 1, 'pet', ?, 'hibernate', ?, 'backing_up', ?, ?, 'agent', ?)`,
    )
    .bind(
      sandboxId,
      "01J0000000000000000000000F",
      now + 60_000,
      now,
      sandboxId,
      "0".repeat(64),
      "01J0000000000000000000000G",
      OPERATION_ID,
      sandboxId,
      now,
    )
    .run();
}

async function insertSession(
  database: D1Database,
  input: {
    readonly cleanup?: boolean;
    readonly id: SessionId;
    readonly lastMessageAt: number;
  },
): Promise<void> {
  const now = Date.now();
  await database
    .prepare(
      `INSERT INTO session (
         agent_id, project_id, archived_at, cleanup_operation_kind, created_at,
         creator_account_id, id, kind, last_message_at, model, provider, renamed,
         runtime_id, status, status_operation_id, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pet', ?, 'gpt-5.4', 'openai', 0,
         'openai-runtime', 'IDLE', ?, ?)`,
    )
    .bind(
      "01J0000000000000000000000E",
      "01J0000000000000000000000F",
      input.cleanup === true ? now : null,
      input.cleanup === true ? "delete" : null,
      now,
      "01J0000000000000000000000G",
      input.id,
      input.lastMessageAt,
      input.cleanup === true ? OPERATION_ID : null,
      now,
    )
    .run();
}

async function insertWorkspace(
  database: D1Database,
  input: {
    readonly cwd: string;
    readonly incarnation: number;
    readonly sandboxId?: SandboxId;
    readonly sessionId: SessionId;
    readonly status: "active" | "closed";
  },
): Promise<void> {
  const now = Date.now();
  await database
    .prepare(
      `INSERT INTO sandbox_session (
         cloudflare_session_id, created_at, cwd, origin_json, sandbox_id,
         sandbox_incarnation, session_id, status, updated_at
       ) VALUES (?, ?, ?, '{}', ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.sessionId,
      now,
      input.cwd,
      input.sandboxId ?? SANDBOX_ID,
      input.incarnation,
      input.sessionId,
      input.status,
      now,
    )
    .run();
}

test("workspace staging binds the exact session scope in SQLite", async () => {
  const database = createDatabase();
  await insertBackingUpSandbox(database);
  await insertSession(database, { id: SESSION_ID, lastMessageAt: 1 });
  await insertWorkspace(database, {
    cwd: "/workspace",
    incarnation: 1,
    sessionId: SESSION_ID,
    status: "active",
  });

  const [write] = await stageSandboxBackupWrites(database, {
    admission: {
      kind: "operation",
      lease: {
        claimExpiresAt: Date.now() + 60_000,
        claimOwner: "owner",
        incarnation: 1,
        kind: "hibernate",
        operationId: OPERATION_ID,
        status: "backing_up",
      },
    },
    sandboxId: SANDBOX_ID,
    targets: [
      {
        dir: "/workspace",
        updateSandboxLastBackup: false,
        workspaceSessionId: SESSION_ID,
      },
    ],
    ttlSeconds: 100,
  });

  expect(write?.kind).toBe("staged");
  if (write?.kind === "staged") {
    expect(write.stage.workspaceSessionId).toBe(SESSION_ID);
    expect(write.stage.sandboxIncarnation).toBe(1);
  }
});

test("session cleanup fences new workspace staging", async () => {
  const database = createDatabase();
  await insertBackingUpSandbox(database);
  await insertSession(database, { cleanup: true, id: SESSION_ID, lastMessageAt: 1 });
  await insertWorkspace(database, {
    cwd: "/workspace",
    incarnation: 1,
    sessionId: SESSION_ID,
    status: "active",
  });

  await expect(
    stageSandboxBackupWrites(database, {
      admission: {
        kind: "operation",
        lease: {
          claimExpiresAt: Date.now() + 60_000,
          claimOwner: "owner",
          incarnation: 1,
          kind: "hibernate",
          operationId: OPERATION_ID,
          status: "backing_up",
        },
      },
      sandboxId: SANDBOX_ID,
      targets: [
        {
          dir: "/workspace",
          updateSandboxLastBackup: false,
          workspaceSessionId: SESSION_ID,
        },
      ],
      ttlSeconds: 100,
    }),
  ).rejects.toThrow("lost its exact lifecycle authority");
});

test("checkpoint candidates exclude a closed workspace from the prior incarnation", async () => {
  const database = createDatabase();
  await insertSession(database, { id: SESSION_ID, lastMessageAt: 1 });
  await insertSession(database, { id: NEXT_SESSION_ID, lastMessageAt: 2 });
  await insertWorkspace(database, {
    cwd: "/workspace/old",
    incarnation: 1,
    sessionId: SESSION_ID,
    status: "closed",
  });
  await insertWorkspace(database, {
    cwd: "/workspace/current",
    incarnation: 2,
    sessionId: NEXT_SESSION_ID,
    status: "active",
  });

  const candidates = await listSandboxSessionBackupCandidates(database, SANDBOX_ID, 2);

  expect(candidates.map(({ cwd, sessionId }) => ({ cwd, sessionId }))).toEqual([
    { cwd: "/workspace/current", sessionId: NEXT_SESSION_ID },
  ]);
});

test("failed repair pages rotate instead of starving the next stage", async () => {
  const database = createDatabase();
  const ids = Array.from({ length: 65 }, () => createPlatformId<SandboxBackupId>());
  for (const [index, id] of ids.entries()) {
    await database
      .prepare(
        `INSERT INTO sandbox_backup_staging (
           claim_owner, created_at, dir, id, operation_id, sandbox_id, sandbox_incarnation,
           ttl_seconds, updated_at, updates_subject_backup
         ) VALUES ('stale-owner', 1, ?, ?, ?, ?, 1, 100, 1, 0)`,
      )
      .bind(`/workspace/${index.toString().padStart(2, "0")}`, id, OPERATION_ID, SANDBOX_ID)
      .run();
  }

  const firstPage = await listSandboxBackupStages(database, 64);
  expect(firstPage).toHaveLength(64);
  expect(firstPage.map(({ id }) => id)).not.toContain(ids[64]);
  for (const stage of firstPage) {
    expect(await deferSandboxBackupStageRepair(database, stage)).toBe(true);
  }

  const secondPage = await listSandboxBackupStages(database, 64);
  expect(secondPage[0]?.id).toBe(ids[64]);
});

test("session delete revokes every exact workspace incarnation and preserves other owners", async () => {
  const database = createDatabase();
  const otherSandboxId = parsePlatformId<SandboxId>("01J0000000000000000000000E");
  const sameSandboxOtherSessionId = parsePlatformId<SessionId>("01J0000000000000000000000V");
  await insertBackingUpSandbox(database);
  await insertBackingUpSandbox(database, otherSandboxId);
  await insertSession(database, { cleanup: true, id: SESSION_ID, lastMessageAt: 1 });
  await insertSession(database, { id: NEXT_SESSION_ID, lastMessageAt: 2 });
  await insertSession(database, { id: sameSandboxOtherSessionId, lastMessageAt: 3 });
  await insertWorkspace(database, {
    cwd: "/workspace/shared",
    incarnation: 2,
    sessionId: SESSION_ID,
    status: "closed",
  });
  await insertWorkspace(database, {
    cwd: "/workspace/shared",
    incarnation: 1,
    sandboxId: otherSandboxId,
    sessionId: NEXT_SESSION_ID,
    status: "closed",
  });
  await insertWorkspace(database, {
    cwd: "/workspace/shared",
    incarnation: 2,
    sessionId: sameSandboxOtherSessionId,
    status: "closed",
  });

  const exactDeletedPriorId = createPlatformId<SandboxBackupId>();
  const exactDeletedCurrentId = createPlatformId<SandboxBackupId>();
  const sameSandboxOtherSessionBackupId = createPlatformId<SandboxBackupId>();
  const otherSandboxBackupId = createPlatformId<SandboxBackupId>();
  const legacyDeletedSandboxId = createPlatformId<SandboxBackupId>();
  const legacyOtherSandboxId = createPlatformId<SandboxBackupId>();
  for (const [backupId, sandboxId, workspaceSessionId, incarnation] of [
    [exactDeletedPriorId, SANDBOX_ID, SESSION_ID, 1],
    [exactDeletedCurrentId, SANDBOX_ID, SESSION_ID, 2],
    [sameSandboxOtherSessionBackupId, SANDBOX_ID, sameSandboxOtherSessionId, 2],
    [otherSandboxBackupId, otherSandboxId, NEXT_SESSION_ID, 1],
    [legacyDeletedSandboxId, SANDBOX_ID, null, 0],
    [legacyOtherSandboxId, otherSandboxId, null, 0],
  ] as const) {
    await database
      .prepare(
        `INSERT INTO sandbox_backup (
           created_at, dir, id, keep, operation_id, sandbox_id, sandbox_incarnation,
           staging_id, status, ttl_seconds, updated_at, workspace_session_id
         ) VALUES (1, '/workspace/shared', ?, 0, ?, ?, ?, ?, 'ready', 100, 1, ?)`,
      )
      .bind(
        backupId,
        incarnation === 0 ? null : createPlatformId<RuntimeOperationId>(),
        sandboxId,
        incarnation,
        incarnation === 0 ? backupId : createPlatformId<SandboxBackupId>(),
        workspaceSessionId,
      )
      .run();
  }

  const stagedActualIds = [
    createPlatformId<SandboxBackupId>(),
    createPlatformId<SandboxBackupId>(),
  ];
  for (const [incarnation, actualBackupId] of [
    [1, stagedActualIds[0]],
    [2, stagedActualIds[1]],
  ] as const) {
    await database
      .prepare(
        `INSERT INTO sandbox_backup_staging (
           actual_backup_id, claim_owner, created_at, dir, id, operation_id, sandbox_id,
           sandbox_incarnation, ttl_seconds, updated_at, updates_subject_backup,
           workspace_session_id
         ) VALUES (?, 'owner', 1, '/workspace/shared', ?, ?, ?, ?, 100, 1, 0, ?)`,
      )
      .bind(
        actualBackupId,
        createPlatformId<SandboxBackupId>(),
        createPlatformId<RuntimeOperationId>(),
        SANDBOX_ID,
        incarnation,
        SESSION_ID,
      )
      .run();
  }

  const revoked = await revokeSandboxBackupsForSessionDelete(database, {
    cwd: "/workspace/shared",
    operationId: OPERATION_ID,
    sandboxId: SANDBOX_ID,
    sessionId: SESSION_ID,
  });
  expect(new Set(revoked)).toEqual(
    new Set([exactDeletedPriorId, exactDeletedCurrentId, stagedActualIds[0], stagedActualIds[1]]),
  );
  await expect(
    database
      .prepare(
        "SELECT COUNT(*) AS count FROM sandbox_backup_staging WHERE workspace_session_id = ?",
      )
      .bind(SESSION_ID)
      .first(),
  ).resolves.toEqual({ count: 0 });
  const rows = await database
    .prepare("SELECT id, status FROM sandbox_backup ORDER BY id")
    .all<{ id: string; status: string }>();
  expect(rows.results).toEqual(
    [
      { id: exactDeletedCurrentId, status: "pruned" },
      { id: exactDeletedPriorId, status: "pruned" },
      { id: legacyDeletedSandboxId, status: "ready" },
      { id: legacyOtherSandboxId, status: "ready" },
      { id: otherSandboxBackupId, status: "ready" },
      { id: sameSandboxOtherSessionBackupId, status: "ready" },
    ].toSorted((left, right) => left.id.localeCompare(right.id)),
  );
});
