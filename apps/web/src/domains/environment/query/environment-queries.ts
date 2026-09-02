import { useQuery } from "@tanstack/react-query";

import { toEnvironmentId, toProjectId } from "../../../routes/typed-id";
import { isTruthy } from "../../../shared/lib/truthiness";
import { getEnvironment, listProjectEnvironments } from "../api/environment-client";
export const environmentKeys = {
  all: ["environment"] as const,
  detail: (projectId: string, environmentId: string) =>
    [...environmentKeys.details(), projectId, environmentId] as const,
  details: () => [...environmentKeys.all, "detail"] as const,
  list: (projectId: string) => [...environmentKeys.lists(), projectId] as const,
  lists: () => [...environmentKeys.all, "list"] as const,
};

export function useProjectEnvironmentsQuery(projectId: string | null) {
  return useQuery({
    enabled: projectId !== null,
    queryFn: async () => listProjectEnvironments(toProjectId(projectId!)),
    queryKey: isTruthy(projectId)
      ? environmentKeys.list(projectId)
      : [...environmentKeys.lists(), "missing"],
  });
}

export function useEnvironmentDetailQuery(projectId: string | null, environmentId: string | null) {
  return useQuery({
    enabled: projectId !== null && environmentId !== null,
    queryFn: async () => getEnvironment(toProjectId(projectId!), toEnvironmentId(environmentId!)),
    queryKey:
      isTruthy(projectId) && isTruthy(environmentId)
        ? environmentKeys.detail(projectId, environmentId)
        : [...environmentKeys.details(), "missing"],
  });
}
