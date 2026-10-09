import type { AgentToolSummary } from "@mosoo/contracts/agent";
import { agentMcpBindingsTable, agentsTable, mcpServersTable } from "@mosoo/db";
import type { AccountId, AgentId, ProjectId } from "@mosoo/id";
import { and, asc, desc, eq, inArray } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { notFoundError } from "../../../platform/errors";
import type { AgentRow } from "./agent-types";

const agentRowColumns = {
  configJson: agentsTable.configJson,
  createdAt: agentsTable.createdAt,
  description: agentsTable.description,
  environmentId: agentsTable.environmentId,
  id: agentsTable.id,
  kind: agentsTable.kind,
  liveDeploymentVersionId: agentsTable.liveDeploymentVersionId,
  model: agentsTable.model,
  name: agentsTable.name,
  ownerId: agentsTable.ownerId,
  projectId: agentsTable.projectId,
  prompt: agentsTable.prompt,
  provider: agentsTable.provider,
  runtimeId: agentsTable.runtimeId,
  status: agentsTable.status,
  updatedAt: agentsTable.updatedAt,
};

export async function getAgentRow(database: D1Database, agentId: AgentId): Promise<AgentRow> {
  const row = await getAppDatabase(database)
    .select(agentRowColumns)
    .from(agentsTable)
    .where(eq(agentsTable.id, agentId))
    .limit(1)
    .get();

  if (!row) {
    throw notFoundError("Agent not found.");
  }

  return row;
}

export async function getProjectAgentRow(
  database: D1Database,
  input: {
    agentId: AgentId;
    projectId: ProjectId;
  },
): Promise<AgentRow | null> {
  return (
    (await getAppDatabase(database)
      .select(agentRowColumns)
      .from(agentsTable)
      .where(and(eq(agentsTable.id, input.agentId), eq(agentsTable.projectId, input.projectId)))
      .limit(1)
      .get()) ?? null
  );
}

export async function listProjectOwnerAgentRows(
  database: D1Database,
  input: {
    projectId: ProjectId;
    viewerId: AccountId;
  },
): Promise<AgentRow[]> {
  return getAppDatabase(database)
    .select(agentRowColumns)
    .from(agentsTable)
    .where(and(eq(agentsTable.projectId, input.projectId), eq(agentsTable.ownerId, input.viewerId)))
    .orderBy(desc(agentsTable.updatedAt))
    .all();
}

export async function listAgentToolSummaries(
  database: D1Database,
  agentId: AgentId,
): Promise<AgentToolSummary[]> {
  return (await listAgentToolSummariesByAgentIds(database, [agentId])).get(agentId) ?? [];
}

export async function listAgentToolSummariesByAgentIds(
  database: D1Database,
  agentIds: readonly AgentId[],
): Promise<Map<AgentId, AgentToolSummary[]>> {
  const uniqueAgentIds = [...new Set(agentIds)];
  const toolsByAgentId = new Map<AgentId, AgentToolSummary[]>(
    uniqueAgentIds.map((agentId) => [agentId, []]),
  );

  if (uniqueAgentIds.length === 0) {
    return toolsByAgentId;
  }

  const rows = await getAppDatabase(database)
    .select({
      agentId: agentMcpBindingsTable.agentId,
      enabled: agentMcpBindingsTable.enabled,
      iconUrl: mcpServersTable.iconUrl,
      name: mcpServersTable.name,
      serverId: mcpServersTable.id,
    })
    .from(agentMcpBindingsTable)
    .innerJoin(mcpServersTable, eq(mcpServersTable.id, agentMcpBindingsTable.serverId))
    .where(inArray(agentMcpBindingsTable.agentId, uniqueAgentIds))
    .orderBy(
      asc(agentMcpBindingsTable.agentId),
      asc(agentMcpBindingsTable.sortOrder),
      asc(agentMcpBindingsTable.createdAt),
    )
    .all();

  for (const row of rows) {
    toolsByAgentId.get(row.agentId)?.push({
      enabled: row.enabled,
      iconUrl: row.iconUrl,
      name: row.name,
      serverId: row.serverId,
    });
  }

  return toolsByAgentId;
}
