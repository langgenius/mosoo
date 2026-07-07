import type { AppDeploymentRunStatus, AppDeploymentTargetKind } from "@mosoo/contracts/app";
import type {
  NativeValidateFailureCode,
  NativeValidateSeverity,
} from "@mosoo/contracts/native-deployment";
import type { NativeAgentProvisionAction } from "@mosoo/contracts/native-deployment-run";

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

/** Per-agent provisioning outcome of a protocol deploy, flattened for display. */
export interface NativeRunAgentVM {
  action: NativeAgentProvisionAction;
  /** True when the agent is in the repo's expose subset. */
  exposed: boolean;
  name: string;
  /** Minted DeploymentVersion number; the key is omitted when none was minted. */
  versionNumber?: number;
}

/** One validate failure, rendered verbatim in repo terms in the run details. */
export interface NativeRunFailureVM {
  /** Repairable instruction in repo terms. */
  action: string;
  code: NativeValidateFailureCode;
  /** Dotted field path when known; the key is omitted when unknown. */
  field?: string;
  /** Repo-relative path, e.g. ".agent/manifest.json". */
  file: string;
  /** Why the current value is illegal. */
  problem: string;
  severity: NativeValidateSeverity;
}

/**
 * Protocol-path facts of a run (mosoo-native deploys): what detection named,
 * per-agent provisioning outcomes, and validate failures in repo terms.
 * `null` on legacy runs that never took the protocol branch.
 */
export interface NativeRunVM {
  /** Detected agent count; `null` when the repo marker never parsed. */
  agentCount: number | null;
  /** Per-agent provisioning outcomes; empty until provisioning ran. */
  agents: NativeRunAgentVM[];
  failures: NativeRunFailureVM[];
  /** Protocol spec string, e.g. "mosoo.spec.v1"; `null` when never parsed. */
  specVersion: string | null;
  /** Resolved web-bound agent name; the key is omitted when none. */
  webAgent?: string;
  webDeclared: boolean;
}

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
  /**
   * Detected deploy target; `null` while detection has not run yet. The server
   * never emits "agent_only" on run rows — the mapping layer derives it from
   * the native facts (provisioning ran and the repo declared no web surface).
   */
  targetKind: AppDeploymentTargetKind | null;
  status: DeploymentRunDisplayStatus;
  /** ISO timestamp the run was created — formatted relative at render time. */
  createdAt: string;
  liveUrl: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  /** Protocol-path run facts; `null` on legacy (non-native) runs. */
  native: NativeRunVM | null;
}

/** "mosoo.spec.v1" → "mosoo-native v1" (unfamiliar suffixes pass through raw). */
function nativeSpecLabel(specVersion: string): string {
  const prefix = "mosoo.spec.";
  const version = specVersion.startsWith(prefix) ? specVersion.slice(prefix.length) : specVersion;

  return `mosoo-native ${version}`;
}

/**
 * The Changes-cell target line: what detection actually named, never a
 * placeholder. Native runs read `mosoo-native v1 · agent api · 2 agents`
 * (parts drop out while unknown); legacy runs read the target label alone, and
 * a legacy run with no target falls back to its error code or "—".
 */
export function deployTargetLine(run: DeploymentRunVM): string {
  const parts: string[] = [];

  if (run.native !== null && run.native.specVersion !== null) {
    parts.push(nativeSpecLabel(run.native.specVersion));
  }
  if (run.targetKind !== null) {
    parts.push(DEPLOY_TARGET_LABELS[run.targetKind]);
  }
  if (run.native !== null && run.native.agentCount !== null) {
    const { agentCount } = run.native;
    parts.push(`${String(agentCount)} agent${agentCount === 1 ? "" : "s"}`);
  }
  if (parts.length > 0) {
    return parts.join(" · ");
  }

  return run.errorCode ?? "—";
}

