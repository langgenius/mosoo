import type { McpRegistry } from "@mosoo/contracts/mcp";
import { useQuery } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";

import { toAppId } from "@/routes/typed-id";

import { getMcpRegistry } from "../api/mcp-client";

export const mcpKeys = {
  agentBinding: (agentId: string) => [...mcpKeys.agentBindings(), agentId] as const,
  agentBindings: () => [...mcpKeys.all, "agent-binding"] as const,
  all: ["mcp"] as const,
  missingAgentBinding: () => [...mcpKeys.agentBindings(), "missing"] as const,
  missingRegistry: () => [...mcpKeys.registries(), "missing"] as const,
  registries: () => [...mcpKeys.all, "registry"] as const,
  registry: (appId: string) => [...mcpKeys.registries(), appId] as const,
};

function requireQueryId(value: string | null, label: string): string {
  if (value === null || value.length === 0) {
    throw new Error(`${label} is required.`);
  }

  return value;
}

export function useMcpRegistryQuery(appId: string | null): UseQueryResult<McpRegistry> {
  return useQuery({
    enabled: appId !== null,
    queryFn: async () => getMcpRegistry(toAppId(requireQueryId(appId, "App id"))),
    queryKey:
      appId !== null && appId.length > 0 ? mcpKeys.registry(appId) : mcpKeys.missingRegistry(),
  });
}
