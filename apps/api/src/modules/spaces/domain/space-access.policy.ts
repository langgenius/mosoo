import { getParentPath, normalizeOptionalPath } from "@mosoo/contracts/file";
import type { OrganizationMemberRole } from "@mosoo/contracts/organization";
import type { SpaceRole, SpaceVisibility } from "@mosoo/contracts/space";
import {
  organizationMembersTable,
  resourceAclTable,
  spaceDirectoriesTable,
  spacesTable,
} from "@mosoo/db";
import type { SpaceDirectoryId } from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import type { AccountId, OrganizationId, SpaceId } from "@mosoo/id";
import type { SQL } from "drizzle-orm";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { forbiddenError } from "../../../platform/errors";
import { currentTimestampMs } from "../../../time";
import { isOrganizationAdminRole } from "../../organizations/domain/organization-access.policy";
import type { CreatorMembershipStatus } from "../../organizations/domain/organization-access.policy";

export interface SpaceAccessRow {
  acl_role_rank: number;
  created_at: number;
  creator_membership_status: CreatorMembershipStatus;
  id: SpaceId;
  name: string;
  owner_account_id: AccountId;
  role_rank: number;
  visibility: SpaceVisibility | "organization";
  viewer_organization_role: OrganizationMemberRole;
  organization_id: OrganizationId;
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

export const spaceCreatorMembersTable = alias(organizationMembersTable, "creator_member");
const spaceViewerMembersTable = alias(organizationMembersTable, "viewer_member");

export function spaceAclRoleRankSql(): SQL<number> {
  return sql<number>`COALESCE(
    MAX(
      CASE ${resourceAclTable.role}
        WHEN 'admin' THEN 3
        WHEN 'edit' THEN 2
        WHEN 'read' THEN 1
        ELSE 0
      END
    ),
    0
  )`;
}

function creatorMembershipStatusSql(): SQL<CreatorMembershipStatus> {
  return sql<CreatorMembershipStatus>`CASE
    WHEN ${spaceCreatorMembersTable.accountId} IS NULL THEN 'removed'
    WHEN ${spaceCreatorMembersTable.disabledAt} IS NULL THEN 'active'
    ELSE 'disabled'
  END`;
}

export function spaceAclJoinCondition(viewerId: AccountId): SQL {
  return and(
    eq(resourceAclTable.resourceType, "space"),
    eq(resourceAclTable.resourceId, spacesTable.id),
    or(
      and(eq(resourceAclTable.targetKind, "user"), eq(resourceAclTable.targetId, viewerId)),
      and(
        eq(resourceAclTable.targetKind, "organization"),
        eq(resourceAclTable.targetId, spacesTable.organizationId),
      ),
    ),
  )!;
}

export function spaceAccessColumns<
  TViewerOrganizationRole extends OrganizationMemberRole | null,
>(input: { roleRank: SQL<number>; viewerOrganizationRole: SQL<TViewerOrganizationRole> }) {
  return {
    acl_role_rank: spaceAclRoleRankSql().as("acl_role_rank"),
    created_at: spacesTable.createdAt,
    creator_membership_status: creatorMembershipStatusSql().as("creator_membership_status"),
    id: spacesTable.id,
    name: spacesTable.name,
    organization_id: spacesTable.organizationId,
    owner_account_id: spacesTable.ownerAccountId,
    role_rank: input.roleRank.as("role_rank"),
    viewer_organization_role: input.viewerOrganizationRole.as("viewer_organization_role"),
    visibility: spacesTable.visibility,
  };
}

function viewerMembershipJoinCondition(viewerId: AccountId): SQL {
  return and(
    eq(spaceViewerMembersTable.organizationId, spacesTable.organizationId),
    eq(spaceViewerMembersTable.accountId, viewerId),
  )!;
}

function activeViewerMembershipJoinCondition(viewerId: AccountId): SQL {
  return and(viewerMembershipJoinCondition(viewerId), isNull(spaceViewerMembersTable.disabledAt))!;
}

export function rankToSpaceRole(rank: number): SpaceRole {
  if (rank >= ROLE_RANK.admin) {
    return "admin";
  }

  if (rank >= ROLE_RANK.edit) {
    return "edit";
  }

  return "read";
}

export function canManageSpaceAclOrDelete(input: {
  creatorMembershipStatus: CreatorMembershipStatus;
  row: Pick<SpaceAccessRow, "acl_role_rank" | "owner_account_id">;
  viewerId: AccountId;
  viewerOrganizationRole: OrganizationMemberRole;
}): boolean {
  if (input.row.owner_account_id === input.viewerId && input.creatorMembershipStatus === "active") {
    return true;
  }

  if (input.viewerOrganizationRole === "owner") {
    return true;
  }

  return input.viewerOrganizationRole === "admin" && input.creatorMembershipStatus !== "active";
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
    .select(
      spaceAccessColumns({
        roleRank: sql<number>`0`,
        viewerOrganizationRole: sql<OrganizationMemberRole | null>`
          ${spaceViewerMembersTable.role}
        `,
      }),
    )
    .from(spacesTable)
    .leftJoin(spaceViewerMembersTable, activeViewerMembershipJoinCondition(viewerId))
    .leftJoin(
      spaceCreatorMembersTable,
      and(
        eq(spaceCreatorMembersTable.organizationId, spacesTable.organizationId),
        eq(spaceCreatorMembersTable.accountId, spacesTable.ownerAccountId),
      ),
    )
    .leftJoin(resourceAclTable, spaceAclJoinCondition(viewerId))
    .where(inArray(spacesTable.id, uniqueSpaceIds))
    .groupBy(spacesTable.id)
    .all();
  const existingSpaceIds = new Set(results.map((row) => row.id));
  const accessibleRowsById = new Map<SpaceId, SpaceAccessRow>();

  for (const row of results) {
    if (row.viewer_organization_role === null) {
      continue;
    }

    const roleRank = isOrganizationAdminRole(row.viewer_organization_role)
      ? ROLE_RANK.admin
      : row.acl_role_rank;

    if (roleRank === 0) {
      continue;
    }

    accessibleRowsById.set(row.id, {
      ...row,
      role_rank: roleRank,
      viewer_organization_role: row.viewer_organization_role,
    });
  }

  return {
    accessibleRowsById,
    existingSpaceIds,
  };
}

export async function ensureSpaceAccess(
  database: D1Database,
  viewerId: AccountId,
  spaceId: SpaceId,
  requiredRole: SpaceRole,
): Promise<SpaceAccessRow> {
  const row =
    (await getAppDatabase(database)
      .select({
        ...spaceAccessColumns({
          roleRank: sql<number>`0`,
          viewerOrganizationRole: sql<OrganizationMemberRole | null>`
            ${spaceViewerMembersTable.role}
          `,
        }),
        viewer_membership_disabled_at: spaceViewerMembersTable.disabledAt,
      })
      .from(spacesTable)
      .leftJoin(spaceViewerMembersTable, viewerMembershipJoinCondition(viewerId))
      .leftJoin(
        spaceCreatorMembersTable,
        and(
          eq(spaceCreatorMembersTable.organizationId, spacesTable.organizationId),
          eq(spaceCreatorMembersTable.accountId, spacesTable.ownerAccountId),
        ),
      )
      .leftJoin(resourceAclTable, spaceAclJoinCondition(viewerId))
      .where(eq(spacesTable.id, spaceId))
      .groupBy(spacesTable.id)
      .limit(1)
      .get()) ?? null;

  if (!row) {
    throw new Error("Space not found.");
  }

  const { viewer_membership_disabled_at: viewerMembershipDisabledAt, ...spaceRow } = row;

  if (spaceRow.viewer_organization_role === null) {
    throw new Error("Organization not found.");
  }

  if (viewerMembershipDisabledAt !== null) {
    throw forbiddenError("Your organization membership is disabled.");
  }

  const roleRank = isOrganizationAdminRole(spaceRow.viewer_organization_role)
    ? ROLE_RANK.admin
    : spaceRow.acl_role_rank;

  if (roleRank === 0) {
    throw new Error("Space not found.");
  }

  const actualRole = rankToSpaceRole(roleRank);

  if (!isSpaceRoleSufficient(actualRole, requiredRole)) {
    throw forbiddenError();
  }

  return {
    ...spaceRow,
    role_rank: roleRank,
    viewer_organization_role: spaceRow.viewer_organization_role,
  };
}

export async function ensureSpaceAclManager(
  database: D1Database,
  viewerId: AccountId,
  spaceId: SpaceId,
): Promise<SpaceAccessRow> {
  const row = await ensureSpaceAccess(database, viewerId, spaceId, "admin");

  if (
    !canManageSpaceAclOrDelete({
      creatorMembershipStatus: row.creator_membership_status,
      row,
      viewerId,
      viewerOrganizationRole: row.viewer_organization_role,
    })
  ) {
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
