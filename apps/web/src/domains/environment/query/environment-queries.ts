import { useQuery } from "@tanstack/react-query";

import { toEnvironmentId, toAppId } from "../../../routes/typed-id";
import { isTruthy } from "../../../shared/lib/truthiness";
import { getEnvironment, listAppEnvironments } from "../api/environment-client";
export const environmentKeys = {
  all: ["environment"] as const,
  detail: (appId: string, environmentId: string) =>
    [...environmentKeys.details(), appId, environmentId] as const,
  details: () => [...environmentKeys.all, "detail"] as const,
  list: (appId: string) => [...environmentKeys.lists(), appId] as const,
  lists: () => [...environmentKeys.all, "list"] as const,
};

export function useAppEnvironmentsQuery(appId: string | null) {
  return useQuery({
    enabled: appId !== null,
    queryFn: async () => listAppEnvironments(toAppId(appId!)),
    queryKey: isTruthy(appId)
      ? environmentKeys.list(appId)
      : [...environmentKeys.lists(), "missing"],
  });
}

export function useEnvironmentDetailQuery(appId: string | null, environmentId: string | null) {
  return useQuery({
    enabled: appId !== null && environmentId !== null,
    queryFn: async () => getEnvironment(toAppId(appId!), toEnvironmentId(environmentId!)),
    queryKey:
      isTruthy(appId) && isTruthy(environmentId)
        ? environmentKeys.detail(appId, environmentId)
        : [...environmentKeys.details(), "missing"],
  });
}
