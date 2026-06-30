import { useCallback, useMemo } from "react";

import {
  isDeploymentRunInFlight,
  useAppDeploymentOverviewQuery,
  useDeleteAppDeploymentMutation,
  useDeployAppMutation,
} from "@/domains/app/query/app-deployment-queries";
import { toAppId } from "@/routes/typed-id";

import { toDeployConsoleState } from "./deploy-console-mapping";
import type { DeployConsoleState } from "./deploy-console-data";

const EMPTY_STATE: DeployConsoleState = { agents: [], deployment: null, runs: [] };

export interface LiveDeployConsole {
  appName: string;
  state: DeployConsoleState;
  /** A deploy is settling (mutation in flight or the latest run is in progress). */
  deploying: boolean;
  loading: boolean;
  error: string | null;
  /** Whether a redeploy can be triggered (an existing deployment to re-pull). */
  canDeploy: boolean;
  /** Re-pull the default branch HEAD of the bound repo and deploy a new run. */
  retryDeploy: () => void;
  /** Delete the App deployment, its Worker, and the agent bindings. */
  deleteDeployment: () => void;
}

/**
 * Live data source for the protected Deployments console. Reads `appOverview`
 * for the active App and exposes the same surface as the fixture-backed
 * `useDeployConsole`, so {@link file://./components/deploy-console-view.tsx} can
 * render either without branching.
 */
export function useLiveDeployConsole(appId: string | null, fallbackName: string): LiveDeployConsole {
  const overviewQuery = useAppDeploymentOverviewQuery(appId);
  const deployMutation = useDeployAppMutation(appId);
  const deleteMutation = useDeleteAppDeploymentMutation(appId);

  const overview = overviewQuery.data ?? null;
  const state = useMemo<DeployConsoleState>(
    () => (overview === null ? EMPTY_STATE : toDeployConsoleState(overview)),
    [overview],
  );

  const deployment = overview?.deployment ?? null;
  const deploying =
    deployMutation.isPending || isDeploymentRunInFlight(deployment?.latestRun?.status);
  const canDeploy = deployment !== null && !deploying && !deleteMutation.isPending;

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

  const error =
    overviewQuery.error?.message ??
    deployMutation.error?.message ??
    deleteMutation.error?.message ??
    null;

  return {
    appName: overview?.appName ?? fallbackName,
    canDeploy,
    deleteDeployment,
    deploying,
    error,
    loading: overviewQuery.isLoading,
    retryDeploy,
    state,
  };
}
