import { describe, expect, test } from "bun:test";

import type { DriverInstanceId, SessionRunId } from "@mosoo/id";

import { recordCanonicalSessionRunFailure } from "../src/modules/runtime/application/session-runs/session-run-terminal-failure.service";
import { classifyReclaim } from "../src/modules/runtime/domain/session-run-reclaim-recovery";
import { createSessionRunTerminalFailureSourceId } from "../src/modules/runtime/domain/session-run-terminal-event-id";
import { recordDriverInstanceFailure } from "../src/modules/runtime/infrastructure/driver-instance/terminal-driver-events";
import {
  releaseTerminalDriverInstanceSessionRun,
  repairFinalizedTerminalDriverRunState,
} from "../src/modules/runtime/infrastructure/driver-instance/terminal-run-release";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  insertActiveSandboxSessionFixture,
  insertOwnerSession,
  PUBLIC_API_TEST_IDS,
} from "./helpers/public-api-http-test-fixture";
import type { SqliteD1Database } from "./helpers/sqlite-d1";

const DRIVER_INSTANCE_ID = PUBLIC_API_TEST_IDS.driverOwner as DriverInstanceId;
const SESSION_RUN_ID = "01J0000000000000000000000T" as SessionRunId;
const SUCCESSOR_SESSION_RUN_ID = "01J0000000000000000000000V" as SessionRunId;

async function createTerminalReleaseFixture(): Promise<{
  bindings: ApiBindings;
  database: SqliteD1Database;
}> {
  const database = await createPublicHttpContractDatabase();
  await insertOwnerSession(database);
  await insertActiveSandboxSessionFixture(database, {
    ownerAccountId: PUBLIC_API_TEST_IDS.ownerAccount,
    sandboxId: PUBLIC_API_TEST_IDS.sandbox,
    sandboxSessionId: "01J0000000000000000000000W",
    sessionId: PUBLIC_API_TEST_IDS.ownerSession,
    timestampMs: 1,
  });
  database.execute(`
    INSERT INTO driver_instance (
      id, boot_token_expires_at, boot_token_hash, connection_id, created_at,
      expires_at, heartbeat_count, protocol, protocol_version, runtime,
      sandbox_id, sandbox_incarnation, sandbox_session_id, status, updated_at
    ) VALUES (
      '${DRIVER_INSTANCE_ID}', 1, X'01', 'terminal-recovery-connection', 1,
      1, 0, 'orpc-ws', 1, 'openai-runtime', '${PUBLIC_API_TEST_IDS.sandbox}',
      1, '${PUBLIC_API_TEST_IDS.ownerSession}', 'stopped', 1
    );

    INSERT INTO session_run (
      id, session_id, agent_id, created_by_account_id, deployment_version_id,
      deployment_version_number, driver_instance_id, trigger, status, provider,
      model, runtime_id, trace_id, started_at, created_at, updated_at
    ) VALUES (
      '${SESSION_RUN_ID}', '${PUBLIC_API_TEST_IDS.ownerSession}', '${PUBLIC_API_TEST_IDS.agent}',
      '${PUBLIC_API_TEST_IDS.ownerAccount}', '${PUBLIC_API_TEST_IDS.deployment}', 1,
      '${DRIVER_INSTANCE_ID}', 'user_prompt', 'running', 'openai', 'gpt-5.4',
      'openai-runtime', 'trace-terminal-recovery', 1, 1, 1
    );

    UPDATE session
    SET last_run_id = '${SESSION_RUN_ID}', status = 'RUNNING'
    WHERE id = '${PUBLIC_API_TEST_IDS.ownerSession}';
  `);

  return {
    bindings: createPublicHttpTestBindings(database) as ApiBindings,
    database,
  };
}

async function recordReclaimFailure(bindings: ApiBindings): Promise<void> {
  const outcome = await recordCanonicalSessionRunFailure(bindings, {
    error: classifyReclaim({
      driverInstanceId: DRIVER_INSTANCE_ID,
      driverTerminalStatus: "stopped",
      reclaimReason: "socket_closed",
    }),
    runId: SESSION_RUN_ID,
    sessionId: PUBLIC_API_TEST_IDS.ownerSession,
    source: "driver",
  });

  expect(outcome.kind).toBe("failed");
}

