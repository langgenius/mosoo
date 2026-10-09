import { skipToken, useQuery } from "@tanstack/react-query";

import { toEnvironmentId, toProjectId } from "../../../routes/typed-id";
import { getEnvironment, listProjectEnvironments } from "../api/environment-client";
export const environmentKeys = {
  all: ["environment"] as const,
  detail: (projectId: string | null, environmentId: string | null) =>
    [...environmentKeys.details(), projectId, environmentId] as const,
  details: () => [...environmentKeys.all, "detail"] as const,
  list: (projectId: string | null) => [...environmentKeys.lists(), projectId] as const,
  lists: () => [...environmentKeys.all, "list"] as const,
};

export function useProjectEnvironmentsQuery(projectId: string | null) {
  return useQuery({
    queryFn:
      projectId === null ? skipToken : async () => listProjectEnvironments(toProjectId(projectId)),
    queryKey: environmentKeys.list(projectId),
  });
}

export function useEnvironmentDetailQuery(projectId: string | null, environmentId: string | null) {
  return useQuery({
    queryFn:
      projectId === null || environmentId === null
        ? skipToken
        : async () => getEnvironment(toProjectId(projectId), toEnvironmentId(environmentId)),
    queryKey: environmentKeys.detail(projectId, environmentId),
  });
}
