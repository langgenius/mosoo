import type { JsonObject } from "@mosoo/contracts";
import type { AgentBuiltInToolConfig, AgentEnvironmentConfig } from "@mosoo/contracts/agent";
import { normalizeAgentBuiltInTools } from "@mosoo/contracts/agent";
import type { AgentId, EnvironmentId } from "@mosoo/id";

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
  builtInTools?: readonly AgentBuiltInToolConfig[];
  currentConfigJson: string;
  environment: AgentEnvironmentConfig;
  providerOptions?: JsonObject;
  updatedAt: number;
}): PreparedAgentEnvironmentConfigWrite {
  const stored = parseAgentStoredConfig(input.currentConfigJson);
  const configJson = serializeAgentStoredConfig({
    builtInTools:
      input.builtInTools === undefined
        ? stored.builtInTools
        : normalizeAgentBuiltInTools(input.builtInTools),
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
