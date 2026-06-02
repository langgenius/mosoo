import type { SpaceView } from "@mosoo/contracts/space";
import { useQuery } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";

import { toOrganizationId } from "@/routes/typed-id";

import { spaces } from "../api/list";

export const spaceKeys = {
  all: ["space"] as const,
  list: (organizationId: string) => [...spaceKeys.lists(), organizationId] as const,
  lists: () => [...spaceKeys.all, "list"] as const,
  missing: () => [...spaceKeys.lists(), "missing"] as const,
};

function requireOrganizationId(organizationId: string | null): string {
  if (organizationId === null || organizationId.length === 0) {
    throw new Error("Organization id is required.");
  }

  return organizationId;
}

export function useSpacesQuery(organizationId: string | null): UseQueryResult<SpaceView[]> {
  return useQuery({
    enabled: organizationId !== null,
    queryFn: async () => spaces(toOrganizationId(requireOrganizationId(organizationId))),
    queryKey:
      organizationId !== null && organizationId.length > 0
        ? spaceKeys.list(organizationId)
        : spaceKeys.missing(),
  });
}
