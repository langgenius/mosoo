import { useCallback, useEffect, useMemo } from "react";

import {
  isDeploymentRunInFlight,
  useAppDeploymentOverviewQuery,
  useAppDeploymentRunsQuery,
  useDeleteAppDeploymentMutation,
  useDeployAppMutation,
} from "@/domains/app/query/app-deployment-queries";
import { toAppId } from "@/routes/typed-id";

import type { DeployConsoleState } from "./deploy-console-data";
import { toDeployConsoleState } from "./deploy-console-mapping";

const EMPTY_STATE: DeployConsoleState = { agents: [], deployment: null, runs: [] };

export interface LiveDeployConsole {
  appName: string;
  state: DeployConsoleState;
  /** A deploy is settling (mutation in flight or the latest run is in progress). */
  deploying: boolean;
  loading: boolean;
  /** The overview read failed — shown as a banner over whichever body renders. */
  loadError: string | null;
  /** The run-list read failed — the Activity history is missing, not empty. */
  runsError: string | null;
  /** The `deployApp` mutation failed — surfaced inline next to the deploy form. */
  deployError: string | null;
  /** The `deleteAppDeployment` mutation failed. */
  deleteError: string | null;
  /** Whether a redeploy can be triggered (an existing deployment to re-pull). */
  canDeploy: boolean;
  /** Deploy (or re-bind) the App from a public GitHub repo URL. */
  deployRepo: (repoUrl: string) => void;
  /** Re-pull the default branch HEAD of the bound repo and deploy a new run. */
  retryDeploy: () => void;
  /** Delete the App deployment, its Worker, and the agent bindings. */
  deleteDeployment: () => void;
}

/**
 * Live data source for the App Overview deploy surface. Reads `appOverview`
 * plus `appDeploymentRunList` for the active App and exposes the same shape as
 * the fixture-backed `useDeployConsole`, so the Overview composition renders
 * either without branching.
 *
 * Polling discipline: the overview query is the only 2.5s poller while a run
 * is in flight; the run list refetches whenever the overview's latest run
 * moves (new run or status change) instead of polling in parallel.
 */
export function useLiveDeployConsole(
  appId: string | null,
  fallbackName: string,
): LiveDeployConsole {
  const overviewQuery = useAppDeploymentOverviewQuery(appId);
  const overview = overviewQuery.data ?? null;
  const deployment = overview?.deployment ?? null;

  const runsQuery = useAppDeploymentRunsQuery(appId, deployment !== null);
  const deployMutation = useDeployAppMutation(appId);
  const deleteMutation = useDeleteAppDeploymentMutation(appId);

  const runs = runsQuery.data ?? null;
  const state = useMemo<DeployConsoleState>(
    () => (overview === null ? EMPTY_STATE : toDeployConsoleState(overview, runs ?? [])),
    [overview, runs],
  );

  // Keep the run list in step with the polled overview without a second
  // poller: refetch it whenever the latest run appears or changes status.
  const latestRun = deployment?.latestRun ?? null;
  const latestRunKey = latestRun === null ? null : `${latestRun.id}:${latestRun.status}`;
  const refetchRuns = runsQuery.refetch;
  useEffect(() => {
    if (latestRunKey !== null) {
      void refetchRuns();
    }
  }, [latestRunKey, refetchRuns]);

  const deploying =
    deployMutation.isPending || isDeploymentRunInFlight(deployment?.latestRun?.status);
  const canDeploy = deployment !== null && !deploying && !deleteMutation.isPending;

  const deployRepo = useCallback(
    (repoUrl: string) => {
      if (appId === null || deploying || deleteMutation.isPending) {
        return;
      }
      deployMutation.mutate({ appId: toAppId(appId), repoUrl });
    },
    [appId, deleteMutation.isPending, deploying, deployMutation],
  );

  const retryDeploy = useCallback(() => {
    if (appId === null || deployment === null || deploying) {
      return;
    }
    deployMutation.mutate({ appId: toAppId(appId), repoUrl: deployment.repoUrl });
  }, [appId, deployment, deploying, deployMutation]);

  const deleteDeployment = useCallback(() => {
    if (appId === null) {
      return;
    }
    deleteMutation.mutate({ appId: toAppId(appId) });
  }, [appId, deleteMutation]);

  return {
    appName: overview?.appName ?? fallbackName,
    canDeploy,
    deleteDeployment,
    deleteError: deleteMutation.error?.message ?? null,
    deployError: deployMutation.error?.message ?? null,
    deploying,
    deployRepo,
    loadError: overviewQuery.error?.message ?? null,
    loading: overviewQuery.isLoading,
    retryDeploy,
    runsError: runsQuery.error?.message ?? null,
    state,
  };
}
