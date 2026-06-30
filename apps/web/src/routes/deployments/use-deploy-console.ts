import { useCallback, useEffect, useRef, useState } from "react";

import type { AppDeploymentRunStatus } from "@mosoo/contracts/app";

import { createDeployConsoleFixture, DEPLOY_APP_IDENTITY } from "./deploy-console-data";
import type { DeployConsoleState, DeploymentRunVM } from "./deploy-console-data";

/**
 * Status steps a freshly triggered deploy walks through. This mirrors the real
 * `AppDeploymentRun` machine (queued -> preparing -> building -> submitting ->
 * activating -> success); the live build runs server-side, so here it is a
 * timed simulation purely to make the console feel real during acceptance.
 */
const DEPLOY_STEPS: AppDeploymentRunStatus[] = [
  "queued",
  "preparing",
  "building",
  "submitting",
  "activating",
  "success",
];

const STEP_INTERVAL_MS = 750;

export interface DeployConsole {
  state: DeployConsoleState;
  deploying: boolean;
  /** Re-pull the default branch HEAD and deploy a new run (no rollback). */
  retryDeploy: () => void;
  /** Delete the App, its Worker, and the agent bindings. */
  deleteDeployment: () => void;
}

function nextCommitSha(): string {
  return Math.floor(Math.random() * 0xffffff)
    .toString(16)
    .padStart(6, "0");
}

function nextRunNumber(runs: DeploymentRunVM[]): number {
  return runs.reduce((max, run) => Math.max(max, run.number), 0) + 1;
}

export function useDeployConsole(): DeployConsole {
  const [state, setState] = useState<DeployConsoleState>(createDeployConsoleFixture);
  const [deploying, setDeploying] = useState(false);
  const timersRef = useRef<number[]>([]);

  const clearTimers = useCallback(() => {
    for (const id of timersRef.current) {
      window.clearTimeout(id);
    }
    timersRef.current = [];
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const retryDeploy = useCallback(() => {
    if (deploying) {
      return;
    }
    setDeploying(true);

    const commitSha = nextCommitSha();
    let runId = "";

    setState((prev) => {
      const number = nextRunNumber(prev.runs);
      runId = `run_${String(number)}`;
      const inflight: DeploymentRunVM = {
        id: runId,
        number,
        commitSha,
        workerName: DEPLOY_APP_IDENTITY.workerName,
        targetKind: "cloudflare_worker",
        status: "queued",
        createdLabel: "just now",
        liveUrl: null,
        errorCode: null,
        errorMessage: null,
      };
      const supersededRuns = prev.runs.map((run) =>
        run.status === "success" ? { ...run, status: "superseded" as const, liveUrl: null } : run,
      );
      return { ...prev, runs: [inflight, ...supersededRuns] };
    });

    DEPLOY_STEPS.forEach((status, index) => {
      const timer = window.setTimeout(
        () => {
          setState((prev) => {
            const runs = prev.runs.map((run) =>
              run.id === runId
                ? {
                    ...run,
                    status,
                    liveUrl: status === "success" ? DEPLOY_APP_IDENTITY.liveUrl : null,
                  }
                : run,
            );
            if (status !== "success") {
              return { ...prev, runs };
            }
            const current = runs.find((run) => run.id === runId);
            const number = current?.number ?? prev.deployment?.latestNumber ?? 1;
            return {
              ...prev,
              runs,
              deployment: {
                appName: DEPLOY_APP_IDENTITY.appName,
                repoUrl: DEPLOY_APP_IDENTITY.repoUrl,
                defaultBranch: DEPLOY_APP_IDENTITY.defaultBranch,
                liveUrl: DEPLOY_APP_IDENTITY.liveUrl,
                subdomain: DEPLOY_APP_IDENTITY.subdomain,
                latestNumber: number,
                latestCommit: commitSha,
              },
            };
          });
          if (status === "success") {
            setDeploying(false);
          }
        },
        STEP_INTERVAL_MS * (index + 1),
      );
      timersRef.current.push(timer);
    });
  }, [deploying]);

  const deleteDeployment = useCallback(() => {
    clearTimers();
    setDeploying(false);
    setState((prev) => ({ ...prev, deployment: null, runs: [] }));
  }, [clearTimers]);

  return { state, deploying, retryDeploy, deleteDeployment };
}
