import { getParentPath, normalizeOptionalPath } from "@mosoo/contracts/file";
import type { SpaceRole } from "@mosoo/contracts/space";
import { appsTable, spaceDirectoriesTable, spacesTable } from "@mosoo/db";
import type { SpaceDirectoryId } from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import type { AccountId, AppId, SpaceId } from "@mosoo/id";
import { and, eq, inArray, sql } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { forbiddenError } from "../../../platform/errors";
import { currentTimestampMs } from "../../../time";

export interface SpaceAccessRow {
  created_at: number;
  id: SpaceId;
  name: string;
  owner_account_id: AccountId;
  app_id: AppId;
  role_rank: number;
}

export interface SpaceAccessLookup {
  accessibleRowsById: Map<SpaceId, SpaceAccessRow>;
  existingSpaceIds: Set<SpaceId>;
}

const ROLE_RANK: Record<SpaceRole, number> = {
  admin: 3,
  edit: 2,
  read: 1,
};

export function rankToSpaceRole(rank: number): SpaceRole {
  if (rank >= ROLE_RANK.admin) {
    return "admin";
  }

  if (rank >= ROLE_RANK.edit) {
    return "edit";
  }

  return "read";
}

function isSpaceRoleSufficient(actual: SpaceRole, required: SpaceRole): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}

export function isSpaceRoleRankSufficient(actualRank: number, required: SpaceRole): boolean {
  return actualRank >= ROLE_RANK[required];
}

export async function listSpaceAccessRows(
  database: D1Database,
  viewerId: AccountId,
  appId: AppId,
  spaceIds: readonly SpaceId[],
): Promise<SpaceAccessLookup> {
  const uniqueSpaceIds = [...new Set(spaceIds)];

  if (uniqueSpaceIds.length === 0) {
    return {
      accessibleRowsById: new Map(),
      existingSpaceIds: new Set(),
    };
  }

  const results = await getAppDatabase(database)
    .select({
      created_at: spacesTable.createdAt,
      id: spacesTable.id,
      name: spacesTable.name,
      owner_account_id: spacesTable.ownerAccountId,
      app_id: spacesTable.appId,
      role_rank: sql<number>`${ROLE_RANK.admin}`.as("role_rank"),
    })
    .from(spacesTable)
    .innerJoin(
      appsTable,
      and(eq(appsTable.id, spacesTable.appId), eq(appsTable.ownerAccountId, viewerId)),
    )
    .where(and(eq(spacesTable.appId, appId), inArray(spacesTable.id, uniqueSpaceIds)))
    .all();
  const existingSpaceIds = new Set(results.map((row) => row.id));

  return {
    accessibleRowsById: new Map(results.map((row) => [row.id, row])),
    existingSpaceIds,
  };
}

export async function ensureSpaceAccess(
  database: D1Database,
  viewerId: AccountId,
  appId: AppId,
  spaceId: SpaceId,
  requiredRole: SpaceRole,
): Promise<SpaceAccessRow> {
  const row =
    (await getAppDatabase(database)
      .select({
        created_at: spacesTable.createdAt,
        id: spacesTable.id,
        name: spacesTable.name,
        owner_account_id: spacesTable.ownerAccountId,
        app_id: spacesTable.appId,
        role_rank: sql<number>`${ROLE_RANK.admin}`.as("role_rank"),
      })
      .from(spacesTable)
      .innerJoin(
        appsTable,
        and(eq(appsTable.id, spacesTable.appId), eq(appsTable.ownerAccountId, viewerId)),
      )
      .where(and(eq(spacesTable.id, spaceId), eq(spacesTable.appId, appId)))
      .limit(1)
      .get()) ?? null;

  if (!row) {
    throw new Error("Space not found.");
  }

  const actualRole = rankToSpaceRole(row.role_rank);

  if (!isSpaceRoleSufficient(actualRole, requiredRole)) {
    throw forbiddenError();
  }

  return row;
}

export async function ensureSpaceAccessBySpaceId(
  database: D1Database,
  viewerId: AccountId,
  spaceId: SpaceId,
  requiredRole: SpaceRole,
): Promise<SpaceAccessRow> {
  const row =
    (await getAppDatabase(database)
      .select({
        created_at: spacesTable.createdAt,
        id: spacesTable.id,
        name: spacesTable.name,
        owner_account_id: spacesTable.ownerAccountId,
        app_id: spacesTable.appId,
        role_rank: sql<number>`${ROLE_RANK.admin}`.as("role_rank"),
      })
      .from(spacesTable)
      .innerJoin(
        appsTable,
        and(eq(appsTable.id, spacesTable.appId), eq(appsTable.ownerAccountId, viewerId)),
      )
      .where(eq(spacesTable.id, spaceId))
      .limit(1)
      .get()) ?? null;

  if (!row) {
    throw new Error("Space not found.");
  }

  if (!isSpaceRoleSufficient(rankToSpaceRole(row.role_rank), requiredRole)) {
    throw forbiddenError();
  }

  return row;
}

export async function ensureParentDirectories(
  database: D1Database,
  viewerId: AccountId,
  spaceId: SpaceId,
  path: string,
): Promise<void> {
  const normalizedPath = normalizeOptionalPath(path);

  if (!normalizedPath) {
    return;
  }

  const timestampMs = currentTimestampMs();
  let cursor = "";
  const directoryRows = [];

  for (const segment of normalizedPath.split("/")) {
    cursor = cursor ? `${cursor}/${segment}` : segment;
    directoryRows.push({
      createdAt: timestampMs,
      createdByAccountId: viewerId,
      id: createPlatformId<SpaceDirectoryId>(),
      name: segment,
      parentPath: getParentPath(cursor),
      path: cursor,
      spaceId,
      updatedAt: timestampMs,
    });
  }

  await getAppDatabase(database)
    .insert(spaceDirectoriesTable)
    .values(directoryRows)
    .onConflictDoNothing({
      target: [spaceDirectoriesTable.spaceId, spaceDirectoriesTable.path],
    })
    .run();
}
