import type { SkillDetail, SkillSummary } from "@mosoo/contracts/skill";
import type { ProjectId, SkillId } from "@mosoo/id";

import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { ensureSkillAccess, listProjectSkillRows } from "./skill-access.service";
import { toSkillSummary } from "./skill-mapper";
import {
  getSkillSnapshot,
  listSkillSnapshotEntries,
  toSkillSnapshotRecord,
} from "./skill-package-snapshot.service";

export async function listProjectSkills(
  database: D1Database,
  viewer: AuthenticatedViewer,
  projectId: ProjectId,
): Promise<SkillSummary[]> {
  const rows = await listProjectSkillRows(database, viewer.id, projectId);
  return rows.map(toSkillSummary);
}

export async function getSkillDetail(
  database: D1Database,
  viewer: AuthenticatedViewer,
  projectId: ProjectId,
  skillId: SkillId,
): Promise<SkillDetail> {
  const row = await ensureSkillAccess(database, viewer.id, projectId, skillId);
  const snapshot = await getSkillSnapshot(database, row.currentSnapshotId);

  if (snapshot === null || snapshot.projectId !== projectId) {
    throw new Error("Skill snapshot not found.");
  }

  return {
    ...(toSkillSummary(row) satisfies SkillSummary),
    currentSnapshot: toSkillSnapshotRecord(snapshot),
    entries: await listSkillSnapshotEntries(database, row.currentSnapshotId),
  };
}

export async function getSkillSummary(
  database: D1Database,
  viewer: AuthenticatedViewer,
  projectId: ProjectId,
  skillId: SkillId,
): Promise<SkillSummary> {
  return toSkillSummary(await ensureSkillAccess(database, viewer.id, projectId, skillId));
}
