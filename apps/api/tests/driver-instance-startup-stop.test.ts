import { expect, mock, spyOn, test } from "bun:test";

import type { DriverInstanceId } from "@mosoo/id";

import type { DriverInstanceStoredState } from "../src/modules/runtime/infrastructure/driver-instance/runtime-state-store";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";

// Keep the Workers shim and lifecycle spies out of other integration tests.
if (process.env.MOSOO_TEST_DRIVER_STARTUP_STOP === "1") {
  mock.module("cloudflare:workers", () => ({
    DurableObject: class {
      constructor(
        readonly ctx: unknown,
        readonly env: unknown,
      ) {}
    },
  }));
  Object.assign(globalThis, {
    WebSocketPair: class {
      0 = {};
      1 = { readyState: WebSocket.OPEN, close() {} };
    },
  });

  const { parsePlatformId } = await import("@mosoo/id");
  const { DRIVER_PROTOCOL_VERSION } = await import("@mosoo/agent-driver/boot");
  const { restartSessionDriver } =
    await import("../src/modules/runtime/application/runtime-state-operations.service");
  const { DriverInstance } =
    await import("../src/modules/runtime/infrastructure/driver-instance/do");
  const { isDriverInstanceActive } =
    await import("../src/modules/runtime/infrastructure/driver-instance/driver-instance-record.repository");
  const tokens =
    await import("../src/modules/runtime/infrastructure/driver-instance/driver-instance-token.repository");
  const lifecycle = await import("../src/modules/runtime/infrastructure/driver-instance/lifecycle");
  const leases =
    await import("../src/modules/runtime/infrastructure/runtime-subject-lifecycle/runtime-run-lease-store");
  const { createOpaqueBootToken } =
    await import("../src/modules/runtime/infrastructure/runtime-boot-token");
  const {
    createPublicHttpContractDatabase,
    createPublicHttpTestBindings,
    insertOwnerSession,
    insertSessionRunFixture,
    PUBLIC_API_TEST_IDS: IDS,
  } = await import("./helpers/public-api-http-test-fixture");
  const { OWNER_VIEWER } = await import("./public-thread-api-fixtures");
  const driverInstanceId = parsePlatformId<DriverInstanceId>(IDS.driverOwner);

  async function fixture() {
    const database = await createPublicHttpContractDatabase();
    await insertOwnerSession(database);
    const now = Date.now();
    const bootToken = await createOpaqueBootToken();
    await database
      .prepare(
        `INSERT INTO sandbox (
          id, project_id, owner_account_id, kind, subject_kind, subject_id,
          status, created_at, updated_at
        ) VALUES (?, ?, ?, 'cattle', 'session', ?, 'active', ?, ?)`,
      )
      .bind(IDS.sandbox, IDS.project, IDS.ownerAccount, IDS.ownerSession, now, now)
      .run();
    await database
      .prepare(
        `INSERT INTO sandbox_session (
          cloudflare_session_id, created_at, cwd, origin_json, sandbox_id,
          session_id, status, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`,
      )
      .bind(
        IDS.file,
        now,
        `/workspace/se/${IDS.ownerSession}`,
        JSON.stringify({
          callerUserId: IDS.ownerAccount,
          executionOwnerUserId: IDS.ownerAccount,
          entrypoint: "chat",
          type: "agent",
        }),
        IDS.sandbox,
        IDS.ownerSession,
        now,
      )
      .run();
    await database
      .prepare(
        `INSERT INTO driver_instance (
          id, sandbox_id, sandbox_session_id, runtime, protocol, protocol_version,
          status, boot_token_hash, boot_token_expires_at, heartbeat_count,
          expires_at, created_at, updated_at
        ) VALUES (?, ?, ?, 'openai-runtime', 'orpc-ws', ?, 'provisioning', ?, ?, 0, ?, ?, ?)`,
      )
      .bind(
        driverInstanceId,
        IDS.sandbox,
        IDS.ownerSession,
        DRIVER_PROTOCOL_VERSION,
        bootToken.hash,
        now + 60_000,
        now + 60_000,
        now,
        now,
      )
      .run();
    await insertSessionRunFixture(database, {
      id: IDS.run,
      sessionId: IDS.ownerSession,
      createdByAccountId: IDS.ownerAccount,
      driverInstanceId,
      status: "booting",
      createdAt: now,
      updatedAt: now,
    });

    const stored = new Map<string, unknown>();
    const accepted: WebSocket[] = [];
    let initialized = Promise.resolve();
    const storage = {
      get: async (key: string) => structuredClone(stored.get(key)),
      put: async (key: string, value: unknown) => {
        stored.set(key, structuredClone(value));
      },
      deleteAll: async () => stored.clear(),
      deleteAlarm: async () => {},
      setAlarm: async () => {},
    };
    const ctx = {
      acceptWebSocket(socket: WebSocket) {
        accepted.push(socket);
      },
      blockConcurrencyWhile(callback: () => Promise<void>) {
        initialized = callback();
        return initialized;
      },
      getWebSockets: () => accepted,
      storage,
    } as unknown as DurableObjectState;
    const bindings = {
      ...createPublicHttpTestBindings(database),
      DriverConnection: {
        idFromName: (name: string) => name,
        get: () => driver,
      },
    } as unknown as ApiBindings;
    const driver = new DriverInstance(ctx, bindings);
    await initialized;

    return {
      accepted,
      bindings,
      bootToken,
      database,
      driver,
      storage,
      request: () =>
        new Request(
          `https://driver-instance.internal/driver-socket?driverInstanceId=${driverInstanceId}&token=${bootToken.encoded}`,
        ),
      row: () =>
        database
          .prepare("SELECT status, connection_id FROM driver_instance WHERE id = ?")
          .bind(driverInstanceId)
          .first<{ status: string; connection_id: string | null }>(),
    };
  }

  async function expectRetired(f: Awaited<ReturnType<typeof fixture>>) {
    expect(await f.row()).toMatchObject({ status: "failed" });
    expect(await isDriverInstanceActive(f.database, driverInstanceId)).toBe(false);
    expect(
      await tokens.claimDriverInstanceByBootTokenHash(f.bindings, f.bootToken.hash),
    ).toBeNull();
    expect(f.accepted).toHaveLength(0);
  }

  test("restart retires a provisioning driver before its first socket connects", async () => {
    const f = await fixture();
    const restarted = await restartSessionDriver(f.bindings, OWNER_VIEWER, {
      projectId: IDS.project,
      sessionId: IDS.ownerSession,
    });

    expect(restarted.ok).toBe(true);
    expect(
      await f.database.prepare("SELECT status FROM session_run WHERE id = ?").bind(IDS.run).first(),
    ).toEqual({ status: "cancelled" });
    expect(
      await f.database
        .prepare("SELECT status, status_operation_id FROM session WHERE id = ?")
        .bind(IDS.ownerSession)
        .first(),
    ).toEqual({ status: "IDLE", status_operation_id: null });
    expect(
      (
        await f.database
          .prepare(
            `SELECT json_extract(canonical_event_json, '$.payload.status') AS status,
              json_extract(canonical_event_json, '$.payload.operation') AS operation
            FROM session_event WHERE session_id = ? AND event_type = 'agent.task.updated'
            ORDER BY seq`,
          )
          .bind(IDS.ownerSession)
          .all()
      ).results,
    ).toEqual([
      { status: "updating", operation: "restartDriver" },
      { status: "ready", operation: "restartDriver" },
    ]);
    await expectRetired(f);
    const response = await f.driver.fetch(f.request());
    expect(response.status).toBe(410);
    await expectRetired(f);
  });

  test("restart still retires the driver and releases its Run when cancellation cannot be written", async () => {
    const f = await fixture();
    f.database.execute(`
      CREATE TRIGGER reject_run_cancellation BEFORE UPDATE OF status ON session_run
      WHEN NEW.status = 'cancelled'
      BEGIN SELECT RAISE(ABORT, 'injected cancellation failure'); END;
    `);
    const release = spyOn(leases, "releaseRuntimeRunLease");
    try {
      await expect(
        restartSessionDriver(f.bindings, OWNER_VIEWER, {
          projectId: IDS.project,
          sessionId: IDS.ownerSession,
        }),
      ).rejects.toMatchObject({ cause: { message: "injected cancellation failure" } });

      await expectRetired(f);
      expect(release).toHaveBeenCalledWith(f.database, {
        driverInstanceId,
        expectedSessionRunId: IDS.run,
      });
      expect(
        await f.database
          .prepare("SELECT status, driver_instance_id FROM session_run WHERE id = ?")
          .bind(IDS.run)
          .first(),
      ).toEqual({ status: "failed", driver_instance_id: driverInstanceId });
      expect((await f.driver.fetch(f.request())).status).toBe(410);
      await expectRetired(f);
    } finally {
      release.mockRestore();
    }
  });

  for (const boundary of ["claim committed", "connection write pending", "connection committed"]) {
    test(`stop during startup rejects the socket after ${boundary}`, async () => {
      const f = await fixture();
      const entered = Promise.withResolvers<void>();
      const resume = Promise.withResolvers<void>();
      const claim = tokens.claimDriverInstanceByBootTokenHash;
      const markConnected = lifecycle.markDriverInstanceConnected;
      let candidateConnectionId: string | null = null;
      const paused =
        boundary === "claim committed"
          ? spyOn(tokens, "claimDriverInstanceByBootTokenHash").mockImplementation(
              async (...args) => {
                const result = await claim(...args);
                entered.resolve();
                await resume.promise;
                return result;
              },
            )
          : spyOn(lifecycle, "markDriverInstanceConnected").mockImplementation(async (...args) => {
              candidateConnectionId = args[1].connectionId;
              if (boundary === "connection committed") {
                const result = await markConnected(...args);
                entered.resolve();
                await resume.promise;
                return result;
              }
              entered.resolve();
              await resume.promise;
              return markConnected(...args);
            });
      const connecting = f.driver.fetch(f.request());
      try {
        await entered.promise;
        expect(await f.row()).toEqual({
          status: "connecting",
          connection_id: boundary === "connection committed" ? candidateConnectionId : null,
        });
        await f.driver.fail(driverInstanceId, "stop during startup");
        expect(await f.row()).toEqual({ status: "failed", connection_id: candidateConnectionId });
        expect(await isDriverInstanceActive(f.database, driverInstanceId)).toBe(false);
      } finally {
        resume.resolve();
        paused.mockRestore();
      }

      const response = await connecting;
      expect(f.accepted).toHaveLength(0);
      expect(response.status).toBe(boundary === "claim committed" ? 410 : 409);
      await expectRetired(f);
      expect(await f.row()).toEqual({ status: "failed", connection_id: candidateConnectionId });
      expect((await f.driver.fetch(f.request())).status).toBe(410);
      await expectRetired(f);
    });
  }

  test("stop retires the candidate while its connection snapshot is being persisted", async () => {
    const f = await fixture();
    const entered = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    const put = f.storage.put;
    let candidateConnectionId: string | null = null;
    const paused = spyOn(f.storage, "put").mockImplementation(async (key, value) => {
      await put(key, value);
      const snapshot = value as DriverInstanceStoredState;
      if (
        candidateConnectionId === null &&
        snapshot.connectionId !== null &&
        snapshot.errorMessage === null &&
        snapshot.close === null
      ) {
        candidateConnectionId = snapshot.connectionId;
        entered.resolve();
        await resume.promise;
      }
    });
    const connecting = f.driver.fetch(f.request());
    try {
      await entered.promise;
      expect(candidateConnectionId).toBeString();
      expect(await f.row()).toEqual({ status: "connecting", connection_id: null });
      await f.driver.fail(driverInstanceId, "stop during connection persistence");
      expect(await f.row()).toEqual({ status: "failed", connection_id: candidateConnectionId });
      await expectRetired(f);
    } finally {
      resume.resolve();
      paused.mockRestore();
    }

    expect((await connecting).status).toBe(409);
    await expectRetired(f);
    expect(await f.row()).toEqual({ status: "failed", connection_id: candidateConnectionId });
    expect((await f.driver.fetch(f.request())).status).toBe(410);
    await expectRetired(f);
  });
} else {
  test("real DriverInstance retires authorization when stopped during startup", async () => {
    const child = Bun.spawn({
      cmd: [process.execPath, "test", import.meta.path],
      env: { ...process.env, MOSOO_TEST_DRIVER_STARTUP_STOP: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [status, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    if (status !== 0) throw new Error(`Driver startup stop regression failed:\n${stdout}${stderr}`);
    expect(status).toBe(0);
  }, 10_000);
}
