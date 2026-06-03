import type { OrganizationMemberRole } from "@mosoo/contracts/organization";
import type {
  CreateSpaceInput,
  SpaceDetail,
  SpaceView,
  UpdateSpaceInput,
} from "@mosoo/contracts/space";
import { resourceAclTable, spaceDirectoriesTable, spacesTable } from "@mosoo/db";
import { createPlatformId, parsePlatformId } from "@mosoo/id";
import type { AccountId, OrganizationId, SpaceId } from "@mosoo/id";
import { and, asc, eq, sql } from "drizzle-orm";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { isTruthy } from "../../../shared/truthiness";
import { currentTimestampMs } from "../../../time";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { deleteFilesForScope } from "../../files/application/file-scope-cleanup.service";
import { ensureOrganizationMembership } from "../../organizations/domain/organization-access.policy";
import {
  insertResourceAclIfAbsent,
  toOrganizationAclTarget,
  toUserAclTarget,
} from "../../resource-access/application/resource-acl.service";
import {
  ensureSpaceAclManager,
  ensureSpaceAccess,
  spaceAccessColumns,
  spaceAclJoinCondition,
  spaceAclRoleRankSql,
  spaceCreatorMembersTable,
} from "../domain/space-access.policy";
import { normalizeSpaceName } from "../domain/space-name";
import { updateSpaceVisibilityAfterCollaboratorChange } from "../domain/space-visibility.policy";
import { toSpaceDetail, toSpaceView } from "./space-view.mapper";

export async function listVisibleSpaces(
  database: D1Database,
  viewer: AuthenticatedViewer,
  organizationId: OrganizationId,
): Promise<SpaceView[]> {
  const viewerId: AccountId = parsePlatformId(viewer.id, "viewer ID");
  const membership = await ensureOrganizationMembership(database, viewerId, organizationId);

  if (membership.role === "owner" || membership.role === "admin") {
    const results = await getAppDatabase(database)
      .select(
        spaceAccessColumns({
          roleRank: sql<number>`3`,
          viewerOrganizationRole: sql<OrganizationMemberRole>`${membership.role}`,
        }),
      )
      .from(spacesTable)
      .leftJoin(
        spaceCreatorMembersTable,
        and(
          eq(spaceCreatorMembersTable.organizationId, spacesTable.organizationId),
          eq(spaceCreatorMembersTable.accountId, spacesTable.ownerAccountId),
        ),
      )
      .leftJoin(resourceAclTable, spaceAclJoinCondition(viewerId))
      .where(eq(spacesTable.organizationId, organizationId))
      .groupBy(spacesTable.id)
      .orderBy(asc(sql<string>`lower(${spacesTable.name})`))
      .all();

    return results.map((space) => toSpaceView(space, viewerId));
  }

  const results = await getAppDatabase(database)
    .select(
      spaceAccessColumns({
        roleRank: spaceAclRoleRankSql(),
        viewerOrganizationRole: sql<OrganizationMemberRole>`${membership.role}`,
      }),
    )
    .from(spacesTable)
    .leftJoin(
      spaceCreatorMembersTable,
      and(
        eq(spaceCreatorMembersTable.organizationId, spacesTable.organizationId),
        eq(spaceCreatorMembersTable.accountId, spacesTable.ownerAccountId),
      ),
    )
    .innerJoin(resourceAclTable, spaceAclJoinCondition(viewerId))
    .where(eq(spacesTable.organizationId, organizationId))
    .groupBy(spacesTable.id)
    .orderBy(asc(sql<string>`lower(${spacesTable.name})`))
    .all();

  return results.map((space) => toSpaceView(space, viewerId));
}

