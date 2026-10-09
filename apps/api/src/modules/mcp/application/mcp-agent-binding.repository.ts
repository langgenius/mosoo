import { agentMcpBindingsTable, mcpServersTable } from "@mosoo/db";
import type { AgentId } from "@mosoo/id";
import { asc, eq } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import type { AgentBindingRow } from "./mcp-types";

export async function listAgentBindingRows(
  database: D1Database,
  agentId: AgentId,
): Promise<AgentBindingRow[]> {
  return getAppDatabase(database)
    .select({
      agentCredentialId: agentMcpBindingsTable.agentCredentialId,
      authType: mcpServersTable.authType,
      createdAt: agentMcpBindingsTable.createdAt,
      credentialMode: agentMcpBindingsTable.credentialMode,
      credentialScope: mcpServersTable.credentialScope,
      enabled: agentMcpBindingsTable.enabled,
      iconUrl: mcpServersTable.iconUrl,
      id: agentMcpBindingsTable.id,
      name: mcpServersTable.name,
      serverEnabled: mcpServersTable.enabled,
      serverId: agentMcpBindingsTable.serverId,
      source: mcpServersTable.source,
      updatedAt: agentMcpBindingsTable.updatedAt,
      url: mcpServersTable.url,
    })
    .from(agentMcpBindingsTable)
    .innerJoin(mcpServersTable, eq(mcpServersTable.id, agentMcpBindingsTable.serverId))
    .where(eq(agentMcpBindingsTable.agentId, agentId))
    .orderBy(asc(agentMcpBindingsTable.sortOrder))
    .all();
}
