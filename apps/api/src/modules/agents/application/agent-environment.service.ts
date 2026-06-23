import type { JsonObject } from "@mosoo/contracts";
import type { AgentEnvironmentConfig } from "@mosoo/contracts/agent";
import { agentsTable } from "@mosoo/db";
import type { AgentId, EnvironmentId } from "@mosoo/id";
import { eq } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { parseAgentStoredConfig, serializeAgentStoredConfig } from "./agent-stored-config.service";

export interface PreparedAgentEnvironmentConfigWrite {
  configJson: string;
  environment: AgentEnvironmentConfig;
  environmentId: EnvironmentId | null;
}

export async function loadAgentEnvironmentConfig(
  _database: D1Database,
  _agentId: AgentId,
  environmentId: EnvironmentId | null,
): Promise<AgentEnvironmentConfig> {
  return {
    environmentId,
  };
}

export function prepareAgentEnvironmentConfigWrite(input: {
  agentId: AgentId;
  currentConfigJson: string;
  environment: AgentEnvironmentConfig;
  providerOptions?: JsonObject;
  updatedAt: number;
}): PreparedAgentEnvironmentConfigWrite {
  const stored = parseAgentStoredConfig(input.currentConfigJson);
  const configJson = serializeAgentStoredConfig({
    packageMcpServers: stored.packageMcpServers,
    packageSkills: stored.packageSkills,
    packageResolution: stored.packageResolution,
    providerOptions: input.providerOptions ?? stored.providerOptions,
  });

  return {
    configJson,
    environment: {
      environmentId: input.environment.environmentId,
    },
    environmentId: input.environment.environmentId,
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
}
