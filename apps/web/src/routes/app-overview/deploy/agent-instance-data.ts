import {
  appNamespaceAgentCurl,
  appNamespaceAgentPath,
  appNamespaceBasePath,
} from "./deploy-console-mapping";

/**
 * Fixture view models for the "agent instance" reframing of the Overview: a
 * published, non-web agent presented as a remote, stateful compute instance —
 * an ADDRESS (Block 1), a WAY IN (Block 2, the SSH-like session console), and a
 * PULSE (Block 3, logs + meter). These live only on the unauthenticated
 * `/v0-deploy-preview` design prototype and back {@link AGENT_INSTANCE_FIXTURE};
 * they have no backend seam and are never mapped from a GraphQL payload.
 */

/** Name-addressed API surface a caller hits to drive the instance (its "IP"). */
export interface AgentInstanceEndpoint {
  /** Full method + URL for the create-thread call, e.g. "POST https://…/threads". */
  threadsPath: string;
  /** Copy-ready curl carrying a PAT bearer, mirroring the live Connect card. */
  curl: string;
  /** The App-level OpenAPI document URL. */
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

/** One recent session in the Pulse log (relative time · summary · cost · status). */
export interface AgentInstanceRecentSession {
  id: string;
  /** Relative "when" label, e.g. "2m". */
  when: string;
  /** One-line summary of what the session did. */
  summary: string;
  cost: string;
  status: "done" | "failed" | "running";
}

/** The whole fixture the panel renders — one instance, its address, session, pulse. */
export interface AgentInstanceFixture {
  name: string;
  slug: string;
  liveVersion: number;
  /** Aggregate spend today, formatted, e.g. "$0.42". */
  todayCost: string;
  /** Count behind the "N sessions today" meter. */
  sessionsToday: number;
  endpoint: AgentInstanceEndpoint;
  session: AgentInstanceSession;
  recentSessions: AgentInstanceRecentSession[];
  /** Small per-hour spend series for the Pulse sparkline (unitless, relative). */
  costTrend: number[];
}

/** The prototype's demo origin — the name-addressed public API host. */
const TRY_ORIGIN = "https://try.mosoo.ai";

const INSTANCE_NAME = "quiz-master";
const INSTANCE_SLUG = "roadmap-agents";

/**
 * A believable published-agent instance: "quiz-master" on slug "roadmap-agents",
 * v4 live, $0.42 spent today. Its session mock shows a delegation, three tool
 * chips (two done, one pending human approval), and the answer, so the panel can
 * convey talk + watch + intervene without any session plumbing.
 */
export const AGENT_INSTANCE_FIXTURE: AgentInstanceFixture = {
  name: INSTANCE_NAME,
  slug: INSTANCE_SLUG,
  liveVersion: 4,
  todayCost: "$0.42",
  sessionsToday: 9,
  endpoint: {
    threadsPath: `POST ${TRY_ORIGIN}${appNamespaceAgentPath(INSTANCE_SLUG, INSTANCE_NAME)}`,
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
