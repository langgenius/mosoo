import type { EnvironmentDetail, EnvironmentSummary } from "@mosoo/contracts/environment";
import { environmentRevisionsTable, environmentsTable, projectsTable } from "@mosoo/db";
import type { EnvironmentId, ProjectId } from "@mosoo/id";
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
  const results = await getAppDatabase(bindings.DB)
    .select(environmentRecordColumns())
    .from(environmentsTable)
    .innerJoin(
      environmentRevisionsTable,
      eq(environmentRevisionsTable.id, environmentsTable.currentRevisionId),
    )
    .innerJoin(projectsTable, eq(projectsTable.id, environmentsTable.projectId))
    .where(
      and(eq(environmentsTable.projectId, projectId), eq(projectsTable.ownerAccountId, viewer.id)),
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
  const access = await ensureEnvironmentAccess(bindings.DB, viewer.id, input);
  return toEnvironmentSummary(access.row);
}
