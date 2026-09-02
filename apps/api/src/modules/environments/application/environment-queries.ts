import type { EnvironmentDetail, EnvironmentSummary } from "@mosoo/contracts/environment";
import {
  accountsTable,
  environmentRevisionsTable,
  environmentsTable,
  projectsTable,
} from "@mosoo/db";
import { parsePlatformId } from "@mosoo/id";
import type { AccountId, EnvironmentId, ProjectId } from "@mosoo/id";
import { and, desc, eq, sql } from "drizzle-orm";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { ensureEnvironmentAccess, environmentRecordColumns } from "./environment-access.service";
import { toEnvironmentSummary } from "./environment-config-mapping";

export async function listProjectEnvironments(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  projectId: ProjectId,
): Promise<EnvironmentSummary[]> {
  const viewerId: AccountId = parsePlatformId(viewer.id, "viewer ID");
  const results = await getAppDatabase(bindings.DB)
    .select(environmentRecordColumns())
    .from(environmentsTable)
    .innerJoin(
      environmentRevisionsTable,
      eq(environmentRevisionsTable.id, environmentsTable.currentRevisionId),
    )
    .innerJoin(projectsTable, eq(projectsTable.id, environmentsTable.projectId))
    .leftJoin(accountsTable, eq(accountsTable.id, environmentsTable.ownerAccountId))
    .where(
      and(eq(environmentsTable.projectId, projectId), eq(projectsTable.ownerAccountId, viewerId)),
    )
    .orderBy(
      desc(sql`CASE WHEN ${environmentsTable.ownerAccountId} IS NULL THEN 1 ELSE 0 END`),
      desc(environmentsTable.updatedAt),
    )
    .all();

  return results.map((row) => toEnvironmentSummary(row));
}

export async function getEnvironmentDetail(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: {
    environmentId: EnvironmentId;
    projectId: ProjectId;
  },
): Promise<EnvironmentDetail> {
  const viewerId: AccountId = parsePlatformId(viewer.id, "viewer ID");
  const access = await ensureEnvironmentAccess(bindings.DB, viewerId, input);
  return toEnvironmentSummary(access.row);
}

export async function canUseEnvironment(
  database: D1Database,
  viewerId: AccountId,
  input: {
    environmentId: EnvironmentId;
    projectId: ProjectId;
  },
): Promise<boolean> {
  try {
    await ensureEnvironmentAccess(database, viewerId, input);
    return true;
  } catch {
    return false;
  }
}