export interface DeploymentVM {
  appName: string;
  /**
   * Instance-global API namespace slug, minted at the App's first protocol
   * deploy; `null` for legacy/console apps that are not name-routable. Drives
   * the name-addressed `/api/v1/apps/{slug}` Connect surface.
   */
  slug: string | null;
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

/**
 * Exposure states of the acceptance page (`/v0-deploy-preview`): the legacy
 * web-only pipe, the two protocol-path green states, and the protocol-path
 * red state whose validate failures render in repo terms.
 */
export type DeployConsoleScenario = "agent-only" | "native-red" | "web" | "web-and-agents";

const WEB_AND_AGENTS_NATIVE: NativeRunVM = {
  agentCount: 2,
  agents: [
    { action: "updated", exposed: true, name: "roadmap", versionNumber: 3 },
    { action: "unchanged", exposed: true, name: "triage" },
  ],
  failures: [],
  specVersion: "mosoo.spec.v1",
  webAgent: "roadmap",
  webDeclared: true,
};

const AGENT_ONLY_NATIVE: NativeRunVM = {
  agentCount: 2,
  agents: [
    { action: "created", exposed: true, name: "quiz-master", versionNumber: 1 },
    { action: "unchanged", exposed: true, name: "triage-helper" },
  ],
  failures: [],
  specVersion: "mosoo.spec.v1",
  webDeclared: false,
};

const AGENT_ONLY_FIRST_NATIVE: NativeRunVM = {
  agentCount: 1,
  agents: [{ action: "created", exposed: true, name: "triage-helper", versionNumber: 1 }],
  failures: [],
  specVersion: "mosoo.spec.v1",
  webDeclared: false,
};

const NATIVE_RED_NATIVE: NativeRunVM = {
  agentCount: 2,
  agents: [],
  failures: [
    {
      action: "add .agent/agents/quiz-master/manifest.json with name, runtime and model",
      code: "native.agent.manifest_missing",
      file: ".agent/agents/quiz-master/manifest.json",
      problem: "manifest file is missing",
      severity: "error",
    },
    {
      action: "set expose.agents to agent directories under .agent/agents/",
      code: "native.expose.agent_unknown",
      field: "expose.agents",
      file: ".mosoo.toml",
      problem: '"quiz-mastr" does not match any agent directory',
      severity: "error",
    },
    {
      action: "add OPENAI_API_KEY in Console → Environment before agents can run",
      code: "native.setup.environment_secret",
      field: "OPENAI_API_KEY",
      file: ".agent/environment/definition.json",
      problem: "secret is declared but has no value on this instance",
      severity: "setup_required",
    },
  ],
  specVersion: "mosoo.spec.v1",
  webDeclared: false,
};

/** Run-level terminal error of the native-red scenario (mirrors the server codes). */
const NATIVE_RED_RUN_ERROR = {
  errorCode: "native_validation_failed",
  errorMessage: "Validation failed · 2 blocking failures · nothing was deployed.",
} as const;

function isoAgo(deltaMs: number): string {
  return new Date(Date.now() - deltaMs).toISOString();
}

function webFixture(): DeployConsoleState {
  const { appName, repoUrl, defaultBranch, plannedUrl, liveUrl } = DEPLOY_APP_IDENTITY;

  return {
    deployment: {
      appName,
      // Legacy web-only deploy: it never took the protocol branch, so no
      // namespace slug was minted and the app is not name-routable.
      slug: null,
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
        native: null,
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
        native: null,
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
        native: null,
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
        native: null,
      },
    ],
  };
}

function agentOnlyFixture(): DeployConsoleState {
  return {
    deployment: {
      appName: DEPLOY_APP_IDENTITY.appName,
      slug: "quiz-agents",
      repoUrl: "github.com/me/quiz-agents",
      defaultBranch: "main",
      plannedUrl: null,
      liveUrl: null,
    },
    // Agent-only deploys produce no Worker, so there are no env-var bindings.
    agents: [],
    runs: [
      {
        id: "run_2",
        number: 2,
        commitSha: "b7e11a",
        targetKind: "agent_only",
        status: "success",
        createdAt: isoAgo(120_000),
        liveUrl: null,
        errorCode: null,
        errorMessage: null,
        native: AGENT_ONLY_NATIVE,
      },
      {
        id: "run_1",
        number: 1,
        commitSha: "9d41c2",
        targetKind: "agent_only",
        status: "superseded",
        createdAt: isoAgo(27 * 3_600_000),
        liveUrl: null,
        errorCode: null,
        errorMessage: null,
        native: AGENT_ONLY_FIRST_NATIVE,
      },
    ],
  };
}

