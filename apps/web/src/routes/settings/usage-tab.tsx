import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { useState } from "react";

import { useAppSession } from "@/app/session-provider";
import { fetchMemberCost } from "@/domains/cost/api/cost-client";
import { RunMixBar } from "@/routes/cost/cost-agents-panel";
import { exportMemberUsageCsv } from "@/routes/cost/cost-csv";
import {
  COST_RANGES,
  cacheHitRate,
  formatCompactNumber,
  formatCurrency,
  formatPlainPercent,
  rangeLabel,
  rangeToInput,
  tokensTotal,
} from "@/routes/cost/cost-model";
import type { CostAttributionCard, CostDailyPoint, CostRange } from "@/routes/cost/cost-model";
import { toAccountId, toOrganizationId } from "@/routes/typed-id";
import { cn } from "@/shared/lib/class-names";

export function UsageTab() {
  const { activeOrganization, user } = useAppSession();
  const [range, setRange] = useState<CostRange>("30d");
  const usageQuery = useQuery({
    enabled: activeOrganization !== null && user !== null,
    queryFn: async () =>
      fetchMemberCost({
        memberId: toAccountId(user!.id),
        organizationId: toOrganizationId(activeOrganization!.id),
        range: rangeToInput(range),
      }),
    queryKey: ["cost", "member-card", activeOrganization?.id, user?.id, range],
  });
  const card = usageQuery.data;

  return (
    <>
      <header className="border-border-subtle flex h-12 shrink-0 items-center justify-between border-b px-5">
        <span className="text-sm font-medium">My Usage</span>
        <div className="flex items-center gap-2">
          <div className="border-border bg-card flex rounded-md border p-0.5">
            {COST_RANGES.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setRange(value);
                }}
                className={cn(
                  "rounded px-2.5 py-1 text-xs font-semibold uppercase",
                  range === value ? "bg-ink-100 text-fg-1" : "text-muted-foreground",
                )}
              >
                {value}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              exportMemberUsageCsv(card);
            }}
            disabled={!card}
            className="border-border hover:bg-muted inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-semibold disabled:pointer-events-none disabled:opacity-50"
          >
            <Download className="size-3.5" />
            Export CSV
          </button>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-5xl space-y-5">
          {usageQuery.isLoading ? (
            <div className="border-border bg-card text-muted-foreground rounded-lg border px-4 py-6 text-sm">
              Loading usage…
            </div>
          ) : null}

          <UsageSection
            agentListTitle="Agents I use most"
            card={card?.used}
            showAgentShare
            title={`Used by me · ${rangeLabel(range)}`}
          />

          {card?.owned && card.owned.totals.requestCount > 0 ? (
            <UsageSection
              agentListTitle="My owned agents"
              card={card.owned}
              showRunMix
              title="Owned by me"
            />
          ) : null}

          <p className="text-muted-foreground text-xs">
            Admins can open the Cost dashboard for organization-wide attribution.
          </p>
        </div>
      </div>
    </>
  );
}

