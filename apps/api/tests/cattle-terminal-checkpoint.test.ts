import { describe, expect, test } from "bun:test";

import { getSessionRuntimeStatePath } from "@mosoo/agent-driver/paths";

import { cleanupDriverInstances } from "../src/modules/runtime/infrastructure/driver-instance/maintenance";
import {
  releaseTerminalDriverInstanceSessionRun,
  repairTerminalDriverRuntimeCommandsGlobally,
} from "../src/modules/runtime/infrastructure/driver-instance/terminal-run-release";
import { repairClaimedDriverStopsGlobally } from "../src/modules/runtime/infrastructure/driver-session-stop.service";
import { encodeSandboxBackupIdForStorage } from "../src/modules/runtime/infrastructure/sandbox-backup-id";
import {
  claimSandboxBackupStageActual,
  finalizeSandboxBackupStage,
  getSandboxBackupStage,
  stageSandboxBackupWrites,
} from "../src/modules/runtime/infrastructure/sandbox-backup-store";
import type {
  RuntimeSubjectIncarnationHandle,
  SandboxHandle,
} from "../src/modules/runtime/infrastructure/sandbox-handles";
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
  backupOptions: Array<{
    dir: string;
    excludes: string[] | undefined;
    forbiddenPaths: string[] | undefined;
    name: string;
    ttl: number | undefined;
  }>;
  createBackupCalls: number;
}

