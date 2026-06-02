import type { EnvironmentShareTarget } from "@mosoo/contracts/environment";
import { Permission, can } from "@mosoo/contracts/permission";
import {
  accountsTable,
  agentsTable,
  environmentRevisionsTable,
  environmentsTable,
  organizationMembersTable,
  organizationsTable,
  resourceAclTable,
} from "@mosoo/db";
import type { AccountId, EnvironmentId, EnvironmentRevisionId, OrganizationId } from "@mosoo/id";
import { and, asc, eq, sql } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { forbiddenError } from "../../../platform/errors";
import { toIsoString } from "../../../time";
import type { EnvironmentRecordRow } from "./environment-types";

export interface OrganizationEnvironmentDefaultsRow {
  creatorAccountId: AccountId | null;
  defaultEnvironmentId: EnvironmentId | null;
  id: OrganizationId;
}

export interface EnvironmentAccessResult {
  hasOrganizationShare: boolean;
  isOrganizationAdmin: boolean;
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
    defaultEnvironmentId: sql<EnvironmentId | null>`${organizationsTable.defaultEnvironmentId}`.as(
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
    organizationId: sql<OrganizationId>`${environmentsTable.organizationId}`.as("organizationId"),
    ownerId: sql<AccountId | null>`${environmentsTable.ownerAccountId}`.as("ownerId"),
    ownerImageUrl: sql<string | null>`${accountsTable.image}`.as("ownerImageUrl"),
    ownerName: sql<string | null>`${accountsTable.name}`.as("ownerName"),
    packagesJson: sql<string>`${environmentRevisionsTable.packagesJson}`.as("packagesJson"),
    setupScript: sql<string>`${environmentRevisionsTable.setupScript}`.as("setupScript"),
    updatedAt: sql<number>`${environmentsTable.updatedAt}`.as("updatedAt"),
    usedByAgentCount: sql<number>`(
      SELECT COUNT(*)
      FROM ${agentsTable}
      WHERE ${agentsTable.environmentId} = ${environmentsTable.id}
    )`.as("usedByAgentCount"),
  };
}

export function environmentShareExistsSql(viewerId: AccountId, organizationId: OrganizationId) {
  return sql`
    EXISTS (
      SELECT 1
      FROM ${resourceAclTable}
      WHERE ${resourceAclTable.resourceType} = 'environment'
        AND ${resourceAclTable.resourceId} = ${environmentsTable.id}
        AND (
          (${resourceAclTable.targetKind} = 'user' AND ${resourceAclTable.targetId} = ${viewerId})
          OR (${resourceAclTable.targetKind} = 'organization' AND ${resourceAclTable.targetId} = ${organizationId})
        )
    )
  `;
}

function environmentShareAccessSql(viewerId: AccountId) {
  return sql<number>`
    EXISTS (
      SELECT 1
      FROM ${resourceAclTable}
      WHERE ${resourceAclTable.resourceType} = 'environment'
        AND ${resourceAclTable.resourceId} = ${environmentsTable.id}
        AND (
          (${resourceAclTable.targetKind} = 'user' AND ${resourceAclTable.targetId} = ${viewerId})
          OR (${resourceAclTable.targetKind} = 'organization' AND ${resourceAclTable.targetId} = ${environmentsTable.organizationId})
        )
    )
  `;
}

function environmentOrganizationShareSql() {
  return sql<number>`
    EXISTS (
      SELECT 1
      FROM ${resourceAclTable}
      WHERE ${resourceAclTable.resourceType} = 'environment'
        AND ${resourceAclTable.resourceId} = ${environmentsTable.id}
        AND ${resourceAclTable.targetKind} = 'organization'
        AND ${resourceAclTable.targetId} = ${environmentsTable.organizationId}
    )
  `;
}

export async function getOrganizationDefaultsRow(
  database: D1Database,
  organizationId: OrganizationId,
): Promise<OrganizationEnvironmentDefaultsRow> {
  const row =
    (await getAppDatabase(database)
      .select({
        creatorAccountId: organizationsTable.creatorAccountId,
        defaultEnvironmentId: organizationsTable.defaultEnvironmentId,
        id: organizationsTable.id,
      })
      .from(organizationsTable)
      .where(eq(organizationsTable.id, organizationId))
      .limit(1)
      .get()) ?? null;

  if (!row) {
    throw new Error("Organization not found.");
  }

  return row;
}

