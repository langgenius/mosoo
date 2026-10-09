import { describe, expect, test } from "bun:test";

import {
  SESSION_RUN_TIME_LIMIT_ERROR,
  stopOverdueSessionRuns,
} from "../src/modules/runtime/application/session-runs/session-run-time-limit.service";
import { SESSION_RUN_TIME_LIMIT_MS } from "../src/modules/runtime/domain/session-runtime-policy";
import { runSandboxMaintenance } from "../src/modules/runtime/infrastructure/runtime-subject-lifecycle/runtime-subject-maintenance.service";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  insertNonOwnerSession,
  insertOwnerSession,
  PUBLIC_API_TEST_IDS,
} from "./helpers/public-api-http-test-fixture";

const OVERDUE_RUN_ID = "01J0000000000000000000R001";
const RECENT_RUN_ID = "01J0000000000000000000R002";

type TestDatabase = Awaited<ReturnType<typeof createPublicHttpContractDatabase>>;

async function insertActiveRun(
  database: TestDatabase,
  input: {
    readonly runId: string;
    readonly sessionId: string;
    readonly startedAt: number;
  },
): Promise<void> {
  await database
    .prepare(
      `
        INSERT INTO session_run (
          id, session_id, agent_id, created_by_account_id, trigger, status, provider,
          model, runtime_id, trace_id, started_at, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, 'user_prompt', 'running', 'openai', 'gpt-5.4', 'openai-runtime', ?, ?, ?, ?)
      `,
    )
    .bind(
      input.runId,
      input.sessionId,
      PUBLIC_API_TEST_IDS.agent,
      PUBLIC_API_TEST_IDS.nonOwnerAccount,
      `trace-${input.runId}`,
      input.startedAt,
      input.startedAt,
      input.startedAt,
    )
    .run();
  await database
    .prepare("UPDATE session SET last_run_id = ?, status = ?, updated_at = ? WHERE id = ?")
    .bind(input.runId, "RUNNING", input.startedAt, input.sessionId)
    .run();
}

async function readRun(database: TestDatabase, runId: string) {
  return database
    .prepare("SELECT error_code, error_message, status FROM session_run WHERE id = ?")
    .bind(runId)
    .first<{ error_code: string | null; error_message: string | null; status: string }>();
}

async function readSessionStatus(database: TestDatabase, sessionId: string) {
  return database
    .prepare("SELECT status FROM session WHERE id = ?")
    .bind(sessionId)
    .first<{ status: string }>();
}

describe("session run time limit", () => {
  test("cancels only turns that ran past the limit and says why", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(database);
    await insertOwnerSession(database);
    const now = Date.now();
    await insertActiveRun(database, {
      runId: OVERDUE_RUN_ID,
      sessionId: PUBLIC_API_TEST_IDS.nonOwnerSession,
      startedAt: now - SESSION_RUN_TIME_LIMIT_MS - 60_000,
    });
    await insertActiveRun(database, {
      runId: RECENT_RUN_ID,
      sessionId: PUBLIC_API_TEST_IDS.ownerSession,
      startedAt: now - 60 * 60_000,
    });
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;

    await expect(stopOverdueSessionRuns(bindings, { limit: 20, nowMs: now })).resolves.toEqual([
      OVERDUE_RUN_ID,
    ]);

    await expect(readRun(database, OVERDUE_RUN_ID)).resolves.toEqual({
      error_code: SESSION_RUN_TIME_LIMIT_ERROR.code,
      error_message: "This turn reached the 2-hour limit and was stopped.",
      status: "cancelled",
    });
    await expect(readSessionStatus(database, PUBLIC_API_TEST_IDS.nonOwnerSession)).resolves.toEqual(
      { status: "IDLE" },
    );
    await expect(
      database
        .prepare("SELECT event_type FROM session_event WHERE run_id = ?")
        .bind(OVERDUE_RUN_ID)
        .all<{ event_type: string }>()
        .then((result) => result.results.map((row) => row.event_type)),
    ).resolves.toContain("run.cancelled");
    await expect(readRun(database, RECENT_RUN_ID)).resolves.toEqual({
      error_code: null,
      error_message: null,
      status: "running",
    });
  });

  test("maintenance keeps sweeping after an earlier step fails", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(database);
    await insertOwnerSession(database);
    const now = Date.now();
    await insertActiveRun(database, {
      runId: OVERDUE_RUN_ID,
      sessionId: PUBLIC_API_TEST_IDS.nonOwnerSession,
      startedAt: now - SESSION_RUN_TIME_LIMIT_MS - 60_000,
    });
    // Reclamation, which runs before the turn time limit, reads this table.
    database.execute("DROP TABLE driver_instance");
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;

    await runSandboxMaintenance(bindings);

    await expect(readRun(database, OVERDUE_RUN_ID)).resolves.toMatchObject({
      status: "cancelled",
    });
  });
});
