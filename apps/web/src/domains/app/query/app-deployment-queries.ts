import type {
  AppDeploymentRun,
  AppDeploymentRunStatus,
  DeleteAppDeploymentInput,
  DeployAppInput,
} from "@mosoo/contracts/app";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query";

import { toAppId } from "@/routes/typed-id";

import {
  deleteAppDeployment,
  deployApp,
  getAppDeploymentOverview,
  listAppDeploymentRuns,
} from "../api/app-deployment-client";
import type { AppDeploymentOverview } from "../api/app-deployment-client";

const appDeploymentKeys = {
  all: ["app-deployment"] as const,
  missingOverview: () => [...appDeploymentKeys.overviews(), "missing"] as const,
  missingRunList: () => [...appDeploymentKeys.runLists(), "missing"] as const,
  overview: (appId: string) => [...appDeploymentKeys.overviews(), appId] as const,
  overviews: () => [...appDeploymentKeys.all, "overview"] as const,
  runList: (appId: string) => [...appDeploymentKeys.runLists(), appId] as const,
  runLists: () => [...appDeploymentKeys.all, "run-list"] as const,
};

/** Match the server-side cap so run numbering covers the widest window. */
const RUN_LIST_LIMIT = 50;

export const IN_FLIGHT_STATUSES: ReadonlySet<AppDeploymentRunStatus> = new Set([
  "activating",
  "building",
  "preparing",
  "queued",
  "submitted",
  "submitting",
]);

/** A run is still settling, so the console should keep polling for progress. */
export function isDeploymentRunInFlight(status: AppDeploymentRunStatus | undefined): boolean {
  return status !== undefined && IN_FLIGHT_STATUSES.has(status);
}

function requireAppId(appId: string | null): string {
  if (appId === null || appId.length === 0) {
    throw new Error("App id is required to load deployment data.");
  }

  return appId;
}

export function useAppDeploymentOverviewQuery(
  appId: string | null,
): UseQueryResult<AppDeploymentOverview> {
  return useQuery<AppDeploymentOverview>({
    enabled: appId !== null,
    queryFn: async () => getAppDeploymentOverview(toAppId(requireAppId(appId))),
    queryKey:
      appId !== null ? appDeploymentKeys.overview(appId) : appDeploymentKeys.missingOverview(),
    refetchInterval: (query) =>
      isDeploymentRunInFlight(query.state.data?.deployment?.latestRun?.status) ? 2_500 : false,
  });
}

/**
 * Run history for the Activity table. Disabled until the overview shows a
 * deployment (a pre-deploy app has no runs to fetch), and never polls on its
 * own — the overview query is the single 2.5s poller while a run is in flight,
 * and the console refetches this list when the overview's latest run moves.
 */
export function useAppDeploymentRunsQuery(
  appId: string | null,
  hasDeployment: boolean,
): UseQueryResult<AppDeploymentRun[]> {
  return useQuery<AppDeploymentRun[]>({
    enabled: appId !== null && hasDeployment,
    queryFn: async () => listAppDeploymentRuns(toAppId(requireAppId(appId)), RUN_LIST_LIMIT),
    queryKey:
      appId !== null ? appDeploymentKeys.runList(appId) : appDeploymentKeys.missingRunList(),
  });
}

export function useDeployAppMutation(
  appId: string | null,
): UseMutationResult<AppDeploymentRun, Error, DeployAppInput> {
  const queryClient = useQueryClient();

  return useMutation<AppDeploymentRun, Error, DeployAppInput>({
    mutationFn: deployApp,
    onSuccess: async () => {
      if (appId === null) {
        return;
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: appDeploymentKeys.overview(appId) }),
        queryClient.invalidateQueries({ queryKey: appDeploymentKeys.runList(appId) }),
      ]);
    },
  });
}

export function useDeleteAppDeploymentMutation(
  appId: string | null,
): UseMutationResult<boolean, Error, DeleteAppDeploymentInput> {
  const queryClient = useQueryClient();

  return useMutation<boolean, Error, DeleteAppDeploymentInput>({
    mutationFn: deleteAppDeployment,
    onSuccess: async () => {
      if (appId === null) {
        return;
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: appDeploymentKeys.overview(appId) }),
        queryClient.invalidateQueries({ queryKey: appDeploymentKeys.runList(appId) }),
      ]);
    },
  });
}
