import type { AgentConfigBuilderMetadata, AgentEnvironmentConfig } from "@mosoo/contracts/agent";
import { agentSpaceBindingsTable, agentsTable } from "@mosoo/db";
import type { AgentId, EnvironmentId, SpaceId } from "@mosoo/id";
import { asc, eq } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { parseAgentStoredConfig, serializeAgentStoredConfig } from "./agent-stored-config.service";

export interface PreparedAgentEnvironmentConfigWrite {
  configJson: string;
  environment: AgentEnvironmentConfig;
  environmentId: EnvironmentId | null;
  spaceRows: {
    agentId: AgentId;
    createdAt: number;
    sortOrder: number;
    spaceId: SpaceId;
  }[];
}

async function getAgentBoundSpaceIds(database: D1Database, agentId: AgentId): Promise<SpaceId[]> {
  const results = await getAppDatabase(database)
    .select({ spaceId: agentSpaceBindingsTable.spaceId })
    .from(agentSpaceBindingsTable)
    .where(eq(agentSpaceBindingsTable.agentId, agentId))
    .orderBy(asc(agentSpaceBindingsTable.sortOrder), asc(agentSpaceBindingsTable.createdAt))
    .all();

  return results.map((row) => row.spaceId);
}

export async function loadAgentEnvironmentConfig(
  database: D1Database,
  agentId: AgentId,
  environmentId: EnvironmentId | null,
): Promise<AgentEnvironmentConfig> {
  return {
    boundSpaceIds: await getAgentBoundSpaceIds(database, agentId),
    environmentId,
  };
}

export function prepareAgentEnvironmentConfigWrite(input: {
  agentId: AgentId;
  builder?: AgentConfigBuilderMetadata;
  currentConfigJson: string;
  environment: AgentEnvironmentConfig;
  updatedAt: number;
}): PreparedAgentEnvironmentConfigWrite {
  const normalizedSpaceIds = [...new Set(input.environment.boundSpaceIds)];
  const stored = parseAgentStoredConfig(input.currentConfigJson);
  const configJson = serializeAgentStoredConfig({
    builder: input.builder ?? stored.builder,
    packageMcpServers: stored.packageMcpServers,
    packageSkills: stored.packageSkills,
    packageResolution: stored.packageResolution,
    packageSharingEnabled: stored.packageSharingEnabled,
  });

  return {
    configJson,
    environment: {
      boundSpaceIds: normalizedSpaceIds,
      environmentId: input.environment.environmentId,
    },
    environmentId: input.environment.environmentId,
    spaceRows: normalizedSpaceIds.map((spaceId, index) => ({
      agentId: input.agentId,
      createdAt: input.updatedAt,
      sortOrder: index,
      spaceId,
    })),
  };
}

export async function persistAgentEnvironmentConfig(
  database: D1Database,
  agentId: AgentId,
  environment: AgentEnvironmentConfig,
  updatedAt: number,
): Promise<void> {
  const db = getAppDatabase(database);
  const current = await db
    .select({ configJson: agentsTable.configJson })
    .from(agentsTable)
    .where(eq(agentsTable.id, agentId))
    .limit(1)
    .get();

  if (!current) {
    throw new Error("Agent not found.");
  }

  const prepared = prepareAgentEnvironmentConfigWrite({
    agentId,
    currentConfigJson: current.configJson,
    environment,
    updatedAt,
  });

  await db
    .update(agentsTable)
    .set({
      configJson: prepared.configJson,
      environmentId: prepared.environmentId,
      updatedAt,
    })
    .where(eq(agentsTable.id, agentId))
    .run();
  await db
    .delete(agentSpaceBindingsTable)
    .where(eq(agentSpaceBindingsTable.agentId, agentId))
    .run();

  if (prepared.spaceRows.length === 0) {
    return;
  }

  await db.insert(agentSpaceBindingsTable).values(prepared.spaceRows).run();
}
