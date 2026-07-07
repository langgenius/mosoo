import type { AppDeploymentRunStatus, AppDeploymentTargetKind } from "@mosoo/contracts/app";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  createDeployConsoleFixture,
  DEPLOY_APP_IDENTITY,
  scenarioTerminalRun,
} from "./deploy-console-data";
import type {
  DeployConsoleScenario,
  DeployConsoleState,
  DeploymentRunVM,
} from "./deploy-console-data";
import { stripProtocol } from "./deploy-console-mapping";

/**
 * Status steps a freshly triggered deploy walks through. This mirrors the real
 * `AppDeploymentRun` machine (queued -> preparing -> building -> submitting ->
 * activating -> success | failed); the live build runs server-side, so here it
 * is a timed simulation purely to make the console feel real during acceptance.
 * The terminal run shape comes from {@link scenarioTerminalRun}, so a walked
 * run lands exactly on the scenario's seeded fixture state — the agent-only
 * walk succeeds with a null URL, the native-red walk terminal-fails with its
 * repo-term validate failures attached.
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

/** Native validation rejects during preparation — the build never starts. */
const NATIVE_RED_STEPS: AppDeploymentRunStatus[] = ["queued", "preparing", "failed"];

const FAILURE_ERROR = {
  errorCode: "build_failed",
  errorMessage: "Build failed: `vite build` exited with code 1 (missing dependency).",
} as const;

const STEP_INTERVAL_MS = 750;

export interface DeployConsole {
  state: DeployConsoleState;
  deploying: boolean;
  /** Mirrors the live console: a redeploy needs an existing deployment. */
  canDeploy: boolean;
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
  return runs.reduce((max, run) => Math.max(max, run.number ?? 0), 0) + 1;
}

export function useDeployConsole(scenario: DeployConsoleScenario = "web"): DeployConsole {
  const [state, setState] = useState<DeployConsoleState>(() =>
    createDeployConsoleFixture(scenario),
  );
  const [deploying, setDeploying] = useState(false);
  const timersRef = useRef<number[]>([]);

  const clearTimers = useCallback(() => {
    for (const id of timersRef.current) {
      window.clearTimeout(id);
    }
    timersRef.current = [];
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  // Reset to the scenario's seeded state whenever the acceptance page switches.
  useEffect(() => {
    clearTimers();
    setDeploying(false);
    setState(createDeployConsoleFixture(scenario));
  }, [clearTimers, scenario]);

  const runDeploy = useCallback(
    (repoUrl: string | null, steps: AppDeploymentRunStatus[], legacyFail: boolean) => {
      if (deploying) {
        return;
      }
      setDeploying(true);

      // Legacy web deploys learn their target as soon as detection runs;
      // protocol runs keep it NULL until the native facts land (the mapping
      // layer derives "agent_only" — never the server).
      const midTargetKind: AppDeploymentTargetKind | null =
        scenario === "web" || scenario === "web-and-agents" ? "cloudflare_worker" : null;
      const terminal = legacyFail
        ? {
            ...FAILURE_ERROR,
            liveUrl: null,
            native: null,
            status: "failed" as const,
            targetKind: midTargetKind,
          }
        : scenarioTerminalRun(scenario);

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
          createdAt: new Date().toISOString(),
          liveUrl: null,
          errorCode: null,
          errorMessage: null,
          native: null,
        };
        // A submitted repo URL re-binds the source even when a deployment
        // already exists — mirroring the live deployApp semantics.
        const deployment =
          prev.deployment === null
            ? {
                appName: DEPLOY_APP_IDENTITY.appName,
                // Slug mirrors the scenario's seeded fixture: legacy web stays
                // null (not name-routable); protocol scenarios mint one.
                slug:
                  scenario === "web"
                    ? null
                    : scenario === "agent-only"
                      ? "quiz-agents"
                      : "roadmap-board",
                repoUrl: repoUrl === null ? DEPLOY_APP_IDENTITY.repoUrl : stripProtocol(repoUrl),
                defaultBranch: DEPLOY_APP_IDENTITY.defaultBranch,
                plannedUrl: scenario === "agent-only" ? null : DEPLOY_APP_IDENTITY.plannedUrl,
                liveUrl: null,
              }
            : repoUrl === null
              ? prev.deployment
              : { ...prev.deployment, repoUrl: stripProtocol(repoUrl) };
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
                if (status === "success" || status === "failed") {
                  return { ...run, ...terminal };
                }
                return {
                  ...run,
                  status,
                  targetKind: status === "queued" ? null : midTargetKind,
                };
              });
              if (status !== "success" || prev.deployment === null || terminal.liveUrl === null) {
                return { ...prev, runs };
              }
              return {
                ...prev,
                runs,
                deployment: {
                  ...prev.deployment,
                  liveUrl: terminal.liveUrl,
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
    [deploying, scenario],
  );

  const deploySteps = scenario === "native-red" ? NATIVE_RED_STEPS : SUCCESS_STEPS;

  const deployRepo = useCallback(
    (repoUrl: string) => {
      runDeploy(repoUrl, deploySteps, false);
    },
    [deploySteps, runDeploy],
  );

  const retryDeploy = useCallback(() => {
    runDeploy(null, deploySteps, false);
  }, [deploySteps, runDeploy]);

  const failDeploy = useCallback(() => {
    runDeploy(null, FAILURE_STEPS, true);
  }, [runDeploy]);

  const deleteDeployment = useCallback(() => {
    clearTimers();
    setDeploying(false);
    setState((prev) => ({ ...prev, deployment: null, runs: [] }));
  }, [clearTimers]);

  const canDeploy = state.deployment !== null && !deploying;

  return { state, deploying, canDeploy, deployRepo, retryDeploy, failDeploy, deleteDeployment };
}
