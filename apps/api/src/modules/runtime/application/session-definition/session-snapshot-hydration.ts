import type { AgentEnvironmentConfig } from "@mosoo/contracts/agent";

export function buildSnapshotAgentEnvironment(
  input: AgentEnvironmentConfig,
): AgentEnvironmentConfig {
  return {
    environmentId: input.environmentId,
  };
}

export function mergeSessionSnapshotEnvVars(input: {
  snapshotEnvVars: Record<string, string>;
  vendorEnvVars: Record<string, string>;
}): Record<string, string> {
  return {
    ...input.vendorEnvVars,
    ...input.snapshotEnvVars,
  };
}
