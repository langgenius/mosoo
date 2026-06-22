import { describe, expect, test } from "bun:test";

import {
  reconcileStaleActiveSessionRun,
  reconcileStaleActiveSessionRuns,
} from "../src/modules/runtime/application/session-runs/stale-run-reconciliation.service";
import {
  createPublicHttpContractDatabase,
  insertNonOwnerSession,
} from "./helpers/public-api-http-test-fixture";

describe("session run reconciliation", () => {
  test("fails stale active runs", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(database);

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
        "run-stale",
        "01J0000000000000000000000B",
        "01J00000000000000000000009",
        "01J00000000000000000000002",
        "user_prompt",
        "running",
        "openai",
        "gpt-5.4",
        "openai-runtime",
        "trace-stale",
        1,
        1,
      )
      .run();
    await database
      .prepare("UPDATE session SET last_run_id = ?, status = ? WHERE id = ?")
      .bind("run-stale", "RUNNING", "01J0000000000000000000000B")
      .run();

    await expect(
      reconcileStaleActiveSessionRun(database, "01J0000000000000000000000B"),
    ).resolves.toBe(true);

    const run = await database
      .prepare("SELECT error_code, status FROM session_run WHERE id = ?")
      .bind("run-stale")
      .first<{ error_code: string | null; status: string }>();
    expect(run).toMatchObject({
      status: "failed",
    });
    expect(run?.error_code).toBeString();
  });

  test("reconciles stale active runs in batches", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(database);

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
        "run-stale",
        "01J0000000000000000000000B",
        "01J00000000000000000000009",
        "01J00000000000000000000002",
        "user_prompt",
        "running",
        "openai",
        "gpt-5.4",
        "openai-runtime",
        "trace-stale",
        1,
        1,
      )
      .run();
    await database
      .prepare("UPDATE session SET last_run_id = ?, status = ? WHERE id = ?")
      .bind("run-stale", "RUNNING", "01J0000000000000000000000B")
      .run();

    await expect(
      reconcileStaleActiveSessionRuns(database, {
        limit: 10,
      }),
    ).resolves.toEqual({
      reconciledRunIds: ["run-stale"],
      reconciledSessionIds: ["01J0000000000000000000000B"],
    });

    const run = await database
      .prepare("SELECT error_code, status FROM session_run WHERE id = ?")
      .bind("run-stale")
      .first<{ error_code: string | null; status: string }>();
    expect(run).toMatchObject({
      status: "failed",
    });
    expect(run?.error_code).toBeString();
  });
});
