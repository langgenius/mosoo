import { sessionRunSkillsTable } from "@mosoo/db";
import type { SessionRunId } from "@mosoo/id";

import { getAppDatabase } from "../../../../platform/db/drizzle";
import type { HydratedSessionRunContext } from "../session-definition/session-execution.types";

export async function persistSessionRunSkills(
  database: D1Database,
  sessionRunId: SessionRunId,
  skills: HydratedSessionRunContext["skills"],
): Promise<void> {
  if (skills.length === 0) {
    return;
  }

  const timestampMs = Date.now();

  await getAppDatabase(database)
    .insert(sessionRunSkillsTable)
    .values(
      skills.map((skill) => ({
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
      })),
    )
    .run();
}
