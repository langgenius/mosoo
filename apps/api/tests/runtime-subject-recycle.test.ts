import { describe, expect, test } from "bun:test";

import { isPlatformId, parsePlatformId } from "@mosoo/id";
import type { RuntimeOperationId } from "@mosoo/id";
import { PLATFORM_ID_FIXTURES } from "@mosoo/id/testing";

import { repairStrandedRuntimeSubjectDeadlines } from "../src/modules/runtime/infrastructure/runtime-subject-lifecycle/runtime-subject-maintenance-store";
import {
  recycleInactiveRuntimeSubjectNow,
  recycleRuntimeSubject,
  resumeRuntimeSubjectRecycleOperation,
} from "../src/modules/runtime/infrastructure/runtime-subject-lifecycle/runtime-subject-recycle.service";
import {
  claimRuntimeSubjectOperationForRepair,
  listInactiveRuntimeSubjects,
  listStaleRuntimeSubjectOperations,
} from "../src/modules/runtime/infrastructure/runtime-subject-lifecycle/runtime-subject-store";
import type { RuntimeSubjectOperationLease } from "../src/modules/runtime/infrastructure/runtime-subject-lifecycle/runtime-subject-store";
import { encodeSandboxBackupIdForStorage } from "../src/modules/runtime/infrastructure/sandbox-backup-id";
import type {
  RuntimeSubjectIncarnationHandle,
  SandboxHandle,
} from "../src/modules/runtime/infrastructure/sandbox-handles";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const CLOUDFLARE_BACKUP_ID = "550e8400-e29b-41d4-a716-446655440000";
const CLOUDFLARE_BACKUP_IDS = [
  CLOUDFLARE_BACKUP_ID,
  "550e8400-e29b-41d4-a716-446655440001",
  "550e8400-e29b-41d4-a716-446655440002",
] as const;
const BACKUP_ID = encodeSandboxBackupIdForStorage(CLOUDFLARE_BACKUP_ID);
const CLAIM_OWNER = "scheduled-maintenance-owner";
const OPERATION_ID = parsePlatformId<RuntimeOperationId>(
  "01J0000000000000000000000R",
  "operation id",
);
const SANDBOX_ID = PLATFORM_ID_FIXTURES.sandbox;

type RuntimeSubjectTestHandle = RuntimeSubjectIncarnationHandle & SandboxHandle;

let currentSandbox: RuntimeSubjectTestHandle | null = null;

