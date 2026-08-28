import { describe, expect, test } from "bun:test";

import { reconcileStaleActiveSessionRuns } from "../src/modules/runtime/application/session-runs/stale-run-reconciliation.service";
import { RUNTIME_SOCKET_TIMEOUT_MS } from "../src/modules/runtime/domain/runtime-config";
import { getRuntimeKindPolicy } from "../src/modules/runtime/domain/runtime-kind-policy";
import { cleanupDriverInstances } from "../src/modules/runtime/infrastructure/driver-instance/maintenance";
import { repairStrandedRuntimeSubjectDeadlines } from "../src/modules/runtime/infrastructure/runtime-subject-lifecycle/runtime-subject-maintenance-store";
import { listInactiveRuntimeSubjects } from "../src/modules/runtime/infrastructure/runtime-subject-lifecycle/runtime-subject-store";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  createPublicHttpContractDatabase,
  insertNonOwnerSession,
} from "./helpers/public-api-http-test-fixture";
import type { SqliteD1Database } from "./helpers/sqlite-d1";

const SANDBOX_ID = "01J0000000000000000000000D";
const DRIVER_ID = "01J0000000000000000000000E";
const RUN_ID = "01J0000000000000000000000N";
const SESSION_ID = "01J0000000000000000000000B";
const AGENT_ID = "01J00000000000000000000009";
const PET_IDLE_GRACE_MS = getRuntimeKindPolicy("pet").subject.idleReleaseDelayMs;

function createBindings(database: D1Database): ApiBindings {
  return { DB: database } as ApiBindings;
}

async function insertSandbox(
  database: SqliteD1Database,
  input: {
    readonly id?: string;
    readonly kind?: "cattle" | "pet";
    readonly subjectId?: string;
    readonly subjectKind?: "agent" | "session";
  } = {},
): Promise<void> {
  await database
    .prepare(
      `
        INSERT INTO sandbox (id, kind, subject_kind, subject_id, status, inactive_deadline_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'active', NULL, 1, 1)
      `,
    )
    .bind(
      input.id ?? SANDBOX_ID,
      input.kind ?? "pet",
      input.subjectKind ?? "agent",
      input.subjectId ?? AGENT_ID,
    )
    .run();
}

async function insertDriver(
  database: SqliteD1Database,
  input: {
    readonly id?: string;
    readonly lastHeartbeatAt: number;
    readonly sandboxId?: string;
    readonly status?: string;
  },
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
          boot_token_used_at,
          generation,
          heartbeat_count,
          last_heartbeat_at,
          expires_at,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .bind(
      input.id ?? DRIVER_ID,
      input.sandboxId ?? SANDBOX_ID,
      SESSION_ID,
      "cloudflare-container",
      "driver-ws",
      1,
      input.status ?? "ready",
      new Uint8Array([1]),
      Date.now() + 10_000,
      Date.now(),
      0,
      1,
      input.lastHeartbeatAt,
      Date.now() + 20_000,
      1,
      input.lastHeartbeatAt,
    )
    .run();
}

async function insertRun(
  database: SqliteD1Database,
  input: {
    readonly driverInstanceId?: string | null;
    readonly id?: string;
    readonly sessionId?: string;
    readonly status?: string;
  } = {},
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
          driver_instance_id,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .bind(
      input.id ?? RUN_ID,
      input.sessionId ?? SESSION_ID,
      AGENT_ID,
      "01J00000000000000000000002",
      "user_prompt",
      input.status ?? "running",
      "openai",
      "gpt-5.4",
      "openai-runtime",
      "trace-pet-stranded",
      input.driverInstanceId === undefined ? DRIVER_ID : input.driverInstanceId,
      1,
      1,
    )
    .run();
}

async function readSandboxDeadline(
  database: SqliteD1Database,
  sandboxId = SANDBOX_ID,
): Promise<number | null> {
  const row = await database
    .prepare("SELECT inactive_deadline_at FROM sandbox WHERE id = ?")
    .bind(sandboxId)
    .first<{ inactive_deadline_at: number | null }>();

  if (row === undefined || row === null) {
    throw new Error("Sandbox test row was not found.");
  }

  return row.inactive_deadline_at;
}

