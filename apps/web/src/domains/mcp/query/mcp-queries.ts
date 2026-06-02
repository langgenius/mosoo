import type { McpRegistry } from "@mosoo/contracts/mcp";
import { useQuery } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";

import { toOrganizationId } from "@/routes/typed-id";

import { getMcpRegistry } from "../api/mcp-client";

export const mcpKeys = {
  agentBinding: (agentId: string) => [...mcpKeys.agentBindings(), agentId] as const,
  agentBindings: () => [...mcpKeys.all, "agent-binding"] as const,
  all: ["mcp"] as const,
  missingAgentBinding: () => [...mcpKeys.agentBindings(), "missing"] as const,
  missingRegistry: () => [...mcpKeys.registries(), "missing"] as const,
  registries: () => [...mcpKeys.all, "registry"] as const,
  registry: (organizationId: string) => [...mcpKeys.registries(), organizationId] as const,
};

function requireQueryId(value: string | null, label: string): string {
  if (value === null || value.length === 0) {
    throw new Error(`${label} is required.`);
  }

  return value;
}

export function useMcpRegistryQuery(organizationId: string | null): UseQueryResult<McpRegistry> {
  return useQuery({
    enabled: organizationId !== null,
    queryFn: async () =>
      getMcpRegistry(toOrganizationId(requireQueryId(organizationId, "Organization id"))),
    queryKey:
      organizationId !== null && organizationId.length > 0
        ? mcpKeys.registry(organizationId)
        : mcpKeys.missingRegistry(),
  });
}
