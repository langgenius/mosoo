import type { Viewer } from "@mosoo/contracts/account";
import { useQuery } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";

import { getViewer } from "../api/user-client";

export const userKeys = {
  all: ["user"] as const,
  viewer: () => [...userKeys.all, "viewer"] as const,
};

export function useViewerQuery(): UseQueryResult<Viewer> {
  return useQuery({
    queryFn: getViewer,
    queryKey: userKeys.viewer(),
    // Session lookups should not silently re-run on every tab refocus —
    // A transient dev-server restart or expired cookie would otherwise
    // Null out viewer.data and bounce ProtectedRoute to /login.
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: Infinity,
  });
}
