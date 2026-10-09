import { describe, expect, test } from "bun:test";

import type { AccountId, ProjectId, SessionId } from "@mosoo/id";

import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import type { SessionViewerSocketContext } from "../src/modules/sessions/infrastructure/session/socket-headers";
import {
  runViewerPermissionCleanupAlarm,
  scheduleViewerPermissionCleanupAlarm,
  VIEWER_PERMISSION_CLEANUP_DELAY_MS,
} from "../src/modules/sessions/infrastructure/session/viewer-permission-cleanup";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  PUBLIC_API_TEST_IDS,
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  insertOwnerSession,
} from "./helpers/public-api-http-test-fixture";
import type { SqliteD1Database } from "./helpers/sqlite-d1";

class MemoryAlarmStorage {
  alarmAt: Date | number | null = null;
  readonly values = new Map<string, unknown>();

  async delete(key: string): Promise<boolean> {
    return this.values.delete(key);
  }

  async deleteAlarm(): Promise<void> {
    this.alarmAt = null;
  }

  async get<T>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }

  async put(key: string, value: unknown): Promise<void> {
    this.values.set(key, value);
  }

  async setAlarm(scheduledTime: Date | number): Promise<void> {
    this.alarmAt = scheduledTime;
  }

  asStorage(): DurableObjectStorage {
    return this as unknown as DurableObjectStorage;
  }
}

const OWNER_VIEWER: AuthenticatedViewer = {
  email: "owner@example.com",
  emailVerified: true,
  id: PUBLIC_API_TEST_IDS.ownerAccount as AccountId,
  imageUrl: null,
  name: "Owner",
};

const ATTACHMENT: SessionViewerSocketContext = {
  projectId: PUBLIC_API_TEST_IDS.project as ProjectId,
  publicOrigin: "https://mosoo.ai",
  sessionId: PUBLIC_API_TEST_IDS.ownerSession as SessionId,
  viewer: OWNER_VIEWER,
};

async function insertPendingPermissionRequest(database: SqliteD1Database): Promise<void> {
  await database
    .prepare(
      `
        INSERT INTO driver_instance (
          id, sandbox_id, sandbox_session_id, runtime, protocol, protocol_version, status,
          boot_token_hash, boot_token_expires_at, heartbeat_count, expires_at, created_at, updated_at
        )
        VALUES (?, ?, ?, 'cloudflare-container', 'driver-ws', 1, 'ready', ?, 10000, 0, 20000, 1, 1)
      `,
    )
    .bind(
      PUBLIC_API_TEST_IDS.driverOwner,
      PUBLIC_API_TEST_IDS.sandbox,
      PUBLIC_API_TEST_IDS.ownerSession,
      new Uint8Array([1]),
    )
    .run();
  await database
    .prepare(
      `
        INSERT INTO session_run (
          id, session_id, created_by_account_id, driver_instance_id, trigger, status, trace_id,
          created_at, updated_at
        )
        VALUES (?, ?, ?, ?, 'user_prompt', 'waiting_input', 'trace-permission', 1, 1)
      `,
    )
    .bind(
      PUBLIC_API_TEST_IDS.run,
      PUBLIC_API_TEST_IDS.ownerSession,
      PUBLIC_API_TEST_IDS.ownerAccount,
      PUBLIC_API_TEST_IDS.driverOwner,
    )
    .run();
  await database
    .prepare("UPDATE session SET last_run_id = ?, status = 'RUNNING' WHERE id = ?")
    .bind(PUBLIC_API_TEST_IDS.run, PUBLIC_API_TEST_IDS.ownerSession)
    .run();
  await database
    .prepare(
      `
        INSERT INTO session_permission_request (
          created_at, driver_instance_id, request_id, run_id, session_id, title, updated_at
        )
        VALUES (1, ?, 'permission-1', ?, ?, 'Run a command', 1)
      `,
    )
    .bind(
      PUBLIC_API_TEST_IDS.driverOwner,
      PUBLIC_API_TEST_IDS.run,
      PUBLIC_API_TEST_IDS.ownerSession,
    )
    .run();
}

async function createAlarmFixture(): Promise<{
  database: SqliteD1Database;
  driverCommands: unknown[];
  env: ApiBindings;
}> {
  const database = await createPublicHttpContractDatabase();
  await insertOwnerSession(database);
  await insertPendingPermissionRequest(database);
  const driverCommands: unknown[] = [];

  return {
    database,
    driverCommands,
    env: {
      ...(createPublicHttpTestBindings(database) as ApiBindings),
      DriverConnection: {
        get: () => ({
          sendControlCommand: async (_driverInstanceId: string, command: unknown) => {
            driverCommands.push(command);
          },
        }),
        idFromName: (name: string) => name,
      } as unknown as ApiBindings["DriverConnection"],
    },
  };
}

describe("viewer permission cleanup alarm", () => {
  test("schedules cleanup 120 seconds after the last viewer disconnects", async () => {
    const storage = new MemoryAlarmStorage();
    const before = Date.now();

    await scheduleViewerPermissionCleanupAlarm({
      attachment: ATTACHMENT,
      storage: storage.asStorage(),
    });

    expect(storage.alarmAt).toBeGreaterThanOrEqual(before + VIEWER_PERMISSION_CLEANUP_DELAY_MS);
    expect(storage.alarmAt).toBeLessThanOrEqual(Date.now() + VIEWER_PERMISSION_CLEANUP_DELAY_MS);
  });

  test("does not touch the session when a viewer is open at alarm time", async () => {
    const storage = new MemoryAlarmStorage();

    await scheduleViewerPermissionCleanupAlarm({
      attachment: ATTACHMENT,
      storage: storage.asStorage(),
    });
    await runViewerPermissionCleanupAlarm({
      env: { DB: {} as D1Database } as ApiBindings,
      hasOpenViewer: () => true,
      storage: storage.asStorage(),
    });

    expect(storage.alarmAt).toBeNull();
    expect(storage.values.size).toBe(0);
  });

  test("rejects pending permissions when no viewer reconnects before the alarm", async () => {
    const { database, driverCommands, env } = await createAlarmFixture();
    const storage = new MemoryAlarmStorage();

    await scheduleViewerPermissionCleanupAlarm({
      attachment: ATTACHMENT,
      storage: storage.asStorage(),
    });
    await runViewerPermissionCleanupAlarm({
      env,
      hasOpenViewer: () => false,
      storage: storage.asStorage(),
    });

    expect(driverCommands).toEqual([
      expect.objectContaining({
        decision: "reject_once",
        kind: "permission.resolve",
        requestId: "permission-1",
      }),
    ]);
    expect(
      await database
        .prepare("SELECT request_id FROM session_permission_request WHERE session_id = ?")
        .bind(PUBLIC_API_TEST_IDS.ownerSession)
        .all(),
    ).toMatchObject({ results: [] });
    expect(storage.alarmAt).toBeNull();
  });

  test("skips rejection when the session is no longer active", async () => {
    const { database, driverCommands, env } = await createAlarmFixture();
    const storage = new MemoryAlarmStorage();
    await database
      .prepare("UPDATE session SET archived_at = 1 WHERE id = ?")
      .bind(PUBLIC_API_TEST_IDS.ownerSession)
      .run();

    await scheduleViewerPermissionCleanupAlarm({
      attachment: ATTACHMENT,
      storage: storage.asStorage(),
    });
    await runViewerPermissionCleanupAlarm({
      env,
      hasOpenViewer: () => false,
      storage: storage.asStorage(),
    });

    expect(driverCommands).toEqual([]);
    expect(storage.alarmAt).toBeNull();
  });
});
