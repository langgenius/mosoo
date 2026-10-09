import { accountsTable, mcpServersTable } from "@mosoo/db";
import type { AccountId, McpServerId, ProjectId } from "@mosoo/id";
import { and, eq, inArray } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { ensureProjectOwnership } from "../../projects/application/project.service";
import type { ServerRow, ViewerRow } from "./mcp-types";

export const serverColumns = {
  authType: mcpServersTable.authType,
  byoClientId: mcpServersTable.byoClientId,
  byoClientSecretSecretId: mcpServersTable.byoClientSecretSecretId,
  createdAt: mcpServersTable.createdAt,
  credentialScope: mcpServersTable.credentialScope,
  description: mcpServersTable.description,
  enabled: mcpServersTable.enabled,
  iconUrl: mcpServersTable.iconUrl,
  id: mcpServersTable.id,
  name: mcpServersTable.name,
  ownerId: mcpServersTable.ownerId,
  ownerName: accountsTable.name,
  projectId: mcpServersTable.projectId,
  source: mcpServersTable.source,
  updatedAt: mcpServersTable.updatedAt,
  url: mcpServersTable.url,
};

export async function getViewerRow(database: D1Database, viewerId: AccountId): Promise<ViewerRow> {
  const row = await getAppDatabase(database)
    .select({
      email: accountsTable.email,
      name: accountsTable.name,
    })
    .from(accountsTable)
    .where(eq(accountsTable.id, viewerId))
    .limit(1)
    .get();

  return {
    email: row?.email ?? null,
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

  return row ?? null;
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

  return new Map(rows.map((row) => [row.id, row]));
}

export async function ensureServerAccess(
  database: D1Database,
  viewer: AuthenticatedViewer,
  projectId: ProjectId,
  serverId: McpServerId,
): Promise<ServerRow> {
  await ensureProjectOwnership(database, viewer.id, projectId);
  const server = await getAppDatabase(database)
    .select(serverColumns)
    .from(mcpServersTable)
    .leftJoin(accountsTable, eq(accountsTable.id, mcpServersTable.ownerId))
    .where(and(eq(mcpServersTable.id, serverId), eq(mcpServersTable.projectId, projectId)))
    .limit(1)
    .get();

  if (!server) {
    throw new Error("MCP server not found.");
  }

  return server;
}
