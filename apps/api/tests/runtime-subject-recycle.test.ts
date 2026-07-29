import { describe, expect, test } from "bun:test";

import { isPlatformId, parsePlatformId } from "@mosoo/id";
import type { RuntimeOperationId } from "@mosoo/id";
import { PLATFORM_ID_FIXTURES } from "@mosoo/id/testing";

import {
  recycleInactiveRuntimeSubjectNow,
  recycleRuntimeSubject,
  resumeRuntimeSubjectRecycleOperation,
} from "../src/modules/runtime/infrastructure/runtime-subject-lifecycle/runtime-subject-recycle.service";
import {
  listInactiveRuntimeSubjects,
  listStaleRuntimeSubjectOperations,
} from "../src/modules/runtime/infrastructure/runtime-subject-lifecycle/runtime-subject-store";
import { encodeSandboxBackupIdForStorage } from "../src/modules/runtime/infrastructure/sandbox-backup-id";
import type { SandboxHandle } from "../src/modules/runtime/infrastructure/sandbox-handles";
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
const OPERATION_ID = "01J0000000000000000000000R";
const SANDBOX_ID = PLATFORM_ID_FIXTURES.sandbox;

let currentSandbox: SandboxHandle | null = null;

function createRuntimeSubjectRecycleDatabase(): SqliteD1Database {
  const database = new SqliteD1Database({ foreignKeys: false });

  database.execute(`
    CREATE TABLE driver_instance (
      id text PRIMARY KEY NOT NULL,
      sandbox_id text NOT NULL,
      generation integer DEFAULT 0 NOT NULL,
      status text NOT NULL
    );

    CREATE TABLE sandbox (
      claim_expires_at integer,
      claim_owner text,
      id text PRIMARY KEY NOT NULL,
      inactive_deadline_at integer,
      kind text NOT NULL,
      last_backup_id text,
      last_error text,
      last_error_code text,
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
      error_message text,
      id text PRIMARY KEY NOT NULL,
      keep integer NOT NULL,
      sandbox_id text NOT NULL,
      status text NOT NULL,
      ttl_seconds integer NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE TABLE sandbox_session (
      cwd text NOT NULL,
      sandbox_id text NOT NULL,
      session_id text PRIMARY KEY NOT NULL,
      status text NOT NULL,
      updated_at integer
    );

    CREATE TABLE session (
      id text PRIMARY KEY NOT NULL,
      last_message_at integer,
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
      kind,
      last_backup_id,
      last_error,
      last_error_code,
      status,
      status_operation_id,
      status_seq,
      status_source,
      subject_id,
      subject_kind,
      updated_at
    )
    VALUES (9999999999999, '${CLAIM_OWNER}', '${SANDBOX_ID}', 1, 'pet', NULL, NULL, NULL, 'active', NULL, 0, 'test', '01J00000000000000000000009', 'session', 1);
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
  } as unknown as ApiBindings;
}

function requireRuntimeOperationId(value: string | null | undefined): RuntimeOperationId {
  if (value === null || value === undefined) {
    throw new Error("Runtime operation id was not recorded.");
  }

  return parsePlatformId<RuntimeOperationId>(value, "runtime operation id");
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

function createSandboxHandle(): SandboxHandle {
  const unavailable = async () => {
    throw new Error("Unexpected sandbox test method call.");
  };

  return {
    createBackup: async (options) => ({
      dir: options.dir,
      id: CLOUDFLARE_BACKUP_ID,
    }),
    createSession: unavailable,
    deleteSession: unavailable,
    destroy: async () => {},
    exec: unavailable,
    getSession: unavailable,
    mkdir: unavailable,
    mountBucket: unavailable,
    readFile: unavailable,
    restoreBackup: unavailable,
    setKeepAlive: async () => {},
    startProcess: unavailable,
    terminal: unavailable,
    watch: unavailable,
    writeFile: unavailable,
    wsConnect: unavailable,
  } as SandboxHandle;
}

describe("runtime subject recycle", () => {
  test("uses a generated operation id instead of the maintenance claim owner", async () => {
    const database = createRuntimeSubjectRecycleDatabase();
    currentSandbox = createSandboxHandle();

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
    expect(subject?.status_operation_id).not.toBe(CLAIM_OWNER);
    expect(isPlatformId(subject?.status_operation_id)).toBe(true);
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
      createBackup: async (options) => {
        checkpointDirs.push(options.dir);
        const id = CLOUDFLARE_BACKUP_IDS[backupIndex];
        backupIndex += 1;
        if (!id) {
          throw new Error("Unexpected extra checkpoint.");
        }
        return { dir: options.dir, id };
      },
      destroy: async () => {
        lifecycleCalls.push("destroy");
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
    expect(lifecycleCalls).toEqual(["keepAlive:false", "destroy"]);
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
      destroy: async () => {},
    };
    await database
      .prepare(
        `
          UPDATE sandbox
          SET status = ?, status_operation_id = ?, status_changed_at = ?, status_source = ?
          WHERE id = ?
        `,
      )
      .bind("destroying", OPERATION_ID, 1, "maintenance", SANDBOX_ID)
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
        operationId: OPERATION_ID,
        reason: "test.repair",
        runtimeSubjectId: SANDBOX_ID,
        status: "destroying",
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
      status_operation_id: OPERATION_ID,
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
      createBackup: async (options) => {
        if (!backupAvailable) {
          backupAvailable = true;
          throw new Error("backup service unavailable");
        }

        return {
          dir: options.dir,
          id: CLOUDFLARE_BACKUP_ID,
        };
      },
      destroy: async () => {
        lifecycleCalls.push("destroy");
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
    await expect(
      listStaleRuntimeSubjectOperations(database, {
        limit: 10,
        staleChangedAtLte: Number.MAX_SAFE_INTEGER,
      }),
    ).resolves.toEqual([
      {
        id: SANDBOX_ID,
        kind: "pet",
        operationId,
        status: "backing_up",
      },
    ]);

    await expect(
      resumeRuntimeSubjectRecycleOperation(createBindings(database), {
        kind: "pet",
        operationId,
        reason: "test.repair",
        runtimeSubjectId: SANDBOX_ID,
        status: "backing_up",
      }),
    ).resolves.toBe(true);

    await expect(readRuntimeSubjectRecycleRow(database)).resolves.toMatchObject({
      last_backup_id: BACKUP_ID,
      last_error: null,
      last_error_code: null,
      status: "cold",
      status_operation_id: operationId,
    });
    expect(lifecycleCalls).toEqual(["keepAlive:false", "destroy"]);
  });

  test("keeps destroy failures as stale repair candidates with the recorded backup", async () => {
    const database = createRuntimeSubjectRecycleDatabase();
    let destroyAvailable = false;
    currentSandbox = {
      ...createSandboxHandle(),
      createBackup: async (options) => {
        return {
          dir: options.dir,
          id: CLOUDFLARE_BACKUP_ID,
        };
      },
      destroy: async () => {
        if (!destroyAvailable) {
          destroyAvailable = true;
          throw new Error("destroy service unavailable");
        }
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
    await expect(
      listStaleRuntimeSubjectOperations(database, {
        limit: 10,
        staleChangedAtLte: Number.MAX_SAFE_INTEGER,
      }),
    ).resolves.toEqual([
      {
        id: SANDBOX_ID,
        kind: "pet",
        operationId,
        status: "destroying",
      },
    ]);

    await expect(
      resumeRuntimeSubjectRecycleOperation(createBindings(database), {
        kind: "pet",
        operationId,
        reason: "test.repair",
        runtimeSubjectId: SANDBOX_ID,
        status: "destroying",
      }),
    ).resolves.toBe(true);

    await expect(readRuntimeSubjectRecycleRow(database)).resolves.toMatchObject({
      last_backup_id: BACKUP_ID,
      last_error: null,
      last_error_code: null,
      status: "cold",
      status_operation_id: operationId,
    });
  });

  test("selects stale operation phases as repair candidates", async () => {
    const database = createRuntimeSubjectRecycleDatabase();
    await database
      .prepare(
        `
          UPDATE sandbox
          SET status = ?, status_operation_id = ?, status_changed_at = ?, status_source = ?
          WHERE id = ?
        `,
      )
      .bind("destroying", OPERATION_ID, 10, "maintenance", SANDBOX_ID)
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
        id: SANDBOX_ID,
        kind: "pet",
        operationId: OPERATION_ID,
        status: "destroying",
      },
    ]);
  });
});
