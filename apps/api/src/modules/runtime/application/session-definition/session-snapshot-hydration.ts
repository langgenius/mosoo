import type { AgentEnvironmentConfig } from "@mosoo/contracts/agent";

export function buildSnapshotAgentEnvironment(
  input: AgentEnvironmentConfig,
): AgentEnvironmentConfig {
  return {
    environmentId: input.environmentId,
  };
}
