import type { AppDeploymentRunStatus } from "@mosoo/contracts/app";
import { useCallback, useEffect, useRef, useState } from "react";

import { createDeployConsoleFixture, DEPLOY_APP_IDENTITY } from "./deploy-console-data";
import type { DeployConsoleState, DeploymentRunVM } from "./deploy-console-data";

/**
 * Status steps a freshly triggered deploy walks through. This mirrors the real
 * `AppDeploymentRun` machine (queued -> preparing -> building -> submitting ->
 * activating -> success | failed); the live build runs server-side, so here it
 * is a timed simulation purely to make the console feel real during acceptance.
 */
const SUCCESS_STEPS: AppDeploymentRunStatus[] = [
  "queued",
  "preparing",
  "building",
  "submitting",
  "activating",
  "success",
];

const FAILURE_STEPS: AppDeploymentRunStatus[] = ["queued", "preparing", "building", "failed"];

const FAILURE_ERROR = {
  errorCode: "build_failed",
  errorMessage: "Build failed: `vite build` exited with code 1 (missing dependency).",
} as const;

const STEP_INTERVAL_MS = 750;

export interface DeployConsole {
  state: DeployConsoleState;
  deploying: boolean;
  /** Bind a public GitHub repo and deploy its default branch HEAD. */
  deployRepo: (repoUrl: string) => void;
  /** Re-pull the default branch HEAD and deploy a new run (no rollback). */
  retryDeploy: () => void;
  /** Walk a run into the failed state to showcase the error surfaces. */
  failDeploy: () => void;
  /** Delete the App deployment, its Worker, and the agent bindings. */
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

function stripProtocol(url: string): string {
  return url.replace(/^https?:\/\//, "");
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

  const runDeploy = useCallback(
    (repoUrl: string | null, steps: AppDeploymentRunStatus[]) => {
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
          targetKind: null,
          status: "queued",
          createdLabel: "just now",
          liveUrl: null,
          errorCode: null,
          errorMessage: null,
        };
        const deployment = prev.deployment ?? {
          appName: DEPLOY_APP_IDENTITY.appName,
          repoUrl: repoUrl === null ? DEPLOY_APP_IDENTITY.repoUrl : stripProtocol(repoUrl),
          defaultBranch: DEPLOY_APP_IDENTITY.defaultBranch,
          liveUrl: null,
          subdomain: null,
        };
        return { ...prev, deployment, runs: [inflight, ...prev.runs] };
      });

      steps.forEach((status, index) => {
        const timer = window.setTimeout(
          () => {
            setState((prev) => {
              const runs = prev.runs.map((run): DeploymentRunVM => {
                if (run.id !== runId) {
                  // The previous live run stays "success" (still serving) until
                  // the new run actually goes live — then it is superseded.
                  return status === "success" && run.status === "success"
                    ? { ...run, status: "superseded", liveUrl: null }
                    : run;
                }
                return {
                  ...run,
                  status,
                  targetKind: status === "queued" ? null : "cloudflare_worker",
                  liveUrl: status === "success" ? DEPLOY_APP_IDENTITY.liveUrl : null,
                  ...(status === "failed" ? FAILURE_ERROR : null),
                };
              });
              if (status !== "success" || prev.deployment === null) {
                return { ...prev, runs };
              }
              return {
                ...prev,
                runs,
                deployment: {
                  ...prev.deployment,
                  liveUrl: DEPLOY_APP_IDENTITY.liveUrl,
                  subdomain: DEPLOY_APP_IDENTITY.subdomain,
                },
              };
            });
            if (status === "success" || status === "failed") {
              setDeploying(false);
            }
          },
          STEP_INTERVAL_MS * (index + 1),
        );
        timersRef.current.push(timer);
      });
    },
    [deploying],
  );

  const deployRepo = useCallback(
    (repoUrl: string) => {
      runDeploy(repoUrl, SUCCESS_STEPS);
    },
    [runDeploy],
  );

  const retryDeploy = useCallback(() => {
    runDeploy(null, SUCCESS_STEPS);
  }, [runDeploy]);

  const failDeploy = useCallback(() => {
    runDeploy(null, FAILURE_STEPS);
  }, [runDeploy]);

  const deleteDeployment = useCallback(() => {
    clearTimers();
    setDeploying(false);
    setState((prev) => ({ ...prev, deployment: null, runs: [] }));
  }, [clearTimers]);

  return { state, deploying, deployRepo, retryDeploy, failDeploy, deleteDeployment };
}