function UsageSection({
  agentListTitle,
  card,
  showAgentShare = false,
  showRunMix = false,
  title,
}: {
  agentListTitle: string;
  card: CostAttributionCard | undefined;
  showAgentShare?: boolean;
  showRunMix?: boolean;
  title: string;
}) {
  const totals = card?.totals;

  return (
    <section className="space-y-4">
      <h2 className="text-foreground text-sm font-semibold">{title}</h2>
      <div className="grid gap-3 md:grid-cols-3">
        {[
          ["Spend", formatCurrency(totals?.totalCostUsd ?? 0), "current period"],
          ["Requests", formatCompactNumber(totals?.requestCount ?? 0), "across agents"],
          [
            "Tokens",
            formatCompactNumber(totals ? tokensTotal(totals) : 0),
            `${Math.round((totals ? cacheHitRate(totals) : 0) * 100)}% cache hit`,
          ],
        ].map(([label, value, detail], index) => (
          <div key={label} className="border-border bg-card rounded-lg border px-4 py-3">
            <div className="text-muted-foreground text-[11px] font-semibold tracking-[0.12em] uppercase">
              {label}
            </div>
            <div className="text-foreground mt-2 flex items-center gap-2 text-2xl font-semibold">
              {index === 0 ? <span className="bg-accent-press size-2.5 rounded-full" /> : null}
              {value}
            </div>
            <div className="text-muted-foreground mt-1 text-xs">{detail}</div>
          </div>
        ))}
      </div>

      <UsageDailyChart points={card?.daily ?? []} />

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="border-border bg-card overflow-hidden rounded-lg border">
          <div className="border-border border-b px-4 py-3 text-sm font-semibold">
            {agentListTitle}
          </div>
          {(card?.agents ?? []).slice(0, 6).map((agent) => (
            <div
              key={agent.agentId}
              className="border-border flex items-center justify-between border-b px-4 py-3 text-sm last:border-b-0"
            >
              <div className="min-w-0">
                <div className="text-foreground truncate font-medium">{agent.agentName}</div>
                <div className="text-muted-foreground text-xs">
                  {agent.requestCount} requests
                  {showAgentShare && totals && totals.totalCostUsd > 0
                    ? ` · ${formatPlainPercent(agent.totalCostUsd / totals.totalCostUsd)}`
                    : ""}
                </div>
              </div>
              {showRunMix ? (
                <div className="w-28">
                  <RunMixBar agent={agent} />
                  <div className="mt-1 text-right font-mono text-xs">
                    {formatCurrency(agent.totalCostUsd)}
                  </div>
                </div>
              ) : (
                <div className="font-mono font-semibold">{formatCurrency(agent.totalCostUsd)}</div>
              )}
            </div>
          ))}
        </div>

        <div className="border-border bg-card overflow-hidden rounded-lg border">
          <div className="border-border border-b px-4 py-3 text-sm font-semibold">
            Recent sessions
          </div>
          {(card?.recentSessions ?? []).slice(0, 7).map((session) => (
            <div
              key={`${session.createdAt}-${session.sessionRunId ?? session.model}`}
              className="border-border grid grid-cols-[92px_minmax(120px,1fr)_110px_90px] items-center border-b px-4 py-3 text-sm last:border-b-0"
            >
              <div className="text-muted-foreground text-xs" suppressHydrationWarning>
                {new Date(session.createdAt).toLocaleDateString()}
              </div>
              <div className="min-w-0">
                <div className="text-muted-foreground truncate font-mono text-xs">
                  {session.model}
                </div>
                <div className="text-muted-foreground text-xs">
                  {formatCompactNumber(session.cacheReadTokens)} cached
                </div>
              </div>
              <div>{formatCompactNumber(session.inputTokens + session.outputTokens)}</div>
              <div className="text-right font-mono font-semibold">
                {formatCurrency(session.totalCostUsd)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function UsageDailyChart({ points }: { points: CostDailyPoint[] }) {
  const totalSpend = points.reduce((sum, point) => sum + point.totalCostUsd, 0);
  const maxSpend = Math.max(...points.map((point) => point.totalCostUsd), 0);

  return (
    <div className="border-border bg-card rounded-lg border p-4">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-foreground text-sm font-semibold">Daily spend</h3>
        <span className="text-muted-foreground font-mono text-xs">
          {formatCurrency(totalSpend)}
        </span>
      </div>
      {points.length === 0 ? (
        <div className="text-muted-foreground flex h-[180px] items-center justify-center text-sm">
          No cost events in this range.
        </div>
      ) : (
        <div className="flex h-[180px] items-end gap-2">
          {points.map((point) => (
            <div key={point.date} className="flex min-w-4 flex-1 flex-col items-center gap-2">
              <div
                className="bg-accent-press w-full rounded-t"
                style={{
                  height: `${Math.max(4, maxSpend > 0 ? (point.totalCostUsd / maxSpend) * 150 : 0)}px`,
                }}
                title={`${point.date}: ${formatCurrency(point.totalCostUsd)}`}
              />
              <div className="text-muted-foreground text-[10.5px]">{point.date.slice(5)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