function createRuntimeSubjectRecycleDatabase(): SqliteD1Database {
  const database = new SqliteD1Database({ foreignKeys: false });

  database.execute(`
    CREATE TABLE driver_instance (
      id text PRIMARY KEY NOT NULL,
      sandbox_id text NOT NULL,
      sandbox_incarnation integer DEFAULT 1 NOT NULL,
      sandbox_session_id text,
      generation integer DEFAULT 0 NOT NULL,
      status text NOT NULL,
      status_operation_id text
    );

    CREATE TABLE sandbox (
      agent_id text NOT NULL DEFAULT '01J00000000000000000000009',
      project_id text NOT NULL DEFAULT '01J0000000000000000000000A',
      claim_expires_at integer,
      claim_owner text,
      id text PRIMARY KEY NOT NULL,
      inactive_deadline_at integer,
      incarnation integer NOT NULL,
      kind text NOT NULL,
      last_backup_id text,
      last_error text,
      last_error_code text,
      last_restore_backup_id text,
      network_constraints_hash text,
      operation_kind text,
      owner_account_id text NOT NULL DEFAULT '01J00000000000000000000008',
      status text NOT NULL,
      status_changed_at integer DEFAULT 0 NOT NULL,
      status_event text DEFAULT 'runtime_subject.active' NOT NULL,
      status_operation_id text,
      status_seq integer DEFAULT 0 NOT NULL,
      status_source text DEFAULT 'system' NOT NULL,
      subject_id text NOT NULL,
      subject_kind text NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE TABLE sandbox_backup (
      created_at integer NOT NULL,
      dir text NOT NULL,
      id text PRIMARY KEY NOT NULL,
      keep integer NOT NULL,
      operation_id text,
      sandbox_id text NOT NULL,
      sandbox_incarnation integer DEFAULT 1 NOT NULL,
      session_run_id text,
      staging_id text NOT NULL,
      status text NOT NULL,
      ttl_seconds integer NOT NULL,
      updated_at integer NOT NULL,
      workspace_session_id text
    );

    CREATE TABLE sandbox_backup_staging (
      actual_backup_id text,
      claim_owner text,
      created_at integer NOT NULL,
      dir text NOT NULL,
      driver_generation integer,
      driver_instance_id text,
      id text PRIMARY KEY NOT NULL,
      operation_id text,
      sandbox_id text NOT NULL,
      sandbox_incarnation integer NOT NULL,
      session_run_id text,
      ttl_seconds integer NOT NULL,
      updated_at integer NOT NULL,
      updates_subject_backup integer NOT NULL,
      workspace_session_id text
    );

    CREATE TABLE sandbox_backup_delete_intent (
      attempted_at integer,
      backup_id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      delete_after integer NOT NULL,
      deleted_at integer
    );

    CREATE TABLE environment_package_artifact_backup (
      backup_id text PRIMARY KEY NOT NULL
    );

    CREATE TABLE environment_package_artifact_backup_staging (
      actual_backup_id text
    );

    CREATE TABLE native_resume_ref (
      committed_session_run_id text,
      committed_value text,
      observed_session_run_id text,
      session_id text PRIMARY KEY NOT NULL,
      value text NOT NULL
    );

    CREATE TABLE sandbox_session (
      cleanup_operation_id text,
      cwd text NOT NULL,
      sandbox_id text NOT NULL,
      sandbox_incarnation integer DEFAULT 1 NOT NULL,
      session_id text PRIMARY KEY NOT NULL,
      status text NOT NULL,
      updated_at integer
    );

    CREATE TABLE session (
      archived_at integer,
      cleanup_operation_kind text,
      id text PRIMARY KEY NOT NULL,
      last_message_at integer,
      runtime_provisioning_operation_id text,
      runtime_provisioning_sandbox_id text,
      status text NOT NULL
    );

    CREATE TABLE session_run (
      agent_id text DEFAULT '' NOT NULL,
      id text PRIMARY KEY NOT NULL,
      driver_instance_id text,
      session_id text DEFAULT '' NOT NULL,
      status text NOT NULL
    );

    INSERT INTO sandbox (
      claim_expires_at,
      claim_owner,
      id,
      inactive_deadline_at,
      incarnation,
      kind,
      last_backup_id,
      last_error,
      last_error_code,
      network_constraints_hash,
      operation_kind,
      status,
      status_operation_id,
      status_seq,
      status_source,
      subject_id,
      subject_kind,
      updated_at
    )
    VALUES (
      9999999999999, '${CLAIM_OWNER}', '${SANDBOX_ID}', 1, 1, 'pet', NULL, NULL, NULL,
      '${"0".repeat(64)}', NULL, 'active', NULL, 0, 'test',
      '01J00000000000000000000009', 'agent', 1
    );
  `);

  return database;
}

function createBindings(database: D1Database): ApiBindings {
  return {
    DB: database,
    runtimeSubjectHandleFactory: () => {
      if (currentSandbox === null) {
        throw new Error("Sandbox test handle was not configured.");
      }

      return currentSandbox;
    },
    SANDBOX_STATE_BUCKET: {
      delete: async () => {},
    },
    Sandbox: {},
  };
}

function requireRuntimeOperationId(value: string | null | undefined): RuntimeOperationId {
  if (value === null || value === undefined) {
    throw new Error("Runtime operation id was not recorded.");
  }

  return parsePlatformId<RuntimeOperationId>(value, "runtime operation id");
}

function operationLease(
  operationId: RuntimeOperationId,
  status: RuntimeSubjectOperationLease["status"],
): RuntimeSubjectOperationLease {
  return {
    claimExpiresAt: Number.MAX_SAFE_INTEGER,
    claimOwner: CLAIM_OWNER,
    incarnation: 1,
    kind: "hibernate",
    operationId,
    status,
  };
}

