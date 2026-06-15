import type { EnvironmentDetail, EnvironmentSummary } from "@mosoo/contracts/environment";
import { accountsTable, environmentRevisionsTable, environmentsTable, appsTable } from "@mosoo/db";
import { parsePlatformId } from "@mosoo/id";
import type { AccountId, EnvironmentId, AppId } from "@mosoo/id";
import { and, desc, eq, sql } from "drizzle-orm";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { ensureEnvironmentAccess, environmentRecordColumns } from "./environment-access.service";
import { toEnvironmentSummary } from "./environment-config-mapping";

export async function listAppEnvironments(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  appId: AppId,
): Promise<EnvironmentSummary[]> {
  const viewerId: AccountId = parsePlatformId(viewer.id, "viewer ID");
  const results = await getAppDatabase(bindings.DB)
    .select(environmentRecordColumns())
    .from(environmentsTable)
    .innerJoin(
      environmentRevisionsTable,
      eq(environmentRevisionsTable.id, environmentsTable.currentRevisionId),
    )
    .innerJoin(appsTable, eq(appsTable.id, environmentsTable.appId))
    .leftJoin(accountsTable, eq(accountsTable.id, environmentsTable.ownerAccountId))
    .where(and(eq(environmentsTable.appId, appId), eq(appsTable.ownerAccountId, viewerId)))
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
    appId: AppId;
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
    appId: AppId;
  },
): Promise<boolean> {
  try {
    await ensureEnvironmentAccess(database, viewerId, input);
    return true;
  } catch {
    return false;
  }
}
