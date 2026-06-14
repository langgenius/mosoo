import type { AgentSummary } from "@mosoo/contracts/agent";
import type { SessionSummary } from "@mosoo/contracts/session";

export type AppOverviewAgentInput = Pick<AgentSummary, "status">;
export type AppOverviewSessionInput = Pick<
  SessionSummary,
  "id" | "lastMessageAt" | "lastRun" | "status" | "title" | "updatedAt"
>;

export interface AppOverviewCostInput {
  daily: readonly AppOverviewDailyCostInput[];
  totals: AppOverviewCostTotalsInput;
}

export interface AppOverviewCostTotalsInput {
  requestCount: number;
  totalCostUsd: number;
}

export interface AppOverviewDailyCostInput {
  date: string;
  totalCostUsd: number;
}

export interface AppOverviewMetrics {
  agentCount: number;
  dependencyCount: number;
  environmentCount: number;
  mcpServerCount: number;
  providerCredentialCount: number;
  publishedAgentCount: number;
  requestCount: number;
  skillCount: number;
  spaceCount: number;
  threadCount: number;
  totalCostUsd: number;
  workingThreadCount: number;
}

export interface AppOverviewQuickstartItem {
  complete: boolean;
  description: string;
  href: string;
  id: string;
  label: string;
}

export interface RecentAppThread {
  id: string;
  lastActivityAt: string;
  status: "idle" | "working";
  title: string;
}

const TITLE_FALLBACK = "Untitled thread";
const TITLE_DISPLAY_LIMIT = 72;
const WORKING_RUN_STATUSES: ReadonlySet<NonNullable<SessionSummary["lastRun"]>["status"]> = new Set(
  ["booting", "queued", "running", "waiting_input"],
);

function getThreadDisplayTitle(session: Pick<AppOverviewSessionInput, "title">): string {
  const trimmed = session.title?.trim() ?? "";

  if (trimmed.length === 0) {
    return TITLE_FALLBACK;
  }

  return trimmed.length > TITLE_DISPLAY_LIMIT
    ? `${trimmed.slice(0, TITLE_DISPLAY_LIMIT - 1)}…`
    : trimmed;
}

export function getAppThreadLastActivityAt(session: AppOverviewSessionInput): string {
  return session.lastMessageAt ?? session.lastRun?.updatedAt ?? session.updatedAt;
}

export function isAppThreadWorking(session: AppOverviewSessionInput): boolean {
  if (session.status === "RUNNING" || session.status === "RESCHEDULING") {
    return true;
  }

  return session.lastRun !== null && WORKING_RUN_STATUSES.has(session.lastRun.status);
}

export function summarizeAppOverview(input: {
  agents: readonly AppOverviewAgentInput[];
  cost: AppOverviewCostInput | null;
  environmentCount: number;
  mcpServerCount: number;
  providerCredentialCount: number;
  sessions: readonly AppOverviewSessionInput[];
  skillCount: number;
  spaceCount: number;
}): AppOverviewMetrics {
  const dependencyCount =
    input.environmentCount + input.providerCredentialCount + input.spaceCount + input.skillCount;

  return {
    agentCount: input.agents.length,
    dependencyCount,
    environmentCount: input.environmentCount,
    mcpServerCount: input.mcpServerCount,
    providerCredentialCount: input.providerCredentialCount,
    publishedAgentCount: input.agents.filter((agent) => agent.status === "published").length,
    requestCount: input.cost?.totals.requestCount ?? 0,
    skillCount: input.skillCount,
    spaceCount: input.spaceCount,
    threadCount: input.sessions.length,
    totalCostUsd: input.cost?.totals.totalCostUsd ?? 0,
    workingThreadCount: input.sessions.filter(isAppThreadWorking).length,
  };
}

export function getRecentAppThreads(
  sessions: readonly AppOverviewSessionInput[],
  limit: number,
): RecentAppThread[] {
  return sessions
    .map((session): RecentAppThread => {
      const status: RecentAppThread["status"] = isAppThreadWorking(session) ? "working" : "idle";

      return {
        id: session.id,
        lastActivityAt: getAppThreadLastActivityAt(session),
        status,
        title: getThreadDisplayTitle(session),
      };
    })
    .toSorted(
      (left, right) =>
        new Date(right.lastActivityAt).getTime() - new Date(left.lastActivityAt).getTime(),
    )
    .slice(0, limit);
}

export function getAppOverviewQuickstartItems(
  metrics: Pick<
    AppOverviewMetrics,
    "agentCount" | "providerCredentialCount" | "publishedAgentCount" | "threadCount"
  >,
): AppOverviewQuickstartItem[] {
  return [
    {
      complete: metrics.providerCredentialCount > 0,
      description: "Store a model key for this App.",
      href: "/providers",
      id: "provider-key",
      label: "Add provider key",
    },
    {
      complete: metrics.agentCount > 0,
      description: "Import or generate the first App-local Agent.",
      href: "/agent?create=1",
      id: "agent",
      label: "Create agent",
    },
    {
      complete: metrics.threadCount > 0,
      description: "Start a Web thread inside this App.",
      href: "/threads",
      id: "thread",
      label: "Run a thread",
    },
    {
      complete: metrics.publishedAgentCount > 0,
      description: "Expose an App-local Agent through its Agent API endpoint.",
      href: "/agent",
      id: "publish",
      label: "Publish an agent",
    },
  ];
}

export function formatAppCurrency(value: number): string {
  const fractionDigits = value > 0 && value < 1 ? 4 : 2;

  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: fractionDigits,
    style: "currency",
  }).format(value);
}

export function formatAppNumber(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
    notation: value >= 1000 ? "compact" : "standard",
  }).format(value);
}
