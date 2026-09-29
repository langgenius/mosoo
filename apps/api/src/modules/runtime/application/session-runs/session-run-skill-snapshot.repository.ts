import { sessionRunSkillsTable } from "@mosoo/db";
import type { SessionRunId } from "@mosoo/id";

import type { AppDatabase } from "../../../../platform/db/drizzle";
import { runAppDatabaseBatch } from "../../../../platform/db/drizzle";
import type { HydratedSessionRunContext } from "../session-definition/session-execution.types";

// D1 accepts at most 100 bound parameters; each session_run_skill row binds 11.
const SESSION_RUN_SKILL_INSERT_BATCH_SIZE = 9;
type AppDatabaseBatchItem = Parameters<AppDatabase["batch"]>[0][number];

export async function persistSessionRunSkills(
  database: D1Database,
  sessionRunId: SessionRunId,
  skills: HydratedSessionRunContext["skills"],
): Promise<void> {
  if (skills.length === 0) {
    return;
  }

  const timestampMs = Date.now();
  const rows = skills.map((skill) => ({
    blobSha256: skill.blobSha256,
    createdAt: timestampMs,
    materializationStatus: skill.materializationStatus,
    mountPath: skill.mountPath,
    resolutionMode: skill.resolutionMode,
    sessionRunId,
    skillId: skill.skillId,
    skillName: skill.skillName,
    snapshotId: skill.snapshotId,
    updatedAt: timestampMs,
    warningCode: skill.warningCode,
  }));

  // A run can reach this insert more than once (inline dispatch, queue
  // fallback, queue retry). The first writer wins; a duplicate (run, skill)
  // pair must not fail the run. Keep the bounded inserts in one D1 transaction
  // so a later statement failure cannot leave a partial snapshot.
  await runAppDatabaseBatch(database, (db) => {
    const queries: [AppDatabaseBatchItem, ...AppDatabaseBatchItem[]] = [
      db
        .insert(sessionRunSkillsTable)
        .values(rows.slice(0, SESSION_RUN_SKILL_INSERT_BATCH_SIZE))
        .onConflictDoNothing(),
    ];

    for (
      let index = SESSION_RUN_SKILL_INSERT_BATCH_SIZE;
      index < rows.length;
      index += SESSION_RUN_SKILL_INSERT_BATCH_SIZE
    ) {
      queries.push(
        db
          .insert(sessionRunSkillsTable)
          .values(rows.slice(index, index + SESSION_RUN_SKILL_INSERT_BATCH_SIZE))
          .onConflictDoNothing(),
      );
    }

    return queries;
  });
}
