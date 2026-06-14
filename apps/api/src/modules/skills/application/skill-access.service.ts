import { accountsTable, skillsTable } from "@mosoo/db";
import type { AccountId, AppId, SkillId, SkillSnapshotId } from "@mosoo/id";
import { and, desc, eq, sql } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { notFoundError } from "../../../platform/errors";
import { ensureAppOwnership } from "../../apps/application/app.service";
import type { SkillRegistryRow } from "./skill-types";

function skillRegistryColumns() {
  return {
    author: skillsTable.author,
    createdAt: sql<number>`${skillsTable.createdAt}`.as("createdAt"),
    currentSnapshotId: sql<SkillSnapshotId>`${skillsTable.currentSnapshotId}`.as(
      "currentSnapshotId",
    ),
    description: skillsTable.description,
    forkedFromOwnerName: sql<string | null>`${skillsTable.forkedFromOwnerName}`.as(
      "forkedFromOwnerName",
    ),
    forkedFromSkillId: sql<SkillId | null>`${skillsTable.forkedFromSkillId}`.as(
      "forkedFromSkillId",
    ),
    forkedFromSkillName: sql<string | null>`${skillsTable.forkedFromSkillName}`.as(
      "forkedFromSkillName",
    ),
    id: skillsTable.id,
    name: skillsTable.name,
    ownerId: sql<AccountId>`${skillsTable.ownerAccountId}`.as("ownerId"),
    ownerName: sql<string | null>`${accountsTable.name}`.as("ownerName"),
    appId: skillsTable.appId,
    sourceKind: sql<SkillRegistryRow["sourceKind"]>`${skillsTable.sourceKind}`.as("sourceKind"),
    updatedAt: sql<number>`${skillsTable.updatedAt}`.as("updatedAt"),
  };
}

async function getAppOwnedSkillRow(
  database: D1Database,
  viewerId: AccountId,
  appId: AppId,
  skillId: SkillId,
): Promise<SkillRegistryRow | null> {
  await ensureAppOwnership(database, viewerId, appId);

  return (
    (await getAppDatabase(database)
      .select(skillRegistryColumns())
      .from(skillsTable)
      .leftJoin(accountsTable, eq(accountsTable.id, skillsTable.ownerAccountId))
      .where(
        and(
          eq(skillsTable.id, skillId),
          eq(skillsTable.appId, appId),
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
  appId: AppId,
  skillId: SkillId,
): Promise<SkillRegistryRow> {
  const row = await getAppOwnedSkillRow(database, viewerId, appId, skillId);

  if (row === null) {
    throw notFoundError("Skill not found.");
  }

  return row;
}

export async function ensureSkillEditor(
  database: D1Database,
  viewerId: AccountId,
  appId: AppId,
  skillId: SkillId,
): Promise<SkillRegistryRow> {
  return ensureSkillAccess(database, viewerId, appId, skillId);
}

export async function ensureSkillDestructiveManager(
  database: D1Database,
  viewerId: AccountId,
  appId: AppId,
  skillId: SkillId,
): Promise<SkillRegistryRow> {
  return ensureSkillAccess(database, viewerId, appId, skillId);
}

export async function listAppSkillRows(
  database: D1Database,
  viewerId: AccountId,
  appId: AppId,
): Promise<SkillRegistryRow[]> {
  await ensureAppOwnership(database, viewerId, appId);

  return getAppDatabase(database)
    .select(skillRegistryColumns())
    .from(skillsTable)
    .leftJoin(accountsTable, eq(accountsTable.id, skillsTable.ownerAccountId))
    .where(and(eq(skillsTable.appId, appId), eq(skillsTable.ownerAccountId, viewerId)))
    .orderBy(desc(skillsTable.updatedAt))
    .all();
}
