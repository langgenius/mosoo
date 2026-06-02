import type { EnvironmentDetail, EnvironmentSummary } from "@mosoo/contracts/environment";
import { Permission, can } from "@mosoo/contracts/permission";
import {
  accountsTable,
  environmentRevisionsTable,
  environmentsTable,
  organizationsTable,
} from "@mosoo/db";
import { parsePlatformId } from "@mosoo/id";
import type { AccountId, EnvironmentId, OrganizationId } from "@mosoo/id";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { ensureOrganizationMembership } from "../../organizations/domain/organization-access.policy";
import {
  ensureEnvironmentAccess,
  environmentRecordColumns,
  environmentShareExistsSql,
  listShareTargets,
} from "./environment-access.service";
import { toEnvironmentSummary } from "./environment-config-mapping";
import { ensureOrganizationEnvironmentDefaults } from "./environment-defaults";

export async function listOrganizationEnvironments(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  organizationId: OrganizationId,
): Promise<EnvironmentSummary[]> {
  const viewerId: AccountId = parsePlatformId(viewer.id, "viewer ID");
  const membership = await ensureOrganizationMembership(bindings.DB, viewerId, organizationId);
  const isOrganizationAdmin = can(membership.role, Permission.EnvironmentsListAll);

  await ensureOrganizationEnvironmentDefaults(bindings, organizationId);

  const visibilityFilter = isOrganizationAdmin
    ? undefined
    : or(
        isNull(environmentsTable.ownerAccountId),
        eq(environmentsTable.ownerAccountId, viewerId),
        environmentShareExistsSql(viewerId, organizationId),
      );
  const results = await getAppDatabase(bindings.DB)
    .select(environmentRecordColumns())
    .from(environmentsTable)
    .innerJoin(
      environmentRevisionsTable,
      eq(environmentRevisionsTable.id, environmentsTable.currentRevisionId),
    )
    .innerJoin(organizationsTable, eq(organizationsTable.id, environmentsTable.organizationId))
    .leftJoin(accountsTable, eq(accountsTable.id, environmentsTable.ownerAccountId))
    .where(
      visibilityFilter
        ? and(eq(environmentsTable.organizationId, organizationId), visibilityFilter)
        : eq(environmentsTable.organizationId, organizationId),
    )
    .orderBy(
      desc(sql`CASE WHEN ${environmentsTable.ownerAccountId} IS NULL THEN 1 ELSE 0 END`),
      desc(environmentsTable.updatedAt),
    )
    .all();

  return results.map((row) => toEnvironmentSummary(row, viewerId, isOrganizationAdmin));
}

export async function getEnvironmentDetail(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  environmentId: EnvironmentId,
): Promise<EnvironmentDetail> {
  const viewerId: AccountId = parsePlatformId(viewer.id, "viewer ID");
  const access = await ensureEnvironmentAccess(bindings.DB, viewerId, environmentId);
  const summary = toEnvironmentSummary(access.row, viewerId, access.isOrganizationAdmin);

  return {
    ...summary,
    shareTargets: summary.canEdit ? await listShareTargets(bindings.DB, environmentId) : [],
  };
}

export async function canUseEnvironment(
  database: D1Database,
  viewerId: AccountId,
  environmentId: EnvironmentId,
): Promise<boolean> {
  try {
    await ensureEnvironmentAccess(database, viewerId, environmentId);
    return true;
  } catch {
    return false;
  }
}
