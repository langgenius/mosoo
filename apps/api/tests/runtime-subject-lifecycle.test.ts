import { afterEach, describe, expect, test } from "bun:test";

import { createTimeoutError } from "@mosoo/effects";
import { createPlatformId } from "@mosoo/id";
import type { RuntimeOperationId, SandboxId, SessionId, SessionRunId } from "@mosoo/id";

import { decideRuntimeSubjectTransition } from "../src/modules/runtime/domain/runtime-subject-lifecycle.machine";
import { hashSandboxNetworkConstraints } from "../src/modules/runtime/domain/sandbox-network-constraints";
import { createRuntimeSubjectLifecycleService } from "../src/modules/runtime/infrastructure/runtime-subject-lifecycle/runtime-subject-lifecycle.service";
import type { ActivateRuntimeSubjectInput } from "../src/modules/runtime/infrastructure/runtime-subject-lifecycle/runtime-subject-lifecycle.service";
import {
  recreateRuntimeSubjectPreservingState,
  resetRuntimeSubjectAgentState,
  runRuntimeSubjectOperation,
} from "../src/modules/runtime/infrastructure/runtime-subject-lifecycle/runtime-subject-operations.service";
import {
  destroyRuntimeSubjectContainer,
  getRuntimeSubjectKeepAliveHandle,
} from "../src/modules/runtime/infrastructure/runtime-subject-lifecycle/runtime-subject-platform";
import { recycleRuntimeSubject } from "../src/modules/runtime/infrastructure/runtime-subject-lifecycle/runtime-subject-recycle.service";
import {
  advanceRuntimeSubjectOperationStatus,
  claimRuntimeSubjectOperationForRepair,
  markRuntimeSubjectCold,
  markRuntimeSubjectOperationStarted,
} from "../src/modules/runtime/infrastructure/runtime-subject-lifecycle/runtime-subject-store";
import { encodeSandboxBackupIdForStorage } from "../src/modules/runtime/infrastructure/sandbox-backup-id";
import type { SandboxHandle } from "../src/modules/runtime/infrastructure/sandbox-handles";
import { setServerProductAnalyticsTransportForTests } from "../src/platform/analytics/product-analytics";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const RUNTIME_SUBJECT_ID = "01J0000000000000000000000D";
const ACCOUNT_ID = "01J00000000000000000000002";
const AGENT_ID = "01J00000000000000000000001";
const PROJECT_ID = "01J00000000000000000000003";
const SESSION_ID = "01J00000000000000000000009";
const CLOUDFLARE_BACKUP_ID = "550e8400-e29b-41d4-a716-446655440000";
const STORED_BACKUP_ID = encodeSandboxBackupIdForStorage(CLOUDFLARE_BACKUP_ID);
const RUNTIME_SUBJECT_QUOTA_SCOPE = {
  agentId: AGENT_ID,
  projectId: PROJECT_ID,
  executionOwnerUserId: ACCOUNT_ID,
} as const;
const FULL_NETWORK_CONSTRAINTS_HASH = await hashSandboxNetworkConstraints({
  allowedHosts: [],
  networkPolicy: "full",
});

afterEach(() => {
  setServerProductAnalyticsTransportForTests(null);
});

function createRuntimeSubjectLifecycleDatabase(): SqliteD1Database {
  const database = new SqliteD1Database();

  database.execute(`
    CREATE TABLE sandbox (
      agent_id text,
      project_id text,
      bind_mount_ready integer DEFAULT false NOT NULL,
      claim_expires_at integer,
      claim_owner text,
      created_at integer NOT NULL,
      global_mounts_json text DEFAULT '[]' NOT NULL,
      id text PRIMARY KEY NOT NULL,
      inactive_deadline_at integer,
      incarnation integer DEFAULT 0 NOT NULL,
      kind text NOT NULL,
      last_backup_id text,
      last_error text,
      last_error_code text,
      last_restore_backup_id text,
      network_constraints_hash text,
      owner_account_id text,
      operation_kind text,
      status text NOT NULL,
      status_changed_at integer DEFAULT 0 NOT NULL,
      status_event text DEFAULT 'runtime_subject.cold' NOT NULL,
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
      operation_id text,
      sandbox_id text NOT NULL,
      sandbox_incarnation integer DEFAULT 0 NOT NULL,
      session_run_id text,
      status text NOT NULL,
      ttl_seconds integer NOT NULL,
      updated_at integer NOT NULL
    );

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

    CREATE TABLE driver_instance (
      generation integer DEFAULT 0 NOT NULL,
      id text PRIMARY KEY NOT NULL,
      sandbox_id text NOT NULL,
      sandbox_incarnation integer DEFAULT 0 NOT NULL,
      sandbox_session_id text NOT NULL,
      status_operation_id text,
      status text NOT NULL
    );

    CREATE TABLE session_run (
      agent_id text NOT NULL,
      driver_instance_id text,
      id text PRIMARY KEY NOT NULL,
      session_id text NOT NULL,
      status text NOT NULL
    );

    CREATE TABLE native_resume_ref (
      session_id text PRIMARY KEY NOT NULL
    );

    CREATE TABLE session (
      archived_at integer,
      cleanup_operation_kind text,
      id text PRIMARY KEY NOT NULL,
      last_message_at integer,
      runtime_provisioning_operation_id text,
      runtime_provisioning_run_id text,
      runtime_provisioning_sandbox_id text,
      runtime_provisioning_sandbox_incarnation integer,
      runtime_provisioning_sandbox_session_id text,
      status text NOT NULL DEFAULT 'ready'
    );
  `);

  return database;
}

