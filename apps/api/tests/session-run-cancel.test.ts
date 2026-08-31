import { describe, expect, test } from "bun:test";

import { parsePlatformId } from "@mosoo/id";
import type { AccountId, DriverInstanceId, SandboxId, SessionId, SessionRunId } from "@mosoo/id";

import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import { cancelRun } from "../src/modules/runtime/application/session-runs/cancel-run.service";
import { resolvePermissionRequest } from "../src/modules/runtime/application/session-runs/resolve-permission-request.service";
import { createSessionRunUpdatedEvent } from "../src/modules/runtime/application/session-runs/session-run-view-events.service";
import { createSessionRunTerminalSourceId } from "../src/modules/runtime/domain/session-run-terminal-event-id";
import { commitTerminalRunProjection } from "../src/modules/runtime/infrastructure/driver-instance/completed-run-commit.repository";
import { recordRuntimeRunLeaseAcquired } from "../src/modules/runtime/infrastructure/runtime-subject-lifecycle/runtime-run-lease-store";
import { getSessionRunSummary } from "../src/modules/runtime/infrastructure/session-runs/session-run-store.repository";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  PUBLIC_API_TEST_IDS,
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  insertActiveSandboxSessionFixture,
  insertOwnerSession,
} from "./helpers/public-api-http-test-fixture";
import type { SqliteD1Database } from "./helpers/sqlite-d1";

