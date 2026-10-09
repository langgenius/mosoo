import { describe, expect, test } from "bun:test";

import { parsePlatformId } from "@mosoo/id";
import type { AccountId, DriverInstanceId, SandboxId, SessionId, SessionRunId } from "@mosoo/id";

import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import { cancelRun } from "../src/modules/runtime/application/session-runs/cancel-run.service";
import { resolvePermissionRequest } from "../src/modules/runtime/application/session-runs/resolve-permission-request.service";
import { acquireRuntimeRunLease } from "../src/modules/runtime/infrastructure/runtime-subject-lifecycle/runtime-run-lease-store";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  insertNonOwnerSession,
  insertOwnerSession,
  insertSessionRunFixture,
  PUBLIC_API_TEST_IDS,
} from "./helpers/public-api-http-test-fixture";

const OWNER_ACCOUNT_ID = parsePlatformId<AccountId>(
  "01J00000000000000000000001",
  "owner account id",
);
const OWNER_SESSION_ID = parsePlatformId<SessionId>(
  "01J0000000000000000000000C",
  "owner session id",
);
const OTHER_SESSION_ID = parsePlatformId<SessionId>(
  PUBLIC_API_TEST_IDS.nonOwnerSession,
  "other session id",
);
const RUN_ID = parsePlatformId<SessionRunId>("01J0000000000000000000000N", "run id");
const SANDBOX_ID = parsePlatformId<SandboxId>("01J0000000000000000000000D", "sandbox id");
const DRIVER_INSTANCE_ID = parsePlatformId<DriverInstanceId>(
  "01J0000000000000000000000E",
  "driver instance id",
);

const ownerViewer: AuthenticatedViewer = {
  email: "owner@example.com",
  emailVerified: true,
  id: OWNER_ACCOUNT_ID,
  imageUrl: null,
  name: "Owner",
};

function createDriverConnectionBinding(requests: unknown[]) {
  return {
    get: () => ({
      sendControlCommand: async (_driverInstanceId: string, command: unknown) => {
        requests.push(command);
      },
    }),
    idFromName: (name: string) => name,
  };
}

function withDriverConnection(bindings: ApiBindings, requests: unknown[]): ApiBindings {
  return {
    ...bindings,
    DriverConnection: createDriverConnectionBinding(requests) as ApiBindings["DriverConnection"],
  };
}

async function insertRunningSessionRun(database: D1Database): Promise<void> {
  await insertSessionRunFixture(database, {
    createdByAccountId: OWNER_ACCOUNT_ID,
    id: RUN_ID,
    sessionId: OWNER_SESSION_ID,
    status: "running",
  });
}

