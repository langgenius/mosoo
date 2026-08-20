import { describe, expect, test } from "bun:test";

import { releaseTerminalDriverInstanceSessionRun } from "../src/modules/runtime/infrastructure/driver-instance/terminal-run-release";
import { encodeSandboxBackupIdForStorage } from "../src/modules/runtime/infrastructure/sandbox-backup-id";
import type { SandboxHandle } from "../src/modules/runtime/infrastructure/sandbox-handles";
import { isCattleTerminalCheckpointReadyForNextRun } from "../src/modules/runtime/infrastructure/session-runs/session-run-admission.repository";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  PUBLIC_API_TEST_IDS,
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  insertOwnerSession,
} from "./helpers/public-api-http-test-fixture";
import type { SqliteD1Database } from "./helpers/sqlite-d1";

const SESSION_CWD = `/workspace/se/${PUBLIC_API_TEST_IDS.ownerSession}`;
const PRIOR_BACKUP_ID = encodeSandboxBackupIdForStorage("550e8400-e29b-41d4-a716-446655440001");
const CREATED_BACKUP_ID = "550e8400-e29b-41d4-a716-446655440002";

interface CheckpointSandboxState {
  backupAvailable: boolean;
  backupOptions: Array<{ dir: string; ttl: number | undefined }>;
  createBackupCalls: number;
}

function createCheckpointSandbox(state: CheckpointSandboxState): {
  commands: string[];
  sandbox: SandboxHandle;
} {
  const commands: string[] = [];
  const unavailable = async (): Promise<never> => {
    throw new Error("Unexpected sandbox test method call.");
  };

  return {
    commands,
    sandbox: {
      configureNetworkConstraints: unavailable,
      async createBackup(options) {
        state.createBackupCalls += 1;
        state.backupOptions.push({ dir: options.dir, ttl: options.ttl });

        if (!state.backupAvailable) {
          throw new Error("backup service unavailable");
        }

        return { dir: options.dir, id: CREATED_BACKUP_ID };
      },
      createSession: unavailable,
      deleteSession: unavailable,
      destroy: unavailable,
      async exec(command) {
        commands.push(command);
        return { exitCode: 0, stderr: "", stdout: "", success: true };
      },
      getSession: unavailable,
      mkdir: async () => {},
      mountBucket: unavailable,
      readFile: unavailable,
      restoreBackup: unavailable,
      setKeepAlive: unavailable,
      startProcess: unavailable,
      terminal: unavailable,
      unmountBucket: async () => {},
      watch: unavailable,
      writeFile: unavailable,
      wsConnect: unavailable,
    },
  };
}

async function createTerminalCheckpointFixture(): Promise<{
  bindings: ApiBindings;
  database: SqliteD1Database;
  sandboxState: CheckpointSandboxState;
  commands: string[];
}> {
  const database = await createPublicHttpContractDatabase();
  await insertOwnerSession(database);
  database.execute(`
    UPDATE session
    SET kind = 'cattle', last_message_at = 1, last_run_id = '${PUBLIC_API_TEST_IDS.run}', status = 'IDLE'
    WHERE id = '${PUBLIC_API_TEST_IDS.ownerSession}';

    INSERT INTO sandbox (
      id, kind, subject_kind, subject_id, status, bind_mount_ready,
      global_mounts_json, created_at, updated_at
    )
    VALUES (
      '${PUBLIC_API_TEST_IDS.sandbox}', 'cattle', 'session', '${PUBLIC_API_TEST_IDS.ownerSession}',
      'active', 1, '[]', 1, 1
    );

    INSERT INTO sandbox_session (
      cloudflare_session_id, created_at, cwd, origin_json, sandbox_id,
      session_id, status, updated_at
    )
    VALUES (
      '01J0000000000000000000000Z', 1, '${SESSION_CWD}',
      '{"callerUserId":"${PUBLIC_API_TEST_IDS.ownerAccount}","entrypoint":"api","executionOwnerUserId":"${PUBLIC_API_TEST_IDS.ownerAccount}","type":"agent"}',
      '${PUBLIC_API_TEST_IDS.sandbox}', '${PUBLIC_API_TEST_IDS.ownerSession}', 'active', 1
    );

    INSERT INTO driver_instance (
      id, boot_token_expires_at, boot_token_hash, connection_id, created_at,
      expires_at, heartbeat_count, protocol, protocol_version, runtime,
      sandbox_id, sandbox_session_id, status, updated_at
    )
    VALUES (
      '${PUBLIC_API_TEST_IDS.driverOwner}', 1, X'01', 'checkpoint-connection', 1, 1, 0,
      'orpc-ws', 1, 'openai-runtime', '${PUBLIC_API_TEST_IDS.sandbox}',
      '${PUBLIC_API_TEST_IDS.ownerSession}', 'ready', 1
    );

    INSERT INTO session_run (
      id, session_id, agent_id, created_by_account_id, deployment_version_id,
      deployment_version_number, driver_instance_id, trigger, status, provider,
      model, runtime_id, trace_id, started_at, completed_at, created_at, updated_at
    )
    VALUES (
      '${PUBLIC_API_TEST_IDS.run}', '${PUBLIC_API_TEST_IDS.ownerSession}', '${PUBLIC_API_TEST_IDS.agent}',
      '${PUBLIC_API_TEST_IDS.ownerAccount}', '${PUBLIC_API_TEST_IDS.deployment}', 1,
      '${PUBLIC_API_TEST_IDS.driverOwner}', 'user_prompt', 'completed', 'openai', 'gpt-5.4',
      'openai-runtime', 'trace-checkpoint', 1, 2, 1, 2
    );

    CREATE TABLE native_resume_ref (
      committed_session_run_id text,
      committed_value text,
      created_at integer NOT NULL,
      kind text NOT NULL,
      observed_driver_instance_id text,
      observed_session_run_id text,
      runtime_id text NOT NULL,
      session_id text PRIMARY KEY NOT NULL,
      updated_at integer NOT NULL,
      value text NOT NULL
    );

    INSERT INTO native_resume_ref (
      created_at, kind, observed_driver_instance_id, observed_session_run_id,
      runtime_id, session_id, updated_at, value
    )
    VALUES (
      1, 'openai_thread_id', '${PUBLIC_API_TEST_IDS.driverOwner}',
      '${PUBLIC_API_TEST_IDS.run}', 'openai-runtime', '${PUBLIC_API_TEST_IDS.ownerSession}',
      1, 'thread-checkpointed'
    );

    INSERT INTO sandbox_backup (
      created_at, dir, id, keep, sandbox_id, session_run_id, status, ttl_seconds, updated_at
    )
    VALUES (
      1, '${SESSION_CWD}', '${PRIOR_BACKUP_ID}', 0, '${PUBLIC_API_TEST_IDS.sandbox}',
      '${PUBLIC_API_TEST_IDS.runAlt}', 'ready', 315360000, 1
    );
  `);

  const sandboxState: CheckpointSandboxState = {
    backupAvailable: false,
    backupOptions: [],
    createBackupCalls: 0,
  };
  const { commands, sandbox } = createCheckpointSandbox(sandboxState);
  const bindings = {
    ...createPublicHttpTestBindings(database),
    runtimeSubjectHandleFactory: () => sandbox,
    SANDBOX_STATE_BUCKET: {
      delete: async () => {},
    },
  } as unknown as ApiBindings;

  return { bindings, commands, database, sandboxState };
}

