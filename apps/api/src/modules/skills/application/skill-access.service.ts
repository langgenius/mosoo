import { accountsTable, skillSnapshotEntriesTable, skillsTable } from "@mosoo/db";
import type { AccountId, ProjectId, SkillId } from "@mosoo/id";
import { and, desc, eq, sql } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { notFoundError } from "../../../platform/errors";
import { ensureProjectOwnership } from "../../projects/application/project.service";
import type { SkillRegistryRow } from "./skill-types";

function skillRegistryColumns() {
  return {
    author: skillsTable.author,
    createdAt: skillsTable.createdAt,
    currentSnapshotId: skillsTable.currentSnapshotId,
    description: skillsTable.description,
    fileCount:
      sql<number>`(select count(*) from ${skillSnapshotEntriesTable} where ${skillSnapshotEntriesTable.snapshotId} = ${skillsTable.currentSnapshotId} and ${skillSnapshotEntriesTable.entryKind} = 'file')`.as(
        "fileCount",
      ),
    forkedFromOwnerName: skillsTable.forkedFromOwnerName,
    forkedFromSkillId: skillsTable.forkedFromSkillId,
    forkedFromSkillName: skillsTable.forkedFromSkillName,
    id: skillsTable.id,
    name: skillsTable.name,
    ownerId: skillsTable.ownerAccountId,
    ownerName: accountsTable.name,
    projectId: skillsTable.projectId,
    updatedAt: skillsTable.updatedAt,
  };
}

async function getProjectOwnedSkillRow(
  database: D1Database,
  viewerId: AccountId,
  projectId: ProjectId,
  skillId: SkillId,
): Promise<SkillRegistryRow | null> {
  await ensureProjectOwnership(database, viewerId, projectId);

  return (
    (await getAppDatabase(database)
      .select(skillRegistryColumns())
      .from(skillsTable)
      .leftJoin(accountsTable, eq(accountsTable.id, skillsTable.ownerAccountId))
      .where(
        and(
          eq(skillsTable.id, skillId),
          eq(skillsTable.projectId, projectId),
          eq(skillsTable.ownerAccountId, viewerId),
        ),
      )
      .limit(1)
      .get()) ?? null
  );
}

export async function ensureSkillAccess(
  database: D1Database,
  viewerId: AccountId,
  projectId: ProjectId,
  skillId: SkillId,
): Promise<SkillRegistryRow> {
  const row = await getProjectOwnedSkillRow(database, viewerId, projectId, skillId);

  if (row === null) {
    throw notFoundError("Skill not found.");
  }

  return row;
}

export async function listProjectSkillRows(
  database: D1Database,
  viewerId: AccountId,
  projectId: ProjectId,
): Promise<SkillRegistryRow[]> {
  await ensureProjectOwnership(database, viewerId, projectId);

  return getAppDatabase(database)
    .select(skillRegistryColumns())
    .from(skillsTable)
    .leftJoin(accountsTable, eq(accountsTable.id, skillsTable.ownerAccountId))
    .where(and(eq(skillsTable.projectId, projectId), eq(skillsTable.ownerAccountId, viewerId)))
    .orderBy(desc(skillsTable.updatedAt))
    .all();
}