export async function getEnvironmentRecordRow(
  database: D1Database,
  environmentId: EnvironmentId,
): Promise<EnvironmentRecordRow | null> {
  return (
    (await getAppDatabase(database)
      .select(environmentRecordColumns())
      .from(environmentsTable)
      .innerJoin(
        environmentRevisionsTable,
        eq(environmentRevisionsTable.id, environmentsTable.currentRevisionId),
      )
      .innerJoin(organizationsTable, eq(organizationsTable.id, environmentsTable.organizationId))
      .leftJoin(accountsTable, eq(accountsTable.id, environmentsTable.ownerAccountId))
      .where(eq(environmentsTable.id, environmentId))
      .limit(1)
      .get()) ?? null
  );
}

export async function ensureEnvironmentAccess(
  database: D1Database,
  viewerId: AccountId,
  environmentId: EnvironmentId,
): Promise<EnvironmentAccessResult> {
  const row =
    (await getAppDatabase(database)
      .select({
        ...environmentRecordColumns(),
        hasOrganizationShare: environmentOrganizationShareSql(),
        hasShareAccess: environmentShareAccessSql(viewerId),
        viewerMembershipDisabledAt: organizationMembersTable.disabledAt,
        viewerMembershipRole: organizationMembersTable.role,
      })
      .from(environmentsTable)
      .innerJoin(
        environmentRevisionsTable,
        eq(environmentRevisionsTable.id, environmentsTable.currentRevisionId),
      )
      .innerJoin(organizationsTable, eq(organizationsTable.id, environmentsTable.organizationId))
      .leftJoin(accountsTable, eq(accountsTable.id, environmentsTable.ownerAccountId))
      .leftJoin(
        organizationMembersTable,
        and(
          eq(organizationMembersTable.organizationId, environmentsTable.organizationId),
          eq(organizationMembersTable.accountId, viewerId),
        ),
      )
      .where(eq(environmentsTable.id, environmentId))
      .limit(1)
      .get()) ?? null;

  if (!row) {
    throw new Error("Environment not found.");
  }

  const {
    hasOrganizationShare,
    hasShareAccess,
    viewerMembershipDisabledAt,
    viewerMembershipRole,
    ...environmentRow
  } = row;

  if (viewerMembershipRole === null) {
    throw new Error("Organization not found.");
  }

  if (viewerMembershipDisabledAt !== null) {
    throw forbiddenError("Your organization membership is disabled.");
  }

  const isOrganizationAdmin = can(viewerMembershipRole, Permission.EnvironmentsUpdate);

  if (
    isOrganizationAdmin ||
    environmentRow.ownerId === viewerId ||
    environmentRow.ownerId === null ||
    hasShareAccess === 1
  ) {
    return {
      hasOrganizationShare: hasOrganizationShare === 1,
      isOrganizationAdmin,
      row: environmentRow,
    };
  }

  throw new Error("Environment not found.");
}

export async function ensureEnvironmentEditor(
  database: D1Database,
  viewerId: AccountId,
  environmentId: EnvironmentId,
): Promise<EnvironmentAccessResult> {
  const access = await ensureEnvironmentAccess(database, viewerId, environmentId);

  if (access.row.ownerId === null) {
    throw forbiddenError("Built-in environments cannot be edited.");
  }

  if (access.row.ownerId === viewerId || access.isOrganizationAdmin) {
    return access;
  }

  throw forbiddenError();
}

export async function listShareTargets(
  database: D1Database,
  environmentId: EnvironmentId,
): Promise<EnvironmentShareTarget[]> {
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
      and(
        eq(resourceAclTable.resourceType, "environment"),
        eq(resourceAclTable.resourceId, environmentId),
      ),
    )
    .orderBy(asc(resourceAclTable.createdAt))
    .all();

  return results.map((target) => ({
    createdAt: toIsoString(target.createdAt),
    email: target.kind === "organization" ? null : target.email,
    id: target.id,
    kind: target.kind,
    name: target.kind === "organization" ? "Everyone in organization" : target.name,
  }));
}
