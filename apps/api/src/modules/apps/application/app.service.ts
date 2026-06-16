import type { AppSummary, RenameAppInput } from "@mosoo/contracts/app";
import type { AppRow } from "@mosoo/db";
import { appsTable } from "@mosoo/db";
import type { AccountId, OrganizationId, AppId } from "@mosoo/id";
import { and, asc, eq } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { forbiddenError, notFoundError } from "../../../platform/errors";
import { currentTimestampMs, toIsoString } from "../../../time";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { ensureOrganizationOwnership } from "../../organizations/domain/organization-ownership.policy";
import { normalizeAppName } from "../domain/app-name";

export function toAppSummary(row: AppRow): AppSummary {
  return {
    createdAt: toIsoString(row.createdAt),
    defaultEnvironmentId: row.defaultEnvironmentId,
    id: row.id,
    name: row.name,
    ownerAccountId: row.ownerAccountId,
  };
}

export async function getAppRow(database: D1Database, appId: AppId): Promise<AppRow> {
  const row =
    (await getAppDatabase(database)
      .select()
      .from(appsTable)
      .where(eq(appsTable.id, appId))
      .limit(1)
      .get()) ?? null;

  if (row === null) {
    throw notFoundError("App not found.");
  }

  return row;
}

export async function ensureAppOwnership(
  database: D1Database,
  viewerId: AccountId,
  appId: AppId,
): Promise<AppRow> {
  const app = await getAppRow(database, appId);

  if (app.ownerAccountId !== viewerId) {
    throw forbiddenError();
  }

  return app;
}

export async function renameApp(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: RenameAppInput,
): Promise<AppSummary> {
  await ensureAppOwnership(database, viewer.id, input.appId);

  const name = normalizeAppName(input.name);

  await getAppDatabase(database)
    .update(appsTable)
    .set({ name, updatedAt: currentTimestampMs() })
    .where(eq(appsTable.id, input.appId))
    .run();

  return toAppSummary(await getAppRow(database, input.appId));
}

export async function listOrganizationApps(
  database: D1Database,
  viewer: AuthenticatedViewer,
  organizationId: OrganizationId,
): Promise<AppSummary[]> {
  await ensureOrganizationOwnership(database, viewer.id, organizationId);

  const rows = await getAppDatabase(database)
    .select()
    .from(appsTable)
    .where(
      and(eq(appsTable.organizationId, organizationId), eq(appsTable.ownerAccountId, viewer.id)),
    )
    .orderBy(asc(appsTable.id))
    .all();

  return rows.map(toAppSummary);
}
