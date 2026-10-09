import { afterEach, describe, expect, spyOn, test } from "bun:test";

import { createPlatformId } from "@mosoo/id";
import type { SandboxId, SessionId } from "@mosoo/id";

import { createRuntimeTimingRecorder } from "../src/modules/runtime/application/session-runs/session-runtime-timing";
import { RuntimeSubjectCapacityExceededError } from "../src/modules/runtime/infrastructure/runtime-subject-lifecycle/runtime-subject-errors";
import { activateRuntimeSubject } from "../src/modules/runtime/infrastructure/runtime-subject-lifecycle/runtime-subject-lifecycle.service";
import type { ActivateRuntimeSubjectInput } from "../src/modules/runtime/infrastructure/runtime-subject-lifecycle/runtime-subject-lifecycle.service";
import {
  advanceRuntimeSubjectOperationStatus,
  ensureRuntimeSubjectId,
  markRuntimeSubjectCold,
  markRuntimeSubjectOperationStarted,
} from "../src/modules/runtime/infrastructure/runtime-subject-lifecycle/runtime-subject-record-store";
import { recycleRuntimeSubject } from "../src/modules/runtime/infrastructure/runtime-subject-lifecycle/runtime-subject-recycle.service";
import { encodeSandboxBackupIdForStorage } from "../src/modules/runtime/infrastructure/sandbox-backup-id";
import type { SandboxHandle } from "../src/modules/runtime/infrastructure/sandbox-handles";
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
  sessionId: SESSION_ID,
  executionOwnerUserId: ACCOUNT_ID,
} as const;

let fetchSpy: { mockRestore(): void } | null = null;

afterEach(() => {
  fetchSpy?.mockRestore();
  fetchSpy = null;
});

function activate(bindings: ApiBindings, input: Omit<ActivateRuntimeSubjectInput, "timing">) {
  return activateRuntimeSubject(bindings, {
    ...input,
    timing: createRuntimeTimingRecorder({
      runId: null,
      sessionId: input.sessionId,
      source: "api",
      stage: "prepare_run",
      traceId: null,
    }),
  });
}

