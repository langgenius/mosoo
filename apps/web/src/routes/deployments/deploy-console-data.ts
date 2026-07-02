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
 * Known backend gap (the v0 differentiator): `AppOverviewAgent` does not yet
 * carry the injected public-thread URL. The per-agent `envVar` / `threadUrl`
 * binding below is what the planned `.mosoo.toml [[agents]]` section feeds into
 * the deployment env. See docs/prd/app-deployment.md.
 */

export type AgentExposure = "public_thread";

export interface BoundAgentVM {
  /** Mosoo agent id, e.g. "agt_3kf". */
  id: string;
  name: string;
  expose: AgentExposure;
  /** Env var injected into the deployed Worker, e.g. "ROADMAP_THREAD_URL". */
  envVar: string;
  /**
   * Public Thread API base the env var resolves to. `null` for live bindings:
   * the real value is a per-deploy self-authorizing capability URL minted at
   * deploy time and not surfaced by `appOverview`.
   */
  threadUrl: string | null;
}

/** Run status plus the console-only "superseded" display state for old runs. */
export type DeploymentRunDisplayStatus = AppDeploymentRunStatus | "superseded";

/** Short console labels for the detected deploy target. */
export const DEPLOY_TARGET_LABELS: Record<AppDeploymentTargetKind, string> = {
  cloudflare_pages: "static",
  cloudflare_worker: "worker",
};

export interface DeploymentRunVM {
  id: string;
  /** Monotonic deploy number shown as "#4" — oldest run is #1. */
  number: number;
  /** Short commit sha of the default-branch HEAD that was deployed. */
  commitSha: string;
  /** Detected deploy target; `null` while detection has not run yet. */
  targetKind: AppDeploymentTargetKind | null;
  status: DeploymentRunDisplayStatus;
  /** Relative time label, e.g. "just now", "3h", "1d". */
  createdLabel: string;
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
   * Mosoo-managed URL the app is served from. `null` until a run has succeeded
   * — the console never shows a reserved/planned URL before the first deploy.
   */
  liveUrl: string | null;
  subdomain: string | null;
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
  subdomain: "roadmap-board.apps.mosoo.ai",
  liveUrl: "https://roadmap-board.apps.mosoo.ai",
} as const;

const DEPLOY_CONSOLE_AGENTS: BoundAgentVM[] = [
  {
    id: "agt_3kf",
    name: "roadmap",
    expose: "public_thread",
    envVar: "ROADMAP_THREAD_URL",
    threadUrl: "https://api.mosoo.ai/api/v1/agents/agt_3kf/threads",
  },
  {
    id: "agt_9wz",
    name: "triage",
    expose: "public_thread",
    envVar: "TRIAGE_THREAD_URL",
    threadUrl: "https://api.mosoo.ai/api/v1/agents/agt_9wz/threads",
  },
];

/** The seeded "happy path" scenario shown on first load — matches the wireframe. */
export function createDeployConsoleFixture(): DeployConsoleState {
  const { appName, repoUrl, defaultBranch, subdomain, liveUrl } = DEPLOY_APP_IDENTITY;

  return {
    deployment: {
      appName,
      repoUrl,
      defaultBranch,
      liveUrl,
      subdomain,
    },
    agents: DEPLOY_CONSOLE_AGENTS,
    runs: [
      {
        id: "run_4",
        number: 4,
        commitSha: "a91c3f",
        targetKind: "cloudflare_worker",
        status: "success",
        createdLabel: "just now",
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
        createdLabel: "3h",
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
        createdLabel: "1d",
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
        createdLabel: "2d",
        liveUrl: null,
        errorCode: null,
        errorMessage: null,
      },
    ],
  };
}
