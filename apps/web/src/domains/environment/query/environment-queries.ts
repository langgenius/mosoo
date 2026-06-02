import { useQuery } from "@tanstack/react-query";

import { toEnvironmentId, toOrganizationId } from "../../../routes/typed-id";
import { isTruthy } from "../../../shared/lib/truthiness";
import { getEnvironment, listOrganizationEnvironments } from "../api/environment-client";
export const environmentKeys = {
  all: ["environment"] as const,
  detail: (environmentId: string) => [...environmentKeys.details(), environmentId] as const,
  details: () => [...environmentKeys.all, "detail"] as const,
  list: (organizationId: string) => [...environmentKeys.lists(), organizationId] as const,
  lists: () => [...environmentKeys.all, "list"] as const,
};

export function useOrganizationEnvironmentsQuery(organizationId: string | null) {
  return useQuery({
    enabled: organizationId !== null,
    queryFn: async () => listOrganizationEnvironments(toOrganizationId(organizationId!)),
    queryKey: isTruthy(organizationId)
      ? environmentKeys.list(organizationId)
      : [...environmentKeys.lists(), "missing"],
  });
}

export function useEnvironmentDetailQuery(environmentId: string | null) {
  return useQuery({
    enabled: environmentId !== null,
    queryFn: async () => getEnvironment(toEnvironmentId(environmentId!)),
    queryKey: isTruthy(environmentId)
      ? environmentKeys.detail(environmentId)
      : [...environmentKeys.details(), "missing"],
  });
}