function createRuntimeSubjectLifecycleDatabase(): SqliteD1Database {
  const database = new SqliteD1Database();

  database.execute(`
    CREATE TABLE project (id text PRIMARY KEY, owner_account_id text NOT NULL);
    CREATE TABLE session (id text PRIMARY KEY, project_id text NOT NULL);
    CREATE TABLE sandbox_session (sandbox_id text, session_id text PRIMARY KEY, status text);
    INSERT INTO project VALUES ('${PROJECT_ID}', '${ACCOUNT_ID}');
    INSERT INTO session VALUES ('${SESSION_ID}', '${PROJECT_ID}');
    CREATE TABLE sandbox (
      sandbox_binding text NOT NULL DEFAULT 'Sandbox',
      agent_id text,
      project_id text DEFAULT '${PROJECT_ID}',
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
      owner_account_id text DEFAULT '${ACCOUNT_ID}',
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
      session_run_id text,
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
      created_by_key_id text,
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
          status_seq,
          subject_id,
          subject_kind,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      input.statusSeq ?? 0,
      SESSION_ID,
      "session",
      1,
    )
    .run();
}

async function readRuntimeSubject(database: D1Database): Promise<{
  status: string;
  status_seq: number;
}> {
  const row = await database
    .prepare(
      `
        SELECT status, status_seq
        FROM sandbox
        WHERE id = '${RUNTIME_SUBJECT_ID}'
      `,
    )
    .first<{
      status: string;
      status_seq: number;
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
    readonly onStartup?: (allowRecovery: boolean) => Promise<void>;
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
    mkdir: unavailable,
    mountBucket: unavailable,
    readFile: unavailable,
    restoreBackup: options.onRestore
      ? async (backup) => {
          options.onRestore?.(backup);
          return backup;
        }
      : unavailable,
    setKeepAlive: async () => {},
    ensureContainerReady: async ({ allowRecovery }) => {
      if (options.prepareError) {
        throw options.prepareError;
      }
      await options.onStartup?.(allowRecovery);
    },
    startProcess: unavailable,
    unmountBucket: unavailable,
    writeFile: unavailable,
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
    readonly onStartup?: (allowRecovery: boolean) => Promise<void>;
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
  test("limits startup recovery to cold subjects without live Drivers", async () => {
    for (const [status, driverStatus, expected] of [
      ["cold", null, true],
      ["active", null, false],
      ["cold", "ready", false],
      ["cold", "stopped", true],
    ] as const) {
      const database = createRuntimeSubjectLifecycleDatabase();
      await insertRuntimeSubject(database, { status });
      if (driverStatus) {
        await database
          .prepare("INSERT INTO driver_instance (id, sandbox_id, status) VALUES (?, ?, ?)")
          .bind("01J0000000000000000000000F", RUNTIME_SUBJECT_ID, driverStatus)
          .run();
      }
      const recoveries: boolean[] = [];
      await activate(
        createBindings(database, {
          onStartup: async (allowRecovery) => {
            recoveries.push(allowRecovery);
          },
        }),
        {
          ...RUNTIME_SUBJECT_QUOTA_SCOPE,

          networkConstraints: { allowedHosts: [], networkPolicy: "full" },
          runtimeSubjectId: RUNTIME_SUBJECT_ID,
          sessionId: SESSION_ID,
        },
      );
      expect(recoveries).toEqual([expected]);
    }
  });

  test("startup failure becomes cold only after confirmed cleanup", async () => {
    for (const destroyError of [undefined, new Error("cleanup not confirmed")]) {
      const database = createRuntimeSubjectLifecycleDatabase();
      await insertRuntimeSubject(database, { status: "cold" });
      let destroys = 0;
      await expect(
        activate(
          createBindings(database, {
            onStartup: async () => {
              throw new Error("container startup attempt 2 timed out");
            },
            onDestroy: () => {
              destroys += 1;
            },
            destroyError,
          }),
          {
            ...RUNTIME_SUBJECT_QUOTA_SCOPE,

            networkConstraints: { allowedHosts: [], networkPolicy: "full" },
            runtimeSubjectId: RUNTIME_SUBJECT_ID,
            sessionId: SESSION_ID,
          },
        ),
      ).rejects.toThrow("startup attempt 2");
      expect(destroys).toBe(1);
      expect((await readRuntimeSubject(database)).status).toBe(
        destroyError ? "destroying" : "cold",
      );
    }
  });

  test("keeps one deployment ceiling across runtime image classes", async () => {
    const database = createRuntimeSubjectLifecycleDatabase();
    const bindings = createBindings(database);
    const runtimes = ["claude-agent-sdk", "openai-runtime", "acp-fallback"];
    const owners = Array.from({ length: 11 }, () => ({
      accountId: createPlatformId(),
      projectId: createPlatformId(),
    }));
    for (const owner of owners) {
      await database
        .prepare("INSERT INTO project (id, owner_account_id) VALUES (?, ?)")
        .bind(owner.projectId, owner.accountId)
        .run();
    }
    const inputs = await Promise.all(
      Array.from({ length: 51 }, async (_, index) => {
        // Five Sessions per owner stay inside each account limit.
        const owner = owners[Math.floor(index / 5)];
        const sessionId = createPlatformId<SessionId>();
        await database
          .prepare("INSERT INTO session (id, project_id) VALUES (?, ?)")
          .bind(sessionId, owner.projectId)
          .run();
        const scope = {
          ...RUNTIME_SUBJECT_QUOTA_SCOPE,
          executionOwnerUserId: owner.accountId,
          projectId: owner.projectId,
          sessionId,
        };
        return {
          ...scope,
          networkConstraints: { allowedHosts: [], networkPolicy: "full" as const },
          runtimeSubjectId: await ensureRuntimeSubjectId(database, {
            ...scope,
            runtimeId: runtimes[index % runtimes.length],
            runtimeImagesEnabled: true,
          }),
        };
      }),
    );
    const outcomes = await Promise.allSettled(inputs.map((input) => activate(bindings, input)));
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(50);
    const rejected = outcomes.filter((outcome) => outcome.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(RuntimeSubjectCapacityExceededError);
    expect(rejected[0]?.reason).toMatchObject({
      limit: 50,
      message: "mosoo is at capacity right now. Try again in a few minutes.",
      scope: "platform",
    });
    const profiles = await database
      .prepare("SELECT DISTINCT sandbox_binding FROM sandbox ORDER BY sandbox_binding")
      .all<{ sandbox_binding: string }>();
    expect(profiles.results.map((row) => row.sandbox_binding)).toEqual([
      "SandboxClaude",
      "SandboxOpenAI",
      "SandboxOpenCode",
    ]);
  });

  test("preserves an unconverted shared binding before any container admission", async () => {
    const database = createRuntimeSubjectLifecycleDatabase();
    await insertRuntimeSubject(database, { status: "cold" });
    database.execute(
      `UPDATE sandbox SET subject_kind = 'agent', subject_id = '${AGENT_ID}', kind = 'pet'`,
    );
    const before = await database.prepare("SELECT * FROM sandbox").all();
    let containerCalls = 0;
    await expect(
      activate(
        createBindings(database, {
          onConfigureNetwork: () => {
            containerCalls += 1;
          },
          onStartup: async () => {
            containerCalls += 1;
          },
          onDestroy: () => {
            containerCalls += 1;
          },
        }),
        {
          ...RUNTIME_SUBJECT_QUOTA_SCOPE,
          networkConstraints: { allowedHosts: ["api.example.com"], networkPolicy: "limited" },
          runtimeSubjectId: RUNTIME_SUBJECT_ID,
        },
      ),
    ).rejects.toThrow("verified exclusive execution binding");
    expect(containerCalls).toBe(0);
    expect(await database.prepare("SELECT * FROM sandbox").all()).toEqual(before);
  });

  test("atomically applies the concurrent sandbox limit per account", async () => {
    const database = createRuntimeSubjectLifecycleDatabase();
    const bindings = createBindings(database);
    const allocate = async (scope: typeof RUNTIME_SUBJECT_QUOTA_SCOPE) => {
      await database
        .prepare("INSERT INTO session (id, project_id) VALUES (?, ?)")
        .bind(scope.sessionId, scope.projectId)
        .run();
      return {
        ...scope,
        networkConstraints: { allowedHosts: [], networkPolicy: "full" as const },
        runtimeSubjectId: await ensureRuntimeSubjectId(database, {
          ...scope,
          runtimeId: "claude-agent-sdk",
        }),
      };
    };
    const inputs = await Promise.all(
      Array.from({ length: 6 }, async () =>
        allocate({ ...RUNTIME_SUBJECT_QUOTA_SCOPE, sessionId: createPlatformId<SessionId>() }),
      ),
    );
    const outcomes = await Promise.allSettled(inputs.map((input) => activate(bindings, input)));
    const admittedIndex = outcomes.findIndex((outcome) => outcome.status === "fulfilled");

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(5);
    const rejected = outcomes.filter((outcome) => outcome.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatchObject({
      limit: 5,
      message:
        "You already have 5 active sessions. Try again in a few minutes, after one of them finishes.",
      scope: "account",
    });
    expect(admittedIndex).toBeGreaterThanOrEqual(0);
    await expect(
      database
        .prepare(
          "SELECT COUNT(*) AS count FROM sandbox WHERE owner_account_id = ? AND status = 'active'",
        )
        .bind(ACCOUNT_ID)
        .first<{ count: number }>(),
    ).resolves.toEqual({ count: 5 });
    await expect(activate(bindings, inputs[admittedIndex])).resolves.toBeDefined();

    await expect(
      activate(bindings, {
        ...inputs[0],
        runtimeSubjectId: createPlatformId<SandboxId>(),
        sessionId: createPlatformId<SessionId>(),
      }),
    ).rejects.toThrow();

    const otherOwner = createPlatformId();
    const otherProject = createPlatformId();
    await database
      .prepare("INSERT INTO project (id, owner_account_id) VALUES (?, ?)")
      .bind(otherProject, otherOwner)
      .run();
    await expect(
      activate(
        bindings,
        await allocate({
          ...RUNTIME_SUBJECT_QUOTA_SCOPE,
          executionOwnerUserId: otherOwner,
          projectId: otherProject,
          sessionId: createPlatformId<SessionId>(),
        }),
      ),
    ).resolves.toBeDefined();
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
      expectedStatus: "destroying",
      runtimeSubjectId: "01J0000000000000000000000D",
    });

    await expect(readRuntimeSubject(database)).resolves.toEqual({
      status: "cold",
      status_seq: 3,
    });
  });

  test("does not let a stale operation completion overwrite a newer subject status", async () => {
    const database = createRuntimeSubjectLifecycleDatabase();
    await insertRuntimeSubject(database, { status: "active", statusSeq: 7 });

    await markRuntimeSubjectCold(database, {
      expectedStatus: "backing_up",
      runtimeSubjectId: "01J0000000000000000000000D",
    });

    await expect(readRuntimeSubject(database)).resolves.toEqual({
      status: "active",
      status_seq: 7,
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

    const activation = await activate(createBindings(database), {
      ...RUNTIME_SUBJECT_QUOTA_SCOPE,

      networkConstraints: { allowedHosts: [], networkPolicy: "full" },
      runtimeSubjectId: RUNTIME_SUBJECT_ID,
      spaceAliases: [],
      sessionId: SESSION_ID,
    });

    expect(activation).toBeTruthy();
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

  test("captures one sandbox creation when a cold subject becomes active", async () => {
    const database = createRuntimeSubjectLifecycleDatabase();
    await insertRuntimeSubject(database, { status: "cold" });
    const capturedEvents: unknown[] = [];
    fetchSpy = spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      capturedEvents.push(JSON.parse(init?.body as string) as unknown);
      return new Response(null, { status: 200 });
    });
    const bindings = {
      ...createBindings(database),
      POSTHOG_API_HOST: "https://us.i.posthog.com",
      POSTHOG_PROJECT_KEY: "phc_test",
    } as ApiBindings;
    const activation = {
      ...RUNTIME_SUBJECT_QUOTA_SCOPE,
      executionOwnerUserId: "01J00000000000000000000002",

      networkConstraints: { allowedHosts: [], networkPolicy: "full" as const },
      runtimeSubjectId: RUNTIME_SUBJECT_ID,
      spaceAliases: [],
      sessionId: "01J00000000000000000000009",
    };

    await activate(bindings, activation);
    await activate(bindings, activation);

    expect(capturedEvents).toHaveLength(1);
    expect(capturedEvents[0]).toMatchObject({
      event: "sandbox_created",
      properties: {
        activation_purpose: "interactive",
        distinct_id: activation.executionOwnerUserId,
        execution_owner_id: activation.executionOwnerUserId,
        sandbox_id: RUNTIME_SUBJECT_ID,
        session_id: activation.sessionId,
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

  test("ignores historical kind and shared memory pointers on an exclusive Session", async () => {
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
      .bind("pet", STORED_BACKUP_ID, SESSION_ID, "session", RUNTIME_SUBJECT_ID)
      .run();
    let restoredBackup: { readonly dir: string; readonly id: string } | null = null;
    let configureNetworkCalls = 0;

    const activation = await activate(
      createBindings(database, {
        onRestore: (backup) => {
          restoredBackup = backup;
        },
        onConfigureNetwork: () => {
          configureNetworkCalls += 1;
        },
      }),
      {
        ...RUNTIME_SUBJECT_QUOTA_SCOPE,

        networkConstraints: { allowedHosts: [], networkPolicy: "full" },
        runtimeSubjectId: RUNTIME_SUBJECT_ID,
        spaceAliases: [],
        sessionId: SESSION_ID,
      },
    );

    expect(activation).toBeTruthy();
    expect(configureNetworkCalls).toBe(1);
    expect(restoredBackup).toBeNull();
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

    const activation = await activate(createBindings(database), {
      ...RUNTIME_SUBJECT_QUOTA_SCOPE,

      networkConstraints: { allowedHosts: [], networkPolicy: "full" },
      runtimeSubjectId: RUNTIME_SUBJECT_ID,
      spaceAliases: [],
      sessionId: SESSION_ID,
    });

    expect(activation).toBeTruthy();
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

  test("clears activation claim when container preparation fails", async () => {
    const database = createRuntimeSubjectLifecycleDatabase();
    await insertRuntimeSubject(database, { status: "cold" });
    const prepareError = new Error("Runtime subject filesystem prepare timed out after 15000ms.");

    await expect(
      activate(createBindings(database, { prepareError }), {
        ...RUNTIME_SUBJECT_QUOTA_SCOPE,

        networkConstraints: { allowedHosts: [], networkPolicy: "full" },
        runtimeSubjectId: RUNTIME_SUBJECT_ID,
        spaceAliases: [],
        sessionId: SESSION_ID,
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
    await insertRuntimeSubject(database, { status: "cold" });
    const prepareError = new Error("original activation failure");

    await expect(
      activate(
        createBindings(database, {
          destroyError: new Error("container destroy failed"),
          prepareError,
        }),
        {
          ...RUNTIME_SUBJECT_QUOTA_SCOPE,

          networkConstraints: { allowedHosts: [], networkPolicy: "full" },
          runtimeSubjectId: RUNTIME_SUBJECT_ID,
          spaceAliases: [],
          sessionId: SESSION_ID,
        },
      ),
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

  test("fails activation and destroys the container when network constraints cannot apply", async () => {
    const database = createRuntimeSubjectLifecycleDatabase();
    await insertRuntimeSubject(database, { status: "cold", statusSeq: 0 });
    const configureNetworkError = new Error(
      "Environment network policy 'limited' cannot be enforced here: sandbox HTTPS interception is disabled.",
    );
    let destroyCalls = 0;

    await expect(
      activate(
        createBindings(database, {
          configureNetworkError,
          onDestroy: () => (destroyCalls += 1),
        }),
        {
          ...RUNTIME_SUBJECT_QUOTA_SCOPE,

          networkConstraints: { allowedHosts: [], networkPolicy: "limited" },
          runtimeSubjectId: RUNTIME_SUBJECT_ID,
          spaceAliases: [],
          sessionId: SESSION_ID,
        },
      ),
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
      activate(createBindings(database, { onDestroy: () => (destroyCalls += 1), prepareError }), {
        ...RUNTIME_SUBJECT_QUOTA_SCOPE,

        networkConstraints: { allowedHosts: [], networkPolicy: "full" },
        runtimeSubjectId: RUNTIME_SUBJECT_ID,
        spaceAliases: [],
        sessionId: SESSION_ID,
      }),
    ).rejects.toThrow("filesystem prepare timed out");

    expect(destroyCalls).toBe(1);
    expect((await readRuntimeSubject(database)).status).toBe("cold");

    // Second activation on the now-cold subject succeeds — self-healed, no
    // manual recreate needed.
    const recovered = await activate(createBindings(database), {
      ...RUNTIME_SUBJECT_QUOTA_SCOPE,

      networkConstraints: { allowedHosts: [], networkPolicy: "full" },
      runtimeSubjectId: RUNTIME_SUBJECT_ID,
      spaceAliases: [],
      sessionId: SESSION_ID,
    });

    expect(recovered).toBeTruthy();
    expect((await readRuntimeSubject(database)).status).toBe("active");
  });
});
