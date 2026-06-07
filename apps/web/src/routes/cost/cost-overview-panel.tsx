import type { ReactNode } from "react";

import { cn } from "@/shared/lib/class-names";
import { Badge } from "@/shared/ui/badge";

import {
  cacheHitRate,
  costDelta,
  formatCompactNumber,
  formatCurrency,
  formatPercent,
  modelColor,
  rangeLabel,
  tokensTotal,
} from "./cost-model";
import type { CostRange, CostTab, OrganizationCostCard } from "./cost-model";

export function CostOverviewPanel({
  card,
  range,
  setActiveTab,
}: {
  card: OrganizationCostCard | undefined;
  range: CostRange;
  setActiveTab: (tab: CostTab) => void;
}) {
  const totals = card?.totals;
  const previousTotals = card?.previousTotals;

  return (
    <>
      <section className="grid gap-3 md:grid-cols-4">
        {[
          [
            "Total Spend",
            formatCurrency(totals?.totalCostUsd ?? 0),
            formatPercent(totals && previousTotals ? costDelta(totals, previousTotals) : 0),
          ],
          ["Total Requests", formatCompactNumber(totals?.requestCount ?? 0), "requests"],
          [
            "Total Tokens",
            formatCompactNumber(totals ? tokensTotal(totals) : 0),
            `${Math.round((totals ? cacheHitRate(totals) : 0) * 100)}% cache hit`,
          ],
          ["Active Users", String(totals?.activeUsers ?? 0), "members this period"],
        ].map(([label, value, detail], index) => (
          <div
            key={label}
            className={cn(
              "rounded-lg border border-border bg-card px-4 py-3",
              index === 0 ? "bg-ink-50" : "",
            )}
          >
            <div className="text-muted-foreground text-[11px] font-semibold tracking-[0.12em] uppercase">
              {label}
            </div>
            <div className="text-foreground mt-2 text-2xl font-semibold">{value}</div>
            <div className="text-muted-foreground mt-1 text-xs">{detail}</div>
          </div>
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="border-border bg-card rounded-lg border p-4">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-foreground text-sm font-semibold">Daily spend</h2>
            <Badge variant="outline">{rangeLabel(range)}</Badge>
          </div>
          <DailySpendChart dailyCosts={card?.daily ?? []} />
        </div>

        <div className="border-border bg-card rounded-lg border p-4">
          <h2 className="text-foreground mb-3 text-sm font-semibold">Top agents</h2>
          {(card?.agents ?? []).length === 0 ? (
            <PanelEmpty>No agent spend in this range.</PanelEmpty>
          ) : null}
          <div className="space-y-2">
            {(card?.agents ?? []).slice(0, 5).map((agent) => (
              <button
                key={agent.agentId}
                type="button"
                onClick={() => {
                  setActiveTab("agents");
                }}
                className="hover:bg-muted/50 flex w-full items-center justify-between rounded-md p-2 text-left"
              >
                <span className="min-w-0">
                  <span className="text-foreground block truncate text-sm font-medium">
                    {agent.agentName}
                  </span>
                  <span className="text-muted-foreground text-xs">{agent.ownerName}</span>
                </span>
                <span className="font-mono text-sm">{formatCurrency(agent.totalCostUsd)}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="border-border bg-card rounded-lg border p-4">
          <h2 className="text-foreground mb-3 text-sm font-semibold">Top users</h2>
          {(card?.users ?? []).length === 0 ? (
            <PanelEmpty>No user spend in this range.</PanelEmpty>
          ) : null}
          <div className="space-y-2">
            {(card?.users ?? []).slice(0, 5).map((user) => (
              <button
                key={user.userId}
                type="button"
                onClick={() => {
                  setActiveTab("users");
                }}
                className="hover:bg-muted/50 flex w-full items-center justify-between rounded-md p-2 text-left"
              >
                <div className="min-w-0">
                  <div className="text-foreground truncate text-sm font-medium">
                    {user.userName}
                  </div>
                  <div className="text-muted-foreground truncate text-xs">
                    {user.topAgentName ?? "No agent usage"}
                  </div>
                </div>
                <div className="font-mono text-sm">{formatCurrency(user.totalCostUsd)}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="border-border bg-card rounded-lg border p-4">
          <h2 className="text-foreground mb-3 text-sm font-semibold">Spend by model</h2>
          {(card?.models ?? []).length === 0 ? (
            <PanelEmpty>No model spend in this range.</PanelEmpty>
          ) : null}
          <div className="space-y-3">
            {(card?.models ?? []).slice(0, 5).map((model) => {
              const total = card?.totals.totalCostUsd ?? 0;
              const share = total > 0 ? model.totalCostUsd / total : 0;

              return (
                <div key={`${model.provider}-${model.model}`}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className={cn("size-2.5 rounded-full", modelColor(model.model))} />
                      <span className="truncate">{model.model}</span>
                    </div>
                    <span className="font-mono">{formatCurrency(model.totalCostUsd)}</span>
                  </div>
                  <div className="bg-muted h-2 overflow-hidden rounded-full">
                    <div
                      className={cn("h-full rounded-full", modelColor(model.model))}
                      style={{ width: `${Math.max(2, share * 100)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </>
  );
}

function PanelEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="text-muted-foreground flex h-[120px] items-center justify-center text-center text-[13px]">
      {children}
    </div>
  );
}

function DailySpendChart({ dailyCosts }: { dailyCosts: { date: string; totalCostUsd: number }[] }) {
  const maxSpend = Math.max(...dailyCosts.map((entry) => entry.totalCostUsd), 1);

  if (dailyCosts.length === 0) {
    return (
      <div className="text-muted-foreground flex h-[220px] items-center justify-center text-sm">
        No cost events in this range.
      </div>
    );
  }

  return (
    <div className="flex h-[220px] items-end gap-2">
      {dailyCosts.map((day) => (
        <div key={day.date} className="flex min-w-4 flex-1 flex-col items-center gap-2">
          <div
            className="bg-accent-press w-full rounded-t"
            style={{ height: `${Math.max(10, (day.totalCostUsd / maxSpend) * 190)}px` }}
            title={`${day.date}: ${formatCurrency(day.totalCostUsd)}`}
          />
          <div className="text-muted-foreground text-[10.5px]">{day.date.slice(5)}</div>
        </div>
      ))}
    </div>
  );
}
