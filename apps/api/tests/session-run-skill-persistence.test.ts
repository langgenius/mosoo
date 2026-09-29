import { describe, expect, spyOn, test } from "bun:test";

import { sessionRunSkillsTable } from "@mosoo/db";
import { asc, eq } from "drizzle-orm";

import { persistSessionRunSkills } from "../src/modules/runtime/application/session-runs/session-run-skill-snapshot.repository";
import { getAppDatabase } from "../src/platform/db/drizzle";
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

function createSkills(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    ...tddSkill,
    blobSha256: `sha-${index}`,
    mountPath: `/workspace/se/session/.mosoo/skill/skill-${index}`,
    skillId: `skill-${String(index).padStart(3, "0")}`,
    skillName: `skill-${index}`,
    snapshotId: `snapshot-${index}`,
    warningCode: index % 2 === 0 ? null : "test-warning",
  }));
}

async function createSkillPersistenceDatabase() {
  const database = await createPublicHttpContractDatabase({ maxBoundParams: 100 });
  await insertNonOwnerSession(database);
  await insertQueuedSessionRun(database);
  return database;
}

function readStoredSkills(database: D1Database) {
  return getAppDatabase(database)
    .select()
    .from(sessionRunSkillsTable)
    .where(eq(sessionRunSkillsTable.sessionRunId, RUN_ID))
    .orderBy(asc(sessionRunSkillsTable.skillId));
}

async function expectStoredSkills(database: D1Database, skills: ReturnType<typeof createSkills>) {
  const rows = await readStoredSkills(database);
  expect(rows).toEqual(
    skills.map((skill) => ({
      blobSha256: skill.blobSha256,
      createdAt: expect.any(Number),
      materializationStatus: skill.materializationStatus,
      mountPath: skill.mountPath,
      resolutionMode: skill.resolutionMode,
      sessionRunId: RUN_ID,
      skillId: skill.skillId,
      skillName: skill.skillName,
      snapshotId: skill.snapshotId,
      updatedAt: expect.any(Number),
      warningCode: skill.warningCode,
    })),
  );
  return rows;
}

describe("session run skill persistence", () => {
  test.each([
    [0, []],
    [9, [99]],
    [10, [99, 11]],
    [25, [99, 99, 77]],
    [100, [...Array<number>(11).fill(99), 11]],
  ] as const)("persists all %i skills within D1's parameter limit", async (count, bindCounts) => {
    const database = await createSkillPersistenceDatabase();
    const skills = createSkills(count);
    const prepare = spyOn(database, "prepare");

    try {
      await persistSessionRunSkills(database, RUN_ID, skills);
      expect(prepare.mock.calls.map(([query]) => query.match(/\?/g)?.length ?? 0)).toEqual(
        bindCounts,
      );
    } finally {
      prepare.mockRestore();
    }

    const rows = await expectStoredSkills(database, skills);
    expect(new Set(rows.map((row) => row.createdAt)).size).toBe(count === 0 ? 0 : 1);
    expect(rows.every((row) => row.createdAt === row.updatedAt)).toBe(true);
  });

  test("persisting the same run skill twice keeps one row and does not throw", async () => {
    const database = await createSkillPersistenceDatabase();

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
    const database = await createSkillPersistenceDatabase();

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

  test("fills a partial snapshot without changing existing rows across repeated dispatches", async () => {
    const database = await createSkillPersistenceDatabase();
    const skills = createSkills(25);
    await persistSessionRunSkills(database, RUN_ID, skills.slice(0, 9));
    const firstBatch = await readStoredSkills(database);
    const retriedSkills = skills.map((skill, index) =>
      index < 9
        ? { ...skill, blobSha256: "changed-sha", materializationStatus: "materialized" as const }
        : skill,
    );

    await persistSessionRunSkills(database, RUN_ID, retriedSkills);
    const stored = await expectStoredSkills(database, skills);
    expect(stored.slice(0, 9)).toEqual(firstBatch);

    await persistSessionRunSkills(database, RUN_ID, retriedSkills);
    expect(await readStoredSkills(database)).toEqual(stored);
  });

  test.each(["skill-009", "skill-018"])(
    "rolls back earlier inserts when a later batch fails at %s and safely retries",
    async (failingSkillId) => {
      const database = await createSkillPersistenceDatabase();
      const skills = createSkills(25);
      database.execute(`
        CREATE TRIGGER reject_skill_insert
        BEFORE INSERT ON session_run_skill
        WHEN NEW.skill_id = '${failingSkillId}'
        BEGIN
          SELECT RAISE(ABORT, 'forced skill insert failure');
        END;
      `);

      await expect(persistSessionRunSkills(database, RUN_ID, skills)).rejects.toThrow(
        "forced skill insert failure",
      );
      expect(await readStoredSkills(database)).toEqual([]);

      database.execute("DROP TRIGGER reject_skill_insert");
      await persistSessionRunSkills(database, RUN_ID, skills);
      const stored = await expectStoredSkills(database, skills);
      await persistSessionRunSkills(database, RUN_ID, skills);
      expect(await readStoredSkills(database)).toEqual(stored);
    },
  );

  test("a retry after a lost commit response preserves the committed snapshot", async () => {
    const database = await createSkillPersistenceDatabase();
    const skills = createSkills(25);
    const batch = database.batch.bind(database);
    const interruptedBatch = spyOn(database, "batch").mockImplementationOnce(async (statements) => {
      await batch(statements);
      throw new Error("lost skill commit response");
    });

    try {
      await expect(persistSessionRunSkills(database, RUN_ID, skills)).rejects.toThrow(
        "lost skill commit response",
      );
    } finally {
      interruptedBatch.mockRestore();
    }

    const stored = await expectStoredSkills(database, skills);
    await persistSessionRunSkills(database, RUN_ID, skills);
    expect(await readStoredSkills(database)).toEqual(stored);
  });

  test("concurrent dispatches preserve one complete snapshot", async () => {
    const database = await createSkillPersistenceDatabase();
    const skills = createSkills(25);
    await Promise.all([
      persistSessionRunSkills(database, RUN_ID, skills),
      persistSessionRunSkills(
        database,
        RUN_ID,
        skills.map((skill) => ({ ...skill, blobSha256: "later-writer-sha" })),
      ),
    ]);

    await expectStoredSkills(database, skills);
  });
});
