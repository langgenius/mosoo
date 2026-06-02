import type { Viewer } from "@mosoo/contracts/account";
import { useQuery } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";

import { UnauthorizedError } from "@/platform/http/graphql-client";

import { getViewer } from "../api/user-client";

const VIEWER_REQUEST_TIMEOUT_MS = 3000;

export const userKeys = {
  all: ["user"] as const,
  viewer: () => [...userKeys.all, "viewer"] as const,
};

export function useViewerQuery(): UseQueryResult<Viewer> {
  return useQuery({
    queryFn: async () => {
      // Race the viewer lookup against a short timeout so the loading screen
      // unblocks if the API is offline/unreachable in local development.
      // In normal operation the request returns in <100ms.
      return new Promise<Viewer>((resolveViewer, reject) => {
        const timer = setTimeout(() => {
          reject(new UnauthorizedError("Viewer lookup timed out"));
        }, VIEWER_REQUEST_TIMEOUT_MS);
        getViewer().then(
          (viewer) => {
            clearTimeout(timer);
            resolveViewer(viewer);
          },
          (error: unknown) => {
            clearTimeout(timer);
            reject(error instanceof Error ? error : new Error(String(error)));
          },
        );
      });
    },
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
