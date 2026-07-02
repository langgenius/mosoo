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
 * from the oldest run (#1 = total - index), and any success older than the
 * newest success renders as "superseded".
 */

function stripProtocol(url: string): string {
  return url.replace(/^https?:\/\//, "");
}

function hostOf(url: string): string {
  return stripProtocol(url).split("/")[0] ?? stripProtocol(url);
}

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

function relativeLabel(iso: string): string {
  const deltaMs = Date.now() - new Date(iso).getTime();

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
    threadUrl: null,
  };
}

function toRunVM(run: AppDeploymentRun, number: number): DeploymentRunVM {
  return {
    commitSha: shortSha(run.sourceCommitSha),
    createdLabel: relativeLabel(run.createdAt),
    errorCode: run.errorCode,
    errorMessage: run.errorMessage,
    id: run.id,
    liveUrl: run.liveUrl,
    number,
    status: run.status,
    targetKind: run.targetKind,
  };
}

function toRunVMs(runs: AppDeploymentRun[]): DeploymentRunVM[] {
  let liveSeen = false;

  return runs.map((run, index) => {
    const superseded = run.status === "success" && liveSeen;
    liveSeen = liveSeen || run.status === "success";
    const vm = toRunVM(run, runs.length - index);

    return superseded ? { ...vm, liveUrl: null, status: "superseded" } : vm;
  });
}

function toDeploymentVM(appName: string, deployment: AppDeployment): DeploymentVM {
  return {
    appName,
    defaultBranch: deployment.defaultBranch,
    liveUrl: deployment.liveUrl,
    repoUrl: stripProtocol(deployment.repoUrl),
    subdomain: deployment.liveUrl === null ? null : hostOf(deployment.liveUrl),
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

  return {
    agents,
    deployment: toDeploymentVM(overview.appName, deployment),
    runs: toRunVMs(sourceRuns),
  };
}
