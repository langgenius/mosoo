import { describe, expect, test } from "bun:test";

import { createPlatformId } from "@mosoo/id";
import type { AgentId, AppId, SandboxId, SessionId } from "@mosoo/id";

import { decideRuntimeSubjectTransition } from "../src/modules/runtime/domain/runtime-subject-lifecycle.machine";
import { createRuntimeSubjectLifecycleService } from "../src/modules/runtime/infrastructure/runtime-subject-lifecycle/runtime-subject-lifecycle.service";
import type { ActivateRuntimeSubjectInput } from "../src/modules/runtime/infrastructure/runtime-subject-lifecycle/runtime-subject-lifecycle.service";
import { destroyRuntimeSubjectContainer } from "../src/modules/runtime/infrastructure/runtime-subject-lifecycle/runtime-subject-platform";
import { recycleRuntimeSubject } from "../src/modules/runtime/infrastructure/runtime-subject-lifecycle/runtime-subject-recycle.service";
import {
  advanceRuntimeSubjectOperationStatus,
  FREE_PLAN_CONCURRENT_SANDBOX_LIMITS,
  markRuntimeSubjectCold,
  markRuntimeSubjectOperationStarted,
} from "../src/modules/runtime/infrastructure/runtime-subject-lifecycle/runtime-subject-store";
import { encodeSandboxBackupIdForStorage } from "../src/modules/runtime/infrastructure/sandbox-backup-id";
import type { SandboxHandle } from "../src/modules/runtime/infrastructure/sandbox-handles";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const RUNTIME_SUBJECT_ID = "01J0000000000000000000000D";
const ACCOUNT_ID = "01J00000000000000000000002";
const AGENT_ID = "01J00000000000000000000001";
const APP_ID = "01J00000000000000000000003";
const SESSION_ID = "01J00000000000000000000009";
const CLOUDFLARE_BACKUP_ID = "550e8400-e29b-41d4-a716-446655440000";
const STORED_BACKUP_ID = encodeSandboxBackupIdForStorage(CLOUDFLARE_BACKUP_ID);
const RUNTIME_SUBJECT_QUOTA_SCOPE = {
  agentId: AGENT_ID,
  appId: APP_ID,
  executionOwnerUserId: ACCOUNT_ID,
} as const;

function createRuntimeSubjectLifecycleDatabase(): SqliteD1Database {
  const database = new SqliteD1Database();

  database.execute(`
    CREATE TABLE sandbox (
      agent_id text,
      app_id text,
      bind_mount_ready integer DEFAULT false NOT NULL,
      claim_expires_at integer,
      claim_owner text,
      created_at integer NOT NULL,
      global_mounts_json text DEFAULT '[]' NOT NULL,
      id text PRIMARY KEY NOT NULL,
      inactive_deadline_at integer,
      kind text NOT NULL,
      last_backup_id text,
      last_error text,
      last_error_code text,
      last_restore_backup_id text,
      owner_account_id text,
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
      sandbox_id text NOT NULL,
      status text NOT NULL,
      ttl_seconds integer NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE TABLE driver_instance (
      id text PRIMARY KEY NOT NULL,
      sandbox_id text NOT NULL,
      status text NOT NULL
    );

    CREATE TABLE session_run (
      agent_id text NOT NULL,
      driver_instance_id text,
      id text PRIMARY KEY NOT NULL,
      session_id text NOT NULL,
      status text NOT NULL
    );
  `);

  return database;
}

