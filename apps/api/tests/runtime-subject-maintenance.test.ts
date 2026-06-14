import { describe, expect, test } from "bun:test";

import { expireStaleReschedulingSessions } from "../src/modules/runtime/infrastructure/runtime-subject-lifecycle/runtime-subject-maintenance.service";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  insertMemberSession,
} from "./helpers/public-api-http-test-fixture";

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
      "run-rescheduling",
      "01J0000000000000000000000B",
      "01J00000000000000000000009",
      "01J00000000000000000000002",
      "user_prompt",
      "running",
      "openai",
      "gpt-5.4",
      "openai-runtime",
      "trace-rescheduling",
      1,
      1,
    )
    .run();
  await database
    .prepare("UPDATE session SET last_run_id = ?, status = ?, updated_at = ? WHERE id = ?")
    .bind("run-rescheduling", "RESCHEDULING", 1, "01J0000000000000000000000B")
    .run();
}

describe("runtime subject maintenance", () => {
  test("expires stale rescheduling sessions", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertMemberSession(database);
    await insertRunningSessionRun(database);

    const bindings = createPublicHttpTestBindings(database) as ApiBindings;

    await expireStaleReschedulingSessions(bindings);

    const run = await database
      .prepare("SELECT error_code, status FROM session_run WHERE id = ?")
      .bind("run-rescheduling")
      .first<{ error_code: string | null; status: string }>();
    expect(run).toEqual({
      error_code: "session.rescheduling_timeout",
      status: "failed",
    });
  });

  test("does not expire runtime operation owned rescheduling sessions", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertMemberSession(database);
    await insertRunningSessionRun(database);
    await database
      .prepare("UPDATE session SET status_operation_id = ? WHERE id = ?")
      .bind("01J0000000000000000000000R", "01J0000000000000000000000B")
      .run();
    const bindings = createPublicHttpTestBindings(database) as ApiBindings;

    await expireStaleReschedulingSessions(bindings);

    const session = await database
      .prepare("SELECT status, status_operation_id FROM session WHERE id = ?")
      .bind("01J0000000000000000000000B")
      .first<{ status: string; status_operation_id: string | null }>();
    const run = await database
      .prepare("SELECT error_code, status FROM session_run WHERE id = ?")
      .bind("run-rescheduling")
      .first<{ error_code: string | null; status: string }>();

    expect(session).toEqual({
      status: "RESCHEDULING",
      status_operation_id: "01J0000000000000000000000R",
    });
    expect(run).toEqual({
      error_code: null,
      status: "running",
    });
  });
});
