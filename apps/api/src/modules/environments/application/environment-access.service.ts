import {
  accountsTable,
  agentsTable,
  environmentRevisionsTable,
  environmentsTable,
  projectsTable,
} from "@mosoo/db";
import type { AccountId, EnvironmentId, EnvironmentRevisionId, ProjectId } from "@mosoo/id";
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
    defaultEnvironmentId: sql<EnvironmentId | null>`${projectsTable.defaultEnvironmentId}`.as(
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
    projectId: sql<ProjectId>`${environmentsTable.projectId}`.as("projectId"),
    setupScript: sql<string>`${environmentRevisionsTable.setupScript}`.as("setupScript"),
    updatedAt: sql<number>`${environmentsTable.updatedAt}`.as("updatedAt"),
    usedByAgentCount: sql<number>`(
      SELECT COUNT(*)
      FROM ${agentsTable}
      WHERE ${agentsTable.environmentId} = ${environmentsTable.id}
        AND ${agentsTable.projectId} = ${environmentsTable.projectId}
    )`.as("usedByAgentCount"),
  };
}

function selectEnvironmentRecord(database: D1Database) {
  return getAppDatabase(database)
    .select({
      ...environmentRecordColumns(),
      projectOwnerAccountId: projectsTable.ownerAccountId,
    })
    .from(environmentsTable)
    .innerJoin(
      environmentRevisionsTable,
      eq(environmentRevisionsTable.id, environmentsTable.currentRevisionId),
    )
    .innerJoin(projectsTable, eq(projectsTable.id, environmentsTable.projectId))
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

  const { projectOwnerAccountId: _projectOwnerAccountId, ...environmentRow } = row;
  return environmentRow;
}

export async function ensureEnvironmentAccess(
  database: D1Database,
  viewerId: AccountId,
  input: {
    environmentId: EnvironmentId;
    projectId: ProjectId;
  },
): Promise<EnvironmentAccessResult> {
  const row =
    (await selectEnvironmentRecord(database)
      .where(
        and(
          eq(environmentsTable.id, input.environmentId),
          eq(environmentsTable.projectId, input.projectId),
        ),
      )
      .limit(1)
      .get()) ?? null;

  if (row === null || row.projectOwnerAccountId !== viewerId) {
    throw new Error("Environment not found.");
  }

  const { projectOwnerAccountId: _projectOwnerAccountId, ...environmentRow } = row;

  return {
    row: environmentRow,
  };
}

export async function ensureEnvironmentEditor(
  database: D1Database,
  viewerId: AccountId,
  input: {
    environmentId: EnvironmentId;
    projectId: ProjectId;
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
