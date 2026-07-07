import type { DeploymentRunVM } from "./deploy-console-data";
import { appNamespaceAgentCurl, appNamespaceAgentPath } from "./deploy-console-mapping";

/**
 * Fixture view models for the "instance" scenario of the `/v0-deploy-preview`
 * design prototype: the deployed agents of one repo, presented as a flat LIST
 * you expand in place to read a single agent's ADDRESS (its code-first door),
 * with the repo-level deployment ACTIVITY shown once below the list.
 *
 * Each agent is one of exactly two kinds — an `agent` (an API-addressed agent
 * with a name-addressed create-thread endpoint) or a `web` (an attached web
 * frontend, reached by URL, no curl). The ACTIVITY feed is a single shared set
 * of {@link DeploymentRunVM} rows because deployment is organized around the
 * REPO: one deploy provisions every agent, so its history belongs at repo level
 * (fed to the same web-console `ActivitySection`), not duplicated per agent.
 *
 * These live only on the unauthenticated prototype, have no backend seam, and
 * are never mapped from a GraphQL payload.
 */

/**
 * Lifecycle of an agent, framed as hibernate/wake rather than a static
 * "running": `live` = awake and serving; `idle` = asleep, wakes on the next
 * call, no compute cost while it sleeps.
 */
export type AgentInstanceLifecycle = "idle" | "live";

/**
 * The two kinds of deployed surface: `agent` = an API-addressed agent (has an
 * {@link AgentInstanceEndpoint}); `web` = an attached web frontend (has a `url`).
 */
export type AgentInstanceType = "agent" | "web";

/** Name-addressed API surface a caller hits to drive an `agent`-type instance. */
export interface AgentInstanceEndpoint {
  /** Full method + URL for the create-thread call, e.g. "POST https://…/threads". */
  threadsPath: string;
  /** Copy-ready multi-line curl carrying a PAT bearer, ready to run as-is. */
  curl: string;
  /** Where a caller mints a personal access token. */
  tokenSettingsPath: string;
}

/**
 * One deployed agent in the list. An `agent` carries an {@link endpoint}; a
 * `web` carries a live {@link url}. Only one of the two is ever set.
 */
export interface AgentInstanceFixture {
  /** Stable id the list expands a row by. */
  id: string;
  name: string;
  type: AgentInstanceType;
  slug: string;
  version: number;
  /** Whether the instance is awake (`live`) or asleep (`idle`). */
  lifecycle: AgentInstanceLifecycle;
  /** The code-first door — set for `type: "agent"`. */
  endpoint?: AgentInstanceEndpoint;
  /** The live web-frontend URL — set for `type: "web"`. */
  url?: string;
}

/** The prototype's demo origin — the name-addressed public API host. */
const TRY_ORIGIN = "https://try.mosoo.ai";

/** All demo agents live under one App namespace, addressed by name. */
const APP_SLUG = "roadmap-agents";

/** Web frontend attached under the App — the one `web`-type instance. */
const DIGEST_WEB_URL = "https://digest.apps.mosoo.ai";

/** Builds the name-addressed endpoint bundle for one agent under the App namespace. */
function buildEndpoint(agentName: string): AgentInstanceEndpoint {
  const apiUrl = `${TRY_ORIGIN}${appNamespaceAgentPath(APP_SLUG, agentName)}`;

  return {
    curl: appNamespaceAgentCurl(TRY_ORIGIN, APP_SLUG, agentName),
    threadsPath: `POST ${apiUrl}`,
    tokenSettingsPath: "/settings/access-tokens",
  };
}

/**
 * The demo agent list: two `agent`-type instances (one live, one idle) and one
 * `web`-type instance (live). Most-active first.
 */
export const AGENT_INSTANCE_AGENTS: AgentInstanceFixture[] = [
  {
    endpoint: buildEndpoint("quiz-master"),
    id: "quiz-master",
    lifecycle: "live",
    name: "quiz-master",
    slug: APP_SLUG,
    type: "agent",
    version: 4,
  },
  {
    endpoint: buildEndpoint("triage-helper"),
    id: "triage-helper",
    lifecycle: "idle",
    name: "triage-helper",
    slug: APP_SLUG,
    type: "agent",
    version: 2,
  },
  {
    id: "digest-writer",
    lifecycle: "live",
    name: "digest-writer",
    slug: APP_SLUG,
    type: "web",
    url: DIGEST_WEB_URL,
    version: 6,
  },
];

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

function isoAgo(deltaMs: number): string {
  return new Date(Date.now() - deltaMs).toISOString();
}

/**
 * The repo-level deployment history, newest first, fed verbatim to the web
 * console's `ActivitySection`. One deploy provisions the whole repo, so each
 * run touches every agent: a live deploy, a failed validate (so the reused
 * failure expansion shows), and a superseded first create.
 */
export const INSTANCE_RUNS: DeploymentRunVM[] = [
  {
    commitSha: "a3f9c1",
    createdAt: isoAgo(2 * HOUR_MS),
    errorCode: null,
    errorMessage: null,
    id: "repo_r3",
    liveUrl: DIGEST_WEB_URL,
    native: {
      agentCount: 3,
      agents: [
        { action: "updated", exposed: true, name: "quiz-master", versionNumber: 4 },
        { action: "updated", exposed: true, name: "triage-helper", versionNumber: 2 },
        { action: "updated", exposed: true, name: "digest-writer", versionNumber: 6 },
      ],
      failures: [],
      specVersion: "mosoo.spec.v1",
      webAgent: "digest-writer",
      webDeclared: true,
    },
    number: 3,
    status: "success",
    targetKind: "cloudflare_worker",
  },
  {
    commitSha: "77b0de",
    createdAt: isoAgo(26 * HOUR_MS),
    errorCode: "native_validation_failed",
    errorMessage: "Validation failed · 1 blocking failure · nothing was deployed.",
    id: "repo_r2",
    liveUrl: null,
    native: {
      agentCount: 3,
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
      webDeclared: true,
    },
    number: 2,
    status: "failed",
    targetKind: null,
  },
  {
    commitSha: "1c2d3e",
    createdAt: isoAgo(5 * DAY_MS),
    errorCode: null,
    errorMessage: null,
    id: "repo_r1",
    liveUrl: null,
    native: {
      agentCount: 3,
      agents: [
        { action: "created", exposed: true, name: "quiz-master", versionNumber: 1 },
        { action: "created", exposed: true, name: "triage-helper", versionNumber: 1 },
        { action: "created", exposed: true, name: "digest-writer", versionNumber: 1 },
      ],
      failures: [],
      specVersion: "mosoo.spec.v1",
      webAgent: "digest-writer",
      webDeclared: true,
    },
    number: 1,
    status: "superseded",
    targetKind: "cloudflare_worker",
  },
];