const OWNER_ACCOUNT_ID = parsePlatformId<AccountId>(
  "01J00000000000000000000001",
  "owner account id",
);
const OWNER_SESSION_ID = parsePlatformId<SessionId>(
  "01J0000000000000000000000C",
  "owner session id",
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

function createDriverConnectionBinding(requests: unknown[], onSend?: () => Promise<void>) {
  return {
    get: () => ({
      fetch: async (request: Request) => {
        const body = request.method === "GET" ? null : await request.json();
        requests.push({
          body,
          path: new URL(request.url).pathname,
        });
        await onSend?.();
        return Response.json({ ok: true });
      },
    }),
    idFromName: (name: string) => name,
  };
}

function withDriverConnection(
  bindings: ApiBindings,
  requests: unknown[],
  onSend?: () => Promise<void>,
): ApiBindings {
  return {
    ...bindings,
    DriverConnection: createDriverConnectionBinding(
      requests,
      onSend,
    ) as ApiBindings["DriverConnection"],
  };
}

async function commitDriverTerminalRun(
  database: D1Database,
  status: "cancelled" | "completed",
  timestampMs = Date.now(),
): Promise<void> {
  const current = await getSessionRunSummary(database, RUN_ID);
  if (current === null) throw new Error("Missing test Session Run.");
  const timestamp = new Date(timestampMs).toISOString();
  const run = {
    ...current,
    completedAt: timestamp,
    startedAt: current.startedAt ?? timestamp,
    status,
    updatedAt: timestamp,
  };
  const kind = status === "completed" ? "run.completed" : "run.cancelled";
  const sourceEventId = createSessionRunTerminalSourceId(RUN_ID, kind);
  const event = createSessionRunUpdatedEvent(run, OWNER_SESSION_ID, "IDLE", sourceEventId);

  await commitTerminalRunProjection(database, {
    assistantMessage: null,
    error: null,
    runId: RUN_ID,
    sessionId: OWNER_SESSION_ID,
    source: "driver",
    targetStatus: status,
    terminalEvent: { event, occurredAt: timestampMs, sourceEventId },
    timestampMs,
  });
}

async function insertRunningSessionRun(
  database: D1Database,
  input: {
    createdByAccountId: AccountId;
    sessionId: SessionId;
  },
): Promise<void> {
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
      input.sessionId,
      "01J00000000000000000000009",
      input.createdByAccountId,
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
    .bind(RUN_ID, "RUNNING", input.sessionId)
    .run();
}

async function insertRunDriverInstance(
  database: SqliteD1Database,
  input: {
    bindRun?: boolean;
    kind?: "cattle" | "pet";
    sessionId: SessionId;
    status?: string;
  },
): Promise<void> {
  await insertActiveSandboxSessionFixture(database, {
    kind: input.kind,
    ownerAccountId: OWNER_ACCOUNT_ID,
    sandboxId: SANDBOX_ID,
    sessionId: input.sessionId,
  });
  await database
    .prepare(
      `
        INSERT INTO driver_instance (
          id,
          connection_id,
          sandbox_id,
          sandbox_incarnation,
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
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .bind(
      DRIVER_INSTANCE_ID,
      "driver-connection-1",
      SANDBOX_ID,
      1,
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
    await insertRunningSessionRun(database, {
      createdByAccountId: OWNER_ACCOUNT_ID,
      sessionId: OWNER_SESSION_ID,
    });
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;

    const result = await cancelRun(bindings, ownerViewer, {
      projectId: PUBLIC_API_TEST_IDS.project,
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
    await insertRunningSessionRun(database, {
      createdByAccountId: OWNER_ACCOUNT_ID,
      sessionId: OWNER_SESSION_ID,
    });
    await insertRunDriverInstance(database, {
      bindRun: false,
      kind: "cattle",
      sessionId: OWNER_SESSION_ID,
      status: "provisioning",
    });

    await expect(
      recordRuntimeRunLeaseAcquired(database, {
        driverGeneration: 0,
        driverInstanceId: DRIVER_INSTANCE_ID,
        runtimeSubjectId: SANDBOX_ID,
        runtimeSubjectIncarnation: 1,
        sessionId: OWNER_SESSION_ID,
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
      () => commitDriverTerminalRun(database, "cancelled"),
    );

    const result = await cancelRun(bindings, ownerViewer, {
      projectId: PUBLIC_API_TEST_IDS.project,
      runId: RUN_ID,
      sessionId: OWNER_SESSION_ID,
    });

    expect(result.run.status).toBe("cancelled");
    expect(driverRequests).toHaveLength(1);
  });

  test("adopts a Driver completion that wins the cancellation race", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertOwnerSession(database);
    await insertRunningSessionRun(database, {
      createdByAccountId: OWNER_ACCOUNT_ID,
      sessionId: OWNER_SESSION_ID,
    });
    await insertRunDriverInstance(database, {
      bindRun: true,
      sessionId: OWNER_SESSION_ID,
    });
    const bindings = withDriverConnection(
      createPublicHttpTestBindings(database) as ApiBindings,
      [],
      () => commitDriverTerminalRun(database, "completed"),
    );

    const result = await cancelRun(bindings, ownerViewer, {
      projectId: PUBLIC_API_TEST_IDS.project,
      runId: RUN_ID,
      sessionId: OWNER_SESSION_ID,
    });

    expect(result.run.status).toBe("completed");
    const terminals = await database
      .prepare(
        "SELECT event_type FROM session_event WHERE run_id = ? AND event_type IN ('run.cancelled', 'run.completed', 'run.failed')",
      )
      .bind(RUN_ID)
      .all<{ event_type: string }>();
    expect(terminals.results).toEqual([{ event_type: "run.completed" }]);
  });

  test("adopts one canonical legacy terminal projection without advancing cursors", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertOwnerSession(database);
    await insertRunningSessionRun(database, {
      createdByAccountId: OWNER_ACCOUNT_ID,
      sessionId: OWNER_SESSION_ID,
    });
    await commitDriverTerminalRun(database, "cancelled");
    await database
      .prepare(
        "UPDATE session_event SET semantic_hash = NULL, terminal_event_json = NULL WHERE run_id = ?",
      )
      .bind(RUN_ID)
      .run();
    const before = await database
      .prepare(
        "SELECT message_seq_cursor, runtime_event_seq_cursor, status, status_operation_id, status_seq FROM session WHERE id = ?",
      )
      .bind(OWNER_SESSION_ID)
      .first();

    await expect(commitDriverTerminalRun(database, "cancelled")).resolves.toBeUndefined();

    const after = await database
      .prepare(
        "SELECT message_seq_cursor, runtime_event_seq_cursor, status, status_operation_id, status_seq FROM session WHERE id = ?",
      )
      .bind(OWNER_SESSION_ID)
      .first();
    const terminals = await database
      .prepare("SELECT semantic_hash, source_event_id FROM session_event WHERE run_id = ?")
      .bind(RUN_ID)
      .all();
    expect(after).toEqual(before);
    expect(terminals.results).toEqual([
      {
        semantic_hash: null,
        source_event_id: createSessionRunTerminalSourceId(RUN_ID, "run.cancelled"),
      },
    ]);
  });

  test("does not move the Session lease timestamp backwards when a terminal event is older", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertOwnerSession(database);
    await insertRunningSessionRun(database, {
      createdByAccountId: OWNER_ACCOUNT_ID,
      sessionId: OWNER_SESSION_ID,
    });
    await database
      .prepare("UPDATE session SET updated_at = ? WHERE id = ?")
      .bind(2_000, OWNER_SESSION_ID)
      .run();

    await commitDriverTerminalRun(database, "cancelled", 1_000);

    await expect(
      database
        .prepare("SELECT updated_at FROM session WHERE id = ?")
        .bind(OWNER_SESSION_ID)
        .first<number>("updated_at"),
    ).resolves.toBe(2_000);
  });

  test("rejects a noncanonical legacy terminal projection", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertOwnerSession(database);
    await insertRunningSessionRun(database, {
      createdByAccountId: OWNER_ACCOUNT_ID,
      sessionId: OWNER_SESSION_ID,
    });
    await commitDriverTerminalRun(database, "cancelled");
    await database
      .prepare(
        "UPDATE session_event SET semantic_hash = NULL, terminal_event_json = NULL, source_event_id = 'provider-terminal' WHERE run_id = ?",
      )
      .bind(RUN_ID)
      .run();

    await expect(commitDriverTerminalRun(database, "cancelled")).rejects.toThrow(
      "Legacy terminal projection conflicts",
    );
  });

  test("synthesizes cancellation only when the Driver control socket is confirmed missing", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertOwnerSession(database);
    await insertRunningSessionRun(database, {
      createdByAccountId: OWNER_ACCOUNT_ID,
      sessionId: OWNER_SESSION_ID,
    });
    await insertRunDriverInstance(database, {
      bindRun: true,
      sessionId: OWNER_SESSION_ID,
    });
    await database
      .prepare("UPDATE driver_instance SET connection_id = NULL WHERE id = ?")
      .bind(DRIVER_INSTANCE_ID)
      .run();
    const driverRequests: string[] = [];
    const bindings = {
      ...(createPublicHttpTestBindings(database) as ApiBindings),
      DriverConnection: {
        get: () => ({
          fetch: async (request: Request) => {
            const path = new URL(request.url).pathname;
            driverRequests.push(path);
            if (path === "/control/send") {
              throw new Error("Runtime driver control socket is not connected.");
            }
            if (path === "/control/fail") {
              await database
                .prepare("UPDATE driver_instance SET status = 'failed' WHERE id = ?")
                .bind(DRIVER_INSTANCE_ID)
                .run();
            }
            return Response.json({ ok: true });
          },
        }),
        idFromName: (name: string) => name,
      } as ApiBindings["DriverConnection"],
    };

    const result = await cancelRun(bindings, ownerViewer, {
      projectId: PUBLIC_API_TEST_IDS.project,
      runId: RUN_ID,
      sessionId: OWNER_SESSION_ID,
    });
    const run = await database
      .prepare("SELECT status, status_source FROM session_run WHERE id = ?")
      .bind(RUN_ID)
      .first<{ status: string; status_source: string }>();

    expect(result.run.status).toBe("cancelled");
    expect(run).toEqual({ status: "cancelled", status_source: "viewer" });
    expect(driverRequests).toEqual([
      "/control/send",
      "/control/send",
      "/control/fail",
      "/wait/close",
    ]);
    await expect(
      database
        .prepare("SELECT status, status_operation_id FROM driver_instance WHERE id = ?")
        .bind(DRIVER_INSTANCE_ID)
        .first(),
    ).resolves.toEqual({ status: "failed", status_operation_id: null });
    await expect(
      database
        .prepare("SELECT driver_instance_id FROM session_run WHERE id = ?")
        .bind(RUN_ID)
        .first(),
    ).resolves.toEqual({ driver_instance_id: DRIVER_INSTANCE_ID });
  });

  test("resolves permission requests for the Project owner through Project ownership", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertOwnerSession(database);
    await insertRunningSessionRun(database, {
      createdByAccountId: OWNER_ACCOUNT_ID,
      sessionId: OWNER_SESSION_ID,
    });
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
      resolvePermissionRequest(bindings, ownerViewer, {
        decision: "allow_once",
        driverInstanceId: DRIVER_INSTANCE_ID,
        projectId: PUBLIC_API_TEST_IDS.project,
        requestId: "permission-1",
        runId: RUN_ID,
        sessionId: OWNER_SESSION_ID,
      }),
    ).resolves.toBeUndefined();
    expect(driverRequests).toHaveLength(1);
  });
});
