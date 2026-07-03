import type { AppDeployment, AppDeploymentRun, AppOverviewBoundAgent } from "@mosoo/contracts/app";

import type { AppDeploymentOverview } from "@/domains/app/api/app-deployment-client";

import type {
  BoundAgentVM,
  DeployConsoleState,
  DeploymentRunVM,
  DeploymentVM,
} from "./deploy-console-data";

/**
 * Pure mappers from the shared `@mosoo/contracts/app` deployment payloads onto
 * the fixture-shaped {@link DeployConsoleState} view models, so the live and
 * preview Overviews render through the exact same components.
 *
 * Runs come from `appDeploymentRunList` newest-first: display numbers count
 * from the oldest fetched run (#1 = length - index, valid within the server's
 * 50-run window), and any success older than the newest success renders as
 * "superseded". Until the run list resolves, the overview's embedded latest
 * run renders WITHOUT a number — a lone run cannot know its place in history.
 */

export function stripProtocol(url: string): string {
  return url.replace(/^https?:\/\//, "");
}

export function hostOf(url: string): string {
  return stripProtocol(url).split("/")[0] ?? stripProtocol(url);
}

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

/** Relative "when" label, computed at render time against `nowMs`. */
export function relativeLabel(iso: string, nowMs: number): string {
  const deltaMs = nowMs - new Date(iso).getTime();

  if (Number.isNaN(deltaMs) || deltaMs < 60_000) {
    return "just now";
  }
  if (deltaMs < 3_600_000) {
    return `${String(Math.round(deltaMs / 60_000))}m`;
  }
  if (deltaMs < 86_400_000) {
    return `${String(Math.round(deltaMs / 3_600_000))}h`;
  }

  return `${String(Math.round(deltaMs / 86_400_000))}d`;
}

function toBoundAgentVM(agent: AppOverviewBoundAgent): BoundAgentVM {
  return {
    envVar: agent.envVar,
    expose: agent.expose,
    id: agent.agentId,
    name: agent.name,
  };
}

function toRunVM(run: AppDeploymentRun, number: number | null): DeploymentRunVM {
  return {
    commitSha: shortSha(run.sourceCommitSha),
    createdAt: run.createdAt,
    errorCode: run.errorCode,
    errorMessage: run.errorMessage,
    id: run.id,
    liveUrl: run.liveUrl,
    number,
    status: run.status,
    targetKind: run.targetKind,
  };
}

function toRunVMs(runs: AppDeploymentRun[], numbered: boolean): DeploymentRunVM[] {
  let liveSeen = false;

  return runs.map((run, index) => {
    const superseded = run.status === "success" && liveSeen;
    liveSeen = liveSeen || run.status === "success";
    const vm = toRunVM(run, numbered ? runs.length - index : null);

    return superseded ? { ...vm, liveUrl: null, status: "superseded" } : vm;
  });
}

function toDeploymentVM(
  appName: string,
  deployment: AppDeployment,
  liveUrl: string | null,
): DeploymentVM {
  return {
    appName,
    defaultBranch: deployment.defaultBranch,
    liveUrl,
    plannedUrl: deployment.plannedUrl,
    repoUrl: stripProtocol(deployment.repoUrl),
  };
}

export function toDeployConsoleState(
  overview: AppDeploymentOverview,
  runs: AppDeploymentRun[],
): DeployConsoleState {
  const agents = overview.boundAgents.map(toBoundAgentVM);
  const { deployment } = overview;

  if (deployment === null) {
    return { agents, deployment: null, runs: [] };
  }

  // The run list loads in parallel with the overview; until it lands, fall
  // back to the embedded latest run so a deployment never renders without one.
  const sourceRuns =
    runs.length > 0 ? runs : deployment.latestRun === null ? [] : [deployment.latestRun];

  // The overview and the run list refresh independently; whichever source saw
  // the newest success first supplies the live URL so the URL card never lags
  // the status pill.
  const liveUrl =
    deployment.liveUrl ?? sourceRuns.find((run) => run.status === "success")?.liveUrl ?? null;

  return {
    agents,
    deployment: toDeploymentVM(overview.appName, deployment, liveUrl),
    runs: toRunVMs(sourceRuns, runs.length > 0),
  };
}