function createCheckpointSandbox(state: CheckpointSandboxState): {
  commands: string[];
  sandbox: RuntimeSubjectIncarnationHandle & SandboxHandle;
} {
  const commands: string[] = [];
  const unavailable = async (): Promise<never> => {
    throw new Error("Unexpected sandbox test method call.");
  };

  return {
    commands,
    sandbox: {
      activateRuntimeSubjectIncarnation: unavailable,
      configureNetworkConstraints: unavailable,
      createBackup: unavailable,
      async createRuntimeSubjectBackup(_incarnation, options) {
        state.createBackupCalls += 1;
        state.backupOptions.push({
          dir: options.dir,
          excludes: options.excludes,
          forbiddenPaths: options.forbiddenPaths,
          name: options.name,
          ttl: options.ttl,
        });

        if (!state.backupAvailable) {
          throw new Error("backup service unavailable");
        }

        return { dir: options.dir, id: CREATED_BACKUP_ID };
      },
      createSession: unavailable,
      deleteSession: unavailable,
      destroy: unavailable,
      destroyRuntimeSubjectIncarnation: unavailable,
      async exec(command) {
        commands.push(command);
        return { exitCode: 0, stderr: "", stdout: "", success: true };
      },
      getSession: unavailable,
      inspectRuntimeSubjectIncarnation: unavailable,
      markRuntimeSubjectIncarnationReady: unavailable,
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
    SET kind = 'cattle', last_message_at = 1, last_run_id = '${PUBLIC_API_TEST_IDS.run}',
        status = 'IDLE', workspace_checkpoint_required = 1
    WHERE id = '${PUBLIC_API_TEST_IDS.ownerSession}';

    INSERT INTO sandbox (
      agent_id, project_id, id, incarnation, kind, network_constraints_hash,
      owner_account_id, subject_kind, subject_id, status, bind_mount_ready,
      global_mounts_json, created_at, updated_at
    )
    VALUES (
      '${PUBLIC_API_TEST_IDS.agent}', '${PUBLIC_API_TEST_IDS.project}',
      '${PUBLIC_API_TEST_IDS.sandbox}', 1, 'cattle', '${"0".repeat(64)}',
      '${PUBLIC_API_TEST_IDS.ownerAccount}', 'session', '${PUBLIC_API_TEST_IDS.ownerSession}',
      'active', 1, '[]', 1, 1
    );

    INSERT INTO sandbox_session (
      cloudflare_session_id, created_at, cwd, origin_json, sandbox_id,
      sandbox_incarnation, session_id, status, updated_at
    )
    VALUES (
      '01J0000000000000000000000Z', 1, '${SESSION_CWD}',
      '{"callerUserId":"${PUBLIC_API_TEST_IDS.ownerAccount}","entrypoint":"api","executionOwnerUserId":"${PUBLIC_API_TEST_IDS.ownerAccount}","type":"agent"}',
      '${PUBLIC_API_TEST_IDS.sandbox}', 1, '${PUBLIC_API_TEST_IDS.ownerSession}', 'active', 1
    );

    INSERT INTO driver_instance (
      id, boot_token_expires_at, boot_token_hash, connection_id, created_at,
      expires_at, heartbeat_count, protocol, protocol_version, runtime,
      sandbox_id, sandbox_incarnation, sandbox_session_id, status, updated_at
    )
    VALUES (
      '${PUBLIC_API_TEST_IDS.driverOwner}', 1, X'01', 'checkpoint-connection', 1, 1, 0,
      'orpc-ws', 1, 'openai-runtime', '${PUBLIC_API_TEST_IDS.sandbox}',
      1, '${PUBLIC_API_TEST_IDS.ownerSession}', 'ready', 1
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
      created_at, dir, id, keep, sandbox_id, sandbox_incarnation, session_run_id,
      staging_id, status, ttl_seconds, updated_at, workspace_session_id
    )
    VALUES (
      1, '${SESSION_CWD}', '${PRIOR_BACKUP_ID}', 0, '${PUBLIC_API_TEST_IDS.sandbox}', 0,
      '${PUBLIC_API_TEST_IDS.runAlt}', '${PRIOR_BACKUP_ID}', 'ready', 315360000, 1,
      '${PUBLIC_API_TEST_IDS.ownerSession}'
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
  test("an old terminal Run cannot commit its resume ref after a successor starts", async () => {
    const { database } = await createTerminalCheckpointFixture();
    database.execute(`
      UPDATE driver_instance
      SET status_operation_id = '${PUBLIC_API_TEST_IDS.run}'
      WHERE id = '${PUBLIC_API_TEST_IDS.driverOwner}'
    `);
    const [write] = await stageSandboxBackupWrites(database, {
      admission: {
        driverGeneration: 0,
        driverInstanceId: PUBLIC_API_TEST_IDS.driverOwner,
        incarnation: 1,
        kind: "terminal",
        sessionId: PUBLIC_API_TEST_IDS.ownerSession,
        sessionRunId: PUBLIC_API_TEST_IDS.run,
      },
      sandboxId: PUBLIC_API_TEST_IDS.sandbox,
      targets: [
        {
          dir: SESSION_CWD,
          updateSandboxLastBackup: false,
          workspaceSessionId: PUBLIC_API_TEST_IDS.ownerSession,
        },
      ],
      ttlSeconds: 100,
    });
    if (write?.kind !== "staged") {
      throw new Error("Terminal backup stage was not created.");
    }
    const actualBackupId = encodeSandboxBackupIdForStorage("550e8400-e29b-41d4-a716-446655440004");
    await claimSandboxBackupStageActual(database, {
      actualBackupId,
      dir: SESSION_CWD,
      sandboxIncarnation: 1,
      stagingId: write.stage.id,
    });
    await database
      .prepare(
        `INSERT INTO sandbox_backup (
           created_at, dir, id, keep, sandbox_id, sandbox_incarnation, session_run_id,
           staging_id, status, ttl_seconds, updated_at, workspace_session_id
         ) SELECT created_at, dir, actual_backup_id, 0, sandbox_id, sandbox_incarnation,
             session_run_id, id, 'ready', ttl_seconds,
             CAST(unixepoch('subsec') * 1000 AS INTEGER), workspace_session_id
           FROM sandbox_backup_staging WHERE id = ?`,
      )
      .bind(write.stage.id)
      .run();
    database.execute(`
      INSERT INTO session_run (
        id, session_id, agent_id, created_by_account_id, deployment_version_id,
        deployment_version_number, driver_instance_id, trigger, status, provider,
        model, runtime_id, trace_id, started_at, created_at, updated_at
      ) VALUES (
        '${PUBLIC_API_TEST_IDS.runAlt}', '${PUBLIC_API_TEST_IDS.ownerSession}',
        '${PUBLIC_API_TEST_IDS.agent}', '${PUBLIC_API_TEST_IDS.ownerAccount}',
        '${PUBLIC_API_TEST_IDS.deployment}', 1, '${PUBLIC_API_TEST_IDS.driverOwner}',
        'resume', 'running', 'openai', 'gpt-5.4', 'openai-runtime',
        'trace-successor', 3, 3, 3
      )
    `);

    await expect(
      finalizeSandboxBackupStage(database, {
        actualBackupId,
        stagingId: write.stage.id,
      }),
    ).resolves.toMatchObject({ candidateAccepted: true, complete: false });
    await expect(
      database
        .prepare("SELECT committed_session_run_id, committed_value FROM native_resume_ref")
        .first(),
    ).resolves.toEqual({ committed_session_run_id: null, committed_value: null });
    await expect(getSandboxBackupStage(database, write.stage.id)).resolves.not.toBeNull();
  });

  test("does not admit a Thread from another workspace's same-path checkpoint", async () => {
    const foreignBackupId = encodeSandboxBackupIdForStorage("550e8400-e29b-41d4-a716-446655440003");
    const insertCheckpoint = async (
      database: D1Database,
      workspaceSessionId: string,
    ): Promise<void> => {
      await database
        .prepare(
          `INSERT INTO sandbox_backup (
           created_at, dir, id, keep, sandbox_id, sandbox_incarnation, session_run_id,
           staging_id, status, ttl_seconds, updated_at, workspace_session_id
         ) VALUES (2, ?, ?, 0, ?, 1, ?, ?, 'ready', 315360000, 2, ?)`,
        )
        .bind(
          SESSION_CWD,
          foreignBackupId,
          PUBLIC_API_TEST_IDS.sandbox,
          PUBLIC_API_TEST_IDS.run,
          foreignBackupId,
          workspaceSessionId,
        )
        .run();
    };

    const { database } = await createTerminalCheckpointFixture();
    await insertCheckpoint(database, PUBLIC_API_TEST_IDS.nonOwnerSession);

    await expect(
      isCattleTerminalCheckpointReadyForNextRun(database, PUBLIC_API_TEST_IDS.ownerSession),
    ).resolves.toBe(false);

    const { database: ownerDatabase } = await createTerminalCheckpointFixture();
    await insertCheckpoint(ownerDatabase, PUBLIC_API_TEST_IDS.ownerSession);
    await expect(
      isCattleTerminalCheckpointReadyForNextRun(ownerDatabase, PUBLIC_API_TEST_IDS.ownerSession),
    ).resolves.toBe(true);
  });

  test("maintenance hands a stopped foreign owner to the terminal Run without a command ledger", async () => {
    const fixture = await createTerminalCheckpointFixture();
    fixture.sandboxState.backupAvailable = true;
    fixture.database.execute(`
      UPDATE driver_instance
      SET expires_at = 9999999999999, status = 'stopped',
          status_operation_id = '${PUBLIC_API_TEST_IDS.operation}'
      WHERE id = '${PUBLIC_API_TEST_IDS.driverOwner}'
    `);
    const controlRequests: string[] = [];
    const bindings = {
      ...fixture.bindings,
      DriverConnection: {
        get: () => ({
          fetch: async (request: Request) => {
            controlRequests.push(new URL(request.url).pathname);
            return Response.json({ ok: true });
          },
        }),
        idFromName: () => "driver-do-id",
      },
    } as unknown as ApiBindings;

    await expect(
      fixture.database.prepare("SELECT COUNT(*) AS count FROM driver_command").first(),
    ).resolves.toEqual({ count: 0 });

    await cleanupDriverInstances(bindings);

    expect(controlRequests).toEqual(["/control/destroy"]);
    expect(fixture.sandboxState.createBackupCalls).toBe(1);
    await expect(
      fixture.database
        .prepare("SELECT status_operation_id FROM driver_instance WHERE id = ?")
        .bind(PUBLIC_API_TEST_IDS.driverOwner)
        .first(),
    ).resolves.toEqual({ status_operation_id: null });
    await expect(
      fixture.database
        .prepare("SELECT driver_instance_id FROM session_run WHERE id = ?")
        .bind(PUBLIC_API_TEST_IDS.run)
        .first(),
    ).resolves.toEqual({ driver_instance_id: PUBLIC_API_TEST_IDS.driverOwner });
  });

  test("does not run foreign-owner terminal side effects after the Driver generation rotates", async () => {
    const fixture = await createTerminalCheckpointFixture();
    fixture.sandboxState.backupAvailable = true;
    fixture.database.execute(`
      UPDATE driver_instance
      SET status = 'stopped', status_operation_id = '${PUBLIC_API_TEST_IDS.operation}'
      WHERE id = '${PUBLIC_API_TEST_IDS.driverOwner}'
    `);
    let rotateAfterCandidateRead = true;
    const interceptCandidateRead = (statement: D1PreparedStatement): D1PreparedStatement =>
      new Proxy(statement, {
        get(target, property, receiver) {
          if (property === "bind") {
            return (...values: unknown[]) =>
              interceptCandidateRead(Reflect.apply(target.bind, target, values));
          }
          if (property === "all" || property === "raw") {
            return async (...args: unknown[]) => {
              const read = property === "all" ? target.all : target.raw;
              const result = await Reflect.apply(read, target, args);
              rotateAfterCandidateRead = false;
              fixture.database.execute(`
                UPDATE driver_instance
                SET generation = generation + 1
                WHERE id = '${PUBLIC_API_TEST_IDS.driverOwner}'
              `);
              return result;
            };
          }
          return Reflect.get(target, property, receiver);
        },
      });
    const racingDatabase = new Proxy(fixture.database, {
      get(target, property) {
        if (property === "prepare") {
          return (query: string) => {
            const statement = target.prepare(query);
            return rotateAfterCandidateRead && query.includes("status_operation_id")
              ? interceptCandidateRead(statement)
              : statement;
          };
        }
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    let controlRequests = 0;
    const bindings = {
      ...fixture.bindings,
      DB: racingDatabase,
      DriverConnection: {
        get: () => ({
          fetch: async () => {
            controlRequests += 1;
            return Response.json({ ok: true });
          },
        }),
        idFromName: () => "driver-do-id",
      },
    } as unknown as ApiBindings;

    await repairClaimedDriverStopsGlobally(bindings);

    expect(rotateAfterCandidateRead).toBe(false);
    expect(controlRequests).toBe(0);
    expect(fixture.sandboxState.createBackupCalls).toBe(0);
    await expect(
      fixture.database
        .prepare("SELECT generation, status_operation_id FROM driver_instance WHERE id = ?")
        .bind(PUBLIC_API_TEST_IDS.driverOwner)
        .first(),
    ).resolves.toEqual({ generation: 1, status_operation_id: PUBLIC_API_TEST_IDS.operation });
    await expect(
      fixture.database
        .prepare("SELECT driver_instance_id FROM session_run WHERE id = ?")
        .bind(PUBLIC_API_TEST_IDS.run)
        .first(),
    ).resolves.toEqual({ driver_instance_id: PUBLIC_API_TEST_IDS.driverOwner });
  });

  test("rejects an old Driver generation before checkpoint or conversation side effects", async () => {
    const { bindings, commands, database, sandboxState } = await createTerminalCheckpointFixture();
    sandboxState.backupAvailable = true;
    database.execute(`
      UPDATE driver_instance
      SET generation = 1
      WHERE id = '${PUBLIC_API_TEST_IDS.driverOwner}';

      INSERT INTO session_run (
        id, session_id, agent_id, created_by_account_id, deployment_version_id,
        deployment_version_number, driver_instance_id, trigger, status, provider,
        model, runtime_id, trace_id, started_at, created_at, updated_at
      )
      VALUES (
        '${PUBLIC_API_TEST_IDS.runAlt}', '${PUBLIC_API_TEST_IDS.ownerSession}',
        '${PUBLIC_API_TEST_IDS.agent}', '${PUBLIC_API_TEST_IDS.ownerAccount}',
        '${PUBLIC_API_TEST_IDS.deployment}', 1, '${PUBLIC_API_TEST_IDS.driverOwner}',
        'resume', 'running', 'openai', 'gpt-5.4', 'openai-runtime', 'trace-r2', 3, 3, 3
      );

      UPDATE session
      SET last_run_id = '${PUBLIC_API_TEST_IDS.runAlt}', status = 'RUNNING', updated_at = 3
      WHERE id = '${PUBLIC_API_TEST_IDS.ownerSession}';
    `);

    await expect(
      releaseTerminalDriverInstanceSessionRun(bindings, {
        driverGeneration: 0,
        driverInstanceId: PUBLIC_API_TEST_IDS.driverOwner,
        sessionRunId: PUBLIC_API_TEST_IDS.run,
      }),
    ).rejects.toThrow("exact Driver ownership");
    expect(sandboxState.createBackupCalls).toBe(0);
    expect(commands).toEqual([]);
    await expect(
      database
        .prepare("SELECT status FROM sandbox_session WHERE session_id = ?")
        .bind(PUBLIC_API_TEST_IDS.ownerSession)
        .first("status"),
    ).resolves.toBe("active");
  });

  test("keeps the last good checkpoint and blocks continuation until a retry commits the Run", async () => {
    const { bindings, commands, database, sandboxState } = await createTerminalCheckpointFixture();

    await expect(
      releaseTerminalDriverInstanceSessionRun(bindings, {
        driverGeneration: 0,
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
    await repairTerminalDriverRuntimeCommandsGlobally(bindings);

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
      expect.objectContaining({
        dir: SESSION_CWD,
        excludes: undefined,
        forbiddenPaths: [
          `${getSessionRuntimeStatePath(PUBLIC_API_TEST_IDS.ownerSession, "openai-runtime")}/auth.json`,
        ],
        ttl: 10 * 365 * 24 * 60 * 60,
      }),
      expect.objectContaining({
        dir: SESSION_CWD,
        excludes: undefined,
        forbiddenPaths: [
          `${getSessionRuntimeStatePath(PUBLIC_API_TEST_IDS.ownerSession, "openai-runtime")}/auth.json`,
        ],
        ttl: 10 * 365 * 24 * 60 * 60,
      }),
    ]);
    expect(
      sandboxState.backupOptions.every(({ name }) => name.startsWith("mosoo:runtime-backup:v1:")),
    ).toBe(true);
    expect(commands).toEqual([]);

    await repairTerminalDriverRuntimeCommandsGlobally(bindings);
    expect(sandboxState.createBackupCalls).toBe(2);
    const commandCount = commands.length;
    await releaseTerminalDriverInstanceSessionRun(bindings, {
      driverGeneration: 0,
      driverInstanceId: PUBLIC_API_TEST_IDS.driverOwner,
      sessionRunId: PUBLIC_API_TEST_IDS.run,
    });
    expect(sandboxState.createBackupCalls).toBe(2);
    expect(commands).toHaveLength(commandCount);
  });
});
