import {
  appNamespaceAgentCurl,
  appNamespaceAgentPath,
  appNamespaceBasePath,
} from "./deploy-console-mapping";

/**
 * Fixture view models for the "agent instance" reframing of the Overview: a
 * published, non-web agent presented as a persistent COMPUTE INSTANCE you own
 * and operate. It has a lifecycle (awake / idle-sleeping, wakes in seconds,
 * state preserved), an ADDRESS (the code-first door), a WAY IN (the live
 * session console), EXPOSED SURFACES (web is a 0-or-1 attachment, not the
 * identity), CHECKPOINTS (versions you can roll back to), and a light meter.
 * These live only on the unauthenticated `/v0-deploy-preview` design prototype
 * and back {@link AGENT_INSTANCE_FIXTURE}; they have no backend seam and are
 * never mapped from a GraphQL payload.
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

/** One tool the agent invoked in a session turn — a chip in the "watch it work" feed. */
export interface AgentInstanceToolCall {
  id: string;
  /** Tool name shown as a mono function call, e.g. "query_db". */
  name: string;
  /** One-line argument/summary rendered under the chip. */
  detail: string;
  /** Per-call cost tick, formatted, e.g. "$0.004". */
  cost: string;
  /** "done" chips already ran; "pending-approval" chips await a human decision. */
  status: "done" | "pending-approval";
}

/** A single message in the session mock — the delegation or the agent's answer. */
export interface AgentInstanceSessionMessage {
  id: string;
  role: "agent" | "user";
  text: string;
}

/** The embedded live-feeling session: a delegation, the tool-call feed, the answer. */
export interface AgentInstanceSession {
  messages: AgentInstanceSessionMessage[];
  toolCalls: AgentInstanceToolCall[];
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

/** One recent session in the meter log (relative time · summary · cost · status). */
export interface AgentInstanceRecentSession {
  id: string;
  /** Relative "when" label, e.g. "2m". */
  when: string;
  /** One-line summary of what the session did. */
  summary: string;
  cost: string;
  status: "done" | "failed" | "running";
}

/** The whole fixture the panel renders — one instance, its lifecycle, surfaces, log. */
export interface AgentInstanceFixture {
  name: string;
  slug: string;
  liveVersion: number;
  /** Whether the instance is awake (`live`) or asleep (`idle`). */
  lifecycle: AgentInstanceLifecycle;
  /** Cold-wake latency shown when idle, e.g. "~1.2s". */
  wakesIn: string;
  /** Aggregate spend today, formatted, e.g. "$0.42". */
  todayCost: string;
  /** Count behind the "Sessions today" meter. */
  sessionsToday: number;
  endpoint: AgentInstanceEndpoint;
  session: AgentInstanceSession;
  exposed: AgentInstanceExposed;
  /** Rollback points, newest first (the live version leads). */
  checkpoints: AgentInstanceCheckpoint[];
  recentSessions: AgentInstanceRecentSession[];
  /** Small per-hour spend series for the meter-strip sparkline (unitless, relative). */
  costTrend: number[];
}

/** The prototype's demo origin — the name-addressed public API host. */
const TRY_ORIGIN = "https://try.mosoo.ai";

const INSTANCE_NAME = "quiz-master";
const INSTANCE_SLUG = "roadmap-agents";

/** The bare create-thread URL — the instance's addressable API surface. */
const AGENT_API_URL = `${TRY_ORIGIN}${appNamespaceAgentPath(INSTANCE_SLUG, INSTANCE_NAME)}`;

/**
 * A believable published-agent instance: "quiz-master" on slug "roadmap-agents",
 * awake on v4, $0.42 spent today, $0 while it sleeps. Its session mock shows a
 * delegation, three tool chips (two done, one pending human approval), and the
 * answer, so the panel can convey talk + watch + intervene without any session
 * plumbing. It exposes an API but no web frontend (web is a 0-or-1 attachment),
 * and carries three checkpoints you can roll back to.
 */
export const AGENT_INSTANCE_FIXTURE: AgentInstanceFixture = {
  name: INSTANCE_NAME,
  slug: INSTANCE_SLUG,
  liveVersion: 4,
  lifecycle: "live",
  wakesIn: "~1.2s",
  todayCost: "$0.42",
  sessionsToday: 9,
  endpoint: {
    threadsPath: `POST ${AGENT_API_URL}`,
    apiUrl: AGENT_API_URL,
    shellCommand: `curl -sX POST ${AGENT_API_URL} -H "Authorization: Bearer $MOSOO_API_TOKEN"`,
    curl: appNamespaceAgentCurl(TRY_ORIGIN, INSTANCE_SLUG, INSTANCE_NAME),
    openapiUrl: `${TRY_ORIGIN}${appNamespaceBasePath(INSTANCE_SLUG)}/openapi.json`,
    tokenSettingsPath: "/settings/access-tokens",
  },
  session: {
    messages: [
      { id: "m1", role: "user", text: "Summarize today's signups." },
      {
        id: "m2",
        role: "agent",
        text: "142 new signups today, up 18% on yesterday. Top source is the /pricing page (61). 3 looked like bots — I've queued their onboarding emails to pause, pending your approval.",
      },
    ],
    toolCalls: [
      {
        id: "t1",
        name: "query_db",
        detail: "select count(*) from signups where day = current_date",
        cost: "$0.004",
        status: "done",
      },
      {
        id: "t2",
        name: "http_get",
        detail: "GET analytics.internal/referrers?window=24h",
        cost: "$0.002",
        status: "done",
      },
      {
        id: "t3",
        name: "pause_onboarding_emails",
        detail: "3 flagged accounts · reversible",
        cost: "$0.001",
        status: "pending-approval",
      },
    ],
  },
  exposed: {
    apiUrl: AGENT_API_URL,
    webUrl: null,
  },
  checkpoints: [
    { id: "v4", version: 4, when: "2h ago", live: true },
    { id: "v3", version: 3, when: "yesterday", live: false },
    { id: "v2", version: 2, when: "5d ago", live: false },
  ],
  recentSessions: [
    {
      id: "s1",
      when: "2m",
      summary: "Summarize today's signups",
      cost: "$0.007",
      status: "running",
    },
    {
      id: "s2",
      when: "38m",
      summary: "Draft the weekly retention digest",
      cost: "$0.031",
      status: "done",
    },
    {
      id: "s3",
      when: "3h",
      summary: "Backfill missing UTM tags",
      cost: "$0.019",
      status: "failed",
    },
  ],
  costTrend: [3, 2, 4, 3, 6, 5, 8, 6, 9, 7, 11, 8],
};