function webAndAgentsFixture(): DeployConsoleState {
  const { appName, repoUrl, defaultBranch, plannedUrl, liveUrl } = DEPLOY_APP_IDENTITY;

  return {
    deployment: { appName, slug: "roadmap-board", repoUrl, defaultBranch, plannedUrl, liveUrl },
    agents: DEPLOY_CONSOLE_AGENTS,
    runs: [
      {
        id: "run_5",
        number: 5,
        commitSha: "f3c2d1",
        targetKind: "cloudflare_worker",
        status: "success",
        createdAt: isoAgo(90_000),
        liveUrl,
        errorCode: null,
        errorMessage: null,
        native: WEB_AND_AGENTS_NATIVE,
      },
      {
        id: "run_4",
        number: 4,
        commitSha: "a91c3f",
        targetKind: "cloudflare_worker",
        status: "superseded",
        createdAt: isoAgo(5 * 3_600_000),
        liveUrl: null,
        errorCode: null,
        errorMessage: null,
        native: null,
      },
    ],
  };
}

function nativeRedFixture(): DeployConsoleState {
  const { appName, repoUrl, defaultBranch, plannedUrl, liveUrl } = DEPLOY_APP_IDENTITY;

  return {
    // The bad push never went live: production still serves the last success.
    deployment: { appName, slug: "roadmap-board", repoUrl, defaultBranch, plannedUrl, liveUrl },
    agents: DEPLOY_CONSOLE_AGENTS,
    runs: [
      {
        id: "run_6",
        number: 6,
        commitSha: "e4d909",
        targetKind: null,
        status: "failed",
        createdAt: isoAgo(45_000),
        liveUrl: null,
        errorCode: NATIVE_RED_RUN_ERROR.errorCode,
        errorMessage: NATIVE_RED_RUN_ERROR.errorMessage,
        native: NATIVE_RED_NATIVE,
      },
      {
        id: "run_5",
        number: 5,
        commitSha: "f3c2d1",
        targetKind: "cloudflare_worker",
        status: "success",
        createdAt: isoAgo(4 * 3_600_000),
        liveUrl,
        errorCode: null,
        errorMessage: null,
        native: WEB_AND_AGENTS_NATIVE,
      },
    ],
  };
}

/**
 * Seeded state per acceptance scenario. "web" is the original happy path from
 * the wireframe; the other three walk the protocol-path exposure states.
 */
export function createDeployConsoleFixture(
  scenario: DeployConsoleScenario = "web",
): DeployConsoleState {
  switch (scenario) {
    case "agent-only":
      return agentOnlyFixture();
    case "native-red":
      return nativeRedFixture();
    case "web":
      return webFixture();
    case "web-and-agents":
      return webAndAgentsFixture();
  }
}

/**
 * Terminal run fields the fixture simulation applies when a simulated deploy
 * completes, so a walked run lands exactly on the scenario's seeded shape.
 */
export function scenarioTerminalRun(
  scenario: DeployConsoleScenario,
): Pick<
  DeploymentRunVM,
  "errorCode" | "errorMessage" | "liveUrl" | "native" | "status" | "targetKind"
> {
  switch (scenario) {
    case "agent-only":
      return {
        errorCode: null,
        errorMessage: null,
        liveUrl: null,
        native: AGENT_ONLY_NATIVE,
        status: "success",
        targetKind: "agent_only",
      };
    case "native-red":
      return {
        errorCode: NATIVE_RED_RUN_ERROR.errorCode,
        errorMessage: NATIVE_RED_RUN_ERROR.errorMessage,
        liveUrl: null,
        native: NATIVE_RED_NATIVE,
        status: "failed",
        targetKind: null,
      };
    case "web":
      return {
        errorCode: null,
        errorMessage: null,
        liveUrl: DEPLOY_APP_IDENTITY.liveUrl,
        native: null,
        status: "success",
        targetKind: "cloudflare_worker",
      };
    case "web-and-agents":
      return {
        errorCode: null,
        errorMessage: null,
        liveUrl: DEPLOY_APP_IDENTITY.liveUrl,
        native: WEB_AND_AGENTS_NATIVE,
        status: "success",
        targetKind: "cloudflare_worker",
      };
  }
}
