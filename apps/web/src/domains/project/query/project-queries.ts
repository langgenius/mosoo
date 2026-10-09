import type { ProjectSummary } from "@mosoo/contracts/project";
import type { OrganizationId } from "@mosoo/id";
import { skipToken, useQuery } from "@tanstack/react-query";

import { listOrganizationProjects } from "../api/project-client";

export const projectKeys = {
  all: ["project"] as const,
  list: (organizationId: string | null) => [...projectKeys.lists(), organizationId] as const,
  lists: () => [...projectKeys.all, "list"] as const,
};

export function useOrganizationProjectsQuery(organizationId: OrganizationId | null) {
  return useQuery<ProjectSummary[]>({
    queryFn:
      organizationId === null ? skipToken : async () => listOrganizationProjects(organizationId),
    queryKey: projectKeys.list(organizationId),
  });
}
