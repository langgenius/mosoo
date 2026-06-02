import { describe, expect, test } from "bun:test";

import { updateSessionRunStatusIfActive } from "../src/modules/runtime/application/session-runs/session-run-state.repository";
import {
  createPublicHttpContractDatabase,
  insertMemberSession,
} from "./helpers/published-agent-http-test-fixture";

async function insertQueuedSessionRun(database: D1Database): Promise<void> {
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
      "run-active-transition",
      "01J0000000000000000000000B",
      "01J00000000000000000000009",
      "01J00000000000000000000002",
      "user_prompt",
      "queued",
      "openai",
      "gpt-5.4",
      "openai-runtime",
      "trace-active-transition",
      1,
      1,
    )
    .run();
  await database
    .prepare("UPDATE session SET last_run_id = ?, status = ?, updated_at = ? WHERE id = ?")
    .bind("run-active-transition", "RUNNING", 1, "01J0000000000000000000000B")
    .run();
}

describe("session run state", () => {
  test("returns active status transitions", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertMemberSession(database);
    await insertQueuedSessionRun(database);

    const run = await updateSessionRunStatusIfActive(database, {
      runId: "run-active-transition",
      status: "booting",
    });

    expect(run?.id).toBe("run-active-transition");
    expect(run?.status).toBe("booting");

    const stored = await database
      .prepare("SELECT status FROM session_run WHERE id = ?")
      .bind("run-active-transition")
      .first<{ status: string }>();
    expect(stored).toEqual({ status: "booting" });
  });
});