// Production chain YEF-1126: a pet driver heartbeat dies, maintenance fails the
// driver and the run, but nothing re-arms the pet inactive deadline, so the
// sandbox stays active (and billing) forever. These tests pin the repaired
// chain: heartbeat timeout -> terminal failed run -> lease released ->
// deadline armed -> recycle candidate.
describe("pet stranded recycle", () => {
  test("maintenance reclaim of a heartbeat-stale pet run arms the inactive deadline", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(database);
    const startMs = Date.now();
    await insertSandbox(database);
    await insertDriver(database, {
      lastHeartbeatAt: startMs - RUNTIME_SOCKET_TIMEOUT_MS - 1_000,
    });
    await insertRun(database);
    await database
      .prepare("UPDATE session SET last_run_id = ?, status = ? WHERE id = ?")
      .bind(RUN_ID, "RUNNING", SESSION_ID)
      .run();

    await cleanupDriverInstances(createBindings(database));

    const driver = await database
      .prepare("SELECT status FROM driver_instance WHERE id = ?")
      .bind(DRIVER_ID)
      .first<{ status: string }>();
    expect(driver?.status).toBe("failed");

    await expect(reconcileStaleActiveSessionRuns(database, { limit: 10 })).resolves.toMatchObject({
      reconciledRunIds: [RUN_ID],
    });

    const run = await database
      .prepare("SELECT error_code, status FROM session_run WHERE id = ?")
      .bind(RUN_ID)
      .first<{ error_code: string | null; status: string }>();
    expect(run).toMatchObject({ error_code: "runtime.driver_stopped", status: "failed" });

    const deadline = await readSandboxDeadline(database);
    expect(deadline).not.toBeNull();
    expect(deadline).toBeGreaterThanOrEqual(startMs + PET_IDLE_GRACE_MS);
    expect(deadline).toBeLessThanOrEqual(Date.now() + PET_IDLE_GRACE_MS);

    await expect(
      listInactiveRuntimeSubjects(database, { limit: 10, now: deadline ?? 0 }),
    ).resolves.toEqual([{ id: SANDBOX_ID, kind: "pet" }]);
  });

  test("repairs a stranded pet after the failed driver row was retention-deleted", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(database);
    const startMs = Date.now();
    await insertSandbox(database);
    // The run went terminal, but its driver row already aged out of the 24h
    // retention window, so a late lease release can no longer resolve the
    // sandbox. Only the defensive repair can arm the deadline now.
    await insertRun(database, { driverInstanceId: DRIVER_ID, status: "failed" });

    await expect(
      repairStrandedRuntimeSubjectDeadlines(database, { now: startMs }),
    ).resolves.toEqual({ cattle: 0, pet: 1 });

    const deadline = await readSandboxDeadline(database);
    expect(deadline).toBe(startMs + PET_IDLE_GRACE_MS);

    await expect(
      listInactiveRuntimeSubjects(database, { limit: 10, now: startMs + PET_IDLE_GRACE_MS }),
    ).resolves.toEqual([{ id: SANDBOX_ID, kind: "pet" }]);
  });

  test("leaves live, busy, and resident subjects alone", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(database);
    const nowMs = Date.now();
    // A pet with a live driver is not reclaimable.
    await insertSandbox(database, { id: "01J0000000000000000000000V" });
    await insertDriver(database, {
      id: "01J0000000000000000000000W",
      lastHeartbeatAt: nowMs,
      sandboxId: "01J0000000000000000000000V",
    });
    // A pet whose subject still has an active run is not reclaimable, even
    // when no driver row links the run to the sandbox yet.
    await insertSandbox(database, {
      id: "01J0000000000000000000000X",
      subjectId: SESSION_ID,
      subjectKind: "session",
    });
    await insertRun(database, { driverInstanceId: null, status: "queued" });
    // A cattle subject with an active conversation stays resident.
    await insertSandbox(database, { id: "01J0000000000000000000000Y", kind: "cattle" });
    await database
      .prepare(
        `
          INSERT INTO sandbox_session (cloudflare_session_id, created_at, cwd, origin_json, sandbox_id, session_id, status, updated_at)
          VALUES ('cf-session-1', 1, '/workspace', '{}', '01J0000000000000000000000Y', '01J0000000000000000000000C', 'active', 1)
        `,
      )
      .run();

    await expect(repairStrandedRuntimeSubjectDeadlines(database, { now: nowMs })).resolves.toEqual({
      cattle: 0,
      pet: 0,
    });

    await expect(readSandboxDeadline(database, "01J0000000000000000000000V")).resolves.toBeNull();
    await expect(readSandboxDeadline(database, "01J0000000000000000000000X")).resolves.toBeNull();
    await expect(readSandboxDeadline(database, "01J0000000000000000000000Y")).resolves.toBeNull();
  });
});