async function claimStaleOperation(
  database: D1Database,
  operationId: RuntimeOperationId,
  status: RuntimeSubjectOperationLease["status"],
): Promise<RuntimeSubjectOperationLease> {
  const candidates = await listStaleRuntimeSubjectOperations(database, {
    limit: 10,
    staleChangedAtLte: Number.MAX_SAFE_INTEGER,
  });
  expect(candidates).toHaveLength(1);
  const candidate = candidates[0];
  if (!candidate) {
    throw new Error("Runtime subject repair candidate was not found.");
  }
  expect(candidate).toMatchObject({
    claimOwner: CLAIM_OWNER,
    id: SANDBOX_ID,
    incarnation: 1,
    kind: "pet",
    operationId,
    operationKind: "hibernate",
    status,
  });
  const now = Date.now();
  const lease = await claimRuntimeSubjectOperationForRepair(database, {
    candidate,
    claimExpiresAt: now + 60_000,
    claimOwner: "repair-owner",
    now,
  });
  if (lease === null) {
    throw new Error("Runtime subject repair candidate could not be claimed.");
  }
  return lease;
}

async function readRuntimeSubjectRecycleRow(database: D1Database): Promise<{
  last_backup_id: string | null;
  last_error: string | null;
  last_error_code: string | null;
  status: string;
  status_operation_id: string | null;
}> {
  const row = await database
    .prepare(
      `
        SELECT last_backup_id, last_error, last_error_code, status, status_operation_id
        FROM sandbox
        WHERE id = ?
      `,
    )
    .bind(SANDBOX_ID)
    .first<{
      last_backup_id: string | null;
      last_error: string | null;
      last_error_code: string | null;
      status: string;
      status_operation_id: string | null;
    }>();

  if (!row) {
    throw new Error("Runtime subject test row was not found.");
  }

  return row;
}

function createSandboxHandle(): RuntimeSubjectTestHandle {
  const unavailable = async () => {
    throw new Error("Unexpected sandbox test method call.");
  };

  return {
    activateRuntimeSubjectIncarnation: async () => {},
    configureNetworkConstraints: async () => {},
    createBackup: async (options) => ({
      dir: options.dir,
      id: CLOUDFLARE_BACKUP_ID,
    }),
    createRuntimeSubjectBackup: async (_incarnation, options) => ({
      dir: options.dir,
      id: CLOUDFLARE_BACKUP_ID,
    }),
    createSession: unavailable,
    deleteSession: unavailable,
    destroy: async () => {},
    destroyRuntimeSubjectIncarnation: async () => ({ kind: "destroyed" }),
    exec: unavailable,
    getSession: unavailable,
    inspectRuntimeSubjectIncarnation: async () => ({ kind: "healthy" }),
    markRuntimeSubjectIncarnationReady: async () => {},
    mkdir: async () => {},
    mountBucket: unavailable,
    readFile: unavailable,
    restoreBackup: unavailable,
    setKeepAlive: async () => {},
    startProcess: unavailable,
    terminal: unavailable,
    unmountBucket: unavailable,
    watch: unavailable,
    writeFile: unavailable,
    wsConnect: unavailable,
  };
}

