import { describe, expect, test } from "bun:test";

import { acquireSessionRunDispatch } from "../src/modules/runtime/application/session-runs/session-run-state.repository";
import {
  createPublicHttpContractDatabase,
  insertNonOwnerSession,
  PUBLIC_API_TEST_IDS,
} from "./helpers/public-api-http-test-fixture";

const RUN_ID = PUBLIC_API_TEST_IDS.run;

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
      RUN_ID,
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
    .bind(RUN_ID, "RUNNING", 1, "01J0000000000000000000000B")
    .run();
}

describe("session run state", () => {
  test("only the first dispatch acquire can continue a run", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(database);
    await insertQueuedSessionRun(database);

    const first = await acquireSessionRunDispatch(database, RUN_ID);
    const second = await acquireSessionRunDispatch(database, RUN_ID);

    expect(first?.id).toBe(RUN_ID);
    expect(first?.status).toBe("booting");
    expect(second).toBeNull();

    const stored = await database
      .prepare("SELECT status FROM session_run WHERE id = ?")
      .bind(RUN_ID)
      .first<{ status: string }>();
    expect(stored).toEqual({ status: "booting" });
  });
});
