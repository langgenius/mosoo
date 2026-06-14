import type { SkillDetail, SkillSummary } from "@mosoo/contracts/skill";
import type { AppId, SkillId } from "@mosoo/id";

import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { ensureSkillAccess, listAppSkillRows } from "./skill-access.service";
import { toSkillSummary } from "./skill-mapper";
import {
  getSkillSnapshot,
  listSkillSnapshotEntries,
  toSkillSnapshotRecord,
} from "./skill-package-snapshot.service";

export async function listAppSkills(
  database: D1Database,
  viewer: AuthenticatedViewer,
  appId: AppId,
): Promise<SkillSummary[]> {
  const rows = await listAppSkillRows(database, viewer.id, appId);
  return rows.map(toSkillSummary);
}

export async function getSkillDetail(
  database: D1Database,
  viewer: AuthenticatedViewer,
  appId: AppId,
  skillId: SkillId,
): Promise<SkillDetail> {
  const row = await ensureSkillAccess(database, viewer.id, appId, skillId);
  const snapshot = await getSkillSnapshot(database, row.currentSnapshotId);

  if (snapshot === null || snapshot.appId !== appId) {
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
  appId: AppId,
  skillId: SkillId,
): Promise<SkillSummary> {
  return toSkillSummary(await ensureSkillAccess(database, viewer.id, appId, skillId));
}
