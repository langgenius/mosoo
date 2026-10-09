import type { McpRegistry } from "@mosoo/contracts/mcp";
import { skipToken, useQuery } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";

import { toProjectId } from "@/routes/typed-id";

import { getMcpRegistry } from "../api/mcp-client";

export const mcpKeys = {
  all: ["mcp"] as const,
  registries: () => [...mcpKeys.all, "registry"] as const,
  registry: (projectId: string | null) => [...mcpKeys.registries(), projectId] as const,
};

export function useMcpRegistryQuery(projectId: string | null): UseQueryResult<McpRegistry> {
  return useQuery({
    queryFn: projectId === null ? skipToken : async () => getMcpRegistry(toProjectId(projectId)),
    queryKey: mcpKeys.registry(projectId),
  });
}