export async function createSpace(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: CreateSpaceInput,
): Promise<SpaceView> {
  const viewerId: AccountId = parsePlatformId(viewer.id, "viewer ID");
  await ensureOrganizationMembership(database, viewerId, input.organizationId);

  const timestampMs = currentTimestampMs();
  const spaceId = createPlatformId<SpaceId>();
  const name = normalizeSpaceName(input.name);
  const visibility = input.visibility ?? "private";

  await getAppDatabase(database)
    .insert(spacesTable)
    .values({
      createdAt: timestampMs,
      id: spaceId,
      name,
      organizationId: input.organizationId,
      ownerAccountId: viewerId,
      updatedAt: timestampMs,
      visibility,
    })
    .run();

  await insertResourceAclIfAbsent(database, {
    assignedByAccountId: viewerId,
    createdAt: timestampMs,
    resourceId: spaceId,
    resourceType: "space",
    role: "admin",
    target: toUserAclTarget(viewerId),
  });

  if (visibility === "shared") {
    await insertResourceAclIfAbsent(database, {
      assignedByAccountId: viewerId,
      createdAt: timestampMs,
      resourceId: spaceId,
      resourceType: "space",
      role: "read",
      target: toOrganizationAclTarget(input.organizationId),
    });
  }

  const createdSpace = await ensureSpaceAccess(database, viewerId, spaceId, "read");

  return toSpaceView(createdSpace, viewerId);
}

export async function getSpace(
  database: D1Database,
  viewer: AuthenticatedViewer,
  spaceId: SpaceId,
): Promise<SpaceDetail> {
  const viewerId: AccountId = parsePlatformId(viewer.id, "viewer ID");
  const space = await ensureSpaceAccess(database, viewerId, spaceId, "read");
  return toSpaceDetail(space, viewerId);
}

export async function updateSpace(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: UpdateSpaceInput,
): Promise<SpaceDetail> {
  const viewerId: AccountId = parsePlatformId(viewer.id, "viewer ID");
  const space = await ensureSpaceAccess(database, viewerId, input.spaceId, "admin");

  const updates: Partial<typeof spacesTable.$inferInsert> = {};

  if (isTruthy(input.name)) {
    updates.name = normalizeSpaceName(input.name);
  }

  if (Object.keys(updates).length === 0 && !input.visibility) {
    return getSpace(database, viewer, input.spaceId);
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

  if (input.visibility === "shared") {
    await insertResourceAclIfAbsent(database, {
      assignedByAccountId: viewerId,
      createdAt: currentTimestampMs(),
      resourceId: input.spaceId,
      resourceType: "space",
      role: "read",
      target: toOrganizationAclTarget(space.organization_id),
    });
    await updateSpaceVisibilityAfterCollaboratorChange(database, input.spaceId);
  } else if (input.visibility === "private") {
    await getAppDatabase(database)
      .delete(resourceAclTable)
      .where(
        and(
          eq(resourceAclTable.resourceType, "space"),
          eq(resourceAclTable.resourceId, input.spaceId),
          sql`NOT (
            ${resourceAclTable.targetKind} = 'user'
            AND ${resourceAclTable.targetId} = ${space.owner_account_id}
          )`,
        ),
      )
      .run();
    await updateSpaceVisibilityAfterCollaboratorChange(database, input.spaceId);
  }

  return getSpace(database, viewer, input.spaceId);
}

export async function deleteSpace(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  spaceId: SpaceId,
): Promise<void> {
  const viewerId: AccountId = parsePlatformId(viewer.id, "viewer ID");
  await ensureSpaceAclManager(bindings.DB, viewerId, spaceId);

  await deleteFilesForScope(bindings, {
    actorAccountId: viewerId,
    scopeId: spaceId,
    scopeKind: "space",
  });
  await getAppDatabase(bindings.DB)
    .delete(spaceDirectoriesTable)
    .where(eq(spaceDirectoriesTable.spaceId, spaceId))
    .run();
  await getAppDatabase(bindings.DB)
    .delete(resourceAclTable)
    .where(
      and(eq(resourceAclTable.resourceType, "space"), eq(resourceAclTable.resourceId, spaceId)),
    )
    .run();
  await getAppDatabase(bindings.DB).delete(spacesTable).where(eq(spacesTable.id, spaceId)).run();
}
