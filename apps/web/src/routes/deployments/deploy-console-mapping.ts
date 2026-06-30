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
 * preview consoles render through the exact same components.
 *
 * v0 keeps only the latest run server-side, so {@link toDeployConsoleState}
 * yields at most one run and uses `1` as its display number.
 */

function stripProtocol(url: string): string {
  return url.replace(/^https?:\/\//, "");
}

function hostOf(url: string): string {
  return stripProtocol(url).split("/")[0] ?? stripProtocol(url);
}

function workerLabel(host: string): string {
  return host.split(".")[0] ?? host;
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

function toRunVM(run: AppDeploymentRun, host: string): DeploymentRunVM {
  return {
    commitSha: shortSha(run.sourceCommitSha),
    createdLabel: relativeLabel(run.createdAt),
    errorCode: run.errorCode,
    errorMessage: run.errorMessage,
    id: run.id,
    liveUrl: run.liveUrl,
    number: 1,
    status: run.status,
    targetKind: run.targetKind ?? "cloudflare_worker",
    workerName: workerLabel(host),
  };
}

function toDeploymentVM(appName: string, deployment: AppDeployment, host: string): DeploymentVM {
  return {
    appName,
    defaultBranch: deployment.defaultBranch,
    latestCommit:
      deployment.latestRun === null ? "—" : shortSha(deployment.latestRun.sourceCommitSha),
    latestNumber: 1,
    liveUrl: deployment.liveUrl ?? deployment.plannedUrl,
    repoUrl: stripProtocol(deployment.repoUrl),
    subdomain: host,
  };
}

export function toDeployConsoleState(overview: AppDeploymentOverview): DeployConsoleState {
  const agents = overview.boundAgents.map(toBoundAgentVM);
  const { deployment } = overview;

  if (deployment === null) {
    return { agents, deployment: null, runs: [] };
  }

  const host = hostOf(deployment.liveUrl ?? deployment.plannedUrl);

  return {
    agents,
    deployment: toDeploymentVM(overview.appName, deployment, host),
    runs: deployment.latestRun === null ? [] : [toRunVM(deployment.latestRun, host)],
  };
}
