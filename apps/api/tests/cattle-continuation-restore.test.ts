import { describe, expect, test } from "bun:test";

import { sandboxBackupsTable, sandboxSessionsTable, sandboxesTable } from "@mosoo/db";

import { encodeSandboxBackupIdForStorage } from "../src/modules/runtime/infrastructure/sandbox-backup-id";
import type {
  ExecutionSessionHandle,
  RuntimeCommandResultHandle,
  SandboxHandle,
} from "../src/modules/runtime/infrastructure/sandbox-handles";
import { ensureSandboxConversationSession } from "../src/modules/runtime/infrastructure/sandbox-session/sandbox-conversation-session.service";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  PUBLIC_API_TEST_IDS,
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  insertOwnerSession,
  nowMsForTest,
} from "./helpers/public-api-http-test-fixture";
import type { SqliteD1Database } from "./helpers/sqlite-d1";

const SESSION_CWD = "/workspace/se/01J00000000000000000000007";
const PRIOR_SANDBOX_SESSION_ID = "01J000000000000000000000Z2";
const CLOUDFLARE_BACKUP_ID = "550e8400-e29b-41d4-a716-446655440000";
const STORED_BACKUP_ID = encodeSandboxBackupIdForStorage(CLOUDFLARE_BACKUP_ID);
const ORIGIN = {
  callerUserId: PUBLIC_API_TEST_IDS.ownerAccount,
  entrypoint: "api",
  executionOwnerUserId: PUBLIC_API_TEST_IDS.ownerAccount,
  type: "agent",
} as const;

function commandResult(success: boolean): RuntimeCommandResultHandle {
  return {
    exitCode: success ? 0 : 1,
    stderr: "",
    stdout: "",
    success,
  };
}

function createContinuationSandbox(input: { restoreError?: Error } = {}): {
  restoredBackups: Array<{ readonly dir: string; readonly id: string }>;
  sandbox: SandboxHandle;
} {
  const restoredBackups: Array<{ readonly dir: string; readonly id: string }> = [];
  const unavailable = async (): Promise<never> => {
    throw new Error("Unexpected sandbox test method call.");
  };
  const executionSession: ExecutionSessionHandle = {
    exec: unavailable,
    mkdir: async () => {},
    readFile: unavailable,
    startProcess: unavailable,
    watch: unavailable,
    writeFile: unavailable,
  };

  return {
    restoredBackups,
    sandbox: {
      configureNetworkConstraints: unavailable,
      createBackup: unavailable,
      createSession: async () => executionSession,
      deleteSession: unavailable,
      destroy: unavailable,
      exec: async () => commandResult(false),
      getSession: async () => executionSession,
      mkdir: async () => {},
      mountBucket: unavailable,
      readFile: unavailable,
      async restoreBackup(backup) {
        if (input.restoreError) {
          throw input.restoreError;
        }

        restoredBackups.push(backup);
        return backup;
      },
      setKeepAlive: unavailable,
      startProcess: unavailable,
      terminal: unavailable,
      unmountBucket: unavailable,
      watch: unavailable,
      writeFile: unavailable,
      wsConnect: unavailable,
    },
  };
}

async function createContinuationFixture(): Promise<{
  bindings: ApiBindings;
  database: SqliteD1Database;
}> {
  const database = await createPublicHttpContractDatabase();
  await insertOwnerSession(database);
  await database
    .prepare("UPDATE session SET kind = 'cattle', workspace_checkpoint_required = 1 WHERE id = ?")
    .bind(PUBLIC_API_TEST_IDS.ownerSession)
    .run();
  const bindings = createPublicHttpTestBindings(database) as ApiBindings;
  const now = nowMsForTest();

  await database
    .app()
    .insert(sandboxesTable)
    .values({
      createdAt: now,
      id: PUBLIC_API_TEST_IDS.sandbox,
      kind: "cattle",
      status: "active",
      subjectId: PUBLIC_API_TEST_IDS.ownerSession,
      subjectKind: "session",
      updatedAt: now,
    })
    .run();
  await database
    .app()
    .insert(sandboxSessionsTable)
    .values({
      createdAt: now,
      cwd: SESSION_CWD,
      originJson: JSON.stringify(ORIGIN),
      sandboxId: PUBLIC_API_TEST_IDS.sandbox,
      sandboxSessionId: PRIOR_SANDBOX_SESSION_ID,
      sessionId: PUBLIC_API_TEST_IDS.ownerSession,
      status: "closed",
      updatedAt: now,
    })
    .run();
  await database
    .app()
    .insert(sandboxBackupsTable)
    .values({
      createdAt: now - 20 * 24 * 60 * 60 * 1000,
      dir: SESSION_CWD,
      id: STORED_BACKUP_ID,
      keep: false,
      sandboxId: PUBLIC_API_TEST_IDS.sandbox,
      status: "ready",
      ttlSeconds: 10 * 365 * 24 * 60 * 60,
      updatedAt: now,
    })
    .run();

  return { bindings, database };
}

function createInput(sandbox: SandboxHandle) {
  return {
    agentId: PUBLIC_API_TEST_IDS.agent,
    kind: "cattle" as const,
    mountSessionResources: false,
    origin: ORIGIN,
    sandbox,
    sandboxId: PUBLIC_API_TEST_IDS.sandbox,
    sessionId: PUBLIC_API_TEST_IDS.ownerSession,
  };
}

describe("recycled cattle sandbox continuation", () => {
  test("restores the complete 20-day-old Thread checkpoint before opening a new execution session", async () => {
    const { bindings } = await createContinuationFixture();
    const { restoredBackups, sandbox } = createContinuationSandbox();

    const result = await ensureSandboxConversationSession(bindings, createInput(sandbox));

    expect(result.sandboxSessionId).not.toBe(PRIOR_SANDBOX_SESSION_ID);
    expect(result.cwd).toBe(SESSION_CWD);
    expect(restoredBackups).toEqual([
      {
        dir: SESSION_CWD,
        id: CLOUDFLARE_BACKUP_ID,
      },
    ]);
  });

  test("leaves a failed restore retryable and idempotently restores the same committed checkpoint", async () => {
    const { bindings, database } = await createContinuationFixture();
    const failed = createContinuationSandbox({
      restoreError: new Error("backup unavailable"),
    });

    await expect(
      ensureSandboxConversationSession(bindings, createInput(failed.sandbox)),
    ).rejects.toThrow("workspace checkpoint could not be restored");

    const rowAfterFailure = await database
      .app()
      .select({ status: sandboxSessionsTable.status })
      .from(sandboxSessionsTable)
      .get();
    expect(rowAfterFailure?.status).toBe("closed");

    const retried = createContinuationSandbox();
    await ensureSandboxConversationSession(bindings, createInput(retried.sandbox));

    expect(retried.restoredBackups).toEqual([
      {
        dir: SESSION_CWD,
        id: CLOUDFLARE_BACKUP_ID,
      },
    ]);
  });
});
