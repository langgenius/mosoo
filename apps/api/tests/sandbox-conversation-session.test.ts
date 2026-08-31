import { describe, expect, mock, test } from "bun:test";

import type { AgentKind } from "@mosoo/contracts/agent";
import type { SandboxSessionStatus } from "@mosoo/contracts/sandbox";
import { isPlatformId } from "@mosoo/id";

import { encodeSandboxBackupIdForStorage } from "../src/modules/runtime/infrastructure/sandbox-backup-id";
import type {
  ExecutionSessionHandle,
  RuntimeCommandResultHandle,
  SandboxHandle,
} from "../src/modules/runtime/infrastructure/sandbox-handles";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  PUBLIC_API_TEST_IDS,
  PublicApiMemoryFileBucket,
  createPublicHttpContractDatabase,
  insertActiveSandboxSessionFixture,
  insertOwnerSession,
} from "./helpers/public-api-http-test-fixture";
import type { SqliteD1Database } from "./helpers/sqlite-d1";

mock.module("@cloudflare/sandbox", () => ({
  getSandbox: () => {
    throw new Error("getSandbox is not used in conversation session tests.");
  },
}));

const {
  closeIdleCattleConversationSession,
  ensureSandboxConversationSession,
  repairPendingSandboxConversationSessionCleanups,
} =
  await import("../src/modules/runtime/infrastructure/sandbox-session/sandbox-conversation-session.service");

const ORIGIN = {
  callerUserId: PUBLIC_API_TEST_IDS.ownerAccount,
  entrypoint: "api",
  executionOwnerUserId: PUBLIC_API_TEST_IDS.ownerAccount,
  type: "agent",
} as const;
const CLOUDFLARE_BACKUP_ID = "550e8400-e29b-41d4-a716-446655440000";
const STORED_BACKUP_ID = encodeSandboxBackupIdForStorage(CLOUDFLARE_BACKUP_ID);
const ARTIFACT_SHA256 = "a".repeat(64);
const SANDBOX_SESSION_ID = "01J00000000000000000000001";
const SANDBOX_INCARNATION = 1;
const SESSION_ID = PUBLIC_API_TEST_IDS.ownerSession;

function commandResult(): RuntimeCommandResultHandle {
  return {
    exitCode: 0,
    stderr: "",
    stdout: "",
    success: true,
  };
}

function failedCommandResult(): RuntimeCommandResultHandle {
  return {
    exitCode: 1,
    stderr: "",
    stdout: "",
    success: false,
  };
}

async function createConversationSessionDatabase(
  kind: AgentKind = "pet",
): Promise<SqliteD1Database> {
  const database = await createPublicHttpContractDatabase();

  await insertOwnerSession(database);
  await database.prepare("UPDATE session SET kind = ? WHERE id = ?").bind(kind, SESSION_ID).run();
  await insertActiveSandboxSessionFixture(database, {
    inactiveDeadlineAt: 123,
    kind,
    ownerAccountId: PUBLIC_API_TEST_IDS.ownerAccount,
    sandboxId: PUBLIC_API_TEST_IDS.sandbox,
    sandboxSessionId: SANDBOX_SESSION_ID,
    sessionId: SESSION_ID,
    timestampMs: 1,
  });
  await database.prepare("DELETE FROM sandbox_session WHERE session_id = ?").bind(SESSION_ID).run();

  return database;
}

