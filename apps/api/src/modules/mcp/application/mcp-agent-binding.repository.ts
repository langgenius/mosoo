import { agentMcpBindingsTable, mcpServersTable } from "@mosoo/db";
import type { AgentId } from "@mosoo/id";
import { asc, eq, sql } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import type { AgentBindingRow } from "./mcp-types";

const agentBindingColumns = {
  agentCredentialId: sql<AgentBindingRow["agentCredentialId"]>`
    ${agentMcpBindingsTable.agentCredentialId}
  `.as("agentCredentialId"),
  agentId: sql<AgentBindingRow["agentId"]>`${agentMcpBindingsTable.agentId}`.as("agentId"),
  authType: sql<AgentBindingRow["authType"]>`${mcpServersTable.authType}`.as("authType"),
  createdAt: sql<number | string>`${agentMcpBindingsTable.createdAt}`.as("createdAt"),
  credentialMode: sql<AgentBindingRow["credentialMode"]>`
    ${agentMcpBindingsTable.credentialMode}
  `.as("credentialMode"),
  credentialScope: sql<AgentBindingRow["credentialScope"]>`
    ${mcpServersTable.credentialScope}
  `.as("credentialScope"),
  enabled: sql<boolean | number | string>`${agentMcpBindingsTable.enabled}`.as("enabled"),
  iconUrl: sql<AgentBindingRow["iconUrl"]>`${mcpServersTable.iconUrl}`.as("iconUrl"),
  id: sql<AgentBindingRow["id"]>`${agentMcpBindingsTable.id}`.as("id"),
  name: sql<AgentBindingRow["name"]>`${mcpServersTable.name}`.as("name"),
  serverEnabled: sql<boolean | number | string>`${mcpServersTable.enabled}`.as("serverEnabled"),
  serverId: sql<AgentBindingRow["serverId"]>`${agentMcpBindingsTable.serverId}`.as("serverId"),
  source: sql<AgentBindingRow["source"]>`${mcpServersTable.source}`.as("source"),
  updatedAt: sql<number | string>`${agentMcpBindingsTable.updatedAt}`.as("updatedAt"),
  url: sql<AgentBindingRow["url"]>`${mcpServersTable.url}`.as("url"),
};

type AgentBindingProjection = Omit<
  AgentBindingRow,
  "createdAt" | "enabled" | "serverEnabled" | "updatedAt"
> & {
  createdAt: number | string;
  enabled: boolean | number | string;
  serverEnabled: boolean | number | string;
  updatedAt: number | string;
};

function readSqliteBoolean(value: boolean | number | string): number {
  if (value === true || value === 1 || value === "1") {
    return 1;
  }

  if (value === false || value === 0 || value === "0") {
    return 0;
  }

  throw new Error("Expected SQLite boolean value.");
}

function readTimestampMs(value: number | string): number {
  const timestampMs = Number(value);

  if (!Number.isFinite(timestampMs)) {
    throw new Error("Expected timestamp millisecond value.");
  }

  return timestampMs;
}

function toAgentBindingRow(row: AgentBindingProjection): AgentBindingRow {
  return {
    ...row,
    createdAt: readTimestampMs(row.createdAt),
    enabled: readSqliteBoolean(row.enabled),
    serverEnabled: readSqliteBoolean(row.serverEnabled),
    updatedAt: readTimestampMs(row.updatedAt),
  };
}

export async function listAgentBindingRows(
  database: D1Database,
  agentId: AgentId,
): Promise<AgentBindingRow[]> {
  const results = await getAppDatabase(database)
    .select(agentBindingColumns)
    .from(agentMcpBindingsTable)
    .innerJoin(mcpServersTable, eq(mcpServersTable.id, agentMcpBindingsTable.serverId))
    .where(eq(agentMcpBindingsTable.agentId, agentId))
    .orderBy(asc(agentMcpBindingsTable.sortOrder))
    .all();

  return results.map(toAgentBindingRow);
}
