import type { DeploymentRunVM } from "./deploy-console-data";
import {
  appNamespaceAgentCurl,
  appNamespaceAgentPath,
  appNamespaceBasePath,
} from "./deploy-console-mapping";

/**
 * Fixture view models for the "agent instance" reframing of the Overview: a
 * published, non-web agent presented as a persistent COMPUTE INSTANCE you own
 * and operate. The surface is a DASHBOARD → AGENT LIST → per-agent DETAIL flow.
 *
 * Each instance has a lifecycle (awake / idle-sleeping, wakes in seconds, state
 * preserved), an ADDRESS (the code-first door, the spine of the detail page),
 * an ACTIVITY log (the SAME deployment-run history the web console renders — fed
 * as {@link DeploymentRunVM} rows), EXPOSED SURFACES (web is a 0-or-1
 * attachment, not the identity), CHECKPOINTS (versions you can roll back to),
 * and a light meter strip. These live only on the unauthenticated
 * `/v0-deploy-preview` design prototype and back {@link AGENT_INSTANCE_AGENTS};
 * they have no backend seam and are never mapped from a GraphQL payload.
 */

/**
 * Lifecycle of the instance, framed as hibernate/wake rather than a static
 * "running": `live` = awake and serving; `idle` = asleep, wakes on the next
 * call, no compute cost while it sleeps.
 */
export type AgentInstanceLifecycle = "idle" | "live";

/** Name-addressed API surface a caller hits to drive the instance (its "IP"). */
export interface AgentInstanceEndpoint {
  /** Full method + URL for the create-thread call, e.g. "POST https://…/threads". */
  threadsPath: string;
  /** Bare create-thread URL (no method prefix) — the exposed "api" surface. */
  apiUrl: string;
  /** A one-line "shell into it" command carrying a PAT bearer (mirrors `oc shell`). */
  shellCommand: string;
  /** Copy-ready multi-line curl carrying a PAT bearer, mirroring the Connect card. */
  curl: string;
  /** The App-level OpenAPI document URL — doubles as the "Docs" pointer. */
  openapiUrl: string;
  /** Where a caller mints a personal access token. */
  tokenSettingsPath: string;
}

/**
 * The instance's exposed surfaces — what a caller can reach. The API is always
 * on; the web frontend is a single optional attachment (`webUrl === null` when
 * nothing is attached), reinforcing "web is an attachment, not the identity".
 */
export interface AgentInstanceExposed {
  /** The always-on API surface — the create-thread URL. */
  apiUrl: string;
  /** The attached web frontend, or `null` when none is attached. */
  webUrl: string | null;
}

/** One rollback point — a published version you can restore the instance to. */
export interface AgentInstanceCheckpoint {
  id: string;
  /** Version number, e.g. 4 for "v4". */
  version: number;
  /** Relative label for when it went live, e.g. "2h ago". */
  when: string;
  /** True for the version currently serving traffic. */
  live: boolean;
}

/**
 * The whole fixture one instance renders — its lifecycle, address, exposed
 * surfaces, rollback points, and the deployment-run rows its Activity section
 * reuses from the web console.
 */
export interface AgentInstanceFixture {
  /** Stable id the dashboard selects a row by. */
  id: string;
  name: string;
  slug: string;
  liveVersion: number;
  /** Whether the instance is awake (`live`) or asleep (`idle`). */
  lifecycle: AgentInstanceLifecycle;
  /** Cold-wake latency shown when idle, e.g. "~1.2s". */
  wakesIn: string;
  /** Aggregate spend today, formatted, e.g. "$0.42". */
  todayCost: string;
  /** Numeric spend today, summed into the dashboard "Spend today" tile. */
  todaySpend: number;
  /** Count behind the "Sessions today" meter. */
  sessionsToday: number;
  /** Relative "last active" label for the dashboard row, e.g. "2m". */
  lastActive: string;
  endpoint: AgentInstanceEndpoint;
  exposed: AgentInstanceExposed;
  /** Rollback points, newest first (the live version leads). */
  checkpoints: AgentInstanceCheckpoint[];
  /**
   * Deployment-run rows feeding the reused web Activity section, newest first.
   * Shaped as {@link DeploymentRunVM} so `DeploymentsHistory` renders them
   * verbatim (status, commit, detection line, provisioning + failure rows).
   */
  runs: DeploymentRunVM[];
  /** Small per-hour spend series for the meter-strip sparkline (unitless, relative). */
  costTrend: number[];
}

/** The prototype's demo origin — the name-addressed public API host. */
const TRY_ORIGIN = "https://try.mosoo.ai";

