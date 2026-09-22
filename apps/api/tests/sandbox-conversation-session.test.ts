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
import { PublicApiMemoryFileBucket } from "./helpers/public-api-http-test-fixture";
import { SqliteD1Database } from "./helpers/sqlite-d1";

mock.module("@cloudflare/sandbox", () => ({
  getSandbox: () => {
    throw new Error("getSandbox is not used in conversation session tests.");
  },
}));

const {
  closeIdleConversationSession,
  closeSandboxConversationSession,
  ensureSandboxConversationSession,
} =
  await import("../src/modules/runtime/infrastructure/sandbox-session/sandbox-conversation-session.service");

const ORIGIN = {
  callerUserId: "01J00000000000000000000001",
  entrypoint: "api",
  executionOwnerUserId: "01J00000000000000000000001",
  type: "agent",
} as const;
const CLOUDFLARE_BACKUP_ID = "550e8400-e29b-41d4-a716-446655440000";
const STORED_BACKUP_ID = encodeSandboxBackupIdForStorage(CLOUDFLARE_BACKUP_ID);
const ARTIFACT_SHA256 = "a".repeat(64);

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

function createConversationSessionDatabase(kind: AgentKind = "pet"): SqliteD1Database {
  const database = new SqliteD1Database();

  database.execute(`
    CREATE TABLE sandbox (
      sandbox_binding text NOT NULL DEFAULT 'Sandbox',
      claim_owner text,
      id text PRIMARY KEY NOT NULL,
      inactive_deadline_at integer,
      kind text NOT NULL,
      last_error text,
      last_error_code text,
      status text DEFAULT 'active' NOT NULL,
      status_changed_at integer DEFAULT 0 NOT NULL,
      status_event text DEFAULT 'runtime_subject.active' NOT NULL,
      status_operation_id text,
      status_seq integer DEFAULT 0 NOT NULL,
      status_source text DEFAULT 'system' NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE TABLE sandbox_session (
      cloudflare_session_id text NOT NULL,
      created_at integer NOT NULL,
      cwd text NOT NULL,
      origin_json text NOT NULL,
      sandbox_id text NOT NULL,
      session_id text PRIMARY KEY NOT NULL,
      status text NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE TABLE sandbox_backup (
      created_at integer NOT NULL,
      dir text NOT NULL,
      id text PRIMARY KEY NOT NULL,
      sandbox_id text NOT NULL,
      session_run_id text,
      status text NOT NULL
    );

    CREATE TABLE session (
      agent_id text,
      id text PRIMARY KEY NOT NULL,
      kind text DEFAULT '${kind}' NOT NULL,
      last_run_id text,
      status_operation_id text,
      workspace_checkpoint_required integer DEFAULT 0 NOT NULL
    );

    CREATE TABLE driver_instance (
      id text PRIMARY KEY NOT NULL,
      sandbox_id text NOT NULL
    );

    CREATE TABLE session_run (
      created_by_key_id text,
      driver_instance_id text,
      id text PRIMARY KEY NOT NULL,
      status text NOT NULL
    );

    CREATE TABLE file_record (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      name text NOT NULL,
      object_key text NOT NULL,
      parent_path text NOT NULL,
      scope_id text,
      scope_kind text NOT NULL,
      session_kind text,
      size integer NOT NULL,
      status text NOT NULL
    );
  `);

  database.execute(`
    INSERT INTO sandbox (id, inactive_deadline_at, kind, updated_at)
    VALUES ('01J0000000000000000000000D', 123, '${kind}', 1);
    INSERT INTO session (agent_id, id) VALUES (NULL, 'session-1');
  `);

  return database;
}

