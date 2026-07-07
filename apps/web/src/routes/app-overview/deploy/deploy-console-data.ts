import type { AppDeploymentRunStatus, AppDeploymentTargetKind } from "@mosoo/contracts/app";

/**
 * View models for the Deploy surface of the App Overview ("/") and its
 * fixture-backed acceptance page (`/v0-deploy-preview`).
 *
 * These mirror the real backend contracts in `@mosoo/contracts/app`
 * (`AppOverview`, `AppDeployment`, `AppDeploymentRun`) but keep ids as plain
 * strings because the fixture surface has no real ids.
 *
 * GraphQL seam — the live page maps resolver payloads into these VMs via
 * {@link file://./deploy-console-mapping.ts}:
 *   - query  `appOverview(appId)`          -> DeploymentVM + BoundAgentVM[]
 *   - query  `appDeploymentRunList(appId)` -> DeploymentRunVM[]
 *   - mutate `deployApp(input)`            -> deploy / redeploy / retry
 *   - mutate `deleteAppDeployment(input)`  -> delete (App deployment + Worker + bindings)
 *
 * The injected public-thread capability URL is minted per deploy and is NOT
 * surfaced by `appOverview` (see docs/prd/app-deployment.md), so the console
 * shows only the binding's env var name, never a URL.
 */

export type AgentExposure = "public_thread";

export interface BoundAgentVM {
  /** Mosoo agent id, e.g. "agt_3kf". */
  id: string;
  name: string;
  expose: AgentExposure;
  /** Env var injected into the deployed Worker, e.g. "ROADMAP_THREAD_URL". */
  envVar: string;
}

/** Run status plus the console-only "superseded" display state for old runs. */
export type DeploymentRunDisplayStatus = AppDeploymentRunStatus | "superseded";

/** Short console labels for the detected deploy target. */
export const DEPLOY_TARGET_LABELS: Record<AppDeploymentTargetKind, string> = {
  agent_only: "agent api",
  cloudflare_pages: "static",
  cloudflare_worker: "worker",
};

export interface DeploymentRunVM {
  id: string;
  /**
   * Deploy number shown as "#4", counted from the oldest fetched run (#1)
   * within the run-list window (the server caps the list at 50). `null` while
   * only the overview's embedded latest run is available — a lone run cannot
   * know its place in history, so the console shows no number over a wrong one.
   */
  number: number | null;
  /** Short commit sha of the default-branch HEAD that was deployed. */
  commitSha: string;
  /** Detected deploy target; `null` while detection has not run yet. */
  targetKind: AppDeploymentTargetKind | null;
  status: DeploymentRunDisplayStatus;
  /** ISO timestamp the run was created — formatted relative at render time. */
  createdAt: string;
  liveUrl: string | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface DeploymentVM {
  appName: string;
  /** Public GitHub repo (source of truth), e.g. "github.com/me/roadmap-board". */
  repoUrl: string;
  defaultBranch: string;
  /**
   * Mosoo-managed production URL reserved for this deployment. It may exist
   * before a deploy succeeds, so the console can show the production pipe
   * independently from the current run status.
   */
  plannedUrl: string | null;
  /**
   * Mosoo-managed URL currently serving production traffic. `null` until a run
   * has reached the live state.
   */
  liveUrl: string | null;
}

export interface DeployConsoleState {
  deployment: DeploymentVM | null;
  runs: DeploymentRunVM[];
  agents: BoundAgentVM[];
}

/** App identity is retained across delete so a subsequent deploy can restore it. */
export const DEPLOY_APP_IDENTITY = {
  appId: "01DEMO0APP0000000000000000",
  appName: "roadmap-board",
  repoUrl: "github.com/me/roadmap-board",
  defaultBranch: "main",
  plannedUrl: "https://roadmap-board.apps.mosoo.ai",
  liveUrl: "https://roadmap-board.apps.mosoo.ai",
} as const;

const DEPLOY_CONSOLE_AGENTS: BoundAgentVM[] = [
  { id: "agt_3kf", name: "roadmap", expose: "public_thread", envVar: "ROADMAP_THREAD_URL" },
  { id: "agt_9wz", name: "triage", expose: "public_thread", envVar: "TRIAGE_THREAD_URL" },
];

function isoAgo(deltaMs: number): string {
  return new Date(Date.now() - deltaMs).toISOString();
}

/** The seeded "happy path" scenario shown on first load — matches the wireframe. */
export function createDeployConsoleFixture(): DeployConsoleState {
  const { appName, repoUrl, defaultBranch, plannedUrl, liveUrl } = DEPLOY_APP_IDENTITY;

  return {
    deployment: {
      appName,
      repoUrl,
      defaultBranch,
      plannedUrl,
      liveUrl,
    },
    agents: DEPLOY_CONSOLE_AGENTS,
    runs: [
      {
        id: "run_4",
        number: 4,
        commitSha: "a91c3f",
        targetKind: "cloudflare_worker",
        status: "success",
        createdAt: isoAgo(30_000),
        liveUrl,
        errorCode: null,
        errorMessage: null,
      },
      {
        id: "run_3",
        number: 3,
        commitSha: "7d20ab",
        targetKind: "cloudflare_worker",
        status: "superseded",
        createdAt: isoAgo(3 * 3_600_000),
        liveUrl: null,
        errorCode: null,
        errorMessage: null,
      },
      {
        id: "run_2",
        number: 2,
        commitSha: "1188ee",
        targetKind: "cloudflare_worker",
        status: "superseded",
        createdAt: isoAgo(26 * 3_600_000),
        liveUrl: null,
        errorCode: null,
        errorMessage: null,
      },
      {
        id: "run_1",
        number: 1,
        commitSha: "c0ffee",
        targetKind: "cloudflare_worker",
        status: "superseded",
        createdAt: isoAgo(50 * 3_600_000),
        liveUrl: null,
        errorCode: null,
        errorMessage: null,
      },
    ],
  };
}