/** All three demo agents live under one App namespace, addressed by name. */
const APP_SLUG = "roadmap-agents";

/** The App-level OpenAPI document URL — shared by every agent on the App. */
const OPENAPI_URL = `${TRY_ORIGIN}${appNamespaceBasePath(APP_SLUG)}/openapi.json`;

/** Builds the name-addressed endpoint bundle for one agent under the App namespace. */
function buildEndpoint(agentName: string): AgentInstanceEndpoint {
  const apiUrl = `${TRY_ORIGIN}${appNamespaceAgentPath(APP_SLUG, agentName)}`;

  return {
    apiUrl,
    curl: appNamespaceAgentCurl(TRY_ORIGIN, APP_SLUG, agentName),
    openapiUrl: OPENAPI_URL,
    shellCommand: `curl -sX POST ${apiUrl} -H "Authorization: Bearer $MOSOO_API_TOKEN"`,
    threadsPath: `POST ${apiUrl}`,
    tokenSettingsPath: "/settings/access-tokens",
  };
}

function isoAgo(deltaMs: number): string {
  return new Date(Date.now() - deltaMs).toISOString();
}

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * "quiz-master" — the live headliner on v4: $0.42 spent today, api-only (no web
 * attached). Its Activity carries a live deploy, a failed validate (so the
 * detail page shows the reused failure expansion), and a superseded success.
 */
const QUIZ_MASTER: AgentInstanceFixture = {
  id: "quiz-master",
  name: "quiz-master",
  slug: APP_SLUG,
  liveVersion: 4,
  lifecycle: "live",
  wakesIn: "~1.2s",
  todayCost: "$0.42",
  todaySpend: 0.42,
  sessionsToday: 9,
  lastActive: "2m",
  endpoint: buildEndpoint("quiz-master"),
  exposed: {
    apiUrl: `${TRY_ORIGIN}${appNamespaceAgentPath(APP_SLUG, "quiz-master")}`,
    webUrl: null,
  },
  checkpoints: [
    { id: "qm-v4", version: 4, when: "2h ago", live: true },
    { id: "qm-v3", version: 3, when: "yesterday", live: false },
    { id: "qm-v2", version: 2, when: "5d ago", live: false },
  ],
  runs: [
    {
      id: "qm_r4",
      number: 4,
      commitSha: "a3f9c1",
      targetKind: "agent_only",
      status: "success",
      createdAt: isoAgo(2 * HOUR_MS),
      liveUrl: null,
      errorCode: null,
      errorMessage: null,
      native: {
        agentCount: 1,
        agents: [{ action: "updated", exposed: true, name: "quiz-master", versionNumber: 4 }],
        failures: [],
        specVersion: "mosoo.spec.v1",
        webDeclared: false,
      },
    },
    {
      id: "qm_r3",
      number: 3,
      commitSha: "77b0de",
      targetKind: null,
      status: "failed",
      createdAt: isoAgo(26 * HOUR_MS),
      liveUrl: null,
      errorCode: "native_validation_failed",
      errorMessage: "Validation failed · 1 blocking failure · nothing was deployed.",
      native: {
        agentCount: 1,
        agents: [],
        failures: [
          {
            action: "add .agent/agents/quiz-master/manifest.json with name, runtime and model",
            code: "native.agent.manifest_missing",
            file: ".agent/agents/quiz-master/manifest.json",
            problem: "manifest file is missing",
            severity: "error",
          },
        ],
        specVersion: "mosoo.spec.v1",
        webDeclared: false,
      },
    },
    {
      id: "qm_r2",
      number: 2,
      commitSha: "1c2d3e",
      targetKind: "agent_only",
      status: "superseded",
      createdAt: isoAgo(5 * DAY_MS),
      liveUrl: null,
      errorCode: null,
      errorMessage: null,
      native: {
        agentCount: 1,
        agents: [{ action: "created", exposed: true, name: "quiz-master", versionNumber: 2 }],
        failures: [],
        specVersion: "mosoo.spec.v1",
        webDeclared: false,
      },
    },
  ],
  costTrend: [3, 2, 4, 3, 6, 5, 8, 6, 9, 7, 11, 8],
};

/**
 * "triage-helper" — asleep on v2, cheap ($0.08 today), api-only. Two clean
 * deploys in its Activity (a live update over a superseded create).
 */
