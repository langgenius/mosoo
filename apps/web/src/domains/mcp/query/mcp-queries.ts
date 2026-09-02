import type { McpRegistry } from "@mosoo/contracts/mcp";
import { useQuery } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";

import { toProjectId } from "@/routes/typed-id";

import { getMcpRegistry } from "../api/mcp-client";

export const mcpKeys = {
  agentBinding: (agentId: string) => [...mcpKeys.agentBindings(), agentId] as const,
  agentBindings: () => [...mcpKeys.all, "agent-binding"] as const,
  all: ["mcp"] as const,
  missingAgentBinding: () => [...mcpKeys.agentBindings(), "missing"] as const,
  missingRegistry: () => [...mcpKeys.registries(), "missing"] as const,
  registries: () => [...mcpKeys.all, "registry"] as const,
  registry: (projectId: string) => [...mcpKeys.registries(), projectId] as const,
};

function requireQueryId(value: string | null, label: string): string {
  if (value === null || value.length === 0) {
    throw new Error(`${label} is required.`);
  }

  return value;
}

export function useMcpRegistryQuery(projectId: string | null): UseQueryResult<McpRegistry> {
  return useQuery({
    enabled: projectId !== null,
    queryFn: async () => getMcpRegistry(toProjectId(requireQueryId(projectId, "Project id"))),
    queryKey:
      projectId !== null && projectId.length > 0
        ? mcpKeys.registry(projectId)
        : mcpKeys.missingRegistry(),
  });
}
