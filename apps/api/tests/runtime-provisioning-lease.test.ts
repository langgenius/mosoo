import { describe, expect, test } from "bun:test";

import { createPlatformId } from "@mosoo/id";
import type { DriverInstanceId } from "@mosoo/id";
import { PLATFORM_ID_FIXTURES } from "@mosoo/id/testing";

import {
  createDriverInstanceRecord,
  runtimeProvisioningDriverLaunchIsOwned,
} from "../src/modules/runtime/infrastructure/driver-instance/driver-instance-record.repository";
import { stopDriverSession } from "../src/modules/runtime/infrastructure/driver-session-stop.service";
import { startProvisionProcessWithOwnershipFence } from "../src/modules/runtime/infrastructure/runtime-sandbox-provisioning/runtime-driver-process-cleanup";
import {
  adoptReadyRuntimeRunProvisioningLease,
  claimRuntimeProvisioningDriverCleanup,
  claimRuntimeRunProvisioningLease,
  claimStaleRuntimeProvisioningLeases,
  heartbeatRuntimeRunProvisioningLease,
  readRuntimeProvisioningCleanupTargets,
  recordRuntimeProvisioningConversationTarget,
  releaseAbortedRuntimeProvisioningLease,
  releaseReadyRuntimeRunProvisioningLease,
  renewRuntimeProvisioningLeaseOwnership,
} from "../src/modules/runtime/infrastructure/runtime-subject-lifecycle/runtime-provisioning-lease-store";
import type { RuntimeRunProvisioningLease } from "../src/modules/runtime/infrastructure/runtime-subject-lifecycle/runtime-provisioning-lease-store";
import { repairStaleRuntimeProvisioningLeases } from "../src/modules/runtime/infrastructure/runtime-subject-lifecycle/runtime-subject-maintenance.service";
import {
  ensureRuntimeSubjectId,
  recordRuntimeConversationSessionClosed,
} from "../src/modules/runtime/infrastructure/runtime-subject-lifecycle/runtime-subject-store";
import type { RuntimeProcessHandle } from "../src/modules/runtime/infrastructure/sandbox-handles";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const DRIVER_ID = PLATFORM_ID_FIXTURES.driverInstance;
const NEW_CONVERSATION_ID = "01J00000000000000000000003";
const OLD_CONVERSATION_ID = "01J00000000000000000000002";
const RUN_ID = PLATFORM_ID_FIXTURES.sessionRun;
const SANDBOX_ID = PLATFORM_ID_FIXTURES.sandbox;
const SESSION_ID = PLATFORM_ID_FIXTURES.session;

