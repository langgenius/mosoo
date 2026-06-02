import { Permission, can } from "@mosoo/contracts/permission";
import {
  accountsTable,
  mcpServersTable,
  organizationMembersTable,
  organizationsTable,
} from "@mosoo/db";
import type { AccountId, McpServerId } from "@mosoo/id";
import { and, eq, inArray, sql } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { forbiddenError } from "../../../platform/errors";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import type { ViewerOrganizationMembership } from "../../organizations/domain/organization-access.policy";
import { readAccountId } from "./mcp-platform-ids";
import type { ServerRow, ViewerRow } from "./mcp-types";

const serverColumns = {
  authType: sql<ServerRow["authType"]>`${mcpServersTable.authType}`.as("authType"),
  byoClientId: sql<string | null>`${mcpServersTable.byoClientId}`.as("byoClientId"),
  byoClientSecretSecretId: sql<string | null>`${mcpServersTable.byoClientSecretSecretId}`.as(
    "byoClientSecretSecretId",
  ),
  createdAt: sql<number>`${mcpServersTable.createdAt}`.as("createdAt"),
  credentialScope: sql<ServerRow["credentialScope"]>`${mcpServersTable.credentialScope}`.as(
    "credentialScope",
  ),
  description: mcpServersTable.description,
  enabled: mcpServersTable.enabled,
  iconUrl: sql<string | null>`${mcpServersTable.iconUrl}`.as("iconUrl"),
  id: mcpServersTable.id,
  name: mcpServersTable.name,
  oauthMetadataJson: sql<string | null>`${mcpServersTable.oauthMetadataJson}`.as(
    "oauthMetadataJson",
  ),
  organizationId: mcpServersTable.organizationId,
  ownerId: mcpServersTable.ownerId,
  ownerName: sql<string | null>`${accountsTable.name}`.as("ownerName"),
  source: sql<ServerRow["source"]>`${mcpServersTable.source}`.as("source"),
  updatedAt: sql<number>`${mcpServersTable.updatedAt}`.as("updatedAt"),
  url: mcpServersTable.url,
};

function toServerRow(
  row: Omit<ServerRow, "enabled"> & { enabled: boolean | number | string },
): ServerRow {
  return {
    ...row,
    enabled: row.enabled === true || row.enabled === 1 || row.enabled === "1" ? 1 : 0,
  };
}

export async function getViewerRow(database: D1Database, viewerId: AccountId): Promise<ViewerRow> {
  const row = await getAppDatabase(database)
    .select({
      email: accountsTable.email,
      imageUrl: accountsTable.image,
      name: accountsTable.name,
    })
    .from(accountsTable)
    .where(eq(accountsTable.id, viewerId))
    .limit(1)
    .get();

  return {
    email: row?.email ?? null,
    imageUrl: row?.imageUrl ?? null,
    name: row?.name ?? null,
  };
}

export async function getServerRow(
  database: D1Database,
  serverId: McpServerId,
): Promise<ServerRow> {
  const row = await getServerRowOrNull(database, serverId);

  if (!row) {
    throw new Error("MCP server not found.");
  }

  return row;
}

export async function getServerRowOrNull(
  database: D1Database,
  serverId: McpServerId,
): Promise<ServerRow | null> {
  const row = await getAppDatabase(database)
    .select(serverColumns)
    .from(mcpServersTable)
    .leftJoin(accountsTable, eq(accountsTable.id, mcpServersTable.ownerId))
    .where(eq(mcpServersTable.id, serverId))
    .limit(1)
    .get();

  return row ? toServerRow(row) : null;
}

export async function listServerRowsById(
  database: D1Database,
  serverIds: readonly McpServerId[],
): Promise<Map<McpServerId, ServerRow>> {
  const uniqueServerIds = [...new Set(serverIds)];

  if (uniqueServerIds.length === 0) {
    return new Map();
  }

  const rows = await getAppDatabase(database)
    .select(serverColumns)
    .from(mcpServersTable)
    .leftJoin(accountsTable, eq(accountsTable.id, mcpServersTable.ownerId))
    .where(inArray(mcpServersTable.id, uniqueServerIds))
    .all();

  return new Map(rows.map((row) => [row.id, toServerRow(row)]));
}

export async function ensureServerAccess(
  database: D1Database,
  viewer: AuthenticatedViewer,
  serverId: McpServerId,
): Promise<{
  membership: ViewerOrganizationMembership;
  server: ServerRow;
}> {
  const viewerId = readAccountId(viewer.id);
  const row =
    (await getAppDatabase(database)
      .select({
        ...serverColumns,
        viewerMembershipDisabledAt: organizationMembersTable.disabledAt,
        viewerMembershipJoinPolicy: organizationsTable.joinPolicy,
        viewerMembershipRole: organizationMembersTable.role,
      })
      .from(mcpServersTable)
      .innerJoin(organizationsTable, eq(organizationsTable.id, mcpServersTable.organizationId))
      .leftJoin(accountsTable, eq(accountsTable.id, mcpServersTable.ownerId))
      .leftJoin(
        organizationMembersTable,
        and(
          eq(organizationMembersTable.organizationId, mcpServersTable.organizationId),
          eq(organizationMembersTable.accountId, viewerId),
        ),
      )
      .where(eq(mcpServersTable.id, serverId))
      .limit(1)
      .get()) ?? null;

  if (!row) {
    throw new Error("MCP server not found.");
  }

  const {
    viewerMembershipDisabledAt,
    viewerMembershipJoinPolicy,
    viewerMembershipRole,
    ...serverRow
  } = row;

  if (viewerMembershipRole === null) {
    throw new Error("Organization not found.");
  }

  if (viewerMembershipDisabledAt !== null) {
    throw forbiddenError("Your organization membership is disabled.");
  }

  const server = toServerRow(serverRow);
  const membership: ViewerOrganizationMembership = {
    joinPolicy: viewerMembershipJoinPolicy,
    organizationId: server.organizationId,
    role: viewerMembershipRole,
  };

  if (server.source === "personal" && server.ownerId !== viewerId) {
    throw forbiddenError("You do not have access to this MCP server.");
  }

  return { membership, server };
}

export async function ensureServerManageAccess(
  database: D1Database,
  viewer: AuthenticatedViewer,
  serverId: McpServerId,
): Promise<{
  membership: ViewerOrganizationMembership;
  server: ServerRow;
}> {
  const { membership, server } = await ensureServerAccess(database, viewer, serverId);

  if (
    server.source === "organization_shared" &&
    !can(membership.role, Permission.McpOrganizationManage)
  ) {
    throw forbiddenError();
  }

  return { membership, server };
}
