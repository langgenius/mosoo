import type { ProjectSummary } from "@mosoo/contracts/project";
import { useQuery } from "@tanstack/react-query";

import { toOrganizationId } from "@/routes/typed-id";

import { listOrganizationProjects } from "../api/project-client";

export const projectKeys = {
  all: ["project"] as const,
  list: (organizationId: string | null) => [...projectKeys.lists(), organizationId] as const,
  lists: () => [...projectKeys.all, "list"] as const,
};

export function useOrganizationProjectsQuery(organizationId: string | null) {
  return useQuery<ProjectSummary[]>({
    enabled: organizationId !== null,
    queryFn: async () => {
      if (organizationId === null) {
        throw new Error("Organization id is required to list projects.");
      }

      return listOrganizationProjects(toOrganizationId(organizationId));
    },
    queryKey: projectKeys.list(organizationId),
  });
}
