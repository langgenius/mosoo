import {
  accountsTable,
  agentsTable,
  environmentRevisionsTable,
  environmentsTable,
  appsTable,
} from "@mosoo/db";
import type { AccountId, EnvironmentId, EnvironmentRevisionId, AppId } from "@mosoo/id";
import { and, eq, sql } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { forbiddenError } from "../../../platform/errors";
import type { EnvironmentRecordRow } from "./environment-types";

export interface EnvironmentAccessResult {
  row: EnvironmentRecordRow;
}

export function environmentRecordColumns() {
  return {
    allowMcpServers: sql<number>`${environmentRevisionsTable.allowMcpServers}`.as(
      "allowMcpServers",
    ),
    allowPackageManagers: sql<number>`${environmentRevisionsTable.allowPackageManagers}`.as(
      "allowPackageManagers",
    ),
    allowedHostsJson: sql<string>`${environmentRevisionsTable.allowedHostsJson}`.as(
      "allowedHostsJson",
    ),
    createdAt: sql<number>`${environmentsTable.createdAt}`.as("createdAt"),
    currentRevisionId: sql<EnvironmentRevisionId>`${environmentsTable.currentRevisionId}`.as(
      "currentRevisionId",
    ),
    defaultEnvironmentId: sql<EnvironmentId | null>`${appsTable.defaultEnvironmentId}`.as(
      "defaultEnvironmentId",
    ),
    description: sql<string>`${environmentsTable.description}`.as("description"),
    envVarsJson: sql<string>`${environmentRevisionsTable.envVarsJson}`.as("envVarsJson"),
    forkedFromEnvironmentId:
      sql<EnvironmentId | null>`${environmentsTable.forkedFromEnvironmentId}`.as(
        "forkedFromEnvironmentId",
      ),
    forkedFromEnvironmentName: sql<
      string | null
    >`${environmentsTable.forkedFromEnvironmentName}`.as("forkedFromEnvironmentName"),
    forkedFromOwnerName: sql<string | null>`${environmentsTable.forkedFromOwnerName}`.as(
      "forkedFromOwnerName",
    ),
    id: sql<EnvironmentId>`${environmentsTable.id}`.as("id"),
    name: sql<string>`${environmentsTable.name}`.as("name"),
    networkPolicy: sql<
      EnvironmentRecordRow["networkPolicy"]
    >`${environmentRevisionsTable.networkPolicy}`.as("networkPolicy"),
    ownerId: sql<AccountId | null>`${environmentsTable.ownerAccountId}`.as("ownerId"),
    ownerImageUrl: sql<string | null>`${accountsTable.image}`.as("ownerImageUrl"),
    ownerName: sql<string | null>`${accountsTable.name}`.as("ownerName"),
    packagesJson: sql<string>`${environmentRevisionsTable.packagesJson}`.as("packagesJson"),
    appId: sql<AppId>`${environmentsTable.appId}`.as("appId"),
    setupScript: sql<string>`${environmentRevisionsTable.setupScript}`.as("setupScript"),
    updatedAt: sql<number>`${environmentsTable.updatedAt}`.as("updatedAt"),
    usedByAgentCount: sql<number>`(
      SELECT COUNT(*)
      FROM ${agentsTable}
      WHERE ${agentsTable.environmentId} = ${environmentsTable.id}
        AND ${agentsTable.appId} = ${environmentsTable.appId}
    )`.as("usedByAgentCount"),
  };
}

function selectEnvironmentRecord(database: D1Database) {
  return getAppDatabase(database)
    .select({
      ...environmentRecordColumns(),
      appOwnerAccountId: appsTable.ownerAccountId,
    })
    .from(environmentsTable)
    .innerJoin(
      environmentRevisionsTable,
      eq(environmentRevisionsTable.id, environmentsTable.currentRevisionId),
    )
    .innerJoin(appsTable, eq(appsTable.id, environmentsTable.appId))
    .leftJoin(accountsTable, eq(accountsTable.id, environmentsTable.ownerAccountId));
}

export async function getEnvironmentRecordRow(
  database: D1Database,
  environmentId: EnvironmentId,
): Promise<EnvironmentRecordRow | null> {
  const row =
    (await selectEnvironmentRecord(database)
      .where(eq(environmentsTable.id, environmentId))
      .limit(1)
      .get()) ?? null;

  if (row === null) {
    return null;
  }

  const { appOwnerAccountId: _appOwnerAccountId, ...environmentRow } = row;
  return environmentRow;
}

export async function ensureEnvironmentAccess(
  database: D1Database,
  viewerId: AccountId,
  input: {
    environmentId: EnvironmentId;
    appId: AppId;
  },
): Promise<EnvironmentAccessResult> {
  const row =
    (await selectEnvironmentRecord(database)
      .where(
        and(
          eq(environmentsTable.id, input.environmentId),
          eq(environmentsTable.appId, input.appId),
        ),
      )
      .limit(1)
      .get()) ?? null;

  if (row === null || row.appOwnerAccountId !== viewerId) {
    throw new Error("Environment not found.");
  }

  const { appOwnerAccountId: _appOwnerAccountId, ...environmentRow } = row;

  return {
    row: environmentRow,
  };
}

export async function ensureEnvironmentEditor(
  database: D1Database,
  viewerId: AccountId,
  input: {
    environmentId: EnvironmentId;
    appId: AppId;
  },
): Promise<EnvironmentAccessResult> {
  const access = await ensureEnvironmentAccess(database, viewerId, input);

  if (access.row.ownerId === null) {
    throw forbiddenError("Built-in environments cannot be edited.");
  }

  if (access.row.ownerId === viewerId) {
    return access;
  }

  throw forbiddenError();
}
