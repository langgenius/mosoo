import { describe, expect, test } from "bun:test";

import { persistSessionRunSkills } from "../src/modules/runtime/application/session-runs/session-run-skill-snapshot.repository";
import {
  createPublicHttpContractDatabase,
  insertNonOwnerSession,
} from "./helpers/public-api-http-test-fixture";

const RUN_ID = "run-skill-persistence";

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
      "deepseek",
      "deepseek-v4-pro",
      "acp-fallback",
      "trace-skill-persistence",
      1,
      1,
    )
    .run();
}

const tddSkill = {
  archiveFormat: "zip",
  blobSha256: "sha-tdd",
  compression: "deflate",
  materializationStatus: "pending",
  mountPath: "/workspace/se/session/.mosoo/skill/skill-tdd",
  resolutionMode: "explicit",
  skillId: "01J00000000000000000000TDD",
  skillName: "tdd",
  snapshotId: "01J0000000000000000000SNAP",
  warningCode: null,
} as const;

describe("session run skill persistence", () => {
  test("persisting the same run skill twice keeps one row and does not throw", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(database);
    await insertQueuedSessionRun(database);

    await persistSessionRunSkills(database, RUN_ID, [tddSkill]);
    await persistSessionRunSkills(database, RUN_ID, [tddSkill]);

    const stored = await database
      .prepare(
        "SELECT COUNT(*) AS row_count FROM session_run_skill WHERE session_run_id = ? AND skill_id = ?",
      )
      .bind(RUN_ID, tddSkill.skillId)
      .first<{ row_count: number }>();
    expect(stored).toEqual({ row_count: 1 });
  });

  test("a duplicate skill insert preserves the first writer's row", async () => {
    const database = await createPublicHttpContractDatabase();
    await insertNonOwnerSession(database);
    await insertQueuedSessionRun(database);

    await persistSessionRunSkills(database, RUN_ID, [tddSkill]);
    await persistSessionRunSkills(database, RUN_ID, [
      { ...tddSkill, materializationStatus: "materialized" },
    ]);

    const stored = await database
      .prepare(
        "SELECT materialization_status FROM session_run_skill WHERE session_run_id = ? AND skill_id = ?",
      )
      .bind(RUN_ID, tddSkill.skillId)
      .first<{ materialization_status: string }>();
    expect(stored).toEqual({ materialization_status: "pending" });
  });
});
