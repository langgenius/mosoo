import type { AppSummary } from "@mosoo/contracts/app";
import { useQuery } from "@tanstack/react-query";

import { toOrganizationId } from "@/routes/typed-id";

import { listOrganizationApps } from "../api/app-client";

export const appKeys = {
  all: ["app"] as const,
  list: (organizationId: string | null) => [...appKeys.lists(), organizationId] as const,
  lists: () => [...appKeys.all, "list"] as const,
};

export function useOrganizationAppsQuery(organizationId: string | null) {
  return useQuery<AppSummary[]>({
    enabled: organizationId !== null,
    queryFn: async () => {
      if (organizationId === null) {
        throw new Error("Organization id is required to list apps.");
      }

      return listOrganizationApps(toOrganizationId(organizationId));
    },
    queryKey: appKeys.list(organizationId),
  });
}
