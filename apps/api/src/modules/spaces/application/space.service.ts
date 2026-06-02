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
import {
  appendAuditEvent,
  resolveViewerAuditActor,
} from "../../audit/application/audit-query.service";
import { AUDIT_ACTION, AUDIT_RESOURCE } from "../../audit/domain/audit-vocabulary";
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
  await appendAuditEvent(database, {
    action: AUDIT_ACTION.spaceCreate,
    ...resolveViewerAuditActor(viewer),
    metadata: { visibility },
    organizationId: input.organizationId,
    outcome: "success",
    resourceDisplay: name,
    resourceId: spaceId,
    resourceType: AUDIT_RESOURCE.space,
  });

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
  let resourceDisplay = space.name;

  if (isTruthy(input.name)) {
    const nextName = normalizeSpaceName(input.name);
    updates.name = nextName;
    resourceDisplay = nextName;
  }

  if (input.visibility) {
    updates.visibility = input.visibility;
  }

  if (Object.keys(updates).length === 0) {
    return getSpace(database, viewer, input.spaceId);
  }

  await getAppDatabase(database)
    .update(spacesTable)
    .set({
      ...updates,
      updatedAt: currentTimestampMs(),
    })
    .where(eq(spacesTable.id, input.spaceId))
    .run();

  if (input.visibility === "shared") {
    await insertResourceAclIfAbsent(database, {
      assignedByAccountId: viewerId,
      createdAt: currentTimestampMs(),
      resourceId: input.spaceId,
      resourceType: "space",
      role: "read",
      target: toOrganizationAclTarget(space.organization_id),
    });
  } else if (input.visibility) {
    await getAppDatabase(database)
      .delete(resourceAclTable)
      .where(
        and(
          eq(resourceAclTable.resourceType, "space"),
          eq(resourceAclTable.resourceId, input.spaceId),
          eq(resourceAclTable.targetKind, "organization"),
        ),
      )
      .run();
  }

  await appendAuditEvent(database, {
    action: AUDIT_ACTION.spaceUpdate,
    ...resolveViewerAuditActor(viewer),
    metadata: {
      owner_at_time_id: space.owner_account_id,
      owner_at_time_status: space.creator_membership_status,
      ...(input.visibility ? { visibility: input.visibility } : {}),
      viewerOrganizationRole: space.viewer_organization_role,
    },
    organizationId: space.organization_id,
    outcome: "success",
    resourceDisplay,
    resourceId: input.spaceId,
    resourceType: AUDIT_RESOURCE.space,
  });

  return getSpace(database, viewer, input.spaceId);
}

export async function deleteSpace(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  spaceId: SpaceId,
): Promise<void> {
  const viewerId: AccountId = parsePlatformId(viewer.id, "viewer ID");
  const space = await ensureSpaceAclManager(bindings.DB, viewerId, spaceId);

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

  await appendAuditEvent(bindings.DB, {
    action: AUDIT_ACTION.spaceDelete,
    ...resolveViewerAuditActor(viewer),
    metadata: {
      owner_at_time_id: space.owner_account_id,
      owner_at_time_status: space.creator_membership_status,
      viewerOrganizationRole: space.viewer_organization_role,
    },
    organizationId: space.organization_id,
    outcome: "success",
    resourceDisplay: space.name,
    resourceId: space.id,
    resourceType: AUDIT_RESOURCE.space,
  });
}