async function insertConversationSession(
  database: D1Database,
  input: {
    readonly status: SandboxSessionStatus;
  },
): Promise<void> {
  await database
    .prepare(
      `
        INSERT INTO sandbox_session (
          cloudflare_session_id,
          created_at,
          cwd,
          origin_json,
          sandbox_id,
          sandbox_incarnation,
          session_id,
          status,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .bind(
      SANDBOX_SESSION_ID,
      1,
      `/workspace/se/${SESSION_ID}`,
      JSON.stringify(ORIGIN),
      PUBLIC_API_TEST_IDS.sandbox,
      SANDBOX_INCARNATION,
      SESSION_ID,
      input.status,
      1,
    )
    .run();
}

async function insertConversationBackup(
  database: D1Database,
  input: {
    createdAt?: number;
    dir?: string;
    workspaceSessionId?: string | null;
  } = {},
): Promise<void> {
  await database
    .prepare(
      `
        INSERT INTO sandbox_backup (
          created_at,
          dir,
          id,
          keep,
          operation_id,
          sandbox_id,
          sandbox_incarnation,
          staging_id,
          status,
          ttl_seconds,
          updated_at,
          workspace_session_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .bind(
      input.createdAt ?? 1,
      input.dir ?? `/workspace/se/${SESSION_ID}`,
      STORED_BACKUP_ID,
      0,
      PUBLIC_API_TEST_IDS.operation,
      PUBLIC_API_TEST_IDS.sandbox,
      SANDBOX_INCARNATION,
      STORED_BACKUP_ID,
      "ready",
      86_400,
      input.createdAt ?? 1,
      input.workspaceSessionId === undefined ? SESSION_ID : input.workspaceSessionId,
    )
    .run();
}

async function readConversationSession(database: D1Database): Promise<{
  cloudflare_session_id: string;
  cwd: string;
  status: string;
}> {
  const row = await database
    .prepare(
      `
        SELECT cloudflare_session_id, cwd, status
        FROM sandbox_session
        WHERE session_id = ?
      `,
    )
    .bind(SESSION_ID)
    .first<{
      cloudflare_session_id: string;
      cwd: string;
      status: string;
    }>();

  if (row === null) {
    throw new Error("Conversation session row is missing.");
  }

  return row;
}

async function readInactiveDeadline(database: D1Database): Promise<number | null> {
  return database
    .prepare("SELECT inactive_deadline_at FROM sandbox WHERE id = ?")
    .bind(PUBLIC_API_TEST_IDS.sandbox)
    .first<number>("inactive_deadline_at");
}

function createExecutionSession(options: {
  cwdHasContent: boolean;
  onWriteFile?: (path: string) => void;
}): ExecutionSessionHandle {
  return {
    async exec() {
      return options.cwdHasContent ? commandResult() : failedCommandResult();
    },
    async mkdir() {},
    async readFile() {
      return { content: "", encoding: "utf8" };
    },
    async startProcess() {
      throw new Error("startProcess is not used in conversation session tests.");
    },
    async watch() {
      return new ReadableStream<Uint8Array>();
    },
    async writeFile(path) {
      options.onWriteFile?.(path);
    },
  };
}

function createSandbox(
  options: {
    cwdHasContent?: boolean;
    deleteSessionError?: Error;
    onRestore?: (backup: { readonly dir: string; readonly id: string }) => void;
    onWriteFile?: (path: string) => void;
    restoreError?: Error;
  } = {},
): SandboxHandle {
  const executionSession = createExecutionSession({
    cwdHasContent: options.cwdHasContent ?? true,
    ...(options.onWriteFile ? { onWriteFile: options.onWriteFile } : {}),
  });

  return {
    ...executionSession,
    async configureNetworkConstraints() {},
    async createBackup() {
      return { dir: "/backup", id: "backup-1" };
    },
    async createSession() {
      return executionSession;
    },
    async deleteSession(sessionId) {
      if (options.deleteSessionError) {
        throw options.deleteSessionError;
      }

      return { sessionId, success: true, timestamp: new Date(0).toISOString() };
    },
    async destroy() {},
    async getSession() {
      return executionSession;
    },
    async mountBucket() {},
    async restoreBackup(backup) {
      if (options.restoreError) {
        throw options.restoreError;
      }

      options.onRestore?.(backup);
      return backup;
    },
    async setKeepAlive() {},
    async terminal() {
      return new Response();
    },
    async unmountBucket() {},
    async wsConnect() {
      return new Response(null, { status: 101 });
    },
  };
}

function createBindings(
  database: D1Database,
  sandbox?: SandboxHandle,
  fileBucket?: R2Bucket,
): ApiBindings {
  return {
    DB: database,
    ...(fileBucket ? { FILE_BUCKET: fileBucket } : {}),
    ...(sandbox ? { runtimeSubjectHandleFactory: () => sandbox } : {}),
  } as ApiBindings;
}

async function setWorkspaceCheckpointRequired(
  database: D1Database,
  required: boolean,
): Promise<void> {
  await database
    .prepare("UPDATE session SET workspace_checkpoint_required = ? WHERE id = ?")
    .bind(required ? 1 : 0, SESSION_ID)
    .run();
}

function createInput(sandbox: SandboxHandle, kind: AgentKind = "pet") {
  return {
    agentId: PUBLIC_API_TEST_IDS.agent,
    kind,
    mountSessionResources: false,
    origin: ORIGIN,
    sandbox,
    sandboxId: PUBLIC_API_TEST_IDS.sandbox,
    sandboxIncarnation: SANDBOX_INCARNATION,
    sessionId: SESSION_ID,
  };
}

describe("ensureSandboxConversationSession", () => {
  test("reuses an active session without preparing directories", async () => {
    const database = await createConversationSessionDatabase();
    await insertConversationSession(database, { status: "active" });
    const sandbox = createSandbox();

    const result = await ensureSandboxConversationSession(
      createBindings(database),
      createInput(sandbox),
    );

    expect(result.sandboxSessionId).toBe(SANDBOX_SESSION_ID);
    await expect(readConversationSession(database)).resolves.toEqual({
      cloudflare_session_id: SANDBOX_SESSION_ID,
      cwd: `/workspace/se/${SESSION_ID}`,
      status: "active",
    });
    await expect(readInactiveDeadline(database)).resolves.toBe(123);
  });

  test("creates a missing conversation session record", async () => {
    const database = await createConversationSessionDatabase();
    const sandbox = createSandbox();

    const result = await ensureSandboxConversationSession(
      createBindings(database),
      createInput(sandbox),
    );

    expect(isPlatformId(result.sandboxSessionId)).toBe(true);
    await expect(readConversationSession(database)).resolves.toEqual({
      cloudflare_session_id: result.sandboxSessionId,
      cwd: result.cwd,
      status: "active",
    });
  });

  test("arms an idle deadline when a legacy Pet session has none", async () => {
    const database = await createConversationSessionDatabase();
    database.execute("UPDATE sandbox SET inactive_deadline_at = NULL");
    const sandbox = createSandbox();
    const startedAt = Date.now();

    await ensureSandboxConversationSession(createBindings(database), createInput(sandbox));

    const deadline = await readInactiveDeadline(database);
    expect(deadline).toBeGreaterThanOrEqual(startedAt + 5 * 60_000);
    expect(deadline).toBeLessThanOrEqual(Date.now() + 5 * 60_000);
  });

  test("continues a warm closed cattle session with a new execution session id", async () => {
    const database = await createConversationSessionDatabase("cattle");
    await insertConversationSession(database, { status: "closed" });
    const sandbox = createSandbox();

    const result = await ensureSandboxConversationSession(
      createBindings(database),
      createInput(sandbox, "cattle"),
    );

    expect(result.sandboxSessionId).not.toBe(SANDBOX_SESSION_ID);
    expect(isPlatformId(result.sandboxSessionId)).toBe(true);

    await expect(readConversationSession(database)).resolves.toMatchObject({
      cloudflare_session_id: result.sandboxSessionId,
      status: "active",
    });
    await expect(readInactiveDeadline(database)).resolves.toBeNull();
  });

  test("restores a cold cattle session from a 20-day-old committed checkpoint", async () => {
    const database = await createConversationSessionDatabase("cattle");
    await insertConversationSession(database, { status: "closed" });
    await setWorkspaceCheckpointRequired(database, true);
    await insertConversationBackup(database, {
      createdAt: Date.now() - 20 * 24 * 60 * 60 * 1000,
    });
    let restoredBackup: { readonly dir: string; readonly id: string } | null = null;
    const sandbox = createSandbox({
      cwdHasContent: false,
      onRestore: (backup) => {
        restoredBackup = backup;
      },
    });

    await ensureSandboxConversationSession(
      createBindings(database),
      createInput(sandbox, "cattle"),
    );

    expect(restoredBackup).toEqual({
      dir: `/workspace/se/${SESSION_ID}`,
      id: CLOUDFLARE_BACKUP_ID,
    });
  });

  test("fails cold cattle continuation when its exact Thread checkpoint is missing", async () => {
    const database = await createConversationSessionDatabase("cattle");
    await insertConversationSession(database, { status: "closed" });
    await setWorkspaceCheckpointRequired(database, true);
    await insertConversationBackup(database, { dir: "/workspace/se/another-session" });
    const sandbox = createSandbox({ cwdHasContent: false });

    await expect(
      ensureSandboxConversationSession(createBindings(database), createInput(sandbox, "cattle")),
    ).rejects.toThrow("has no committed workspace checkpoint");
  });

  test("does not consume a legacy checkpoint without exact Thread ownership", async () => {
    const database = await createConversationSessionDatabase("cattle");
    await insertConversationSession(database, { status: "closed" });
    await setWorkspaceCheckpointRequired(database, true);
    await insertConversationBackup(database, { workspaceSessionId: null });

    await expect(
      ensureSandboxConversationSession(
        createBindings(database),
        createInput(createSandbox({ cwdHasContent: false }), "cattle"),
      ),
    ).rejects.toThrow("has no committed workspace checkpoint");
  });

  test("reports an actionable error for a corrupt cattle checkpoint", async () => {
    const database = await createConversationSessionDatabase("cattle");
    await insertConversationSession(database, { status: "closed" });
    await setWorkspaceCheckpointRequired(database, true);
    await insertConversationBackup(database);
    const sandbox = createSandbox({
      cwdHasContent: false,
      restoreError: new Error("backup checksum mismatch"),
    });

    await expect(
      ensureSandboxConversationSession(createBindings(database), createInput(sandbox, "cattle")),
    ).rejects.toThrow("workspace checkpoint could not be restored. Retry the continuation");
  });

  test("restores backfilled artifacts for a pre-rollout cattle Thread", async () => {
    const database = await createConversationSessionDatabase("cattle");
    await insertConversationSession(database, { status: "closed" });
    database.execute(`
      INSERT INTO file_record (
        committed, created_at, created_by_account_id, id, name, object_key,
        owner_id, owner_kind, parent_path, path, purpose, runtime_event_seq,
        scope_id, scope_kind, session_kind, size, status, updated_at, version
      ) VALUES (
        1, 1, '${PUBLIC_API_TEST_IDS.ownerAccount}', '${PUBLIC_API_TEST_IDS.file}',
        'legacy.txt', 'artifacts/legacy.txt', '${SESSION_ID}', 'session',
        'runtime-output/outputs/legacy.txt/${ARTIFACT_SHA256}',
        'session-artifacts/${PUBLIC_API_TEST_IDS.file}/legacy.txt', 'session_artifact', 0,
        '${SESSION_ID}', 'session', 'artifact', 14, 'ready', 1, 1
      );

      INSERT INTO session_artifact_head (
        file_id, runtime_event_seq, session_id, source_event_id, source_path, updated_at
      ) VALUES (
        '${PUBLIC_API_TEST_IDS.file}', 0, '${SESSION_ID}',
        'legacy-file:${PUBLIC_API_TEST_IDS.file}',
        'outputs/legacy.txt', 1
      );
    `);
    const bucket = new PublicApiMemoryFileBucket();
    await bucket.put("artifacts/legacy.txt", "legacy output\n");
    const restoredPaths: string[] = [];
    const sandbox = createSandbox({
      cwdHasContent: false,
      onWriteFile: (path) => restoredPaths.push(path),
    });

    await ensureSandboxConversationSession(
      createBindings(database, undefined, bucket),
      createInput(sandbox, "cattle"),
    );

    expect(restoredPaths).toContain(`/workspace/se/${SESSION_ID}/outputs/legacy.txt`);
  });

  test("continues a closed pet session through the stable restore path", async () => {
    const database = await createConversationSessionDatabase();
    await insertConversationSession(database, { status: "closed" });
    await insertConversationBackup(database);
    let restoredBackup: { readonly dir: string; readonly id: string } | null = null;
    const sandbox = createSandbox({
      cwdHasContent: false,
      onRestore: (backup) => {
        restoredBackup = backup;
      },
    });

    const result = await ensureSandboxConversationSession(
      createBindings(database),
      createInput(sandbox, "pet"),
    );

    expect(result.sandboxSessionId).toBe(SANDBOX_SESSION_ID);
    expect(restoredBackup).toEqual({
      dir: `/workspace/se/${SESSION_ID}`,
      id: CLOUDFLARE_BACKUP_ID,
    });
    await expect(readConversationSession(database)).resolves.toMatchObject({
      cloudflare_session_id: SANDBOX_SESSION_ID,
      status: "active",
    });
  });

  test("replaces a closed pet execution session for a fenced Run provisioning", async () => {
    const database = await createConversationSessionDatabase();
    await insertConversationSession(database, { status: "closed" });
    await insertConversationBackup(database);
    const sandbox = createSandbox({ cwdHasContent: false });

    const result = await ensureSandboxConversationSession(createBindings(database), {
      ...createInput(sandbox, "pet"),
      replaceClosedExecutionSession: true,
    });

    expect(result.sandboxSessionId).not.toBe(SANDBOX_SESSION_ID);
    expect(isPlatformId(result.sandboxSessionId)).toBe(true);
    await expect(readConversationSession(database)).resolves.toMatchObject({
      cloudflare_session_id: result.sandboxSessionId,
      status: "active",
    });
  });
});

describe("closeIdleCattleConversationSession", () => {
  test("arms subject reclamation when the remote session is already absent", async () => {
    const database = await createConversationSessionDatabase("cattle");
    await insertConversationSession(database, { status: "active" });
    database.execute("UPDATE sandbox SET inactive_deadline_at = NULL");
    const sandbox = createSandbox({
      deleteSessionError: new Error(`Session '${SANDBOX_SESSION_ID}' not found`),
    });
    const startedAt = Date.now();

    await expect(
      closeIdleCattleConversationSession(createBindings(database, sandbox), {
        idleSinceLte: 1,
        sandboxId: PUBLIC_API_TEST_IDS.sandbox,
        sessionId: SESSION_ID,
      }),
    ).resolves.toBe(true);

    await expect(readConversationSession(database)).resolves.toMatchObject({ status: "closed" });
    await expect(
      database
        .prepare(
          `SELECT event_type, family, source, visibility
             FROM session_event
            WHERE session_id = ? AND event_type = 'runtime.sandbox.updated'`,
        )
        .bind(SESSION_ID)
        .first(),
    ).resolves.toEqual({
      event_type: "runtime.sandbox.updated",
      family: "sandbox",
      source: "system",
      visibility: "owner_debug",
    });
    const deadline = await readInactiveDeadline(database);
    expect(deadline).toBeGreaterThanOrEqual(startedAt + 5 * 60_000);
    expect(deadline).toBeLessThanOrEqual(Date.now() + 5 * 60_000);
  });

  test("repairs cleanup against its retired physical incarnation", async () => {
    const database = await createConversationSessionDatabase("cattle");
    await insertConversationSession(database, { status: "active" });
    database.execute(`
      UPDATE sandbox SET incarnation = 5;
      UPDATE sandbox_session
      SET cleanup_operation_id = '${PUBLIC_API_TEST_IDS.operation}',
          sandbox_incarnation = 4,
          status = 'cleanup_pending';
    `);
    const physicalIds: string[] = [];
    const sandbox = createSandbox();
    const bindings = {
      DB: database,
      runtimeSubjectHandleFactory: (physicalId: string) => {
        physicalIds.push(physicalId);
        return sandbox;
      },
    } as ApiBindings;

    await expect(repairPendingSandboxConversationSessionCleanups(bindings, 10)).resolves.toBe(1);

    expect(physicalIds).toEqual([`${PUBLIC_API_TEST_IDS.sandbox}-i4`]);
    await expect(readConversationSession(database)).resolves.toMatchObject({ status: "closed" });
  });
});