function createDatabase(options: { readonly insertSandbox?: boolean } = {}): SqliteD1Database {
  const database = new SqliteD1Database({ foreignKeys: false });
  database.execute(`
    CREATE TABLE session (
      id text PRIMARY KEY NOT NULL,
      archived_at integer,
      cleanup_operation_kind text,
      last_run_id text,
      runtime_provisioning_heartbeat_at integer,
      runtime_provisioning_operation_id text,
      runtime_provisioning_run_id text,
      runtime_provisioning_sandbox_id text,
      runtime_provisioning_sandbox_incarnation integer,
      runtime_provisioning_sandbox_session_id text,
      status text NOT NULL,
      status_operation_id text,
      CHECK (
        (
          runtime_provisioning_operation_id IS NULL
          AND runtime_provisioning_run_id IS NULL
          AND runtime_provisioning_sandbox_id IS NULL
          AND runtime_provisioning_sandbox_incarnation IS NULL
          AND runtime_provisioning_sandbox_session_id IS NULL
          AND runtime_provisioning_heartbeat_at IS NULL
        ) OR (
          runtime_provisioning_operation_id IS NOT NULL
          AND runtime_provisioning_sandbox_id IS NOT NULL
          AND runtime_provisioning_heartbeat_at IS NOT NULL
          AND typeof(runtime_provisioning_heartbeat_at) = 'integer'
          AND archived_at IS NULL
          AND cleanup_operation_kind IS NULL
          AND status_operation_id IS NULL
        )
      )
    );
    CREATE TABLE session_run (
      driver_instance_id text,
      id text PRIMARY KEY NOT NULL,
      session_id text NOT NULL,
      status text NOT NULL
    );
    CREATE TABLE sandbox_session (
      cloudflare_session_id text NOT NULL DEFAULT '${OLD_CONVERSATION_ID}',
      cleanup_operation_id text,
      sandbox_id text NOT NULL,
      sandbox_incarnation integer NOT NULL DEFAULT 1,
      session_id text PRIMARY KEY NOT NULL,
      status text NOT NULL,
      updated_at integer NOT NULL DEFAULT 0
    );
    CREATE TABLE driver_instance (
      boot_token_expires_at integer,
      boot_token_hash blob,
      created_at integer NOT NULL DEFAULT 0,
      expires_at integer,
      generation integer NOT NULL DEFAULT 0,
      heartbeat_count integer NOT NULL DEFAULT 0,
      id text PRIMARY KEY NOT NULL,
      protocol text NOT NULL DEFAULT 'orpc-ws',
      protocol_version integer NOT NULL DEFAULT 3,
      restart_count integer NOT NULL DEFAULT 0,
      runtime text NOT NULL DEFAULT 'openai-runtime',
      sandbox_id text NOT NULL,
      sandbox_incarnation integer NOT NULL DEFAULT 1,
      sandbox_session_id text NOT NULL,
      status text NOT NULL,
      status_changed_at integer DEFAULT 0 NOT NULL,
      status_event text DEFAULT 'driver.provision' NOT NULL,
      status_operation_id text,
      status_seq integer DEFAULT 0 NOT NULL,
      status_source text DEFAULT 'system' NOT NULL,
      updated_at integer DEFAULT 0 NOT NULL
    );
    CREATE TABLE sandbox (
      agent_id text,
      project_id text,
      bind_mount_ready integer NOT NULL DEFAULT 0,
      claim_expires_at integer,
      claim_owner text,
      created_at integer NOT NULL DEFAULT 0,
      global_mounts_json text NOT NULL DEFAULT '[]',
      id text PRIMARY KEY NOT NULL,
      inactive_deadline_at integer,
      incarnation integer NOT NULL DEFAULT 1,
      kind text,
      last_backup_id text,
      last_error text,
      last_error_code text,
      last_restore_backup_id text,
      network_constraints_hash text,
      operation_kind text,
      owner_account_id text,
      status text NOT NULL DEFAULT 'active',
      status_changed_at integer NOT NULL DEFAULT 0,
      status_event text NOT NULL DEFAULT 'runtime_subject.active',
      status_operation_id text,
      status_seq integer NOT NULL DEFAULT 0,
      status_source text NOT NULL DEFAULT 'test',
      subject_id text,
      subject_kind text,
      updated_at integer NOT NULL
    );
    INSERT INTO session (id, last_run_id, status)
    VALUES ('${SESSION_ID}', '${RUN_ID}', 'RUNNING');
    INSERT INTO session_run (id, session_id, status)
    VALUES ('${RUN_ID}', '${SESSION_ID}', 'running');
  `);
  if (options.insertSandbox !== false) {
    database.execute(`
      INSERT INTO sandbox (
        agent_id, project_id, id, kind, owner_account_id, subject_id, subject_kind, updated_at
      ) VALUES (
        '${PLATFORM_ID_FIXTURES.agent}', '${PLATFORM_ID_FIXTURES.project}', '${SANDBOX_ID}',
        'cattle', '${PLATFORM_ID_FIXTURES.account}', '${SESSION_ID}', 'session', 0
      );
    `);
  }
  return database;
}

async function insertDurableRunHandoff(
  database: D1Database,
  lease: RuntimeRunProvisioningLease,
): Promise<RuntimeRunProvisioningLease> {
  await database
    .prepare(
      `INSERT INTO sandbox_session (sandbox_id, session_id, status)
       VALUES (?, ?, 'active')`,
    )
    .bind(SANDBOX_ID, SESSION_ID)
    .run();
  await database
    .prepare(
      `INSERT INTO driver_instance (id, sandbox_id, sandbox_session_id, status)
       VALUES (?, ?, ?, 'ready')`,
    )
    .bind(DRIVER_ID, SANDBOX_ID, SESSION_ID)
    .run();
  await database
    .prepare("UPDATE session_run SET driver_instance_id = ? WHERE id = ?")
    .bind(DRIVER_ID, RUN_ID)
    .run();
  const targeted = await recordRuntimeProvisioningConversationTarget(database, {
    lease,
    sandboxIncarnation: 1,
    sandboxSessionId: OLD_CONVERSATION_ID,
  });
  if (targeted === null) {
    throw new Error("Runtime provisioning fixture lost its target lease.");
  }
  return targeted;
}

