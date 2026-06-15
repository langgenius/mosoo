import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  Bot,
  Box,
  CheckCircle2,
  Circle,
  DollarSign,
  Folder,
  KeyRound,
  Puzzle,
  Radio,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router-dom";

import { useAppSession } from "@/app/session-provider";
import { useVisibleAgentsQuery } from "@/domains/agent/query/agent-queries";
import { fetchAppCost } from "@/domains/cost/api/cost-client";
import { useAppEnvironmentsQuery } from "@/domains/environment/query/environment-queries";
import { useMcpRegistryQuery } from "@/domains/mcp/query/mcp-queries";
import { threadSessions } from "@/domains/session/api/list";
import { useAppSkillsQuery } from "@/domains/skill/query/skill-queries";
import { useSpacesQuery } from "@/domains/space/query/space-queries";
import { listVendorCredentials } from "@/domains/vendor-credential/api/vendor-credential-client";
import { cn } from "@/shared/lib/class-names";

import { toAppId } from "../typed-id";
import {
  formatAppCurrency,
  formatAppNumber,
  getAppOverviewQuickstartItems,
  getRecentAppThreads,
  summarizeAppOverview,
} from "./app-overview-model";
import type { AppOverviewDailyCostInput, AppOverviewMetrics } from "./app-overview-model";

const RECENT_THREAD_LIMIT = 5;
const EMPTY_DAILY_COST: AppOverviewDailyCostInput[] = [];

function OverviewMetricCard({
  detail,
  icon: Icon,
  label,
  value,
}: {
  detail: string;
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="border-border bg-card rounded-lg border p-4">
      <div className="text-muted-foreground flex items-center justify-between gap-3 text-xs font-medium">
        <span>{label}</span>
        <Icon className="size-4" />
      </div>
      <div className="text-foreground mt-3 text-2xl font-semibold tracking-normal">{value}</div>
      <div className="text-muted-foreground mt-1 text-xs">{detail}</div>
    </div>
  );
}

