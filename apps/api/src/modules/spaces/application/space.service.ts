import type {
  CreateSpaceInput,
  SpaceDetail,
  SpaceView,
  UpdateSpaceInput,
} from "@mosoo/contracts/space";
import { spaceDirectoriesTable, spacesTable } from "@mosoo/db";
import { createPlatformId, parsePlatformId } from "@mosoo/id";
import type { AccountId, AppId, SpaceId } from "@mosoo/id";
import { asc, eq, sql } from "drizzle-orm";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { isTruthy } from "../../../shared/truthiness";
import { currentTimestampMs } from "../../../time";
import { ensureAppOwnership } from "../../apps/application/app.service";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { deleteFilesForScope } from "../../files/application/file-scope-cleanup.service";
import { ensureSpaceAccess } from "../domain/space-access.policy";
import { normalizeSpaceName } from "../domain/space-name";
import { toSpaceDetail, toSpaceView } from "./space-view.mapper";

export async function listAppSpaces(
  database: D1Database,
  viewer: AuthenticatedViewer,
  appId: AppId,
): Promise<SpaceView[]> {
  const viewerId: AccountId = parsePlatformId(viewer.id, "viewer ID");
  await ensureAppOwnership(database, viewerId, appId);

  const results = await getAppDatabase(database)
    .select({
      created_at: spacesTable.createdAt,
      id: spacesTable.id,
      name: spacesTable.name,
      owner_account_id: spacesTable.ownerAccountId,
      app_id: spacesTable.appId,
      role_rank: sql<number>`3`.as("role_rank"),
    })
    .from(spacesTable)
    .where(eq(spacesTable.appId, appId))
    .orderBy(asc(sql<string>`lower(${spacesTable.name})`))
    .all();

  return results.map((space) => toSpaceView(space));
}

export async function createSpace(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: CreateSpaceInput,
): Promise<SpaceView> {
  const viewerId: AccountId = parsePlatformId(viewer.id, "viewer ID");
  await ensureAppOwnership(database, viewerId, input.appId);

  const timestampMs = currentTimestampMs();
  const spaceId = createPlatformId<SpaceId>();
  const name = normalizeSpaceName(input.name);

  await getAppDatabase(database)
    .insert(spacesTable)
    .values({
      createdAt: timestampMs,
      id: spaceId,
      name,
      ownerAccountId: viewerId,
      appId: input.appId,
      updatedAt: timestampMs,
    })
    .run();

  const createdSpace = await ensureSpaceAccess(database, viewerId, input.appId, spaceId, "read");

  return toSpaceView(createdSpace);
}

export async function getSpace(
  database: D1Database,
  viewer: AuthenticatedViewer,
  appId: AppId,
  spaceId: SpaceId,
): Promise<SpaceDetail> {
  const viewerId: AccountId = parsePlatformId(viewer.id, "viewer ID");
  const space = await ensureSpaceAccess(database, viewerId, appId, spaceId, "read");
  return toSpaceDetail(space);
}

export async function updateSpace(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: UpdateSpaceInput,
): Promise<SpaceDetail> {
  const viewerId: AccountId = parsePlatformId(viewer.id, "viewer ID");
  await ensureSpaceAccess(database, viewerId, input.appId, input.spaceId, "admin");

  const updates: Partial<typeof spacesTable.$inferInsert> = {};

  if (isTruthy(input.name)) {
    updates.name = normalizeSpaceName(input.name);
  }

  if (Object.keys(updates).length === 0) {
    return getSpace(database, viewer, input.appId, input.spaceId);
  }

  if (Object.keys(updates).length > 0) {
    await getAppDatabase(database)
      .update(spacesTable)
      .set({
        ...updates,
        updatedAt: currentTimestampMs(),
      })
      .where(eq(spacesTable.id, input.spaceId))
      .run();
  }

  return getSpace(database, viewer, input.appId, input.spaceId);
}

export async function deleteSpace(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  appId: AppId,
  spaceId: SpaceId,
): Promise<void> {
  const viewerId: AccountId = parsePlatformId(viewer.id, "viewer ID");
  await ensureSpaceAccess(bindings.DB, viewerId, appId, spaceId, "admin");

  await deleteFilesForScope(bindings, {
    actorAccountId: viewerId,
    scopeId: spaceId,
    scopeKind: "space",
  });
  await getAppDatabase(bindings.DB)
    .delete(spaceDirectoriesTable)
    .where(eq(spaceDirectoriesTable.spaceId, spaceId))
    .run();
  await getAppDatabase(bindings.DB).delete(spacesTable).where(eq(spacesTable.id, spaceId)).run();
}