describe("runtime provisioning lease", () => {
  test("allocates the lifecycle row before claiming initial provisioning", async () => {
    const database = createDatabase({ insertSandbox: false });
    const sandboxId = await ensureRuntimeSubjectId(database, {
      agentId: PLATFORM_ID_FIXTURES.agent,
      projectId: PLATFORM_ID_FIXTURES.project,
      executionOwnerUserId: PLATFORM_ID_FIXTURES.account,
      kind: "cattle",
      runtimeSubjectId: SANDBOX_ID,
      subjectId: SESSION_ID,
      subjectKind: "session",
    });

    expect(sandboxId).toBe(SANDBOX_ID);
    await expect(
      ensureRuntimeSubjectId(database, {
        agentId: PLATFORM_ID_FIXTURES.agent,
        projectId: PLATFORM_ID_FIXTURES.project,
        executionOwnerUserId: "01J0000000000000000000000F",
        kind: "cattle",
        runtimeSubjectId: SANDBOX_ID,
        subjectId: SESSION_ID,
        subjectKind: "session",
      }),
    ).rejects.toThrow("identity does not match");
    expect(
      await claimRuntimeRunProvisioningLease(database, {
        runId: RUN_ID,
        sandboxId,
        sessionId: SESSION_ID,
      }),
    ).not.toBeNull();
  });

  test("rejects a half-written lease without a heartbeat", async () => {
    const database = createDatabase();

    await expect(
      database
        .prepare(
          `UPDATE session
              SET runtime_provisioning_operation_id = ?,
                  runtime_provisioning_sandbox_id = ?
            WHERE id = ?`,
        )
        .bind(PLATFORM_ID_FIXTURES.runtimeOperation, SANDBOX_ID, SESSION_ID)
        .run(),
    ).rejects.toThrow();
  });

  test("uses stable provisioning identity across heartbeats and rejects a rotated owner", async () => {
    const database = createDatabase();
    const claimed = await claimRuntimeRunProvisioningLease(database, {
      runId: RUN_ID,
      sandboxId: SANDBOX_ID,
      sessionId: SESSION_ID,
    });
    expect(claimed).not.toBeNull();
    if (claimed === null) {
      return;
    }
    await database
      .prepare(
        `INSERT INTO sandbox_session (
           cloudflare_session_id, sandbox_id, sandbox_incarnation, session_id, status
         ) VALUES (?, ?, 1, ?, 'active')`,
      )
      .bind(OLD_CONVERSATION_ID, SANDBOX_ID, SESSION_ID)
      .run();
    const targeted = await recordRuntimeProvisioningConversationTarget(database, {
      lease: claimed,
      sandboxIncarnation: 1,
      sandboxSessionId: OLD_CONVERSATION_ID,
    });
    expect(targeted).not.toBeNull();
    if (targeted === null) {
      return;
    }

    expect(await heartbeatRuntimeRunProvisioningLease(database, targeted)).toBe(true);
    expect(
      await createDriverInstanceRecord({ DB: database } as ApiBindings, {
        bootTokenHash: new Uint8Array([1]),
        conflictStrategy: "insert-only",
        driverInstanceId: DRIVER_ID,
        runtime: "openai-runtime",
        runtimeProvisioningLease: targeted,
        sandboxId: SANDBOX_ID,
        sandboxIncarnation: 1,
        sandboxSessionId: SESSION_ID,
      }),
    ).toMatchObject({ generation: 0, status: "created" });

    expect(
      await runtimeProvisioningDriverLaunchIsOwned(database, {
        bootTokenHash: new Uint8Array([1]),
        driverGeneration: 0,
        driverInstanceId: DRIVER_ID,
        lease: targeted,
      }),
    ).toBe(true);

    await database
      .prepare("UPDATE session SET runtime_provisioning_heartbeat_at = 1 WHERE id = ?")
      .bind(SESSION_ID)
      .run();
    const maintenance = await claimStaleRuntimeProvisioningLeases(database, {
      heartbeatAtLte: 1,
      limit: 1,
    });
    expect(maintenance).toHaveLength(1);
    expect(
      await runtimeProvisioningDriverLaunchIsOwned(database, {
        bootTokenHash: new Uint8Array([1]),
        driverGeneration: 0,
        driverInstanceId: DRIVER_ID,
        lease: targeted,
      }),
    ).toBe(false);
    expect(
      await createDriverInstanceRecord({ DB: database } as ApiBindings, {
        bootTokenHash: new Uint8Array([2]),
        conflictStrategy: "insert-only",
        driverInstanceId: createPlatformId<DriverInstanceId>(),
        runtime: "openai-runtime",
        runtimeProvisioningLease: targeted,
        sandboxId: SANDBOX_ID,
        sandboxIncarnation: 1,
        sandboxSessionId: SESSION_ID,
      }),
    ).toEqual({
      bootTokenExpiresAt: null,
      generation: null,
      reason: "existing-driver",
      status: "skipped",
    });
  });

  test("stops a late process after activation moves to the next incarnation", async () => {
    let activeIncarnation = 1;
    let disposeCalls = 0;
    let killCalls = 0;
    let startCalls = 0;
    const process = {
      [Symbol.dispose]: () => {
        disposeCalls++;
      },
      getStatus: async () => "running" as const,
      kill: async () => {
        killCalls++;
      },
    } as unknown as RuntimeProcessHandle;
    const assertOwned = async () => {
      if (activeIncarnation !== 1) {
        throw new Error("Runtime Driver provisioning lost launch ownership.");
      }
    };

    await expect(
      startProvisionProcessWithOwnershipFence({
        assertOwned,
        context: { sandboxId: SANDBOX_ID },
        message: "test late process cleanup",
        startProcess: async () => {
          startCalls++;
          activeIncarnation = 2;
          return process;
        },
      }),
    ).rejects.toThrow("lost launch ownership");
    expect({ disposeCalls, killCalls, startCalls }).toEqual({
      disposeCalls: 1,
      killCalls: 1,
      startCalls: 1,
    });

    await expect(
      startProvisionProcessWithOwnershipFence({
        assertOwned,
        context: { sandboxId: SANDBOX_ID },
        message: "test pre-launch fence",
        startProcess: async () => {
          startCalls++;
          return process;
        },
      }),
    ).rejects.toThrow("lost launch ownership");
    expect(startCalls).toBe(1);
  });

  test("fences cleanup until the conversation, Driver, and Run handoff are durable", async () => {
    const database = createDatabase();
    let lease = await claimRuntimeRunProvisioningLease(database, {
      runId: RUN_ID,
      sandboxId: SANDBOX_ID,
      sessionId: SESSION_ID,
    });
    expect(lease).not.toBeNull();
    if (lease === null) {
      return;
    }

    await expect(
      database
        .prepare(
          "UPDATE session SET archived_at = 1, cleanup_operation_kind = 'archive' WHERE id = ?",
        )
        .bind(SESSION_ID)
        .run(),
    ).rejects.toThrow();
    expect(
      await releaseReadyRuntimeRunProvisioningLease(database, {
        driverGeneration: 0,
        driverInstanceId: DRIVER_ID,
        lease,
      }),
    ).toBe(false);

    lease = await insertDurableRunHandoff(database, lease);
    expect(
      await releaseReadyRuntimeRunProvisioningLease(database, {
        driverGeneration: 0,
        driverInstanceId: DRIVER_ID,
        lease,
      }),
    ).toBe(true);
    expect(
      await database
        .prepare("SELECT runtime_provisioning_operation_id FROM session WHERE id = ?")
        .bind(SESSION_ID)
        .first(),
    ).toEqual({ runtime_provisioning_operation_id: null });
  });

  test("does not release a stale Driver generation handoff", async () => {
    const database = createDatabase();
    let lease = await claimRuntimeRunProvisioningLease(database, {
      runId: RUN_ID,
      sandboxId: SANDBOX_ID,
      sessionId: SESSION_ID,
    });
    expect(lease).not.toBeNull();
    if (lease === null) {
      return;
    }
    lease = await insertDurableRunHandoff(database, lease);
    await database
      .prepare("UPDATE driver_instance SET generation = 1 WHERE id = ?")
      .bind(DRIVER_ID)
      .run();

    expect(
      await releaseReadyRuntimeRunProvisioningLease(database, {
        driverGeneration: 0,
        driverInstanceId: DRIVER_ID,
        lease,
      }),
    ).toBe(false);
    expect(await heartbeatRuntimeRunProvisioningLease(database, lease)).toBe(true);
    expect(
      await releaseReadyRuntimeRunProvisioningLease(database, {
        driverGeneration: 1,
        driverInstanceId: DRIVER_ID,
        lease,
      }),
    ).toBe(true);
  });

  test("cleanup ownership wins before provisioning without an external-work window", async () => {
    const database = createDatabase();
    await database
      .prepare(
        `UPDATE session
            SET archived_at = 1,
                cleanup_operation_kind = 'archive',
                status = 'RESCHEDULING',
                status_operation_id = ?
          WHERE id = ?`,
      )
      .bind(PLATFORM_ID_FIXTURES.runtimeOperation, SESSION_ID)
      .run();

    expect(
      await claimRuntimeRunProvisioningLease(database, {
        runId: RUN_ID,
        sandboxId: SANDBOX_ID,
        sessionId: SESSION_ID,
      }),
    ).toBeNull();
  });

  test("maintenance adopts a durable handoff instead of destroying a healthy Run", async () => {
    const database = createDatabase();
    let lease = await claimRuntimeRunProvisioningLease(database, {
      runId: RUN_ID,
      sandboxId: SANDBOX_ID,
      sessionId: SESSION_ID,
    });
    expect(lease).not.toBeNull();
    if (lease === null) {
      return;
    }
    lease = await insertDurableRunHandoff(database, lease);
    await database
      .prepare("UPDATE session SET runtime_provisioning_heartbeat_at = 1 WHERE id = ?")
      .bind(SESSION_ID)
      .run();

    const [maintenance] = await claimStaleRuntimeProvisioningLeases(database, {
      heartbeatAtLte: 1,
      limit: 1,
    });
    expect(maintenance).toBeDefined();
    if (maintenance === undefined) {
      return;
    }
    expect(await adoptReadyRuntimeRunProvisioningLease(database, maintenance)).toBe(true);
    expect(await heartbeatRuntimeRunProvisioningLease(database, lease)).toBe(false);
    expect(await releaseAbortedRuntimeProvisioningLease(database, lease)).toBe(false);
    expect(
      await database
        .prepare("SELECT driver_instance_id, status FROM session_run WHERE id = ?")
        .bind(RUN_ID)
        .first(),
    ).toEqual({ driver_instance_id: DRIVER_ID, status: "running" });
  });

  test("a cleanup claim makes the exact Driver generation non-assignable before remote I/O", async () => {
    const database = createDatabase();
    let lease = await claimRuntimeRunProvisioningLease(database, {
      runId: RUN_ID,
      sandboxId: SANDBOX_ID,
      sessionId: SESSION_ID,
    });
    expect(lease).not.toBeNull();
    if (lease === null) {
      return;
    }
    lease = await insertDurableRunHandoff(database, lease);
    await database
      .prepare("UPDATE session SET runtime_provisioning_heartbeat_at = 1 WHERE id = ?")
      .bind(SESSION_ID)
      .run();
    const requestStarted = Promise.withResolvers<void>();
    const response = Promise.withResolvers<Response>();
    const bindings = {
      DB: database,
      DriverConnection: {
        get: () => ({
          fetch: async () => {
            requestStarted.resolve();
            return response.promise;
          },
        }),
        idFromName: () => "driver-do-id",
      },
    } as unknown as ApiBindings;
    expect(
      await claimRuntimeProvisioningDriverCleanup(database, {
        driverGeneration: 0,
        driverInstanceId: DRIVER_ID,
        lease,
        source: "maintenance",
      }),
    ).toBe(true);
    const stopping = stopDriverSession(bindings, {
      driverInstanceId: DRIVER_ID,
      expectedDriverGeneration: 0,
      expectedSessionRunId: RUN_ID,
      reason: "runtime.provisioning_stale",
    });
    await requestStarted.promise;

    await expect(
      database
        .prepare(
          "SELECT status, status_operation_id, status_source FROM driver_instance WHERE id = ?",
        )
        .bind(DRIVER_ID)
        .first(),
    ).resolves.toEqual({
      status: "stopping",
      status_operation_id: expect.any(String),
      status_source: "maintenance",
    });
    const [maintenance] = await claimStaleRuntimeProvisioningLeases(database, {
      heartbeatAtLte: 1,
      limit: 1,
    });
    expect(maintenance).toBeDefined();
    if (maintenance !== undefined) {
      expect(await adoptReadyRuntimeRunProvisioningLease(database, maintenance)).toBe(false);
    }

    response.resolve(Response.json({ error: "injected stop failure" }, { status: 500 }));
    await expect(stopping).rejects.toThrow("injected stop failure");
  });

  test("a stale cleanup cannot claim a Driver after maintenance adopts its handoff", async () => {
    const database = createDatabase();
    let staleLease = await claimRuntimeRunProvisioningLease(database, {
      runId: RUN_ID,
      sandboxId: SANDBOX_ID,
      sessionId: SESSION_ID,
    });
    expect(staleLease).not.toBeNull();
    if (staleLease === null) {
      return;
    }
    staleLease = await insertDurableRunHandoff(database, staleLease);
    const targets = await readRuntimeProvisioningCleanupTargets(database, staleLease);
    const [driver] = targets?.driverInstances ?? [];
    expect(driver).toBeDefined();
    if (driver === undefined) {
      return;
    }
    await database
      .prepare("UPDATE session SET runtime_provisioning_heartbeat_at = 1 WHERE id = ?")
      .bind(SESSION_ID)
      .run();
    const [maintenance] = await claimStaleRuntimeProvisioningLeases(database, {
      heartbeatAtLte: 1,
      limit: 1,
    });
    expect(maintenance).toBeDefined();
    if (maintenance === undefined) {
      return;
    }
    expect(await adoptReadyRuntimeRunProvisioningLease(database, maintenance)).toBe(true);

    expect(
      await claimRuntimeProvisioningDriverCleanup(database, {
        driverGeneration: driver.generation,
        driverInstanceId: driver.id,
        lease: staleLease,
        source: "maintenance",
      }),
    ).toBe(false);
    await expect(
      database
        .prepare("SELECT status, status_operation_id FROM driver_instance WHERE id = ?")
        .bind(DRIVER_ID)
        .first(),
    ).resolves.toEqual({ status: "ready", status_operation_id: null });
    await expect(
      database
        .prepare("SELECT driver_instance_id, status FROM session_run WHERE id = ?")
        .bind(RUN_ID)
        .first(),
    ).resolves.toEqual({ driver_instance_id: DRIVER_ID, status: "running" });
  });

  test("the maintenance entry point releases a crashed post-handoff lease", async () => {
    const database = createDatabase();
    let lease = await claimRuntimeRunProvisioningLease(database, {
      runId: RUN_ID,
      sandboxId: SANDBOX_ID,
      sessionId: SESSION_ID,
    });
    expect(lease).not.toBeNull();
    if (lease === null) {
      return;
    }
    lease = await insertDurableRunHandoff(database, lease);
    await database
      .prepare("UPDATE session SET runtime_provisioning_heartbeat_at = 1 WHERE id = ?")
      .bind(SESSION_ID)
      .run();

    expect(
      await repairStaleRuntimeProvisioningLeases({ DB: database } as ApiBindings, {
        heartbeatAtLte: 1,
        limit: 1,
      }),
    ).toBe(1);
    expect(
      await database
        .prepare("SELECT runtime_provisioning_operation_id FROM session WHERE id = ?")
        .bind(SESSION_ID)
        .first(),
    ).toEqual({ runtime_provisioning_operation_id: null });
  });

  test("maintenance takeover revokes the old holder before clearing an incomplete attempt", async () => {
    const database = createDatabase();
    const lease = await claimRuntimeRunProvisioningLease(database, {
      runId: RUN_ID,
      sandboxId: SANDBOX_ID,
      sessionId: SESSION_ID,
    });
    expect(lease).not.toBeNull();
    if (lease === null) {
      return;
    }
    await database
      .prepare("UPDATE session SET runtime_provisioning_heartbeat_at = 1 WHERE id = ?")
      .bind(SESSION_ID)
      .run();

    const [maintenance] = await claimStaleRuntimeProvisioningLeases(database, {
      heartbeatAtLte: 1,
      limit: 1,
    });
    expect(maintenance).toBeDefined();
    if (maintenance === undefined) {
      return;
    }
    expect(maintenance.operationId).not.toBe(lease.operationId);
    expect(await heartbeatRuntimeRunProvisioningLease(database, lease)).toBe(false);
    expect(await releaseAbortedRuntimeProvisioningLease(database, lease)).toBe(false);
    expect(await releaseAbortedRuntimeProvisioningLease(database, maintenance)).toBe(true);

    const nextLease = await claimRuntimeRunProvisioningLease(database, {
      runId: RUN_ID,
      sandboxId: SANDBOX_ID,
      sessionId: SESSION_ID,
    });
    expect(nextLease).not.toBeNull();
    expect(await renewRuntimeProvisioningLeaseOwnership(database, lease)).toBe(false);
    if (nextLease !== null) {
      expect(await heartbeatRuntimeRunProvisioningLease(database, nextLease)).toBe(true);
    }
  });

  test("a late old cleanup cannot close the next owner's conversation", async () => {
    const database = createDatabase();
    let lease = await claimRuntimeRunProvisioningLease(database, {
      runId: RUN_ID,
      sandboxId: SANDBOX_ID,
      sessionId: SESSION_ID,
    });
    expect(lease).not.toBeNull();
    if (lease === null) {
      return;
    }
    await database
      .prepare(
        `INSERT INTO sandbox_session
           (cloudflare_session_id, sandbox_id, session_id, status)
         VALUES (?, ?, ?, 'active')`,
      )
      .bind(OLD_CONVERSATION_ID, SANDBOX_ID, SESSION_ID)
      .run();
    const targetedLease = await recordRuntimeProvisioningConversationTarget(database, {
      lease,
      sandboxIncarnation: 1,
      sandboxSessionId: OLD_CONVERSATION_ID,
    });
    expect(targetedLease).not.toBeNull();
    if (targetedLease === null) {
      return;
    }
    lease = targetedLease;
    expect(await readRuntimeProvisioningCleanupTargets(database, lease)).toMatchObject({
      conversationSessionId: OLD_CONVERSATION_ID,
    });
    await database
      .prepare("UPDATE session SET runtime_provisioning_heartbeat_at = 1 WHERE id = ?")
      .bind(SESSION_ID)
      .run();

    const [maintenance] = await claimStaleRuntimeProvisioningLeases(database, {
      heartbeatAtLte: 1,
      limit: 1,
    });
    expect(maintenance).toBeDefined();
    if (maintenance === undefined) {
      return;
    }
    expect(await releaseAbortedRuntimeProvisioningLease(database, maintenance)).toBe(true);
    const nextLease = await claimRuntimeRunProvisioningLease(database, {
      runId: RUN_ID,
      sandboxId: SANDBOX_ID,
      sessionId: SESSION_ID,
    });
    expect(nextLease).not.toBeNull();
    await database
      .prepare(
        `UPDATE sandbox_session
            SET cloudflare_session_id = ?, status = 'active'
          WHERE session_id = ?`,
      )
      .bind(NEW_CONVERSATION_ID, SESSION_ID)
      .run();

    await recordRuntimeConversationSessionClosed(database, {
      expectedProvisioningOperationId: lease.operationId,
      inactiveDeadlineAt: 100,
      now: 10,
      runtimeSubjectId: SANDBOX_ID,
      sandboxSessionId: OLD_CONVERSATION_ID,
      sessionId: SESSION_ID,
    });

    expect(
      await database
        .prepare("SELECT cloudflare_session_id, status FROM sandbox_session WHERE session_id = ?")
        .bind(SESSION_ID)
        .first(),
    ).toEqual({ cloudflare_session_id: NEW_CONVERSATION_ID, status: "active" });
    if (nextLease !== null) {
      expect(await heartbeatRuntimeRunProvisioningLease(database, nextLease)).toBe(true);
    }
  });
});
