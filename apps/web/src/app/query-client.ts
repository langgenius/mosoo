import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";

import { userKeys } from "@/domains/user/query/user-queries";
import { UnauthorizedError } from "@/platform/http/graphql-client";

function handleAuthError(error: unknown) {
  if (!(error instanceof UnauthorizedError)) {
    return;
  }
  // Force viewer to null. ProtectedRoute then redirects to /login?redirect=...
  // And stays there until the user signs in again.
  appQueryClient.setQueryData(userKeys.viewer(), null);
  void appQueryClient.cancelQueries();
}

export const appQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: 10 * 60 * 1000,
      retry: (failureCount, error) => {
        if (error instanceof UnauthorizedError) {
          return false;
        }
        return failureCount < 1;
      },
      staleTime: 30 * 1000,
    },
  },
  mutationCache: new MutationCache({ onError: handleAuthError }),
  queryCache: new QueryCache({ onError: handleAuthError }),
});
