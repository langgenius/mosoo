import { getParentPath, normalizeOptionalPath } from "@mosoo/contracts/file";
import { appsTable, spaceDirectoriesTable, spacesTable } from "@mosoo/db";
import type { SpaceDirectoryId } from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import type { AccountId, AppId, SpaceId } from "@mosoo/id";
import { and, eq, inArray } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../time";

export interface SpaceAccessRow {
  created_at: number;
  id: SpaceId;
  name: string;
  owner_account_id: AccountId;
  app_id: AppId;
}

export interface SpaceAccessLookup {
  accessibleRowsById: Map<SpaceId, SpaceAccessRow>;
  existingSpaceIds: Set<SpaceId>;
}

export type SpaceAccessIntent = "manage" | "view" | "write";

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
  intent: SpaceAccessIntent,
): Promise<SpaceAccessRow> {
  void intent;
  const row =
    (await getAppDatabase(database)
      .select({
        created_at: spacesTable.createdAt,
        id: spacesTable.id,
        name: spacesTable.name,
        owner_account_id: spacesTable.ownerAccountId,
        app_id: spacesTable.appId,
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

  return row;
}

export async function ensureSpaceAccessBySpaceId(
  database: D1Database,
  viewerId: AccountId,
  spaceId: SpaceId,
  intent: SpaceAccessIntent,
): Promise<SpaceAccessRow> {
  void intent;
  const row =
    (await getAppDatabase(database)
      .select({
        created_at: spacesTable.createdAt,
        id: spacesTable.id,
        name: spacesTable.name,
        owner_account_id: spacesTable.ownerAccountId,
        app_id: spacesTable.appId,
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
