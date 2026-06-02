import type { OrganizationMemberRole } from "@mosoo/contracts/organization";
import {
  accountsTable,
  organizationMembersTable,
  resourceAclTable,
  skillPreferencesTable,
  skillsTable,
} from "@mosoo/db";
import type { AccountId, OrganizationId, SkillId, SkillSnapshotId } from "@mosoo/id";
import type { SQL } from "drizzle-orm";
import { and, desc, eq, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { forbiddenError } from "../../../platform/errors";
import {
  ensureOrganizationMembership,
  isOrganizationAdminRole,
} from "../../organizations/domain/organization-access.policy";
import type { CreatorMembershipStatus } from "../../organizations/domain/organization-access.policy";
import type { SkillRegistryRow } from "./skill-types";

interface SkillAccessFactRow extends SkillRegistryRow {
  ownerMembershipStatus: CreatorMembershipStatus;
  shareGrantCount: number;
  viewerMembershipDisabledAt: number | null;
  viewerMembershipRole: OrganizationMemberRole | null;
}

interface SkillAccessDecision extends SkillRegistryRow {
  ownerMembershipStatus: CreatorMembershipStatus;
  shareGrantCount: number;
  viewerMembershipRole: OrganizationMemberRole;
}

const skillOwnerMembersTable = alias(organizationMembersTable, "skill_owner_member");
const skillViewerMembersTable = alias(organizationMembersTable, "skill_viewer_member");

function skillRegistryColumns() {
  return {
    author: skillsTable.author,
    autoEnabled: sql<number>`COALESCE(${skillPreferencesTable.autoEnabled}, 1)`.as("autoEnabled"),
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
    organizationId: sql<OrganizationId>`${skillsTable.organizationId}`.as("organizationId"),
    ownerId: sql<AccountId>`${skillsTable.ownerAccountId}`.as("ownerId"),
    ownerName: sql<string | null>`${accountsTable.name}`.as("ownerName"),
    sourceKind: sql<SkillRegistryRow["sourceKind"]>`${skillsTable.sourceKind}`.as("sourceKind"),
    updatedAt: sql<number>`${skillsTable.updatedAt}`.as("updatedAt"),
  };
}

function skillShareExistsSql(viewerId: AccountId, organizationId: OrganizationId): SQL {
  return sql`
    EXISTS (
      SELECT 1
      FROM ${resourceAclTable}
      WHERE ${resourceAclTable.resourceType} = 'skill'
        AND ${resourceAclTable.resourceId} = ${skillsTable.id}
        AND (
          (${resourceAclTable.targetKind} = 'user' AND ${resourceAclTable.targetId} = ${viewerId})
          OR (${resourceAclTable.targetKind} = 'organization' AND ${resourceAclTable.targetId} = ${organizationId})
        )
    )
  `;
}

function skillShareJoinCondition(viewerId: AccountId): SQL {
  return and(
    eq(resourceAclTable.resourceType, "skill"),
    eq(resourceAclTable.resourceId, skillsTable.id),
    or(
      and(eq(resourceAclTable.targetKind, "user"), eq(resourceAclTable.targetId, viewerId)),
      and(
        eq(resourceAclTable.targetKind, "organization"),
        eq(resourceAclTable.targetId, skillsTable.organizationId),
      ),
    ),
  )!;
}

function ownerMembershipStatusSql(): SQL<CreatorMembershipStatus> {
  return sql<CreatorMembershipStatus>`CASE
    WHEN ${skillOwnerMembersTable.accountId} IS NULL THEN 'removed'
    WHEN ${skillOwnerMembersTable.disabledAt} IS NULL THEN 'active'
    ELSE 'disabled'
  END`;
}

async function listSkillAccessFactRows(
  database: D1Database,
  viewerId: AccountId,
  where: SQL,
): Promise<SkillAccessFactRow[]> {
  return getAppDatabase(database)
    .select({
      ...skillRegistryColumns(),
      ownerMembershipStatus: ownerMembershipStatusSql(),
      shareGrantCount: sql<number>`COUNT(${resourceAclTable.resourceId})`.mapWith(Number),
      viewerMembershipDisabledAt: skillViewerMembersTable.disabledAt,
      viewerMembershipRole: skillViewerMembersTable.role,
    })
    .from(skillsTable)
    .leftJoin(accountsTable, eq(accountsTable.id, skillsTable.ownerAccountId))
    .leftJoin(
      skillViewerMembersTable,
      and(
        eq(skillViewerMembersTable.organizationId, skillsTable.organizationId),
        eq(skillViewerMembersTable.accountId, viewerId),
      ),
    )
    .leftJoin(
      skillOwnerMembersTable,
      and(
        eq(skillOwnerMembersTable.organizationId, skillsTable.organizationId),
        eq(skillOwnerMembersTable.accountId, skillsTable.ownerAccountId),
      ),
    )
    .leftJoin(
      skillPreferencesTable,
      and(
        eq(skillPreferencesTable.skillId, skillsTable.id),
        eq(skillPreferencesTable.accountId, viewerId),
      ),
    )
    .leftJoin(resourceAclTable, skillShareJoinCondition(viewerId))
    .where(where)
    .groupBy(skillsTable.id)
    .all();
}

function toReadableSkillAccessDecision(
  row: SkillAccessFactRow,
  viewerId: string,
): SkillAccessDecision | null {
  const { viewerMembershipDisabledAt, viewerMembershipRole, ...skill } = row;

  if (viewerMembershipRole === null) {
    throw new Error("Organization not found.");
  }

  if (viewerMembershipDisabledAt !== null) {
    throw forbiddenError("Your organization membership is disabled.");
  }

  if (
    skill.ownerId !== viewerId &&
    !isOrganizationAdminRole(viewerMembershipRole) &&
    skill.shareGrantCount === 0
  ) {
    return null;
  }

  return {
    ...skill,
    viewerMembershipRole,
  };
}

async function listVisibleSkillRows(
  database: D1Database,
  viewerId: AccountId,
  organizationId: OrganizationId,
  includeAllOrganizationSkills: boolean,
): Promise<SkillRegistryRow[]> {
  const filters: SQL[] = [eq(skillsTable.organizationId, organizationId)];

  if (!includeAllOrganizationSkills) {
    filters.push(
      or(eq(skillsTable.ownerAccountId, viewerId), skillShareExistsSql(viewerId, organizationId))!,
    );
  }

  return getAppDatabase(database)
    .select(skillRegistryColumns())
    .from(skillsTable)
    .leftJoin(accountsTable, eq(accountsTable.id, skillsTable.ownerAccountId))
    .leftJoin(
      skillPreferencesTable,
      and(
        eq(skillPreferencesTable.skillId, skillsTable.id),
        eq(skillPreferencesTable.accountId, viewerId),
      ),
    )
    .where(and(...filters))
    .orderBy(desc(skillsTable.updatedAt))
    .all();
}

export async function ensureSkillAccess(
  database: D1Database,
  viewerId: AccountId,
  skillId: SkillId,
): Promise<SkillRegistryRow> {
  return ensureSkillAccessDecision(database, viewerId, skillId);
}

async function ensureSkillAccessDecision(
  database: D1Database,
  viewerId: AccountId,
  skillId: SkillId,
): Promise<SkillAccessDecision> {
  const row = (await listSkillAccessFactRows(database, viewerId, eq(skillsTable.id, skillId)))[0];

  if (!row) {
    throw new Error("Skill not found.");
  }

  const skill = toReadableSkillAccessDecision(row, viewerId);

  if (skill === null) {
    throw new Error("Skill not found.");
  }

  return skill;
}

export async function ensureSkillEditor(
  database: D1Database,
  viewerId: AccountId,
  skillId: SkillId,
): Promise<SkillRegistryRow> {
  const row = await ensureSkillAccessDecision(database, viewerId, skillId);

  if (row.ownerId === viewerId) {
    return row;
  }

  if (isOrganizationAdminRole(row.viewerMembershipRole)) {
    return row;
  }

  throw forbiddenError();
}

export async function ensureSkillDestructiveManager(
  database: D1Database,
  viewerId: AccountId,
  skillId: SkillId,
): Promise<SkillRegistryRow> {
  const row = await ensureSkillAccessDecision(database, viewerId, skillId);

  if (row.ownerId === viewerId) {
    return row;
  }

  if (row.viewerMembershipRole === "owner") {
    return row;
  }

  if (row.viewerMembershipRole === "admin" && row.ownerMembershipStatus !== "active") {
    return row;
  }

  throw forbiddenError();
}

export async function listAccessibleSkillRows(
  database: D1Database,
  viewerId: AccountId,
  organizationId: OrganizationId,
): Promise<SkillRegistryRow[]> {
  const membership = await ensureOrganizationMembership(database, viewerId, organizationId);
  return listVisibleSkillRows(
    database,
    viewerId,
    organizationId,
    isOrganizationAdminRole(membership.role),
  );
}