async function readReleaseState(database: D1Database): Promise<{
  inactiveDeadlineAt: number | null;
  sandboxUpdatedAt: number;
}> {
  const row = await database
    .prepare(
      "SELECT inactive_deadline_at AS inactiveDeadlineAt, updated_at AS sandboxUpdatedAt FROM sandbox WHERE id = ?",
    )
    .bind(PUBLIC_API_TEST_IDS.sandbox)
    .first<{
      inactiveDeadlineAt: number | null;
      sandboxUpdatedAt: number;
    }>();

  if (row === null) {
    throw new Error("Sandbox release state was not found.");
  }

  return row;
}

describe("terminal Run release recovery", () => {
  test("releases a Driver failure reported before the connection becomes ready", async () => {
    const { bindings, database } = await createTerminalReleaseFixture();
    database.execute(`
      UPDATE driver_instance
      SET status = 'connecting', status_operation_id = NULL
      WHERE id = '${DRIVER_INSTANCE_ID}';
    `);

    await recordDriverInstanceFailure(bindings, {
      driverConnectionId: "terminal-recovery-connection",
      driverGeneration: 0,
      driverInstanceId: DRIVER_INSTANCE_ID,
      sessionRunId: SESSION_RUN_ID,
      error: {
        code: "driver.startup_failed",
        details: {},
        message: "Driver failed before ready.",
        retryable: true,
      },
    });
    await expect(
      database
        .prepare("SELECT status, status_operation_id FROM driver_instance WHERE id = ?")
        .bind(DRIVER_INSTANCE_ID)
        .first(),
    ).resolves.toEqual({ status: "stopping", status_operation_id: SESSION_RUN_ID });
    await expect(
      database
        .prepare("SELECT error_code, status FROM session_run WHERE id = ?")
        .bind(SESSION_RUN_ID)
        .first(),
    ).resolves.toEqual({ error_code: "driver.startup_failed", status: "failed" });
  });

  test("does not release a replacement connection from an old terminal RPC", async () => {
    const { bindings, database } = await createTerminalReleaseFixture();
    await recordReclaimFailure(bindings);
    const beforeRelease = await readReleaseState(database);
    const commandId = "01J0000000000000000000000X";

    await database
      .prepare(
        `INSERT INTO driver_command (
           driver_generation, driver_instance_id, id, issued_at, kind,
           payload_json, seq, status
         ) VALUES (?, ?, ?, ?, 'input.start', ?, ?, 'accepted')`,
      )
      .bind(
        0,
        DRIVER_INSTANCE_ID,
        commandId,
        1,
        JSON.stringify({
          commandId,
          input: { text: "continue" },
          kind: "input.start",
          requestId: "replacement-command",
          runId: SESSION_RUN_ID,
        }),
        1,
      )
      .run();
    database.execute(`
      UPDATE driver_instance
      SET connection_id = 'replacement-connection', status_operation_id = NULL
      WHERE id = '${DRIVER_INSTANCE_ID}';
    `);

    await expect(
      releaseTerminalDriverInstanceSessionRun(bindings, {
        expectedDriverConnectionId: "terminal-recovery-connection",
        driverGeneration: 0,
        driverInstanceId: DRIVER_INSTANCE_ID,
        sessionRunId: SESSION_RUN_ID,
      }),
    ).rejects.toThrow("lost its exact Driver ownership");
    await expect(
      database
        .prepare("SELECT connection_id, status_operation_id FROM driver_instance WHERE id = ?")
        .bind(DRIVER_INSTANCE_ID)
        .first(),
    ).resolves.toEqual({
      connection_id: "replacement-connection",
      status_operation_id: null,
    });
    await expect(
      database
        .prepare("SELECT error_json, result_json, status FROM driver_command WHERE id = ?")
        .bind(commandId)
        .first(),
    ).resolves.toEqual({ error_json: null, result_json: null, status: "accepted" });
    expect(await readReleaseState(database)).toEqual(beforeRelease);
  });

  test("does not let an old terminal Run claim a Driver owned by an active successor", async () => {
    const { bindings, database } = await createTerminalReleaseFixture();
    await recordReclaimFailure(bindings);
    database.execute(`
      INSERT INTO session_run (
        id, session_id, agent_id, created_by_account_id, deployment_version_id,
        deployment_version_number, driver_instance_id, trigger, status, provider,
        model, runtime_id, trace_id, started_at, created_at, updated_at
      ) VALUES (
        '${SUCCESSOR_SESSION_RUN_ID}', '${PUBLIC_API_TEST_IDS.ownerSession}',
        '${PUBLIC_API_TEST_IDS.agent}', '${PUBLIC_API_TEST_IDS.ownerAccount}',
        '${PUBLIC_API_TEST_IDS.deployment}', 1, '${DRIVER_INSTANCE_ID}',
        'user_prompt', 'running', 'openai', 'gpt-5.4', 'openai-runtime',
        'trace-terminal-successor', 2, 2, 2
      );

      UPDATE session
      SET last_run_id = '${SUCCESSOR_SESSION_RUN_ID}', status = 'RUNNING'
      WHERE id = '${PUBLIC_API_TEST_IDS.ownerSession}';

      UPDATE driver_instance
      SET status = 'ready', status_operation_id = NULL
      WHERE id = '${DRIVER_INSTANCE_ID}';
    `);

    await expect(
      releaseTerminalDriverInstanceSessionRun(bindings, {
        driverGeneration: 0,
        driverInstanceId: DRIVER_INSTANCE_ID,
        sessionRunId: SESSION_RUN_ID,
      }),
    ).rejects.toThrow("lost its exact Driver ownership");
    await expect(
      database
        .prepare("SELECT status, status_operation_id FROM driver_instance WHERE id = ?")
        .bind(DRIVER_INSTANCE_ID)
        .first(),
    ).resolves.toEqual({ status: "ready", status_operation_id: null });
    await expect(
      database
        .prepare("SELECT driver_instance_id, status FROM session_run WHERE id = ?")
        .bind(SUCCESSOR_SESSION_RUN_ID)
        .first(),
    ).resolves.toEqual({ driver_instance_id: DRIVER_INSTANCE_ID, status: "running" });
  });

  test("repairs the lease from a complete canonical terminal projection", async () => {
    const { bindings, database } = await createTerminalReleaseFixture();
    await recordReclaimFailure(bindings);
    const sourceEventId = createSessionRunTerminalFailureSourceId(SESSION_RUN_ID);

    await expect(
      database
        .prepare("SELECT COUNT(*) AS count FROM session_event WHERE source_event_id = ?")
        .bind(sourceEventId)
        .first(),
    ).resolves.toEqual({ count: 1 });

    await expect(
      repairFinalizedTerminalDriverRunState(bindings, {
        driverGeneration: 0,
        driverInstanceId: DRIVER_INSTANCE_ID,
        sessionRunId: SESSION_RUN_ID,
        status: "stopped",
      }),
    ).resolves.toMatchObject({ released: true });
    const firstRelease = await readReleaseState(database);

    await expect(
      repairFinalizedTerminalDriverRunState(bindings, {
        driverGeneration: 0,
        driverInstanceId: DRIVER_INSTANCE_ID,
        sessionRunId: SESSION_RUN_ID,
        status: "stopped",
      }),
    ).resolves.toMatchObject({ released: true });
    await expect(
      database
        .prepare("SELECT COUNT(*) AS count FROM session_event WHERE source_event_id = ?")
        .bind(sourceEventId)
        .first(),
    ).resolves.toEqual({ count: 1 });
    expect(await readReleaseState(database)).toEqual(firstRelease);
  });

  test("converges after the atomic lease release commits but its acknowledgement is lost", async () => {
    const { bindings, database } = await createTerminalReleaseFixture();
    await recordReclaimFailure(bindings);
    const originalBatch = database.batch;
    let loseAcknowledgement = true;
    database.batch = (async <T = unknown>(statements: D1PreparedStatement[]) => {
      const results = await originalBatch.call(database, statements);

      if (loseAcknowledgement) {
        loseAcknowledgement = false;
        throw new Error("lease release acknowledgement lost");
      }

      return results as D1Result<T>[];
    }) as D1Database["batch"];

    await expect(
      releaseTerminalDriverInstanceSessionRun(bindings, {
        driverGeneration: 0,
        driverInstanceId: DRIVER_INSTANCE_ID,
        sessionRunId: SESSION_RUN_ID,
      }),
    ).rejects.toThrow("lease release acknowledgement lost");
    const committedRelease = await readReleaseState(database);
    expect(committedRelease.inactiveDeadlineAt).not.toBeNull();

    database.batch = originalBatch;
    await expect(
      releaseTerminalDriverInstanceSessionRun(bindings, {
        driverGeneration: 0,
        driverInstanceId: DRIVER_INSTANCE_ID,
        sessionRunId: SESSION_RUN_ID,
      }),
    ).resolves.toMatchObject({ released: true });
    expect(await readReleaseState(database)).toEqual(committedRelease);
  });
});