describe("runtime subject recycle", () => {
  test("repairs stranded cattle subjects without touching active conversations", async () => {
    const database = createRuntimeSubjectRecycleDatabase();
    database.execute(`
      UPDATE sandbox
      SET claim_expires_at = NULL,
          claim_owner = NULL,
          inactive_deadline_at = NULL,
          kind = 'cattle',
          subject_id = 'session-1',
          subject_kind = 'session'
      WHERE id = '${SANDBOX_ID}';

      INSERT INTO sandbox_session (cwd, sandbox_id, session_id, status, updated_at)
      VALUES ('/workspace', '${SANDBOX_ID}', 'session-1', 'closed', 1);
    `);

    await expect(repairStrandedRuntimeSubjectDeadlines(database, { now: 10 })).resolves.toEqual({
      cattle: 1,
      pet: 0,
    });
    await expect(
      listInactiveRuntimeSubjects(database, { limit: 10, now: 300_009 }),
    ).resolves.toEqual([]);
    await expect(
      listInactiveRuntimeSubjects(database, { limit: 10, now: 300_010 }),
    ).resolves.toEqual([{ id: SANDBOX_ID, kind: "cattle" }]);

    database.execute(`
      UPDATE sandbox SET inactive_deadline_at = NULL WHERE id = '${SANDBOX_ID}';
      UPDATE sandbox_session SET status = 'active' WHERE session_id = 'session-1';
    `);

    await expect(repairStrandedRuntimeSubjectDeadlines(database, { now: 20 })).resolves.toEqual({
      cattle: 0,
      pet: 0,
    });
  });

  test("uses a generated operation id instead of the maintenance claim owner", async () => {
    const database = createRuntimeSubjectRecycleDatabase();
    let observedOperationId: string | null = null;
    currentSandbox = {
      ...createSandboxHandle(),
      createRuntimeSubjectBackup: async (_incarnation, options) => {
        observedOperationId = await database
          .prepare("SELECT status_operation_id FROM sandbox WHERE id = ?")
          .bind(SANDBOX_ID)
          .first<string>("status_operation_id");
        return { dir: options.dir, id: CLOUDFLARE_BACKUP_ID };
      },
    };

    await expect(
      recycleRuntimeSubject(createBindings(database), {
        claimOwner: CLAIM_OWNER,
        kind: "pet",
        now: 10,
        reason: "test.recycle",
        runtimeSubjectId: SANDBOX_ID,
      }),
    ).resolves.toBe(true);

    const subject = await database
      .prepare(
        `
          SELECT last_backup_id, status, status_operation_id
          FROM sandbox
          WHERE id = ?
        `,
      )
      .bind(SANDBOX_ID)
      .first<{
        last_backup_id: string | null;
        status: string;
        status_operation_id: string | null;
      }>();

    expect(subject?.status).toBe("cold");
    expect(subject?.last_backup_id).toBe(BACKUP_ID);
    expect(observedOperationId).not.toBe(CLAIM_OWNER);
    expect(isPlatformId(observedOperationId)).toBe(true);
    expect(subject?.status_operation_id).toBeNull();
  });

  test("hibernates one idle pet subject across sessions after checkpointing durable state", async () => {
    const database = createRuntimeSubjectRecycleDatabase();
    await database
      .prepare(
        `
          UPDATE sandbox
          SET claim_expires_at = NULL,
              claim_owner = NULL,
              inactive_deadline_at = ?,
              subject_kind = ?
          WHERE id = ?
        `,
      )
      .bind(10, "agent", SANDBOX_ID)
      .run();
    database.execute(`
      INSERT INTO sandbox_session (cwd, sandbox_id, session_id, status, updated_at)
      VALUES
        ('/workspace/se/session-1', '${SANDBOX_ID}', '01J0000000000000000000000S', 'active', 1),
        ('/workspace/se/session-2', '${SANDBOX_ID}', '01J0000000000000000000000T', 'active', 1),
        ('/workspace/se/terminated', '${SANDBOX_ID}', '01J0000000000000000000000U', 'active', 1);

      INSERT INTO session (id, last_message_at, status)
      VALUES
        ('01J0000000000000000000000S', 1, 'IDLE'),
        ('01J0000000000000000000000T', 1, 'IDLE'),
        ('01J0000000000000000000000U', 1, 'TERMINATED');
    `);
    const checkpointDirs: string[] = [];
    const lifecycleCalls: string[] = [];
    let backupIndex = 0;
    currentSandbox = {
      ...createSandboxHandle(),
      createRuntimeSubjectBackup: async (_incarnation, options) => {
        checkpointDirs.push(options.dir);
        const id = CLOUDFLARE_BACKUP_IDS[backupIndex];
        backupIndex += 1;
        if (!id) {
          throw new Error("Unexpected extra checkpoint.");
        }
        return { dir: options.dir, id };
      },
      destroyRuntimeSubjectIncarnation: async () => {
        lifecycleCalls.push("destroy");
        return { kind: "destroyed" };
      },
      setKeepAlive: async (keepAlive) => {
        lifecycleCalls.push(`keepAlive:${keepAlive}`);
      },
    };
    const bindings = createBindings(database);

    await expect(
      listInactiveRuntimeSubjects(database, {
        limit: 10,
        now: 10,
      }),
    ).resolves.toEqual([{ id: SANDBOX_ID, kind: "pet" }]);
    await expect(
      recycleInactiveRuntimeSubjectNow(bindings, {
        kind: "pet",
        now: 10,
        reason: "test.pet_idle_hibernate",
        runtimeSubjectId: SANDBOX_ID,
      }),
    ).resolves.toBe(true);
    await expect(
      recycleInactiveRuntimeSubjectNow(bindings, {
        kind: "pet",
        now: 10,
        reason: "test.pet_idle_hibernate_duplicate",
        runtimeSubjectId: SANDBOX_ID,
      }),
    ).resolves.toBe(false);

    expect(checkpointDirs.toSorted()).toEqual([
      "/workspace/memory",
      "/workspace/se/session-1",
      "/workspace/se/session-2",
    ]);
    expect(lifecycleCalls).toEqual(["destroy"]);
    await expect(readRuntimeSubjectRecycleRow(database)).resolves.toMatchObject({
      last_error: null,
      last_error_code: null,
      status: "cold",
    });
    const sessions = await database
      .prepare("SELECT status FROM sandbox_session ORDER BY session_id")
      .all<{ status: string }>();
    expect(sessions.results).toEqual([
      { status: "closed" },
      { status: "closed" },
      { status: "closed" },
    ]);
    await expect(
      listInactiveRuntimeSubjects(database, {
        limit: 10,
        now: Number.MAX_SAFE_INTEGER,
      }),
    ).resolves.toEqual([]);
  });

  test("resumes a stale destroy phase using the recorded operation id", async () => {
    const database = createRuntimeSubjectRecycleDatabase();
    currentSandbox = {
      ...createSandboxHandle(),
      destroyRuntimeSubjectIncarnation: async () => ({ kind: "destroyed" }),
    };
    await database
      .prepare(
        `
          UPDATE sandbox
          SET operation_kind = ?, status = ?, status_operation_id = ?, status_changed_at = ?, status_source = ?
          WHERE id = ?
        `,
      )
      .bind("hibernate", "destroying", OPERATION_ID, 1, "maintenance", SANDBOX_ID)
      .run();
    await database
      .prepare(
        `
          INSERT INTO sandbox_session (cwd, sandbox_id, session_id, status, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `,
      )
      .bind("/workspace", SANDBOX_ID, "01J0000000000000000000000S", "active", 1)
      .run();

    await expect(
      resumeRuntimeSubjectRecycleOperation(createBindings(database), {
        kind: "pet",
        lease: operationLease(OPERATION_ID, "destroying"),
        reason: "test.repair",
        runtimeSubjectId: SANDBOX_ID,
      }),
    ).resolves.toBe(true);

    const subject = await database
      .prepare(
        `
          SELECT status, status_operation_id
          FROM sandbox
          WHERE id = ?
        `,
      )
      .bind(SANDBOX_ID)
      .first<{
        status: string;
        status_operation_id: string | null;
      }>();
    const session = await database
      .prepare("SELECT status FROM sandbox_session WHERE session_id = ?")
      .bind("01J0000000000000000000000S")
      .first<{ status: string }>();

    expect(subject).toEqual({
      status: "cold",
      status_operation_id: null,
    });
    expect(session).toEqual({ status: "closed" });
  });

  test("keeps backup failures as stale repair candidates", async () => {
    const database = createRuntimeSubjectRecycleDatabase();
    let backupAvailable = false;
    const lifecycleCalls: string[] = [];
    await database
      .prepare(
        `
          INSERT INTO sandbox_session (cwd, sandbox_id, session_id, status, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `,
      )
      .bind("/workspace/se/session-1", SANDBOX_ID, "01J0000000000000000000000S", "active", 1)
      .run();
    currentSandbox = {
      ...createSandboxHandle(),
      createRuntimeSubjectBackup: async (_incarnation, options) => {
        if (!backupAvailable) {
          backupAvailable = true;
          throw new Error("backup service unavailable");
        }

        return {
          dir: options.dir,
          id: CLOUDFLARE_BACKUP_ID,
        };
      },
      destroyRuntimeSubjectIncarnation: async () => {
        lifecycleCalls.push("destroy");
        return { kind: "destroyed" };
      },
      setKeepAlive: async (keepAlive) => {
        lifecycleCalls.push(`keepAlive:${keepAlive}`);
      },
    };

    await expect(
      recycleRuntimeSubject(createBindings(database), {
        claimOwner: CLAIM_OWNER,
        kind: "pet",
        now: 10,
        reason: "test.recycle",
        runtimeSubjectId: SANDBOX_ID,
      }),
    ).rejects.toThrow("checkpoint failed");

    const failedSubject = await readRuntimeSubjectRecycleRow(database);
    const operationId = requireRuntimeOperationId(failedSubject.status_operation_id);

    expect(failedSubject).toMatchObject({
      last_backup_id: null,
      last_error_code: "runtime.subject_checkpoint_failed",
      status: "backing_up",
      status_operation_id: operationId,
    });
    expect(failedSubject.last_error).toContain("checkpoint failed");
    expect(lifecycleCalls).toEqual([]);
    await expect(
      database
        .prepare("SELECT status FROM sandbox_session WHERE session_id = ?")
        .bind("01J0000000000000000000000S")
        .first("status"),
    ).resolves.toBe("active");
    const repairLease = await claimStaleOperation(database, operationId, "backing_up");

    await expect(
      resumeRuntimeSubjectRecycleOperation(createBindings(database), {
        kind: "pet",
        lease: repairLease,
        reason: "test.repair",
        runtimeSubjectId: SANDBOX_ID,
      }),
    ).resolves.toBe(true);

    await expect(readRuntimeSubjectRecycleRow(database)).resolves.toMatchObject({
      last_backup_id: BACKUP_ID,
      last_error: null,
      last_error_code: null,
      status: "cold",
      status_operation_id: null,
    });
    expect(lifecycleCalls).toEqual(["destroy"]);
  });

  test("keeps destroy failures as stale repair candidates with the recorded backup", async () => {
    const database = createRuntimeSubjectRecycleDatabase();
    let destroyAvailable = false;
    currentSandbox = {
      ...createSandboxHandle(),
      createRuntimeSubjectBackup: async (_incarnation, options) => {
        return {
          dir: options.dir,
          id: CLOUDFLARE_BACKUP_ID,
        };
      },
      destroyRuntimeSubjectIncarnation: async () => {
        if (!destroyAvailable) {
          destroyAvailable = true;
          throw new Error("destroy service unavailable");
        }
        return { kind: "destroyed" };
      },
    };

    await expect(
      recycleRuntimeSubject(createBindings(database), {
        claimOwner: CLAIM_OWNER,
        kind: "pet",
        now: 10,
        reason: "test.recycle",
        runtimeSubjectId: SANDBOX_ID,
      }),
    ).rejects.toThrow("destroy service unavailable");

    const failedSubject = await readRuntimeSubjectRecycleRow(database);
    const operationId = requireRuntimeOperationId(failedSubject.status_operation_id);

    expect(failedSubject).toMatchObject({
      last_backup_id: BACKUP_ID,
      last_error: "destroy service unavailable",
      last_error_code: "runtime.subject_operation_failed",
      status: "destroying",
      status_operation_id: operationId,
    });
    const repairLease = await claimStaleOperation(database, operationId, "destroying");

    await expect(
      resumeRuntimeSubjectRecycleOperation(createBindings(database), {
        kind: "pet",
        lease: repairLease,
        reason: "test.repair",
        runtimeSubjectId: SANDBOX_ID,
      }),
    ).resolves.toBe(true);

    await expect(readRuntimeSubjectRecycleRow(database)).resolves.toMatchObject({
      last_backup_id: BACKUP_ID,
      last_error: null,
      last_error_code: null,
      status: "cold",
      status_operation_id: null,
    });
  });

  test("selects stale operation phases as repair candidates", async () => {
    const database = createRuntimeSubjectRecycleDatabase();
    await database
      .prepare(
        `
          UPDATE sandbox
          SET claim_expires_at = ?, operation_kind = ?, status = ?, status_operation_id = ?, status_changed_at = ?, status_source = ?
          WHERE id = ?
        `,
      )
      .bind(10, "hibernate", "destroying", OPERATION_ID, 10, "maintenance", SANDBOX_ID)
      .run();

    await expect(
      listStaleRuntimeSubjectOperations(database, {
        limit: 10,
        staleChangedAtLte: 9,
      }),
    ).resolves.toEqual([]);
    await expect(
      listStaleRuntimeSubjectOperations(database, {
        limit: 10,
        staleChangedAtLte: 10,
      }),
    ).resolves.toEqual([
      {
        claimExpiresAt: 10,
        claimOwner: CLAIM_OWNER,
        id: SANDBOX_ID,
        incarnation: 1,
        kind: "pet",
        operationId: OPERATION_ID,
        operationKind: "hibernate",
        status: "destroying",
      },
    ]);
  });
});