async function insertRuntimeSubject(
  database: D1Database,
  input: {
    readonly incarnation?: number;
    readonly kind?: "cattle" | "pet";
    readonly lastBackupId?: string | null;
    readonly lastError?: string | null;
    readonly lastErrorCode?: string | null;
    readonly status: string;
    readonly statusSeq?: number;
  },
): Promise<void> {
  await database
    .prepare(
      `
        INSERT INTO sandbox (
          agent_id,
          project_id,
          claim_expires_at,
          claim_owner,
          created_at,
          id,
          inactive_deadline_at,
          incarnation,
          kind,
          last_backup_id,
          last_error,
          last_error_code,
          last_restore_backup_id,
          network_constraints_hash,
          owner_account_id,
          status,
          status_event,
          status_seq,
          status_source,
          subject_id,
          subject_kind,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .bind(
      AGENT_ID,
      PROJECT_ID,
      null,
      null,
      1,
      RUNTIME_SUBJECT_ID,
      1,
      input.incarnation ?? (input.status === "cold" ? 0 : 1),
      input.kind ?? "cattle",
      input.lastBackupId ?? null,
      input.lastError ?? null,
      input.lastErrorCode ?? null,
      null,
      FULL_NETWORK_CONSTRAINTS_HASH,
      ACCOUNT_ID,
      input.status,
      `runtime_subject.${input.status === "backing_up" ? "back_up" : input.status}`,
      input.statusSeq ?? 0,
      "test",
      input.kind === "pet" ? AGENT_ID : SESSION_ID,
      input.kind === "pet" ? "agent" : "session",
      1,
    )
    .run();
}

async function insertRuntimeProvisioningAuthority(
  database: D1Database,
  incarnation: number,
): Promise<NonNullable<ActivateRuntimeSubjectInput["provisioningAuthority"]>> {
  const operationId = createPlatformId<RuntimeOperationId>();
  const runId = createPlatformId<SessionRunId>();
  await database
    .prepare(
      `INSERT INTO session (
         id, runtime_provisioning_operation_id, runtime_provisioning_run_id,
         runtime_provisioning_sandbox_id, runtime_provisioning_sandbox_incarnation,
         status
       ) VALUES (?, ?, ?, ?, ?, 'ready')`,
    )
    .bind(SESSION_ID, operationId, runId, RUNTIME_SUBJECT_ID, incarnation)
    .run();
  return { operationId, runId, sessionId: SESSION_ID };
}

async function insertReadySubjectBackup(database: D1Database, incarnation: number): Promise<void> {
  await database
    .prepare(
      `INSERT INTO sandbox_backup (
         created_at, dir, error_message, id, keep, sandbox_id,
         sandbox_incarnation, status, ttl_seconds, updated_at
       ) VALUES (1, '/workspace/memory', NULL, ?, 0, ?, ?, 'ready', 600, 1)`,
    )
    .bind(STORED_BACKUP_ID, RUNTIME_SUBJECT_ID, incarnation)
    .run();
}

async function insertRuntimeConversationSession(
  database: D1Database,
  input: {
    readonly incarnation: number;
    readonly sessionId: string;
    readonly status: "active" | "cleanup_pending" | "closed" | "error";
  },
): Promise<void> {
  await database
    .prepare(
      `INSERT INTO sandbox_session (
         cloudflare_session_id, cleanup_operation_id, created_at, cwd, origin_json,
         sandbox_id, sandbox_incarnation, session_id, status, updated_at
       ) VALUES (?, ?, 1, '/workspace', '{}', ?, ?, ?, ?, 1)`,
    )
    .bind(
      createPlatformId(),
      input.status === "cleanup_pending" ? createPlatformId() : null,
      RUNTIME_SUBJECT_ID,
      input.incarnation,
      input.sessionId,
      input.status,
    )
    .run();
}

async function readRuntimeSubject(database: D1Database): Promise<{
  status: string;
  status_event: string;
  status_seq: number;
  status_source: string;
}> {
  const row = await database
    .prepare(
      `
        SELECT status, status_event, status_seq, status_source
        FROM sandbox
        WHERE id = '${RUNTIME_SUBJECT_ID}'
      `,
    )
    .first<{
      status: string;
      status_event: string;
      status_seq: number;
      status_source: string;
    }>();

  if (!row) {
    throw new Error("Runtime subject test row was not found.");
  }

  return row;
}

function createSandboxHandle(
  options: {
    readonly configureNetworkError?: Error;
    readonly destroyError?: Error;
    readonly destroyPromise?: Promise<void>;
    readonly onConfigureNetwork?: () => void;
    readonly onDispose?: () => void;
    readonly onDestroy?: () => void;
    readonly onExec?: (command: string) => void;
    readonly inspectKind?: "healthy" | "missing" | "retired" | "stale" | "unknown";
    readonly onActivate?: (incarnation: number) => void;
    readonly onReady?: (incarnation: number) => void;
    readonly onRestore?: (backup: { readonly dir: string; readonly id: string }) => void;
    readonly prepareError?: Error;
  } = {},
): SandboxHandle {
  const unavailable = async () => {
    throw new Error("Unexpected sandbox test method call.");
  };

  return {
    [Symbol.dispose]: () => options.onDispose?.(),
    activateRuntimeSubjectIncarnation: async (incarnation: number) => {
      options.onActivate?.(incarnation);
    },
    configureNetworkConstraints: async () => {
      options.onConfigureNetwork?.();
      if (options.configureNetworkError) {
        throw options.configureNetworkError;
      }
    },
    createBackup: unavailable,
    createRuntimeSubjectBackup: unavailable,
    createSession: unavailable,
    deleteSession: unavailable,
    destroy: async () => {
      options.onDestroy?.();

      if (options.destroyError) {
        throw options.destroyError;
      }

      await options.destroyPromise;
    },
    destroyRuntimeSubjectIncarnation: async () => {
      options.onDestroy?.();

      if (options.destroyError) {
        throw options.destroyError;
      }

      await options.destroyPromise;
      return { kind: "destroyed" as const };
    },
    exec: options.onExec
      ? async (command) => {
          options.onExec?.(command);
          return { exitCode: 0, stderr: "", stdout: "", success: true };
        }
      : unavailable,
    getSession: unavailable,
    inspectRuntimeSubjectIncarnation: async () => ({
      kind: options.inspectKind ?? "healthy",
    }),
    markRuntimeSubjectIncarnationReady: async (incarnation: number) => {
      options.onReady?.(incarnation);
    },
    mkdir: async () => {
      if (options.prepareError) {
        throw options.prepareError;
      }
    },
    mountBucket: unavailable,
    readFile: unavailable,
    restoreBackup: options.onRestore
      ? async (backup) => {
          options.onRestore?.(backup);
          return backup;
        }
      : unavailable,
    setKeepAlive: async () => {},
    startProcess: unavailable,
    terminal: unavailable,
    unmountBucket: unavailable,
    watch: unavailable,
    writeFile: unavailable,
    wsConnect: unavailable,
  } as SandboxHandle;
}

function createBindings(
  database: D1Database,
  options: {
    readonly accountConcurrentSandboxLimit?: string;
    readonly configureNetworkError?: Error;
    readonly destroyError?: Error;
    readonly destroyPromise?: Promise<void>;
    readonly inspectKind?: "healthy" | "missing" | "retired" | "stale" | "unknown";
    readonly onActivate?: (incarnation: number) => void;
    readonly onConfigureNetwork?: () => void;
    readonly onDispose?: () => void;
    readonly onDestroy?: () => void;
    readonly onExec?: (command: string) => void;
    readonly onRestore?: (backup: { readonly dir: string; readonly id: string }) => void;
    readonly onReady?: (incarnation: number) => void;
    readonly prepareError?: Error;
  } = {},
): ApiBindings {
  return {
    DB: database,
    MOSOO_ACCOUNT_CONCURRENT_SANDBOX_LIMIT: options.accountConcurrentSandboxLimit ?? "5",
    SANDBOX_FILE_BUCKET_LOCAL: "true",
    runtimeSubjectHandleFactory: () => createSandboxHandle(options),
  } as ApiBindings;
}

describe("runtime subject lifecycle machine", () => {
  test("keeps every subject operation transition explicit", () => {
    const statuses = ["active", "backing_up", "cold", "destroying", "restoring"] as const;
    const accepted = new Set([
      "active->backing_up",
      "active->cold",
      "active->destroying",
      "backing_up->active",
      "backing_up->cold",
      "backing_up->destroying",
      "cold->backing_up",
      "cold->destroying",
      "cold->restoring",
      "destroying->cold",
      "restoring->active",
      "restoring->cold",
      "restoring->destroying",
    ]);

    for (const currentStatus of statuses) {
      for (const targetStatus of statuses) {
        const decision = decideRuntimeSubjectTransition({ currentStatus, targetStatus });
        expect(decision.kind).toBe(
          currentStatus === targetStatus
            ? "duplicate"
            : accepted.has(`${currentStatus}->${targetStatus}`)
              ? "accepted"
              : "rejected",
        );
      }
    }
  });

  test("rejects Pet Limited before lifecycle admission", async () => {
    const database = createRuntimeSubjectLifecycleDatabase();

    await expect(
      createRuntimeSubjectLifecycleService(createBindings(database)).activate({
        ...RUNTIME_SUBJECT_QUOTA_SCOPE,
        kind: "pet",
        networkConstraints: { allowedHosts: ["api.example.com"], networkPolicy: "limited" },
        runtimeSubjectId: RUNTIME_SUBJECT_ID,
        spaceAliases: [],
        subjectId: AGENT_ID,
        subjectKind: "agent",
      }),
    ).rejects.toThrow("only for Task Agents");

    await expect(
      database.prepare("SELECT id FROM sandbox WHERE id = ?").bind(RUNTIME_SUBJECT_ID).first("id"),
    ).resolves.toBeNull();
  });

  test("atomically applies the configured concurrent sandbox limit per account", async () => {
    const database = createRuntimeSubjectLifecycleDatabase();
    const inputs: ActivateRuntimeSubjectInput[] = Array.from({ length: 3 }, () => {
      const sessionId = createPlatformId<SessionId>();

      return {
        agentId: AGENT_ID,
        projectId: PROJECT_ID,
        executionOwnerUserId: ACCOUNT_ID,
        kind: "cattle",
        networkConstraints: { allowedHosts: [], networkPolicy: "full" },
        runtimeSubjectId: createPlatformId<SandboxId>(),
        subjectId: sessionId,
        subjectKind: "session",
      };
    });

    const lifecycle = createRuntimeSubjectLifecycleService(
      createBindings(database, { accountConcurrentSandboxLimit: "2" }),
    );
    const outcomes = await Promise.allSettled(inputs.map((input) => lifecycle.activate(input)));
    const admittedIndex = outcomes.findIndex((outcome) => outcome.status === "fulfilled");

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(2);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
    expect(admittedIndex).toBeGreaterThanOrEqual(0);
    await expect(
      database
        .prepare(
          "SELECT COUNT(*) AS count FROM sandbox WHERE owner_account_id = ? AND status = 'active'",
        )
        .bind(ACCOUNT_ID)
        .first<{ count: number }>(),
    ).resolves.toEqual({ count: 2 });
    await expect(lifecycle.activate(inputs[admittedIndex])).resolves.toBeDefined();

    await expect(
      lifecycle.activate({
        ...inputs[0],
        agentId: createPlatformId(),
        projectId: createPlatformId(),
        runtimeSubjectId: createPlatformId<SandboxId>(),
        subjectId: createPlatformId<SessionId>(),
      }),
    ).rejects.toThrow();

    await expect(
      lifecycle.activate({
        ...inputs[0],
        executionOwnerUserId: createPlatformId(),
        runtimeSubjectId: createPlatformId<SandboxId>(),
        subjectId: createPlatformId<SessionId>(),
      }),
    ).resolves.toBeDefined();
  });

  test("rejects an invalid concurrent sandbox limit", () => {
    expect(() =>
      createRuntimeSubjectLifecycleService(
        createBindings(createRuntimeSubjectLifecycleDatabase(), {
          accountConcurrentSandboxLimit: "0",
        }),
      ),
    ).toThrow("MOSOO_ACCOUNT_CONCURRENT_SANDBOX_LIMIT must be a positive integer.");
  });

  test("records operation transitions with monotonic status metadata", async () => {
    const database = createRuntimeSubjectLifecycleDatabase();
    await insertRuntimeSubject(database, { status: "active" });

    const lease = await markRuntimeSubjectOperationStarted(database, {
      claimExpiresAt: 60_010,
      claimOwner: "operation-test",
      now: 10,
      operationId: createPlatformId(),
      operationKind: "hibernate",
      runtimeSubjectId: "01J0000000000000000000000D",
    });
    expect(lease).not.toBeNull();
    if (lease === null) {
      throw new Error("Runtime subject operation lease was not created.");
    }
    await expect(
      advanceRuntimeSubjectOperationStatus(database, {
        expectedStatus: "backing_up",
        lease,
        runtimeSubjectId: "01J0000000000000000000000D",
        status: "destroying",
      }),
    ).resolves.toBe(true);
    await markRuntimeSubjectCold(database, {
      clearBackups: false,
      expectedStatus: "destroying",
      lease: { ...lease, status: "destroying" },
      runtimeSubjectId: "01J0000000000000000000000D",
    });

    await expect(readRuntimeSubject(database)).resolves.toEqual({
      status: "cold",
      status_event: "runtime_subject.cold",
      status_seq: 3,
      status_source: "api",
    });
  });

  test("does not let a stale operation completion mutate a newer incarnation", async () => {
    const database = createRuntimeSubjectLifecycleDatabase();
    await insertRuntimeSubject(database, { incarnation: 1, status: "active", statusSeq: 7 });
    await insertRuntimeConversationSession(database, {
      incarnation: 1,
      sessionId: SESSION_ID,
      status: "active",
    });
    await database
      .prepare("INSERT INTO native_resume_ref (session_id) VALUES (?)")
      .bind(SESSION_ID)
      .run();
    const operationId = createPlatformId<RuntimeOperationId>();
    const firstLease = await markRuntimeSubjectOperationStarted(database, {
      claimExpiresAt: 10,
      claimOwner: "first-worker",
      now: 1,
      operationId,
      operationKind: "reset",
      runtimeSubjectId: RUNTIME_SUBJECT_ID,
    });
    expect(firstLease).not.toBeNull();
    if (firstLease === null) {
      throw new Error("The first operation lease was not created.");
    }
    await expect(
      advanceRuntimeSubjectOperationStatus(database, {
        expectedStatus: "backing_up",
        lease: firstLease,
        runtimeSubjectId: RUNTIME_SUBJECT_ID,
        status: "destroying",
      }),
    ).resolves.toBe(true);
    const firstDestroyingLease = { ...firstLease, status: "destroying" as const };
    const batchEntered = Promise.withResolvers<void>();
    const releaseFirstWorker = Promise.withResolvers<void>();
    const gatedDatabase = {
      batch: async <T = unknown>(statements: D1PreparedStatement[]) => {
        batchEntered.resolve();
        await releaseFirstWorker.promise;
        return database.batch<T>(statements);
      },
      prepare: (query: string) => database.prepare(query),
    } as D1Database;

    const staleCompletion = markRuntimeSubjectCold(gatedDatabase, {
      clearBackups: false,
      clearNativeResumeRefs: true,
      expectedStatus: "destroying",
      lease: firstDestroyingLease,
      runtimeSubjectId: RUNTIME_SUBJECT_ID,
    });
    await batchEntered.promise;

    const takeoverLease = await claimRuntimeSubjectOperationForRepair(database, {
      candidate: {
        claimExpiresAt: 10,
        claimOwner: "first-worker",
        id: RUNTIME_SUBJECT_ID,
        incarnation: 1,
        kind: "cattle",
        operationId,
        operationKind: "reset",
        status: "destroying",
      },
      claimExpiresAt: 100,
      claimOwner: "takeover-worker",
      now: 11,
    });
    expect(takeoverLease).not.toBeNull();
    if (takeoverLease === null) {
      throw new Error("The takeover operation lease was not created.");
    }
    await expect(
      markRuntimeSubjectCold(database, {
        clearBackups: false,
        clearNativeResumeRefs: true,
        expectedStatus: "destroying",
        lease: takeoverLease,
        runtimeSubjectId: RUNTIME_SUBJECT_ID,
      }),
    ).resolves.toBe(true);
    await database
      .prepare(
        `UPDATE sandbox
            SET incarnation = 2, status = 'active', status_event = 'runtime_subject.active',
                status_seq = status_seq + 1, status_source = 'test', updated_at = 12
          WHERE id = ?`,
      )
      .bind(RUNTIME_SUBJECT_ID)
      .run();
    await database
      .prepare(
        `UPDATE sandbox_session
            SET sandbox_incarnation = 2, status = 'active', updated_at = 12
          WHERE session_id = ?`,
      )
      .bind(SESSION_ID)
      .run();
    await database
      .prepare("INSERT INTO native_resume_ref (session_id) VALUES (?)")
      .bind(SESSION_ID)
      .run();
    releaseFirstWorker.resolve();

    await expect(staleCompletion).resolves.toBe(false);

    await expect(readRuntimeSubject(database)).resolves.toEqual({
      status: "active",
      status_event: "runtime_subject.active",
      status_seq: 11,
      status_source: "test",
    });
    await expect(
      database
        .prepare("SELECT sandbox_incarnation, status FROM sandbox_session WHERE session_id = ?")
        .bind(SESSION_ID)
        .first(),
    ).resolves.toEqual({ sandbox_incarnation: 2, status: "active" });
    await expect(
      database
        .prepare("SELECT session_id FROM native_resume_ref WHERE session_id = ?")
        .bind(SESSION_ID)
        .first("session_id"),
    ).resolves.toBe(SESSION_ID);
  });

  test("lets interactive activation preempt best-effort prewarm activation claims", async () => {
    const database = createRuntimeSubjectLifecycleDatabase();
    await insertRuntimeSubject(database, { status: "cold" });
    await database
      .prepare(
        `
          UPDATE sandbox
          SET claim_owner = ?, claim_expires_at = ?
          WHERE id = ?
        `,
      )
      .bind("prewarm-activation-stalled", Date.now() + 60_000, RUNTIME_SUBJECT_ID)
      .run();

    const activation = await createRuntimeSubjectLifecycleService(
      createBindings(database),
    ).activate({
      ...RUNTIME_SUBJECT_QUOTA_SCOPE,
      kind: "cattle",
      networkConstraints: { allowedHosts: [], networkPolicy: "full" },
      runtimeSubjectId: RUNTIME_SUBJECT_ID,
      spaceAliases: [],
      subjectId: SESSION_ID,
      subjectKind: "session",
    });

    expect(activation.subject).toBeTruthy();
    const row = await database
      .prepare(
        `
          SELECT claim_expires_at, claim_owner, status
          FROM sandbox
          WHERE id = ?
        `,
      )
      .bind(RUNTIME_SUBJECT_ID)
      .first<{
        claim_expires_at: number | null;
        claim_owner: string | null;
        status: string;
      }>();

    expect(row).toEqual({
      claim_expires_at: null,
      claim_owner: null,
      status: "active",
    });
  });

  test("does not let prewarm retire an idle or shared Pet with a legacy network identity", async () => {
    for (const hasActiveRun of [false, true]) {
      const database = createRuntimeSubjectLifecycleDatabase();
      await insertRuntimeSubject(database, { incarnation: 4, kind: "pet", status: "active" });
      await database
        .prepare("UPDATE sandbox SET network_constraints_hash = NULL WHERE id = ?")
        .bind(RUNTIME_SUBJECT_ID)
        .run();
      if (hasActiveRun) {
        const driverInstanceId = createPlatformId();
        await database
          .prepare(
            `INSERT INTO driver_instance (
               id, sandbox_id, sandbox_incarnation, sandbox_session_id, status
             ) VALUES (?, ?, 4, ?, 'ready')`,
          )
          .bind(driverInstanceId, RUNTIME_SUBJECT_ID, SESSION_ID)
          .run();
        await database
          .prepare(
            `INSERT INTO session_run (agent_id, driver_instance_id, id, session_id, status)
             VALUES (?, ?, ?, ?, 'running')`,
          )
          .bind(AGENT_ID, driverInstanceId, createPlatformId(), SESSION_ID)
          .run();
      }
      let destroyCalls = 0;

      await expect(
        createRuntimeSubjectLifecycleService(
          createBindings(database, {
            onDestroy: () => {
              destroyCalls++;
            },
          }),
        ).activate({
          ...RUNTIME_SUBJECT_QUOTA_SCOPE,
          kind: "pet",
          networkConstraints: { allowedHosts: [], networkPolicy: "full" },
          purpose: "prewarm",
          runtimeSubjectId: RUNTIME_SUBJECT_ID,
          subjectId: AGENT_ID,
          subjectKind: "agent",
        }),
      ).rejects.toThrow("network retirement");

      expect(destroyCalls).toBe(0);
      await expect(
        database
          .prepare(
            `SELECT claim_owner, incarnation, operation_kind, status, status_operation_id
             FROM sandbox WHERE id = ?`,
          )
          .bind(RUNTIME_SUBJECT_ID)
          .first(),
      ).resolves.toEqual({
        claim_owner: null,
        incarnation: 4,
        operation_kind: null,
        status: "active",
        status_operation_id: null,
      });
    }
  });

  test("captures one sandbox creation when a cold subject becomes active", async () => {
    const database = createRuntimeSubjectLifecycleDatabase();
    await insertRuntimeSubject(database, { status: "cold" });
    const capturedEvents: unknown[] = [];
    setServerProductAnalyticsTransportForTests(async (_input, init) => {
      capturedEvents.push(JSON.parse(init.body as string) as unknown);
      return new Response(null, { status: 200 });
    });
    const bindings = {
      ...createBindings(database),
      POSTHOG_PROJECT_KEY: "phc_test",
    } as ApiBindings;
    const service = createRuntimeSubjectLifecycleService(bindings);
    const activation = {
      ...RUNTIME_SUBJECT_QUOTA_SCOPE,
      kind: "cattle" as const,
      networkConstraints: { allowedHosts: [], networkPolicy: "full" as const },
      runtimeSubjectId: RUNTIME_SUBJECT_ID,
      spaceAliases: [],
      subjectId: "01J00000000000000000000009",
      subjectKind: "session" as const,
    };

    await service.activate(activation);
    await service.activate(activation);

    expect(capturedEvents).toHaveLength(1);
    expect(capturedEvents[0]).toMatchObject({
      event: "sandbox_created",
      properties: {
        activation_purpose: "interactive",
        distinct_id: activation.executionOwnerUserId,
        execution_owner_id: activation.executionOwnerUserId,
        sandbox_id: RUNTIME_SUBJECT_ID,
        sandbox_kind: "cattle",
        session_id: activation.subjectId,
        subject_id: activation.subjectId,
        subject_kind: "session",
      },
    });
  });

  test("releases maintenance claim after a Run wins the post-claim race", async () => {
    const database = createRuntimeSubjectLifecycleDatabase();
    await insertRuntimeSubject(database, { status: "active" });
    await database
      .prepare("UPDATE sandbox SET kind = ?, subject_id = ?, subject_kind = ? WHERE id = ?")
      .bind("pet", "01J00000000000000000000001", "agent", RUNTIME_SUBJECT_ID)
      .run();
    await database
      .prepare("UPDATE sandbox SET claim_owner = ?, claim_expires_at = ? WHERE id = ?")
      .bind("scheduled-race", Date.now() + 60_000, RUNTIME_SUBJECT_ID)
      .run();
    await database
      .prepare(
        `INSERT INTO session_run (agent_id, driver_instance_id, id, session_id, status)
         VALUES (?, NULL, ?, ?, 'queued')`,
      )
      .bind(
        "01J00000000000000000000001",
        "01J0000000000000000000000E",
        "01J00000000000000000000009",
      )
      .run();

    await expect(
      recycleRuntimeSubject(createBindings(database), {
        claimOwner: "scheduled-race",
        kind: "pet",
        now: Date.now(),
        reason: "test",
        runtimeSubjectId: RUNTIME_SUBJECT_ID,
      }),
    ).resolves.toBe(false);
    await expect(readRuntimeSubject(database)).resolves.toMatchObject({ status: "active" });
    await expect(
      database
        .prepare("SELECT claim_owner FROM sandbox WHERE id = ?")
        .bind(RUNTIME_SUBJECT_ID)
        .first("claim_owner"),
    ).resolves.toBeNull();
  });

  test("restores pet memory when the same logical subject activates from cold", async () => {
    const database = createRuntimeSubjectLifecycleDatabase();
    await insertRuntimeSubject(database, { status: "cold" });
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
        1,
        "/workspace/memory",
        null,
        STORED_BACKUP_ID,
        false,
        RUNTIME_SUBJECT_ID,
        "ready",
        600,
        1,
      )
      .run();
    await database
      .prepare(
        "UPDATE sandbox SET kind = ?, last_backup_id = ?, subject_id = ?, subject_kind = ? WHERE id = ?",
      )
      .bind("pet", STORED_BACKUP_ID, AGENT_ID, "agent", RUNTIME_SUBJECT_ID)
      .run();
    let restoredBackup: { readonly dir: string; readonly id: string } | null = null;
    let configureNetworkCalls = 0;

    const activation = await createRuntimeSubjectLifecycleService(
      createBindings(database, {
        onRestore: (backup) => {
          restoredBackup = backup;
        },
        onConfigureNetwork: () => {
          configureNetworkCalls += 1;
        },
      }),
    ).activate({
      ...RUNTIME_SUBJECT_QUOTA_SCOPE,
      kind: "pet",
      networkConstraints: { allowedHosts: [], networkPolicy: "full" },
      runtimeSubjectId: RUNTIME_SUBJECT_ID,
      spaceAliases: [],
      subjectId: AGENT_ID,
      subjectKind: "agent",
    });

    expect(activation.subject).toBeTruthy();
    expect(configureNetworkCalls).toBe(0);
    expect(restoredBackup).toEqual({
      dir: "/workspace/memory",
      id: CLOUDFLARE_BACKUP_ID,
    });
    expect((await readRuntimeSubject(database)).status).toBe("active");
  });

  test("converges a lost recreate to cold while preserving the last ready backup", async () => {
    const database = createRuntimeSubjectLifecycleDatabase();
    await insertRuntimeSubject(database, {
      incarnation: 1,
      kind: "pet",
      lastBackupId: STORED_BACKUP_ID,
      status: "active",
    });
    let destroyCalls = 0;

    await expect(
      recreateRuntimeSubjectPreservingState(
        createBindings(database, {
          inspectKind: "missing",
          onDestroy: () => {
            destroyCalls++;
          },
        }),
        {
          operationId: createPlatformId<RuntimeOperationId>(),
          reason: "test missing recreate",
          runtimeSubjectId: RUNTIME_SUBJECT_ID,
          targets: [],
        },
      ),
    ).rejects.toMatchObject({ name: "RuntimeSubjectPhysicalStateLostError" });

    expect(destroyCalls).toBe(1);
    await expect(
      database
        .prepare(
          `SELECT status, status_operation_id, claim_owner, last_backup_id,
                  last_error_code
           FROM sandbox WHERE id = ?`,
        )
        .bind(RUNTIME_SUBJECT_ID)
        .first(),
    ).resolves.toEqual({
      claim_owner: null,
      last_backup_id: STORED_BACKUP_ID,
      last_error_code: "runtime.subject_operation_failed",
      status: "cold",
      status_operation_id: null,
    });
  });

  test("retries a lost cold reset on a new incarnation and clears the old subject backup", async () => {
    const database = createRuntimeSubjectLifecycleDatabase();
    await insertReadySubjectBackup(database, 1);
    await insertRuntimeSubject(database, {
      incarnation: 1,
      kind: "pet",
      lastBackupId: STORED_BACKUP_ID,
      status: "active",
    });
    const restoredBackups: Array<{ readonly dir: string; readonly id: string }> = [];
    const clearCommands: string[] = [];
    const bindings = createBindings(database);
    bindings.runtimeSubjectHandleFactory = (physicalId) =>
      createSandboxHandle({
        inspectKind: physicalId === `${RUNTIME_SUBJECT_ID}-i1` ? "missing" : "healthy",
        onExec: (command) => {
          clearCommands.push(command);
        },
        onRestore: (backup) => {
          restoredBackups.push(backup);
        },
      });

    await expect(
      resetRuntimeSubjectAgentState(bindings, {
        operationId: createPlatformId<RuntimeOperationId>(),
        reason: "test missing reset",
        runtimeSubjectId: RUNTIME_SUBJECT_ID,
        targets: [],
      }),
    ).rejects.toMatchObject({ name: "RuntimeSubjectPhysicalStateLostError" });
    await expect(
      database
        .prepare("SELECT status, last_backup_id FROM sandbox WHERE id = ?")
        .bind(RUNTIME_SUBJECT_ID)
        .first(),
    ).resolves.toEqual({ last_backup_id: STORED_BACKUP_ID, status: "cold" });

    await expect(
      resetRuntimeSubjectAgentState(bindings, {
        operationId: createPlatformId<RuntimeOperationId>(),
        reason: "retry missing reset",
        runtimeSubjectId: RUNTIME_SUBJECT_ID,
        targets: [],
      }),
    ).resolves.toBeUndefined();

    expect(restoredBackups).toEqual([{ dir: "/workspace/memory", id: CLOUDFLARE_BACKUP_ID }]);
    expect(clearCommands).toHaveLength(1);
    await expect(
      database
        .prepare(
          `SELECT incarnation, status, last_backup_id, last_restore_backup_id,
                  last_error, last_error_code
           FROM sandbox WHERE id = ?`,
        )
        .bind(RUNTIME_SUBJECT_ID)
        .first(),
    ).resolves.toEqual({
      incarnation: 2,
      last_backup_id: null,
      last_error: null,
      last_error_code: null,
      last_restore_backup_id: null,
      status: "cold",
    });
  });

  test("lets interactive activation retry after a prior activation failure", async () => {
    const database = createRuntimeSubjectLifecycleDatabase();
    // A prior activation failure leaves the subject cold (no live container)
    // with the diagnostic retained in lastError. Re-activation is a normal
    // cold start that recovers it and clears the stale diagnostic.
    await insertRuntimeSubject(database, {
      lastError: "Runtime subject filesystem prepare timed out after 15000ms.",
      lastErrorCode: "runtime.subject_activation_failed",
      status: "cold",
      statusSeq: 7,
    });

    const activation = await createRuntimeSubjectLifecycleService(
      createBindings(database),
    ).activate({
      ...RUNTIME_SUBJECT_QUOTA_SCOPE,
      kind: "cattle",
      networkConstraints: { allowedHosts: [], networkPolicy: "full" },
      runtimeSubjectId: RUNTIME_SUBJECT_ID,
      spaceAliases: [],
      subjectId: SESSION_ID,
      subjectKind: "session",
    });

    expect(activation.subject).toBeTruthy();
    const row = await database
      .prepare(
        `
          SELECT claim_expires_at, claim_owner, last_error, last_error_code, status,
                 status_operation_id
          FROM sandbox
          WHERE id = ?
        `,
      )
      .bind(RUNTIME_SUBJECT_ID)
      .first<{
        claim_expires_at: number | null;
        claim_owner: string | null;
        last_error: string | null;
        last_error_code: string | null;
        status: string;
        status_operation_id: string | null;
      }>();

    expect(row).toEqual({
      claim_expires_at: null,
      claim_owner: null,
      last_error: null,
      last_error_code: null,
      status: "active",
      status_operation_id: null,
    });
  });

  test("clears activation claim when filesystem preparation fails", async () => {
    const database = createRuntimeSubjectLifecycleDatabase();
    const prepareError = new Error("Runtime subject filesystem prepare timed out after 15000ms.");

    await expect(
      createRuntimeSubjectLifecycleService(createBindings(database, { prepareError })).activate({
        ...RUNTIME_SUBJECT_QUOTA_SCOPE,
        kind: "cattle",
        networkConstraints: { allowedHosts: [], networkPolicy: "full" },
        runtimeSubjectId: RUNTIME_SUBJECT_ID,
        spaceAliases: [],
        subjectId: SESSION_ID,
        subjectKind: "session",
      }),
    ).rejects.toThrow("Runtime subject filesystem prepare timed out after 15000ms.");

    const row = await database
      .prepare(
        `
          SELECT claim_expires_at, claim_owner, last_error, last_error_code, status,
                 status_operation_id
          FROM sandbox
          WHERE id = ?
        `,
      )
      .bind(RUNTIME_SUBJECT_ID)
      .first<{
        claim_expires_at: number | null;
        claim_owner: string | null;
        last_error: string | null;
        last_error_code: string | null;
        status: string;
        status_operation_id: string | null;
      }>();

    expect(row).toEqual({
      claim_expires_at: null,
      claim_owner: null,
      last_error: "Runtime subject filesystem prepare timed out after 15000ms.",
      last_error_code: "runtime.subject_activation_failed",
      status: "cold",
      status_operation_id: null,
    });
  });

  test("keeps activation failure destroying with an operation id when teardown fails", async () => {
    const database = createRuntimeSubjectLifecycleDatabase();
    const prepareError = new Error("original activation failure");

    await expect(
      createRuntimeSubjectLifecycleService(
        createBindings(database, {
          destroyError: new Error("container destroy failed"),
          prepareError,
        }),
      ).activate({
        ...RUNTIME_SUBJECT_QUOTA_SCOPE,
        kind: "cattle",
        networkConstraints: { allowedHosts: [], networkPolicy: "full" },
        runtimeSubjectId: RUNTIME_SUBJECT_ID,
        spaceAliases: [],
        subjectId: SESSION_ID,
        subjectKind: "session",
      }),
    ).rejects.toThrow("original activation failure");

    const row = await database
      .prepare(
        `
          SELECT last_error, last_error_code, status, status_operation_id
          FROM sandbox
          WHERE id = ?
        `,
      )
      .bind(RUNTIME_SUBJECT_ID)
      .first<{
        last_error: string | null;
        last_error_code: string | null;
        status: string;
        status_operation_id: string | null;
      }>();

    expect(row).toMatchObject({
      last_error: "original activation failure",
      last_error_code: "runtime.subject_activation_failed",
      status: "destroying",
    });
    expect(row?.status_operation_id).toMatch(/^01/);
  });

  test("bounds teardown with the runtime provision timeout", async () => {
    const database = createRuntimeSubjectLifecycleDatabase();
    const destroyPromise = new Promise<void>(() => {});

    await expect(
      destroyRuntimeSubjectContainer(
        createBindings(database, { destroyPromise }),
        RUNTIME_SUBJECT_ID,
        5,
        5,
      ),
    ).rejects.toThrow("Runtime subject destroy");
  });

  test("fails activation and destroys the container when network constraints cannot apply", async () => {
    const database = createRuntimeSubjectLifecycleDatabase();
    await insertRuntimeSubject(database, { status: "cold", statusSeq: 0 });
    const configureNetworkError = new Error(
      "Environment network policy 'limited' cannot be enforced here: sandbox HTTPS interception is disabled.",
    );
    let destroyCalls = 0;

    await expect(
      createRuntimeSubjectLifecycleService(
        createBindings(database, {
          configureNetworkError,
          onDestroy: () => (destroyCalls += 1),
        }),
      ).activate({
        ...RUNTIME_SUBJECT_QUOTA_SCOPE,
        kind: "cattle",
        networkConstraints: { allowedHosts: [], networkPolicy: "limited" },
        runtimeSubjectId: RUNTIME_SUBJECT_ID,
        spaceAliases: [],
        subjectId: SESSION_ID,
        subjectKind: "session",
      }),
    ).rejects.toThrow("cannot be enforced");

    expect(destroyCalls).toBe(1);
    expect((await readRuntimeSubject(database)).status).toBe("cold");
  });

  test("destroys the container on activation failure so it cannot be reused", async () => {
    const database = createRuntimeSubjectLifecycleDatabase();
    await insertRuntimeSubject(database, { status: "cold", statusSeq: 0 });
    const prepareError = new Error("Runtime subject filesystem prepare timed out after 15000ms.");
    let destroyCalls = 0;

    // First activation fails at prepareFilesystem. The broken container must be
    // destroyed and the subject returned to cold — never left in a reclaimable
    // "failed" state that would hand the next run the same dead container. This
    // is the production death loop (sandbox 01KYC1ZB…): reproduce it and prove
    // it converges instead of looping.
    await expect(
      createRuntimeSubjectLifecycleService(
        createBindings(database, { onDestroy: () => (destroyCalls += 1), prepareError }),
      ).activate({
        ...RUNTIME_SUBJECT_QUOTA_SCOPE,
        kind: "cattle",
        networkConstraints: { allowedHosts: [], networkPolicy: "full" },
        runtimeSubjectId: RUNTIME_SUBJECT_ID,
        spaceAliases: [],
        subjectId: SESSION_ID,
        subjectKind: "session",
      }),
    ).rejects.toThrow("filesystem prepare timed out");

    expect(destroyCalls).toBe(1);
    expect((await readRuntimeSubject(database)).status).toBe("cold");

    // Second activation on the now-cold subject succeeds — self-healed, no
    // manual recreate needed.
    const recovered = await createRuntimeSubjectLifecycleService(createBindings(database)).activate(
      {
        ...RUNTIME_SUBJECT_QUOTA_SCOPE,
        kind: "cattle",
        networkConstraints: { allowedHosts: [], networkPolicy: "full" },
        runtimeSubjectId: RUNTIME_SUBJECT_ID,
        spaceAliases: [],
        subjectId: SESSION_ID,
        subjectKind: "session",
      },
    );

    expect(recovered.subject).toBeTruthy();
    expect((await readRuntimeSubject(database)).status).toBe("active");
  });

  test("disposes an activation handle that fails before it can be returned", async () => {
    const database = createRuntimeSubjectLifecycleDatabase();
    await insertRuntimeSubject(database, { status: "cold" });
    const bindings = createBindings(database);
    let createdHandles = 0;
    let activationHandleDisposals = 0;
    bindings.runtimeSubjectHandleFactory = () => {
      const isActivationHandle = createdHandles++ === 0;
      return createSandboxHandle(
        isActivationHandle
          ? {
              onDispose: () => (activationHandleDisposals += 1),
              prepareError: new Error("injected prepare failure"),
            }
          : {},
      );
    };

    await expect(
      createRuntimeSubjectLifecycleService(bindings).activate({
        ...RUNTIME_SUBJECT_QUOTA_SCOPE,
        kind: "cattle",
        networkConstraints: { allowedHosts: [], networkPolicy: "full" },
        runtimeSubjectId: RUNTIME_SUBJECT_ID,
        subjectId: SESSION_ID,
        subjectKind: "session",
      }),
    ).rejects.toThrow("injected prepare failure");

    expect(activationHandleDisposals).toBe(1);
  });

  test("routes each incarnation to one physical sandbox id", async () => {
    const physicalIds: string[] = [];
    const bindings = createBindings(createRuntimeSubjectLifecycleDatabase());
    bindings.runtimeSubjectHandleFactory = (physicalId) => {
      physicalIds.push(physicalId);
      return createSandboxHandle();
    };

    await getRuntimeSubjectKeepAliveHandle(bindings, RUNTIME_SUBJECT_ID, 0);
    await getRuntimeSubjectKeepAliveHandle(bindings, RUNTIME_SUBJECT_ID, 36);

    expect(physicalIds).toEqual([RUNTIME_SUBJECT_ID, `${RUNTIME_SUBJECT_ID}-i10`]);
  });

  test("recovers a missing active runtime into a new physical incarnation", async () => {
    const database = createRuntimeSubjectLifecycleDatabase();
    await insertRuntimeSubject(database, { status: "active" });
    await insertRuntimeConversationSession(database, {
      incarnation: 4,
      sessionId: SESSION_ID,
      status: "active",
    });
    await insertRuntimeConversationSession(database, {
      incarnation: 4,
      sessionId: "01J0000000000000000000000A",
      status: "cleanup_pending",
    });
    await database
      .prepare(
        `INSERT INTO sandbox_backup (
           created_at, dir, error_message, id, keep, sandbox_id, sandbox_incarnation,
           status, ttl_seconds, updated_at
         ) VALUES (?, ?, NULL, ?, false, ?, ?, 'ready', 600, ?)`,
      )
      .bind(1, "/workspace/memory", STORED_BACKUP_ID, RUNTIME_SUBJECT_ID, 4, 1)
      .run();
    await database
      .prepare(
        `UPDATE sandbox
         SET incarnation = 4, kind = 'pet', last_backup_id = ?, subject_id = ?, subject_kind = 'agent'
         WHERE id = ?`,
      )
      .bind(STORED_BACKUP_ID, AGENT_ID, RUNTIME_SUBJECT_ID)
      .run();
    const provisioningAuthority = await insertRuntimeProvisioningAuthority(database, 4);

    let releaseOldMutation: (() => void) | undefined;
    let oldRetired = false;
    const oldMutationBarrier = new Promise<void>((resolve) => {
      releaseOldMutation = resolve;
    });
    const oldHandle = {
      ...createSandboxHandle({ inspectKind: "missing" }),
      destroyRuntimeSubjectIncarnation: async () => {
        oldRetired = true;
        return { kind: "destroyed" as const };
      },
      exec: async () => {
        await oldMutationBarrier;
        if (oldRetired) {
          throw new Error("Runtime subject incarnation is retired.");
        }
        return { exitCode: 0, stderr: "", stdout: "", success: true };
      },
    } as SandboxHandle;
    let restored = false;
    let readyIncarnation: number | null = null;
    const newHandle = createSandboxHandle({
      onReady: (incarnation) => {
        readyIncarnation = incarnation;
      },
      onRestore: () => {
        restored = true;
      },
    });
    const physicalIds: string[] = [];
    const bindings = createBindings(database);
    bindings.runtimeSubjectHandleFactory = (physicalId) => {
      physicalIds.push(physicalId);
      return physicalId === `${RUNTIME_SUBJECT_ID}-i4` ? oldHandle : newHandle;
    };

    const staleMutation = oldHandle.exec("stale-write");
    const lifecycle = createRuntimeSubjectLifecycleService(bindings);
    const activationInput = {
      ...RUNTIME_SUBJECT_QUOTA_SCOPE,
      kind: "pet" as const,
      networkConstraints: { allowedHosts: [], networkPolicy: "full" as const },
      provisioningAuthority,
      runtimeSubjectId: RUNTIME_SUBJECT_ID,
      subjectId: AGENT_ID,
      subjectKind: "agent" as const,
    };

    await expect(lifecycle.activate(activationInput)).rejects.toThrow("retired");
    const activation = await lifecycle.activate(activationInput);

    releaseOldMutation?.();
    await expect(staleMutation).rejects.toThrow("retired");
    expect(activation.incarnation).toBe(5);
    expect(restored).toBe(true);
    expect(readyIncarnation).toBe(5);
    expect(physicalIds).toContain(`${RUNTIME_SUBJECT_ID}-i4`);
    expect(physicalIds).toContain(`${RUNTIME_SUBJECT_ID}-i5`);
    await expect(
      database
        .prepare("SELECT incarnation, status FROM sandbox WHERE id = ?")
        .bind(RUNTIME_SUBJECT_ID)
        .first(),
    ).resolves.toEqual({ incarnation: 5, status: "active" });
    await expect(
      database
        .prepare("SELECT sandbox_incarnation, status FROM sandbox_session WHERE session_id = ?")
        .bind(SESSION_ID)
        .first(),
    ).resolves.toEqual({ sandbox_incarnation: 4, status: "closed" });
    await expect(
      database
        .prepare(
          "SELECT cleanup_operation_id, sandbox_incarnation, status FROM sandbox_session WHERE session_id = ?",
        )
        .bind("01J0000000000000000000000A")
        .first(),
    ).resolves.toEqual({ cleanup_operation_id: null, sandbox_incarnation: 4, status: "closed" });
  });

  test("retires an ambiguously timed-out restoring incarnation before retry", async () => {
    const database = createRuntimeSubjectLifecycleDatabase();
    await insertRuntimeSubject(database, { incarnation: 3, kind: "pet", status: "cold" });

    let releaseOldMutation: (() => void) | undefined;
    let oldRetired = false;
    const oldMutationBarrier = new Promise<void>((resolve) => {
      releaseOldMutation = resolve;
    });
    const oldHandle = {
      ...createSandboxHandle({
        inspectKind: "healthy",
        prepareError: createTimeoutError({
          label: "Runtime subject filesystem prepare",
          timeoutMs: 15_000,
        }),
      }),
      destroyRuntimeSubjectIncarnation: async () => {
        oldRetired = true;
        return { kind: "destroyed" as const };
      },
      exec: async () => {
        await oldMutationBarrier;
        if (oldRetired) {
          throw new Error("Runtime subject incarnation is retired.");
        }
        return { exitCode: 0, stderr: "", stdout: "late", success: true };
      },
    } as SandboxHandle;
    const newHandle = createSandboxHandle();
    const bindings = createBindings(database);
    bindings.runtimeSubjectHandleFactory = (physicalId) =>
      physicalId === `${RUNTIME_SUBJECT_ID}-i4` ? oldHandle : newHandle;
    const lifecycle = createRuntimeSubjectLifecycleService(bindings);
    const activationInput = {
      ...RUNTIME_SUBJECT_QUOTA_SCOPE,
      kind: "pet" as const,
      networkConstraints: { allowedHosts: [], networkPolicy: "full" as const },
      runtimeSubjectId: RUNTIME_SUBJECT_ID,
      subjectId: AGENT_ID,
      subjectKind: "agent" as const,
    };

    const staleMutation = oldHandle.exec("late-write");
    await expect(lifecycle.activate(activationInput)).rejects.toThrow("timed out");
    await expect(
      database
        .prepare("SELECT incarnation, status FROM sandbox WHERE id = ?")
        .bind(RUNTIME_SUBJECT_ID)
        .first(),
    ).resolves.toEqual({ incarnation: 4, status: "cold" });

    const recovered = await lifecycle.activate(activationInput);
    releaseOldMutation?.();
    await expect(staleMutation).rejects.toThrow("retired");
    expect(recovered.incarnation).toBe(5);
  });

  test("keeps an active incarnation on an unknown health result", async () => {
    const database = createRuntimeSubjectLifecycleDatabase();
    await insertRuntimeSubject(database, { status: "active" });
    await database
      .prepare("UPDATE sandbox SET incarnation = 4 WHERE id = ?")
      .bind(RUNTIME_SUBJECT_ID)
      .run();
    let destroyCalls = 0;
    let disposeCalls = 0;

    await expect(
      createRuntimeSubjectLifecycleService(
        createBindings(database, {
          inspectKind: "unknown",
          onDestroy: () => (destroyCalls += 1),
          onDispose: () => (disposeCalls += 1),
        }),
      ).activate({
        ...RUNTIME_SUBJECT_QUOTA_SCOPE,
        kind: "cattle",
        networkConstraints: { allowedHosts: [], networkPolicy: "full" },
        runtimeSubjectId: RUNTIME_SUBJECT_ID,
        subjectId: SESSION_ID,
        subjectKind: "session",
      }),
    ).rejects.toThrow("health is unknown");

    expect(destroyCalls).toBe(0);
    expect(disposeCalls).toBe(1);
    await expect(
      database
        .prepare("SELECT claim_owner, incarnation, status FROM sandbox WHERE id = ?")
        .bind(RUNTIME_SUBJECT_ID)
        .first(),
    ).resolves.toEqual({ claim_owner: null, incarnation: 4, status: "active" });
  });

  test("retires a cattle conversation after its missing incarnation is destroyed", async () => {
    const database = createRuntimeSubjectLifecycleDatabase();
    await insertRuntimeSubject(database, { status: "active" });
    await database
      .prepare("UPDATE sandbox SET incarnation = 4 WHERE id = ?")
      .bind(RUNTIME_SUBJECT_ID)
      .run();
    await insertRuntimeConversationSession(database, {
      incarnation: 4,
      sessionId: SESSION_ID,
      status: "error",
    });
    const provisioningAuthority = await insertRuntimeProvisioningAuthority(database, 4);
    const bindings = createBindings(database, { inspectKind: "missing" });

    const lifecycle = createRuntimeSubjectLifecycleService(bindings);
    const activationInput = {
      ...RUNTIME_SUBJECT_QUOTA_SCOPE,
      kind: "cattle" as const,
      networkConstraints: { allowedHosts: [], networkPolicy: "full" as const },
      provisioningAuthority,
      runtimeSubjectId: RUNTIME_SUBJECT_ID,
      subjectId: SESSION_ID,
      subjectKind: "session" as const,
    };

    await expect(lifecycle.activate(activationInput)).rejects.toThrow("retired");
    const activation = await lifecycle.activate(activationInput);

    expect(activation.incarnation).toBe(5);
    await expect(
      database
        .prepare("SELECT sandbox_incarnation, status FROM sandbox_session WHERE session_id = ?")
        .bind(SESSION_ID)
        .first(),
    ).resolves.toEqual({ sandbox_incarnation: 4, status: "closed" });
  });

  test("repairs active-incarnation retirement without closing a newer conversation", async () => {
    const database = createRuntimeSubjectLifecycleDatabase();
    await insertRuntimeSubject(database, { status: "active" });
    await insertRuntimeConversationSession(database, {
      incarnation: 4,
      sessionId: SESSION_ID,
      status: "active",
    });
    await insertRuntimeConversationSession(database, {
      incarnation: 4,
      sessionId: "01J00000000000000000000008",
      status: "cleanup_pending",
    });
    const newerSessionId = "01J0000000000000000000000A";
    await insertRuntimeConversationSession(database, {
      incarnation: 5,
      sessionId: newerSessionId,
      status: "active",
    });
    const operationId = createPlatformId<RuntimeOperationId>();
    const claimExpiresAt = Date.now() + 60_000;
    await database
      .prepare(
        `UPDATE sandbox
            SET claim_expires_at = ?, claim_owner = 'activation-repair', incarnation = 4,
                operation_kind = 'activate', status = 'destroying', status_operation_id = ?
          WHERE id = ?`,
      )
      .bind(claimExpiresAt, operationId, RUNTIME_SUBJECT_ID)
      .run();

    await runRuntimeSubjectOperation(createBindings(database), {
      kind: "pet",
      lease: {
        claimExpiresAt,
        claimOwner: "activation-repair",
        incarnation: 4,
        kind: "activate",
        operationId,
        status: "destroying",
      },
      reason: "repair active incarnation retirement",
      runtimeSubjectId: RUNTIME_SUBJECT_ID,
    });

    await expect(
      database
        .prepare(
          `SELECT cleanup_operation_id, sandbox_incarnation, status
             FROM sandbox_session
            ORDER BY session_id`,
        )
        .all(),
    ).resolves.toMatchObject({
      results: [
        { cleanup_operation_id: null, sandbox_incarnation: 4, status: "closed" },
        { cleanup_operation_id: null, sandbox_incarnation: 4, status: "closed" },
        { cleanup_operation_id: null, sandbox_incarnation: 5, status: "active" },
      ],
    });
    expect((await readRuntimeSubject(database)).status).toBe("cold");
  });

  test("keeps generic activation repair draining until every exact-incarnation Run is terminal", async () => {
    const database = createRuntimeSubjectLifecycleDatabase();
    await insertRuntimeSubject(database, { incarnation: 4, kind: "pet", status: "active" });
    const operationId = createPlatformId<RuntimeOperationId>();
    const driverInstanceId = createPlatformId();
    const runId = createPlatformId();
    await database
      .prepare(
        `UPDATE sandbox
            SET claim_expires_at = 1, claim_owner = 'expired-activation',
                operation_kind = 'activate', status = 'destroying', status_operation_id = ?
          WHERE id = ?`,
      )
      .bind(operationId, RUNTIME_SUBJECT_ID)
      .run();
    await database
      .prepare(
        `INSERT INTO driver_instance (
           id, sandbox_id, sandbox_incarnation, sandbox_session_id, status
         ) VALUES (?, ?, 4, ?, 'ready')`,
      )
      .bind(driverInstanceId, RUNTIME_SUBJECT_ID, SESSION_ID)
      .run();
    await database
      .prepare(
        `INSERT INTO session_run (agent_id, driver_instance_id, id, session_id, status)
         VALUES (?, ?, ?, ?, 'running')`,
      )
      .bind(AGENT_ID, driverInstanceId, runId, SESSION_ID)
      .run();
    const firstRepairLease = await claimRuntimeSubjectOperationForRepair(database, {
      candidate: {
        claimExpiresAt: 1,
        claimOwner: "expired-activation",
        id: RUNTIME_SUBJECT_ID,
        incarnation: 4,
        kind: "pet",
        operationId,
        operationKind: "activate",
        status: "destroying",
      },
      claimExpiresAt: 60_002,
      claimOwner: "first-repair",
      now: 2,
    });
    expect(firstRepairLease).not.toBeNull();
    if (firstRepairLease === null) {
      return;
    }
    let destroyCalls = 0;
    const bindings = createBindings(database, {
      onDestroy: () => {
        destroyCalls++;
      },
    });

    await expect(
      runRuntimeSubjectOperation(bindings, {
        kind: "pet",
        lease: firstRepairLease,
        reason: "test activation retirement drain",
        runtimeSubjectId: RUNTIME_SUBJECT_ID,
      }),
    ).rejects.toThrow("still draining active Runs");
    expect(destroyCalls).toBe(0);
    const waiting = await database
      .prepare(
        `SELECT claim_expires_at, claim_owner, operation_kind, status, status_operation_id
         FROM sandbox WHERE id = ?`,
      )
      .bind(RUNTIME_SUBJECT_ID)
      .first<{
        claim_expires_at: number;
        claim_owner: string;
        operation_kind: "activate";
        status: "destroying";
        status_operation_id: RuntimeOperationId;
      }>();
    expect(waiting).toMatchObject({
      claim_owner: "first-repair",
      operation_kind: "activate",
      status: "destroying",
      status_operation_id: operationId,
    });
    if (waiting === null) {
      return;
    }

    await database
      .prepare("UPDATE session_run SET status = 'completed' WHERE id = ?")
      .bind(runId)
      .run();
    await database
      .prepare("UPDATE driver_instance SET status = 'stopped' WHERE id = ?")
      .bind(driverInstanceId)
      .run();
    const nextNow = waiting.claim_expires_at + 1;
    const nextRepairLease = await claimRuntimeSubjectOperationForRepair(database, {
      candidate: {
        claimExpiresAt: waiting.claim_expires_at,
        claimOwner: waiting.claim_owner,
        id: RUNTIME_SUBJECT_ID,
        incarnation: 4,
        kind: "pet",
        operationId,
        operationKind: "activate",
        status: "destroying",
      },
      claimExpiresAt: nextNow + 60_000,
      claimOwner: "next-repair",
      now: nextNow,
    });
    expect(nextRepairLease).not.toBeNull();
    if (nextRepairLease === null) {
      return;
    }

    await runRuntimeSubjectOperation(bindings, {
      kind: "pet",
      lease: nextRepairLease,
      reason: "test activation retirement drained",
      runtimeSubjectId: RUNTIME_SUBJECT_ID,
    });

    expect(destroyCalls).toBe(1);
    await expect(
      database
        .prepare("SELECT claim_owner, operation_kind, status FROM sandbox WHERE id = ?")
        .bind(RUNTIME_SUBJECT_ID)
        .first(),
    ).resolves.toEqual({ claim_owner: null, operation_kind: null, status: "cold" });
  });
});