async function insertConversationSession(
  database: D1Database,
  input: {
    readonly status: SandboxSessionStatus;
  },
): Promise<void> {
  await database
    .prepare("INSERT INTO session (agent_id, id) VALUES (?, ?) ON CONFLICT (id) DO NOTHING")
    .bind(null, "session-1")
    .run();
  await database
    .prepare(
      `
        INSERT INTO sandbox_session (
          cloudflare_session_id,
          created_at,
          cwd,
          origin_json,
          sandbox_id,
          session_id,
          status,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .bind(
      "01J00000000000000000000001",
      1,
      "/workspace/se/session-1",
      JSON.stringify(ORIGIN),
      "01J0000000000000000000000D",
      "session-1",
      input.status,
      1,
    )
    .run();
}

async function insertConversationBackup(
  database: D1Database,
  input: { createdAt?: number; dir?: string } = {},
): Promise<void> {
  await database
    .prepare(
      `
        INSERT INTO sandbox_backup (
          created_at,
          dir,
          id,
          sandbox_id,
          status
        )
        VALUES (?, ?, ?, ?, ?)
      `,
    )
    .bind(
      input.createdAt ?? 1,
      input.dir ?? "/workspace/se/session-1",
      STORED_BACKUP_ID,
      "01J0000000000000000000000D",
      "ready",
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
    .bind("session-1")
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
    .bind("01J0000000000000000000000D")
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
    onOpen?: () => Promise<void>;
    onDelete?: () => Promise<void>;
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
      await options.onOpen?.();
      return executionSession;
    },
    async deleteSession(sessionId) {
      await options.onDelete?.();
      if (options.deleteSessionError) {
        throw options.deleteSessionError;
      }

      return { sessionId, success: true, timestamp: new Date(0).toISOString() };
    },
    async destroy() {},
    async getSession() {
      await options.onOpen?.();
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
    async ensureContainerReady() {},
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
    .bind(required ? 1 : 0, "session-1")
    .run();
}

function createInput(sandbox: SandboxHandle, kind: AgentKind = "pet") {
  return {
    agentId: "01J00000000000000000000009",
    kind,
    mountSessionResources: false,
    origin: ORIGIN,
    sandbox,
    sandboxId: "01J0000000000000000000000D",
    sessionId: "session-1",
  };
}

describe("conversation callbacks after a binding change", () => {
  for (const change of ["sandbox", "execution session", "deleted"] as const) {
    for (const operation of ["activate", "close"] as const) {
      test(`late ${operation} leaves the ${change} replacement intact`, async () => {
        const database = createConversationSessionDatabase();
        await insertConversationSession(database, { status: "active" });
        let expected: unknown;
        const beforeSandbox = await database.prepare("SELECT * FROM sandbox").all();
        const replaceBinding = async () => {
          if (change === "deleted") {
            database.execute("DELETE FROM sandbox_session WHERE session_id = 'session-1'");
          } else {
            database.execute(`
              UPDATE sandbox_session SET
                ${change === "sandbox" ? "sandbox_id = '01J0000000000000000000000E'," : ""}
                cloudflare_session_id = '01J00000000000000000000002',
                status = 'active', updated_at = 999
              WHERE session_id = 'session-1'
            `);
          }
          expected = await database.prepare("SELECT * FROM sandbox_session").all();
        };
        const sandbox = createSandbox(
          operation === "activate" ? { onOpen: replaceBinding } : { onDelete: replaceBinding },
        );

        if (operation === "activate") {
          const result = await ensureSandboxConversationSession(
            createBindings(database),
            createInput(sandbox),
          ).then(
            () => null,
            (error: unknown) => error,
          );
          expect(await database.prepare("SELECT * FROM sandbox_session").all()).toEqual(expected);
          expect(result).toBeInstanceOf(Error);
          if (!(result instanceof Error)) {
            throw new Error("Stale activation unexpectedly succeeded.");
          }
          expect(result.message).toContain("binding changed");
        } else {
          await closeSandboxConversationSession(createBindings(database, sandbox), {
            sandboxId: "01J0000000000000000000000D",
            sessionId: "session-1",
          });
          expect(await database.prepare("SELECT * FROM sandbox_session").all()).toEqual(expected);
        }
        expect(await database.prepare("SELECT * FROM sandbox").all()).toEqual(beforeSandbox);
      });
    }
  }

  test.each(["pet", "cattle"] as const)(
    "a matching %s activation failure still records its error",
    async (kind) => {
      const database = createConversationSessionDatabase(kind);
      await insertConversationSession(database, { status: "closed" });
      database.execute(`
      CREATE TRIGGER fail_activation BEFORE UPDATE ON sandbox_session
      WHEN NEW.status = 'active'
      BEGIN SELECT RAISE(ABORT, 'injected activation failure'); END;
    `);

      await expect(
        ensureSandboxConversationSession(
          createBindings(database),
          createInput(createSandbox(), kind),
        ),
      ).rejects.toThrow("injected activation failure");
      expect(await readConversationSession(database)).toMatchObject({ status: "error" });
      expect(await database.prepare("SELECT status, last_error_code FROM sandbox").first()).toEqual(
        {
          status: "cold",
          last_error_code: "runtime.conversation_mount_failed",
        },
      );
    },
  );
});

describe("ensureSandboxConversationSession", () => {
  test("reuses an active session without preparing directories", async () => {
    const database = createConversationSessionDatabase();
    await insertConversationSession(database, { status: "active" });
    const sandbox = createSandbox();

    const result = await ensureSandboxConversationSession(
      createBindings(database),
      createInput(sandbox),
    );

    expect(result.sandboxSessionId).toBe("01J00000000000000000000001");
    await expect(readConversationSession(database)).resolves.toEqual({
      cloudflare_session_id: "01J00000000000000000000001",
      cwd: "/workspace/se/session-1",
      status: "active",
    });
    await expect(readInactiveDeadline(database)).resolves.toBeNull();
  });

  test("creates a missing conversation session record", async () => {
    const database = createConversationSessionDatabase();
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

  test.each(["pet", "cattle"] as const)(
    "an active Session clears the idle deadline despite its historical %s label",
    async (kind) => {
      const database = createConversationSessionDatabase(kind);
      const sandbox = createSandbox();
      await ensureSandboxConversationSession(createBindings(database), createInput(sandbox, kind));
      expect(await readInactiveDeadline(database)).toBeNull();
    },
  );

  test("continues a warm closed cattle session with a new execution session id", async () => {
    const database = createConversationSessionDatabase("cattle");
    await insertConversationSession(database, { status: "closed" });
    const sandbox = createSandbox();

    const result = await ensureSandboxConversationSession(
      createBindings(database),
      createInput(sandbox, "cattle"),
    );

    expect(result.sandboxSessionId).not.toBe("01J00000000000000000000001");
    expect(isPlatformId(result.sandboxSessionId)).toBe(true);

    await expect(readConversationSession(database)).resolves.toMatchObject({
      cloudflare_session_id: result.sandboxSessionId,
      status: "active",
    });
    await expect(readInactiveDeadline(database)).resolves.toBeNull();
  });

  test.each(["true", "false"])(
    "restores a cold session checkpoint from its configured bucket (local %s)",
    async (localBucket) => {
      const database = createConversationSessionDatabase("cattle");
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
        { ...createBindings(database), SANDBOX_FILE_BUCKET_LOCAL: localBucket },
        createInput(sandbox, "cattle"),
      );

      expect(restoredBackup).toEqual({
        dir: "/workspace/se/session-1",
        id: CLOUDFLARE_BACKUP_ID,
        localBucket: localBucket === "true",
      });
    },
  );

  test("fails cold cattle continuation when its exact Thread checkpoint is missing", async () => {
    const database = createConversationSessionDatabase("cattle");
    await insertConversationSession(database, { status: "closed" });
    await setWorkspaceCheckpointRequired(database, true);
    await insertConversationBackup(database, { dir: "/workspace/se/another-session" });
    const sandbox = createSandbox({ cwdHasContent: false });

    await expect(
      ensureSandboxConversationSession(createBindings(database), createInput(sandbox, "cattle")),
    ).rejects.toThrow("has no committed workspace checkpoint");
  });

  test("reports an actionable error for a corrupt cattle checkpoint", async () => {
    const database = createConversationSessionDatabase("cattle");
    await insertConversationSession(database, { status: "closed" });
    await setWorkspaceCheckpointRequired(database, true);
    await insertConversationBackup(database);
    const sandbox = createSandbox({
      cwdHasContent: false,
      restoreError: new Error("backup checksum mismatch"),
    });

    await expect(
      ensureSandboxConversationSession(createBindings(database), createInput(sandbox, "cattle")),
    ).rejects.toThrow("workspace checkpoint could not be restored. Retry this Thread");
  });

  test("restores recorded artifacts for a pre-rollout cattle Thread", async () => {
    const database = createConversationSessionDatabase("cattle");
    await insertConversationSession(database, { status: "closed" });
    database.execute(`
      INSERT INTO file_record (
        id, created_at, name, object_key, parent_path, scope_id, scope_kind,
        session_kind, size, status
      ) VALUES (
        'artifact-legacy', 1, 'legacy.txt', 'artifacts/legacy.txt',
        'runtime-output/outputs/legacy.txt/${ARTIFACT_SHA256}', 'session-1', 'session',
        'artifact', 14, 'ready'
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
      createBindings(database, undefined, bucket as unknown as R2Bucket),
      createInput(sandbox, "cattle"),
    );

    expect(restoredPaths).toContain("/workspace/se/session-1/outputs/legacy.txt");
  });

  test("a legacy label cannot retain a closed execution handle or change the public Session", async () => {
    const database = createConversationSessionDatabase();
    await insertConversationSession(database, { status: "closed" });
    await setWorkspaceCheckpointRequired(database, true);
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

    expect(result.sandboxSessionId).not.toBe("01J00000000000000000000001");
    expect(isPlatformId(result.sandboxSessionId)).toBe(true);
    expect(restoredBackup).toEqual({
      dir: "/workspace/se/session-1",
      id: CLOUDFLARE_BACKUP_ID,
      localBucket: false,
    });
    await expect(readConversationSession(database)).resolves.toMatchObject({
      cloudflare_session_id: result.sandboxSessionId,
      status: "active",
    });
    expect(
      (await database.prepare("SELECT session_id FROM sandbox_session").all()).results,
    ).toEqual([{ session_id: "session-1" }]);
  });
});

describe("closeIdleConversationSession", () => {
  test("arms subject reclamation when the remote session is already absent", async () => {
    const database = createConversationSessionDatabase("cattle");
    await insertConversationSession(database, { status: "active" });
    database.execute("UPDATE sandbox SET inactive_deadline_at = NULL");
    const sandboxSessionId = "01J00000000000000000000001";
    const sandbox = createSandbox({
      deleteSessionError: new Error(`Session '${sandboxSessionId}' not found`),
    });
    const startedAt = Date.now();

    await expect(
      closeIdleConversationSession(createBindings(database, sandbox), {
        idleSinceLte: 1,
        sandboxId: "01J0000000000000000000000D",
        sessionId: "session-1",
      }),
    ).rejects.toThrow(`Session '${sandboxSessionId}' not found`);

    await expect(readConversationSession(database)).resolves.toMatchObject({ status: "closed" });
    const deadline = await readInactiveDeadline(database);
    expect(deadline).toBeGreaterThanOrEqual(startedAt + 5 * 60_000);
    expect(deadline).toBeLessThanOrEqual(Date.now() + 5 * 60_000);
  });
});
