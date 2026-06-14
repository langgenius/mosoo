import type { SpaceView } from "@mosoo/contracts/space";
import { useQuery } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";

import { toAppId } from "@/routes/typed-id";

import { spaces } from "../api/list";

export const spaceKeys = {
  all: ["space"] as const,
  list: (appId: string) => [...spaceKeys.lists(), appId] as const,
  lists: () => [...spaceKeys.all, "list"] as const,
  missing: () => [...spaceKeys.lists(), "missing"] as const,
};

function requireAppId(appId: string | null): string {
  if (appId === null || appId.length === 0) {
    throw new Error("App id is required.");
  }

  return appId;
}

export function useSpacesQuery(appId: string | null): UseQueryResult<SpaceView[]> {
  return useQuery({
    enabled: appId !== null,
    queryFn: async () => spaces(toAppId(requireAppId(appId))),
    queryKey: appId !== null && appId.length > 0 ? spaceKeys.list(appId) : spaceKeys.missing(),
  });
}