async function insertRuntimeSubject(
  database: D1Database,
  input: {
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
          claim_expires_at,
          claim_owner,
          created_at,
          id,
          inactive_deadline_at,
          kind,
          last_backup_id,
          last_error,
          last_error_code,
          last_restore_backup_id,
          status,
          status_event,
          status_seq,
          status_source,
          subject_id,
          subject_kind,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .bind(
      null,
      null,
      1,
      RUNTIME_SUBJECT_ID,
      1,
      "cattle",
      null,
      input.lastError ?? null,
      input.lastErrorCode ?? null,
      null,
      input.status,
      `runtime_subject.${input.status === "backing_up" ? "back_up" : input.status}`,
      input.statusSeq ?? 0,
      "test",
      SESSION_ID,
      "session",
      1,
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
    readonly onDestroy?: () => void;
    readonly onRestore?: (backup: { readonly dir: string; readonly id: string }) => void;
    readonly prepareError?: Error;
  } = {},
): SandboxHandle {
  const unavailable = async () => {
    throw new Error("Unexpected sandbox test method call.");
  };

  return {
    configureNetworkConstraints: async () => {
      options.onConfigureNetwork?.();
      if (options.configureNetworkError) {
        throw options.configureNetworkError;
      }
    },
    createBackup: unavailable,
    createSession: unavailable,
    deleteSession: unavailable,
    destroy: async () => {
      options.onDestroy?.();

      if (options.destroyError) {
        throw options.destroyError;
      }

      await options.destroyPromise;
    },
    exec: unavailable,
    getSession: unavailable,
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
    watch: unavailable,
    writeFile: unavailable,
    wsConnect: unavailable,
  } as SandboxHandle;
}

function createBindings(
  database: D1Database,
  options: {
    readonly configureNetworkError?: Error;
    readonly destroyError?: Error;
    readonly destroyPromise?: Promise<void>;
    readonly onConfigureNetwork?: () => void;
    readonly onDestroy?: () => void;
    readonly onRestore?: (backup: { readonly dir: string; readonly id: string }) => void;
    readonly prepareError?: Error;
  } = {},
): ApiBindings {
  return {
    DB: database,
    SANDBOX_FILE_BUCKET_LOCAL: "true",
    runtimeSubjectHandleFactory: () => createSandboxHandle(options),
  } as unknown as ApiBindings;
}

describe("runtime subject lifecycle machine", () => {
  test("keeps subject operation transitions explicit", () => {
    expect(
      decideRuntimeSubjectTransition({
        currentStatus: "cold",
        targetStatus: "restoring",
      }),
    ).toMatchObject({ kind: "accepted", nextStatus: "restoring" });
    expect(
      decideRuntimeSubjectTransition({
        currentStatus: "restoring",
        targetStatus: "backing_up",
      }),
    ).toMatchObject({ kind: "rejected", reason: "illegal_transition" });
    expect(
      decideRuntimeSubjectTransition({
        currentStatus: "backing_up",
        targetStatus: "destroying",
      }),
    ).toMatchObject({ kind: "accepted", nextStatus: "destroying" });
    expect(
      decideRuntimeSubjectTransition({
        currentStatus: "restoring",
        targetStatus: "destroying",
      }),
    ).toMatchObject({ kind: "accepted", nextStatus: "destroying" });
    // Confirmed teardown returns to cold; there is no `error` status.
    expect(
      decideRuntimeSubjectTransition({ currentStatus: "active", targetStatus: "cold" }),
    ).toMatchObject({ kind: "accepted", nextStatus: "cold" });
    expect(
      decideRuntimeSubjectTransition({ currentStatus: "restoring", targetStatus: "cold" }),
    ).toMatchObject({ kind: "accepted", nextStatus: "cold" });
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

  test("atomically caps Free sandboxes per Agent, App, and account", async () => {
    for (const scope of ["agent", "app", "account"] as const) {
      const database = createRuntimeSubjectLifecycleDatabase();
      const inputs: ActivateRuntimeSubjectInput[] = [];
      const limit = FREE_PLAN_CONCURRENT_SANDBOX_LIMITS[scope];

      for (let index = 0; index <= limit; index += 1) {
        const agentId = scope === "agent" ? AGENT_ID : createPlatformId<AgentId>();
        const appId = scope === "account" ? createPlatformId<AppId>() : APP_ID;
        const sessionId = createPlatformId<SessionId>();

        inputs.push({
          agentId,
          appId,
          executionOwnerUserId: ACCOUNT_ID,
          kind: "cattle",
          networkConstraints: { allowedHosts: [], networkPolicy: "full" },
          runtimeSubjectId: createPlatformId<SandboxId>(),
          subjectId: sessionId,
          subjectKind: "session",
        });
      }

      const lifecycle = createRuntimeSubjectLifecycleService(createBindings(database));
      const outcomes = await Promise.allSettled(inputs.map((input) => lifecycle.activate(input)));
      const rejected = outcomes.filter(
        (outcome): outcome is PromiseRejectedResult => outcome.status === "rejected",
      );
      const active = await database
        .prepare("SELECT COUNT(*) AS count FROM sandbox WHERE status = 'active'")
        .first<{ count: number }>();

      expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(limit);
      expect(rejected).toHaveLength(1);
      expect(String(rejected[0]?.reason)).toContain("Free plan concurrent sandbox limit reached");
      expect(active?.count).toBe(limit);
    }
  });

  test("records operation transitions with monotonic status metadata", async () => {
    const database = createRuntimeSubjectLifecycleDatabase();
    await insertRuntimeSubject(database, { status: "active" });

    await expect(
      markRuntimeSubjectOperationStarted(database, {
        now: 10,
        runtimeSubjectId: "01J0000000000000000000000D",
        status: "backing_up",
      }),
    ).resolves.toBe(true);
    await expect(
      advanceRuntimeSubjectOperationStatus(database, {
        expectedStatus: "backing_up",
        runtimeSubjectId: "01J0000000000000000000000D",
        status: "destroying",
      }),
    ).resolves.toBe(true);
    await markRuntimeSubjectCold(database, {
      clearBackups: false,
      expectedStatus: "destroying",
      runtimeSubjectId: "01J0000000000000000000000D",
    });

    await expect(readRuntimeSubject(database)).resolves.toEqual({
      status: "cold",
      status_event: "runtime_subject.cold",
      status_seq: 3,
      status_source: "api",
    });
  });

  test("does not let a stale operation completion overwrite a newer subject status", async () => {
    const database = createRuntimeSubjectLifecycleDatabase();
    await insertRuntimeSubject(database, { status: "active", statusSeq: 7 });

    await markRuntimeSubjectCold(database, {
      clearBackups: false,
      expectedStatus: "backing_up",
      runtimeSubjectId: "01J0000000000000000000000D",
    });

    await expect(readRuntimeSubject(database)).resolves.toEqual({
      status: "active",
      status_event: "runtime_subject.active",
      status_seq: 7,
      status_source: "test",
    });
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
});
