import { describe, expect, spyOn, test } from "bun:test";

import { sessionRunSkillsTable } from "@mosoo/db";
import { asc, eq } from "drizzle-orm";

import { persistSessionRunSkills } from "../src/modules/runtime/application/session-runs/session-run-skill-snapshot.repository";
import { getAppDatabase } from "../src/platform/db/drizzle";
import {
  createPublicHttpContractDatabase,
  insertNonOwnerSession,
  insertSessionRunFixture,
} from "./helpers/public-api-http-test-fixture";

const RUN_ID = "01J00000000000000000000SRP";

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

function skillId(index: number): string {
  return `01J000000000000000000SK${String(index).padStart(3, "0")}`;
}

function createSkills(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    ...tddSkill,
    blobSha256: `sha-${index}`,
    mountPath: `/workspace/se/session/.mosoo/skill/skill-${index}`,
    skillId: skillId(index),
    skillName: `skill-${index}`,
    snapshotId: `01J000000000000000000SN${String(index).padStart(3, "0")}`,
    warningCode: index % 2 === 0 ? null : "test-warning",
  }));
}

async function createSkillPersistenceDatabase() {
  const database = await createPublicHttpContractDatabase({ maxBoundParams: 100 });
  await insertNonOwnerSession(database);
  await insertSessionRunFixture(database, { id: RUN_ID, status: "booting" });
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

  test("keeps the first row when a snapshot references the same skill twice", async () => {
    const database = await createSkillPersistenceDatabase();

    await persistSessionRunSkills(database, RUN_ID, [
      tddSkill,
      { ...tddSkill, materializationStatus: "materialized" },
    ]);

    const stored = await database
      .prepare(
        "SELECT materialization_status FROM session_run_skill WHERE session_run_id = ? AND skill_id = ?",
      )
      .bind(RUN_ID, tddSkill.skillId)
      .all<{ materialization_status: string }>();
    expect(stored.results).toEqual([{ materialization_status: "pending" }]);
  });

  test.each([skillId(9), skillId(18)])(
    "rolls back earlier inserts when a later batch fails at %s",
    async (failingSkillId) => {
      const database = await createSkillPersistenceDatabase();
      database.execute(`
        CREATE TRIGGER reject_skill_insert
        BEFORE INSERT ON session_run_skill
        WHEN NEW.skill_id = '${failingSkillId}'
        BEGIN
          SELECT RAISE(ABORT, 'forced skill insert failure');
        END;
      `);

      await expect(persistSessionRunSkills(database, RUN_ID, createSkills(25))).rejects.toThrow(
        "forced skill insert failure",
      );
      expect(await readStoredSkills(database)).toEqual([]);
    },
  );
});