async function insertRunDriverInstance(
  database: D1Database,
  input: { bindRun?: boolean; sessionId: SessionId; status?: string },
): Promise<void> {
  await database
    .prepare(
      `
        INSERT INTO driver_instance (
          id,
          sandbox_id,
          sandbox_session_id,
          runtime,
          protocol,
          protocol_version,
          status,
          boot_token_hash,
          boot_token_expires_at,
          generation,
          heartbeat_count,
          expires_at,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .bind(
      DRIVER_INSTANCE_ID,
      SANDBOX_ID,
      input.sessionId,
      "cloudflare-container",
      "driver-ws",
      1,
      input.status ?? "ready",
      new Uint8Array([1]),
      10_000,
      0,
      0,
      20_000,
      1,
      1,
    )
    .run();

  if (input.bindRun === true) {
    await database
      .prepare("UPDATE session_run SET driver_instance_id = ? WHERE id = ?")
      .bind(DRIVER_INSTANCE_ID, RUN_ID)
      .run();
  }
}

describe("session run cancel", () => {
  test("cancels an owned run and emits the cancellation event", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertOwnerSession(database);
    await insertRunningSessionRun(database);
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;

    const result = await cancelRun(bindings, ownerViewer, {
      runId: RUN_ID,
      sessionId: OWNER_SESSION_ID,
    });

    expect(result.run.status).toBe("cancelled");
    const run = await database
      .prepare("SELECT status FROM session_run WHERE id = ?")
      .bind(RUN_ID)
      .first<{ status: string }>();
    expect(run).toEqual({ status: "cancelled" });
    const event = await database
      .prepare("SELECT id FROM session_event WHERE session_id = ?")
      .bind(OWNER_SESSION_ID)
      .first<{ id: string }>();
    expect(event).not.toBeNull();
  });

  test("cancels a cold-start run after the runtime lease binds the driver from the run", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertOwnerSession(database);
    await insertRunningSessionRun(database);
    await database
      .prepare(
        `
          INSERT INTO sandbox (
            id,
            inactive_deadline_at,
            kind,
            subject_kind,
            subject_id,
            status,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .bind(SANDBOX_ID, 1, "cattle", "session", OWNER_SESSION_ID, "active", 1, 1)
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
        "01J0000000000000000000000Z",
        1,
        "/workspace",
        "{}",
        SANDBOX_ID,
        OWNER_SESSION_ID,
        "active",
        1,
      )
      .run();
    await insertRunDriverInstance(database, {
      bindRun: false,
      sessionId: OWNER_SESSION_ID,
      status: "provisioning",
    });

    await expect(
      acquireRuntimeRunLease(database, {
        driverInstanceId: DRIVER_INSTANCE_ID,
        runtimeSubjectId: SANDBOX_ID,
        sessionId: OWNER_SESSION_ID,
        sessionRunId: RUN_ID,
      }),
    ).resolves.toEqual({ ok: true });

    const linkedRun = await database
      .prepare("SELECT driver_instance_id FROM session_run WHERE id = ?")
      .bind(RUN_ID)
      .first<{ driver_instance_id: string | null }>();
    expect(linkedRun).toEqual({ driver_instance_id: DRIVER_INSTANCE_ID });

    const driverRequests: unknown[] = [];
    const bindings = withDriverConnection(
      createPublicHttpTestBindings(database) as ApiBindings,
      driverRequests,
    );

    const result = await cancelRun(bindings, ownerViewer, {
      runId: RUN_ID,
      sessionId: OWNER_SESSION_ID,
    });

    expect(result.run.status).toBe("cancelled");
    expect(driverRequests).toHaveLength(1);
  });

  test("resolves permission requests through the active Run's driver", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertOwnerSession(database);
    await insertRunningSessionRun(database);
    await insertRunDriverInstance(database, {
      bindRun: true,
      sessionId: OWNER_SESSION_ID,
    });
    const driverRequests: unknown[] = [];
    const bindings = withDriverConnection(
      createPublicHttpTestBindings(database) as ApiBindings,
      driverRequests,
    );

    await expect(
      resolvePermissionRequest(bindings, {
        decision: "allow_once",
        driverInstanceId: DRIVER_INSTANCE_ID,
        requestId: "permission-1",
        sessionId: OWNER_SESSION_ID,
      }),
    ).resolves.toBeUndefined();
    expect(driverRequests).toHaveLength(1);
  });

  // The caller authorized OWNER_SESSION_ID; ids naming another Session's Run or
  // Driver must not reach that Run.
  test("does not cancel a Run of another Session", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertOwnerSession(database);
    await insertNonOwnerSession(database);
    await insertSessionRunFixture(database, {
      id: RUN_ID,
      sessionId: OTHER_SESSION_ID,
      status: "running",
    });
    const driverRequests: unknown[] = [];
    const bindings = withDriverConnection(
      createPublicHttpTestBindings(database) as ApiBindings,
      driverRequests,
    );

    await expect(
      cancelRun(bindings, ownerViewer, { runId: RUN_ID, sessionId: OWNER_SESSION_ID }),
    ).rejects.toThrow("Session run not found.");
    await expect(
      database.prepare("SELECT status FROM session_run WHERE id = ?").bind(RUN_ID).first(),
    ).resolves.toEqual({ status: "running" });
    expect(driverRequests).toEqual([]);
  });

  test("does not resolve a permission through another Session's Driver", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertOwnerSession(database);
    await insertNonOwnerSession(database);
    await insertSessionRunFixture(database, {
      id: RUN_ID,
      sessionId: OTHER_SESSION_ID,
      status: "running",
    });
    await insertRunDriverInstance(database, { bindRun: true, sessionId: OTHER_SESSION_ID });
    const driverRequests: unknown[] = [];
    const bindings = withDriverConnection(
      createPublicHttpTestBindings(database) as ApiBindings,
      driverRequests,
    );

    await expect(
      resolvePermissionRequest(bindings, {
        decision: "allow_once",
        driverInstanceId: DRIVER_INSTANCE_ID,
        requestId: "permission-1",
        sessionId: OWNER_SESSION_ID,
      }),
    ).rejects.toThrow("Driver instance not found.");
    expect(driverRequests).toEqual([]);
  });
});
