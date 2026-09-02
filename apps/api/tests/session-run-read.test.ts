import { describe, expect, test } from "bun:test";

import {
  getActiveSessionRunId,
  hasActiveSessionRun,
} from "../src/modules/runtime/infrastructure/session-runs/session-run-store.repository";
import {
  createPublicHttpContractDatabase,
  insertNonOwnerSession,
  PUBLIC_API_TEST_IDS,
} from "./helpers/public-api-http-test-fixture";

async function insertQueuedSessionRun(
  database: D1Database,
  input: {
    createdAt?: number;
    id?: string;
  } = {},
): Promise<void> {
  const id = input.id ?? PUBLIC_API_TEST_IDS.run;
  const createdAt = input.createdAt ?? 1;

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
      id,
      "01J0000000000000000000000B",
      "01J00000000000000000000009",
      "01J00000000000000000000002",
      "user_prompt",
      "queued",
      "openai",
      "gpt-5.4",
      "openai-runtime",
      `trace-${id}`,
      createdAt,
      createdAt,
    )
    .run();
}

describe("session run reads", () => {
  test("checks active run existence", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(database);
    await insertQueuedSessionRun(database);

    await expect(hasActiveSessionRun(database, "01J0000000000000000000000B")).resolves.toBe(true);
  });

  test("loads the latest active run id", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(database);
    await insertQueuedSessionRun(database, { createdAt: 1, id: PUBLIC_API_TEST_IDS.run });
    await insertQueuedSessionRun(database, { createdAt: 2, id: PUBLIC_API_TEST_IDS.runAlt });

    await expect(getActiveSessionRunId(database, "01J0000000000000000000000B")).resolves.toBe(
      PUBLIC_API_TEST_IDS.runAlt,
    );
  });
});
