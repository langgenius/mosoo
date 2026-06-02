import { describe, expect, test } from "bun:test";

import { parsePlatformId } from "@mosoo/id";
import type { AccountId, DriverInstanceId, SandboxId, SessionId, SessionRunId } from "@mosoo/id";

import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import { cancelRun } from "../src/modules/runtime/application/session-runs/cancel-run.service";
import { resolvePermissionRequest } from "../src/modules/runtime/application/session-runs/resolve-permission-request.service";
import { recordRuntimeRunLeaseAcquired } from "../src/modules/runtime/infrastructure/runtime-subject-lifecycle/runtime-run-lease-store";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  PUBLIC_API_TEST_IDS,
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  insertMemberSession,
} from "./helpers/published-agent-http-test-fixture";

const MEMBER_ACCOUNT_ID = parsePlatformId<AccountId>(
  "01J00000000000000000000002",
  "member account id",
);
const SESSION_ID = parsePlatformId<SessionId>("01J0000000000000000000000B", "session id");
const RUN_ID = parsePlatformId<SessionRunId>("01J0000000000000000000000N", "run id");
const SANDBOX_ID = parsePlatformId<SandboxId>("01J0000000000000000000000D", "sandbox id");
const DRIVER_INSTANCE_ID = parsePlatformId<DriverInstanceId>(
  "01J0000000000000000000000E",
  "driver instance id",
);

const memberViewer: AuthenticatedViewer = {
  email: "member@example.com",
  emailVerified: true,
  id: MEMBER_ACCOUNT_ID,
  imageUrl: null,
  name: "Member",
};

function createDriverConnectionBinding(requests: unknown[]) {
  return {
    get: () => ({
      fetch: async (request: Request) => {
        const body = request.method === "GET" ? null : await request.json();
        requests.push({
          body,
          path: new URL(request.url).pathname,
        });
        return Response.json({ ok: true });
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

async function ensureRuntimeLeaseTables(database: D1Database): Promise<void> {
  await database
    .prepare(
      `
        CREATE TABLE IF NOT EXISTS sandbox (
          id text PRIMARY KEY NOT NULL,
          inactive_deadline_at integer,
          kind text NOT NULL,
          updated_at integer NOT NULL
        )
      `,
    )
    .run();
  await database
    .prepare(
      `
        CREATE TABLE IF NOT EXISTS sandbox_session (
          sandbox_id text NOT NULL,
          session_id text PRIMARY KEY NOT NULL,
          status text NOT NULL
        )
      `,
    )
    .run();
}

async function insertRunningSessionRun(database: D1Database): Promise<void> {
  await database
    .prepare(
      `
        INSERT INTO session_run (
          id,
          session_id,
          agent_id,
          created_by_account_id,
          trigger,
          status,
          provider,
          model,
          runtime_id,
          trace_id,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .bind(
      RUN_ID,
      SESSION_ID,
      "01J00000000000000000000009",
      MEMBER_ACCOUNT_ID,
      "user_prompt",
      "running",
      "openai",
      "gpt-5.4",
      "openai-runtime",
      "trace-cancel",
      1,
      1,
    )
    .run();
  await database
    .prepare("UPDATE session SET last_run_id = ?, status = ? WHERE id = ?")
    .bind(RUN_ID, "RUNNING", SESSION_ID)
    .run();
}

async function insertRunDriverInstance(
  database: D1Database,
  input: { bindRun?: boolean; status?: string } = { bindRun: true },
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
      SESSION_ID,
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
    await insertMemberSession(database);
    await insertRunningSessionRun(database);

    const bindings = createPublicHttpTestBindings(database) as ApiBindings;

    const result = await cancelRun(bindings, memberViewer, { runId: RUN_ID });

    expect(result.run.status).toBe("cancelled");
    const run = await database
      .prepare("SELECT status FROM session_run WHERE id = ?")
      .bind(RUN_ID)
      .first<{ status: string }>();
    expect(run).toEqual({ status: "cancelled" });
    const event = await database
      .prepare("SELECT id FROM session_event WHERE session_id = ?")
      .bind(SESSION_ID)
      .first<{ id: string }>();
    expect(event).not.toBeNull();
  });

  test("cancels a cold-start run after the runtime lease binds the driver from the run", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertMemberSession(database);
    await insertRunningSessionRun(database);
    await ensureRuntimeLeaseTables(database);
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
      .bind(SANDBOX_ID, 1, "cattle", "session", SESSION_ID, "active", 1, 1)
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
            space_aliases_json,
            status,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .bind(
        "cloudflare-session-1",
        1,
        "/workspace",
        "{}",
        SANDBOX_ID,
        SESSION_ID,
        "[]",
        "active",
        1,
      )
      .run();
    await insertRunDriverInstance(database, { bindRun: false, status: "provisioning" });

    await expect(
      recordRuntimeRunLeaseAcquired(database, {
        driverInstanceId: DRIVER_INSTANCE_ID,
        runtimeSubjectId: SANDBOX_ID,
        sessionId: SESSION_ID,
        sessionRunId: RUN_ID,
      }),
    ).resolves.toBe(true);

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

    const result = await cancelRun(bindings, memberViewer, { runId: RUN_ID });

    expect(result.run.status).toBe("cancelled");
    expect(driverRequests).toHaveLength(1);
  });

  test("denies historical participants after membership is disabled or removed", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertMemberSession(database);
    await insertRunningSessionRun(database);
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;

    await database
      .prepare(
        `
          UPDATE organization_member
             SET disabled_at = 2
           WHERE organization_id = ?
             AND account_id = ?
        `,
      )
      .bind(PUBLIC_API_TEST_IDS.organization, MEMBER_ACCOUNT_ID)
      .run();

    await expect(cancelRun(bindings, memberViewer, { runId: RUN_ID })).rejects.toThrow();

    await database
      .prepare(
        `
          DELETE FROM organization_member
           WHERE organization_id = ?
             AND account_id = ?
        `,
      )
      .bind(PUBLIC_API_TEST_IDS.organization, MEMBER_ACCOUNT_ID)
      .run();

    await expect(cancelRun(bindings, memberViewer, { runId: RUN_ID })).rejects.toThrow();
  });

  test("denies permission resolution after membership is disabled", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertMemberSession(database);
    await insertRunningSessionRun(database);
    await insertRunDriverInstance(database);
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;

    await database
      .prepare(
        `
          UPDATE organization_member
             SET disabled_at = 2
           WHERE organization_id = ?
             AND account_id = ?
        `,
      )
      .bind(PUBLIC_API_TEST_IDS.organization, MEMBER_ACCOUNT_ID)
      .run();

    await expect(
      resolvePermissionRequest(bindings, memberViewer, {
        decision: "allow_once",
        driverInstanceId: DRIVER_INSTANCE_ID,
        requestId: "permission-1",
      }),
    ).rejects.toThrow();
  });
});