describe("cattle terminal checkpoint", () => {
  test("keeps the last good checkpoint and blocks continuation until a retry commits the Run", async () => {
    const { bindings, commands, database, sandboxState } = await createTerminalCheckpointFixture();

    await expect(
      releaseTerminalDriverInstanceSessionRun(bindings, {
        driverInstanceId: PUBLIC_API_TEST_IDS.driverOwner,
        sessionRunId: PUBLIC_API_TEST_IDS.run,
      }),
    ).rejects.toThrow("checkpoint failed");

    await expect(
      isCattleTerminalCheckpointReadyForNextRun(database, PUBLIC_API_TEST_IDS.ownerSession),
    ).resolves.toBe(false);
    const afterFailure = await database
      .prepare("SELECT id, session_run_id FROM sandbox_backup ORDER BY created_at")
      .all<{ id: string; session_run_id: string | null }>();
    expect(afterFailure.results).toEqual([
      { id: PRIOR_BACKUP_ID, session_run_id: PUBLIC_API_TEST_IDS.runAlt },
    ]);
    await expect(
      database
        .prepare("SELECT committed_session_run_id, committed_value FROM native_resume_ref")
        .first(),
    ).resolves.toEqual({ committed_session_run_id: null, committed_value: null });

    sandboxState.backupAvailable = true;
    await releaseTerminalDriverInstanceSessionRun(bindings, {
      driverInstanceId: PUBLIC_API_TEST_IDS.driverOwner,
      sessionRunId: PUBLIC_API_TEST_IDS.run,
    });

    await expect(
      isCattleTerminalCheckpointReadyForNextRun(database, PUBLIC_API_TEST_IDS.ownerSession),
    ).resolves.toBe(true);
    const committed = await database
      .prepare(
        "SELECT dir, session_run_id, status, ttl_seconds FROM sandbox_backup WHERE session_run_id = ?",
      )
      .bind(PUBLIC_API_TEST_IDS.run)
      .first<{
        dir: string;
        session_run_id: string;
        status: string;
        ttl_seconds: number;
      }>();
    expect(committed).toEqual({
      dir: SESSION_CWD,
      session_run_id: PUBLIC_API_TEST_IDS.run,
      status: "ready",
      ttl_seconds: 10 * 365 * 24 * 60 * 60,
    });
    await expect(
      database
        .prepare("SELECT committed_session_run_id, committed_value FROM native_resume_ref")
        .first(),
    ).resolves.toEqual({
      committed_session_run_id: PUBLIC_API_TEST_IDS.run,
      committed_value: "thread-checkpointed",
    });
    expect(sandboxState.backupOptions).toEqual([
      { dir: SESSION_CWD, ttl: 10 * 365 * 24 * 60 * 60 },
      { dir: SESSION_CWD, ttl: 10 * 365 * 24 * 60 * 60 },
    ]);
    expect(commands.join("\n")).toContain("session-files");
    expect(commands.join("\n")).toContain("driver-boot-payload-*.json");
    expect(commands.join("\n")).toContain("openai-runtime/auth.json");

    await releaseTerminalDriverInstanceSessionRun(bindings, {
      driverInstanceId: PUBLIC_API_TEST_IDS.driverOwner,
      sessionRunId: PUBLIC_API_TEST_IDS.run,
    });
    expect(sandboxState.createBackupCalls).toBe(2);
  });
});