function QuickstartPanel({ metrics }: { metrics: AppOverviewMetrics }) {
  const items = getAppOverviewQuickstartItems(metrics);
  const completeCount = items.filter((item) => item.complete).length;

  return (
    <section className="border-border bg-card rounded-lg border">
      <div className="border-border flex items-center justify-between border-b px-4 py-3">
        <div>
          <h2 className="text-foreground text-sm font-semibold">Quickstart</h2>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {completeCount} of {items.length} quickstart steps complete
          </p>
        </div>
      </div>
      <div className="divide-border divide-y">
        {items.map((item) => {
          const StatusIcon = item.complete ? CheckCircle2 : Circle;

          return (
            <Link
              key={item.id}
              to={item.href}
              className="hover:bg-muted/55 flex items-center gap-3 px-4 py-3 transition-colors"
            >
              <StatusIcon
                className={cn(
                  "size-4 shrink-0",
                  item.complete ? "text-success" : "text-muted-foreground",
                )}
              />
              <div className="min-w-0">
                <div className="text-foreground text-sm font-medium">{item.label}</div>
                <div className="text-muted-foreground truncate text-xs">{item.description}</div>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function RecentThreadsPanel({ threads }: { threads: ReturnType<typeof getRecentAppThreads> }) {
  return (
    <section className="border-border bg-card rounded-lg border">
      <div className="border-border flex items-center justify-between border-b px-4 py-3">
        <div>
          <h2 className="text-foreground text-sm font-semibold">Recent threads</h2>
          <p className="text-muted-foreground mt-0.5 text-xs">Web runs scoped to this App</p>
        </div>
        <Link to="/threads" className="text-primary text-xs font-semibold hover:underline">
          View all
        </Link>
      </div>
      {threads.length === 0 ? (
        <div className="text-muted-foreground px-4 py-8 text-center text-sm">
          No threads have run in this App yet.
        </div>
      ) : (
        <div className="divide-border divide-y">
          {threads.map((thread) => (
            <Link
              key={thread.id}
              to={`/threads/${thread.id}`}
              className="hover:bg-muted/55 flex items-center justify-between gap-4 px-4 py-3 transition-colors"
            >
              <div className="min-w-0">
                <div className="text-foreground truncate text-sm font-medium">{thread.title}</div>
                <div className="text-muted-foreground mt-0.5 text-xs">
                  {new Date(thread.lastActivityAt).toLocaleString()}
                </div>
              </div>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                  thread.status === "working"
                    ? "bg-primary/10 text-primary"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {thread.status === "working" ? "Working" : "Idle"}
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function UsagePanel({ daily }: { daily: readonly AppOverviewDailyCostInput[] }) {
  const maxDailyCost = Math.max(...daily.map((point) => point.totalCostUsd), 0);

  return (
    <section className="border-border bg-card rounded-lg border p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-foreground text-sm font-semibold">Usage</h2>
          <p className="text-muted-foreground mt-0.5 text-xs">Last 30 days in this App</p>
        </div>
        <Link to="/cost" className="text-primary text-xs font-semibold hover:underline">
          Cost detail
        </Link>
      </div>
      {daily.length === 0 ? (
        <div className="text-muted-foreground mt-8 text-center text-sm">No usage yet.</div>
      ) : (
        <div className="mt-5 flex h-16 items-end gap-1.5">
          {daily.map((point) => {
            const height =
              maxDailyCost === 0 ? 6 : Math.max(6, (point.totalCostUsd / maxDailyCost) * 56);

            return (
              <div
                key={point.date}
                title={`${point.date}: ${formatAppCurrency(point.totalCostUsd)}`}
                className="bg-primary/70 min-w-1 flex-1 rounded-t-sm"
                style={{ height }}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}

export function AppOverviewPage() {
  const { activeApp, activeAppId, appsLoading } = useAppSession();
  const agentsQuery = useVisibleAgentsQuery(activeAppId);
  const environmentsQuery = useAppEnvironmentsQuery(activeAppId);
  const spacesQuery = useSpacesQuery(activeAppId);
  const skillsQuery = useAppSkillsQuery(activeAppId);
  const mcpRegistryQuery = useMcpRegistryQuery(activeAppId);
  const threadSessionsQuery = useQuery({
    enabled: activeAppId !== null,
    queryFn: async () => {
      if (activeAppId === null) {
        throw new Error("App id is required to list App threads.");
      }

      return threadSessions(toAppId(activeAppId), "ui");
    },
    queryKey: ["app-overview", "threads", activeAppId],
    refetchInterval: 10_000,
  });
  const costQuery = useQuery({
    enabled: activeAppId !== null,
    queryFn: async () => {
      if (activeAppId === null) {
        throw new Error("App id is required to load App usage.");
      }

      return fetchAppCost(toAppId(activeAppId), "LAST_30_DAYS");
    },
    queryKey: ["app-overview", "cost", activeAppId],
  });
  const vendorCredentialsQuery = useQuery({
    enabled: activeAppId !== null,
    queryFn: async () => {
      if (activeAppId === null) {
        throw new Error("App id is required to list App provider keys.");
      }

      return listVendorCredentials(toAppId(activeAppId));
    },
    queryKey: ["app-overview", "vendor-credentials", activeAppId],
  });

  const sessions = useMemo(
    () => (threadSessionsQuery.data ?? []).map((item) => item.session),
    [threadSessionsQuery.data],
  );
  const metrics = useMemo(
    () =>
      summarizeAppOverview({
        agents: agentsQuery.data ?? [],
        cost: costQuery.data ?? null,
        environmentCount: environmentsQuery.data?.length ?? 0,
        mcpServerCount: mcpRegistryQuery.data?.servers.length ?? 0,
        providerCredentialCount: vendorCredentialsQuery.data?.length ?? 0,
        sessions,
        skillCount: skillsQuery.data?.length ?? 0,
        spaceCount: spacesQuery.data?.length ?? 0,
      }),
    [
      agentsQuery.data,
      costQuery.data,
      environmentsQuery.data,
      mcpRegistryQuery.data,
      sessions,
      skillsQuery.data,
      spacesQuery.data,
      vendorCredentialsQuery.data,
    ],
  );
  const recentThreads = useMemo(
    () => getRecentAppThreads(sessions, RECENT_THREAD_LIMIT),
    [sessions],
  );
  const dailyCost = costQuery.data?.daily ?? EMPTY_DAILY_COST;
  const loadError =
    agentsQuery.error ??
    threadSessionsQuery.error ??
    costQuery.error ??
    environmentsQuery.error ??
    spacesQuery.error ??
    skillsQuery.error ??
    mcpRegistryQuery.error ??
    vendorCredentialsQuery.error;
  const loading =
    agentsQuery.isLoading ||
    threadSessionsQuery.isLoading ||
    costQuery.isLoading ||
    environmentsQuery.isLoading ||
    spacesQuery.isLoading ||
    skillsQuery.isLoading ||
    mcpRegistryQuery.isLoading ||
    vendorCredentialsQuery.isLoading;

  if (activeApp === null) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
        {appsLoading ? "Loading App…" : "No App available."}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="border-border bg-background flex shrink-0 items-center justify-between gap-4 border-b px-8 py-5">
        <div className="min-w-0">
          <div className="text-muted-foreground flex items-center gap-2 text-xs font-semibold uppercase">
            <Box className="size-3.5" />
            App
          </div>
          <h1 className="text-foreground mt-1 truncate text-2xl font-semibold tracking-normal">
            {activeApp.name}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/channels"
            className="border-border hover:bg-muted inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-semibold transition-colors"
          >
            <Radio className="size-4" />
            Channels
          </Link>
          <Link
            to="/providers"
            className="border-border hover:bg-muted inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-semibold transition-colors"
          >
            <KeyRound className="size-4" />
            Provider keys
          </Link>
          <Link
            to="/agent?create=1"
            className="bg-primary text-primary-foreground hover:bg-primary-hover inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-semibold shadow-xs transition-colors"
          >
            <Bot className="size-4" />
            New agent
          </Link>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
        <div className="mx-auto max-w-6xl space-y-5">
          {loadError ? (
            <div className="border-destructive/30 bg-destructive/5 text-destructive rounded-lg border px-4 py-3 text-sm">
              App overview data failed to load. Refresh the page after checking app access.
            </div>
          ) : null}
          {loading ? (
            <div className="border-border bg-card text-muted-foreground rounded-lg border px-4 py-3 text-sm">
              Loading App overview…
            </div>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <OverviewMetricCard
              detail={`${metrics.publishedAgentCount} published`}
              icon={Bot}
              label="Agents"
              value={formatAppNumber(metrics.agentCount)}
            />
            <OverviewMetricCard
              detail={`${metrics.workingThreadCount} working`}
              icon={Activity}
              label="Threads"
              value={formatAppNumber(metrics.threadCount)}
            />
            <OverviewMetricCard
              detail={`${formatAppNumber(metrics.requestCount)} model requests`}
              icon={DollarSign}
              label="Cost"
              value={formatAppCurrency(metrics.totalCostUsd)}
            />
            <OverviewMetricCard
              detail={`${metrics.environmentCount} env · ${metrics.providerCredentialCount} keys`}
              icon={Puzzle}
              label="Dependencies"
              value={formatAppNumber(metrics.dependencyCount + metrics.mcpServerCount)}
            />
          </div>

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="space-y-5">
              <UsagePanel daily={dailyCost} />
              <RecentThreadsPanel threads={recentThreads} />
            </div>
            <div className="space-y-5">
              <QuickstartPanel metrics={metrics} />
              <section className="border-border bg-card rounded-lg border p-4">
                <h2 className="text-foreground text-sm font-semibold">Resources</h2>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <OverviewMetricCard
                    detail="Files and app data"
                    icon={Folder}
                    label="Spaces"
                    value={formatAppNumber(metrics.spaceCount)}
                  />
                  <OverviewMetricCard
                    detail="Runtime config"
                    icon={Box}
                    label="Envs"
                    value={formatAppNumber(metrics.environmentCount)}
                  />
                  <OverviewMetricCard
                    detail="Reusable capabilities"
                    icon={Puzzle}
                    label="Skills"
                    value={formatAppNumber(metrics.skillCount)}
                  />
                  <OverviewMetricCard
                    detail="Connected tools"
                    icon={Radio}
                    label="MCP"
                    value={formatAppNumber(metrics.mcpServerCount)}
                  />
                </div>
              </section>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
