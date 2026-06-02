import type { SkillDetail, SkillShareTarget, SkillSummary } from "@mosoo/contracts/skill";
import { accountsTable, resourceAclTable } from "@mosoo/db";
import type { AccountId, OrganizationId, SkillId } from "@mosoo/id";
import { asc, and, eq, sql } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { toIsoString } from "../../../time";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import {
  ensureOrganizationMembership,
  isOrganizationAdminRole,
} from "../../organizations/domain/organization-access.policy";
import {
  ensureSkillAccess,
  ensureSkillEditor,
  listAccessibleSkillRows,
} from "./skill-access.service";
import { toSkillSummary } from "./skill-mapper";
import {
  getSkillSnapshot,
  listSkillSnapshotEntries,
  toSkillSnapshotRecord,
} from "./skill-package-snapshot.service";

export async function listOrganizationSkills(
  database: D1Database,
  viewer: AuthenticatedViewer,
  organizationId: OrganizationId,
): Promise<SkillSummary[]> {
  const viewerId = viewer.id;
  const rows = await listAccessibleSkillRows(database, viewerId, organizationId);
  return rows.map((row) => toSkillSummary(row, viewerId));
}

export async function getSkillDetail(
  database: D1Database,
  viewer: AuthenticatedViewer,
  skillId: SkillId,
): Promise<SkillDetail> {
  const viewerId = viewer.id;
  const row = await ensureSkillAccess(database, viewerId, skillId);
  const snapshot = await getSkillSnapshot(database, row.currentSnapshotId);
  const canSeeShareTargets =
    row.ownerId === viewerId ||
    (await isOrganizationAdminViewer(database, viewerId, row.organizationId));

  if (snapshot === null) {
    throw new Error("Skill snapshot not found.");
  }

  return {
    ...(toSkillSummary(row, viewerId) satisfies SkillSummary),
    currentSnapshot: toSkillSnapshotRecord(snapshot),
    entries: await listSkillSnapshotEntries(database, row.currentSnapshotId),
    shareTargets: canSeeShareTargets ? await listSkillShareTargets(database, viewer, skillId) : [],
  };
}

export async function listSkillShareTargets(
  database: D1Database,
  viewer: AuthenticatedViewer,
  skillId: SkillId,
): Promise<SkillShareTarget[]> {
  const viewerId = viewer.id;
  const row = await ensureSkillEditor(database, viewerId, skillId);
  const results = await getAppDatabase(database)
    .select({
      createdAt: resourceAclTable.createdAt,
      email: accountsTable.email,
      id: resourceAclTable.targetId,
      kind: resourceAclTable.targetKind,
      name: accountsTable.name,
    })
    .from(resourceAclTable)
    .leftJoin(
      accountsTable,
      and(
        sql`${resourceAclTable.targetKind} = 'user'`,
        eq(accountsTable.id, resourceAclTable.targetId),
      ),
    )
    .where(
      and(eq(resourceAclTable.resourceType, "skill"), eq(resourceAclTable.resourceId, skillId)),
    )
    .orderBy(asc(resourceAclTable.createdAt))
    .all();

  return results.map((target) => ({
    createdAt: toIsoString(target.createdAt),
    email: target.kind === "organization" ? null : target.email,
    id: target.id,
    kind: target.kind,
    name: target.kind === "organization" ? `Everyone in ${row.organizationId}` : target.name,
  }));
}

export async function getSkillSummary(
  database: D1Database,
  viewer: AuthenticatedViewer,
  skillId: SkillId,
): Promise<SkillSummary> {
  const viewerId = viewer.id;
  return toSkillSummary(await ensureSkillAccess(database, viewerId, skillId), viewerId);
}

async function isOrganizationAdminViewer(
  database: D1Database,
  viewerId: AccountId,
  organizationId: OrganizationId,
): Promise<boolean> {
  const membership = await ensureOrganizationMembership(database, viewerId, organizationId);
  return isOrganizationAdminRole(membership.role);
}