const TRIAGE_HELPER: AgentInstanceFixture = {
  id: "triage-helper",
  name: "triage-helper",
  slug: APP_SLUG,
  liveVersion: 2,
  lifecycle: "idle",
  wakesIn: "~0.9s",
  todayCost: "$0.08",
  todaySpend: 0.08,
  sessionsToday: 3,
  lastActive: "1h",
  endpoint: buildEndpoint("triage-helper"),
  exposed: {
    apiUrl: `${TRY_ORIGIN}${appNamespaceAgentPath(APP_SLUG, "triage-helper")}`,
    webUrl: null,
  },
  checkpoints: [
    { id: "th-v2", version: 2, when: "yesterday", live: true },
    { id: "th-v1", version: 1, when: "4d ago", live: false },
  ],
  runs: [
    {
      id: "th_r2",
      number: 2,
      commitSha: "b7e11a",
      targetKind: "agent_only",
      status: "success",
      createdAt: isoAgo(27 * HOUR_MS),
      liveUrl: null,
      errorCode: null,
      errorMessage: null,
      native: {
        agentCount: 1,
        agents: [{ action: "updated", exposed: true, name: "triage-helper", versionNumber: 2 }],
        failures: [],
        specVersion: "mosoo.spec.v1",
        webDeclared: false,
      },
    },
    {
      id: "th_r1",
      number: 1,
      commitSha: "9d41c2",
      targetKind: "agent_only",
      status: "superseded",
      createdAt: isoAgo(4 * DAY_MS),
      liveUrl: null,
      errorCode: null,
      errorMessage: null,
      native: {
        agentCount: 1,
        agents: [{ action: "created", exposed: true, name: "triage-helper", versionNumber: 1 }],
        failures: [],
        specVersion: "mosoo.spec.v1",
        webDeclared: false,
      },
    },
  ],
  costTrend: [1, 0, 2, 1, 3, 2, 1, 0, 2, 1, 2, 1],
};

/** Web frontend attached to "digest-writer" — the 1-of-1 exposed-surface case. */
const DIGEST_WEB_URL = "https://digest.apps.mosoo.ai";

/**
 * "digest-writer" — asleep on v6, idle today ($0 while it sleeps), and the one
 * agent WITH a web frontend attached (so Exposed surfaces shows the 1-of-1
 * case). Its Activity runs are worker deploys with a declared web surface.
 */
const DIGEST_WRITER: AgentInstanceFixture = {
  id: "digest-writer",
  name: "digest-writer",
  slug: APP_SLUG,
  liveVersion: 6,
  lifecycle: "idle",
  wakesIn: "~1.4s",
  todayCost: "$0.00",
  todaySpend: 0,
  sessionsToday: 0,
  lastActive: "3h",
  endpoint: buildEndpoint("digest-writer"),
  exposed: {
    apiUrl: `${TRY_ORIGIN}${appNamespaceAgentPath(APP_SLUG, "digest-writer")}`,
    webUrl: DIGEST_WEB_URL,
  },
  checkpoints: [
    { id: "dw-v6", version: 6, when: "3h ago", live: true },
    { id: "dw-v5", version: 5, when: "2d ago", live: false },
    { id: "dw-v4", version: 4, when: "6d ago", live: false },
  ],
  runs: [
    {
      id: "dw_r6",
      number: 6,
      commitSha: "f3c2d1",
      targetKind: "cloudflare_worker",
      status: "success",
      createdAt: isoAgo(3 * HOUR_MS),
      liveUrl: DIGEST_WEB_URL,
      errorCode: null,
      errorMessage: null,
      native: {
        agentCount: 1,
        agents: [{ action: "updated", exposed: true, name: "digest-writer", versionNumber: 6 }],
        failures: [],
        specVersion: "mosoo.spec.v1",
        webAgent: "digest-writer",
        webDeclared: true,
      },
    },
    {
      id: "dw_r5",
      number: 5,
      commitSha: "a91c3f",
      targetKind: "cloudflare_worker",
      status: "superseded",
      createdAt: isoAgo(2 * DAY_MS),
      liveUrl: null,
      errorCode: null,
      errorMessage: null,
      native: {
        agentCount: 1,
        agents: [{ action: "created", exposed: true, name: "digest-writer", versionNumber: 5 }],
        failures: [],
        specVersion: "mosoo.spec.v1",
        webAgent: "digest-writer",
        webDeclared: true,
      },
    },
  ],
  costTrend: [0, 0, 1, 0, 2, 1, 0, 0, 1, 0, 0, 0],
};

/**
 * The demo agent list backing the dashboard and the per-agent detail: one live
 * headliner and two idle instances, one of which carries an attached web
 * frontend. Newest/most-active first.
 */
export const AGENT_INSTANCE_AGENTS: AgentInstanceFixture[] = [
  QUIZ_MASTER,
  TRIAGE_HELPER,
  DIGEST_WRITER,
];
