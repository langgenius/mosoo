import { useQuery } from "@tanstack/react-query";
import { BarChart3, Download, ExternalLink } from "lucide-react";
import { useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Link } from "react-router-dom";

import { fetchAgentCost } from "@/domains/cost/api/cost-client";
import type { CostRunPurpose } from "@/domains/cost/api/cost-client";
import { exportAttributionCostCsv } from "@/routes/cost/cost-csv";
import {
  COST_RANGES,
  cacheHitRate,
  formatCompactNumber,
  formatCurrency,
  formatPlainPercent,
  rangeToInput,
  tokensTotal,
} from "@/routes/cost/cost-model";
import type { CostRange } from "@/routes/cost/cost-model";
import { toAgentId } from "@/routes/typed-id";
import { cn } from "@/shared/lib/class-names";

const RUN_PURPOSES: { label: string; value: CostRunPurpose | "all" }[] = [
  { label: "All", value: "all" },
  { label: "Production", value: "production" },
  { label: "Debug", value: "debug" },
  { label: "Preview", value: "preview" },
];

export function AgentCostTab({ agentId }: { agentId: string }): ReactElement {
  const [range, setRange] = useState<CostRange>("30d");
  const [purpose, setPurpose] = useState<CostRunPurpose | "all">("all");
  const runPurposes = purpose === "all" ? [] : [purpose];
  const costQuery = useQuery({
    queryFn: async () =>
      fetchAgentCost({
        agentId: toAgentId(agentId),
        range: rangeToInput(range),
        runPurposes,
      }),
    queryKey: ["cost", "agent-card", agentId, range, purpose],
  });
  const card = costQuery.data;
  const totals = card?.totals;

  return (
    <div className="bg-paper-200 h-full overflow-y-auto px-6 py-5">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-foreground text-lg font-semibold">Cost</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Agent spend, model mix, runner attribution, and recent usage events.
            </p>
          </div>
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
            <Link
              to="/settings/cost"
              className="border-border hover:bg-muted inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm font-semibold"
            >
              <ExternalLink className="size-3.5" />
              Open workspace Cost
            </Link>
            <button
              type="button"
              onClick={() => {
                exportAttributionCostCsv("agent-cost.csv", card);
              }}
              disabled={!card}
              className="border-border hover:bg-muted inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm font-semibold disabled:pointer-events-none disabled:opacity-50"
            >
              <Download className="size-3.5" />
              Export CSV
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {RUN_PURPOSES.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => {
                setPurpose(item.value);
              }}
              className={cn(
                "rounded-md border px-3 py-1.5 text-xs font-semibold",
                purpose === item.value
                  ? "border-border-strong bg-ink-100 text-fg-1"
                  : "border-border text-muted-foreground hover:bg-muted",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>

        {costQuery.isLoading ? (
          <div className="border-border bg-card text-muted-foreground rounded-lg border px-4 py-10 text-center text-sm">
            Loading agent cost…
          </div>
        ) : null}

        <section className="grid gap-3 md:grid-cols-4">
          {[
            ["Agent Spend", formatCurrency(totals?.totalCostUsd ?? 0), "cache adjusted"],
            ["Runs", formatCompactNumber(totals?.requestCount ?? 0), "model calls"],
            [
              "Avg Tokens / Run",
              formatCompactNumber(
                totals && totals.requestCount > 0 ? tokensTotal(totals) / totals.requestCount : 0,
              ),
              "input + output",
            ],
            [
              "Cache Hit",
              formatPlainPercent(totals ? cacheHitRate(totals) : 0),
              "read tokens / input",
            ],
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

        <section className="grid gap-4 lg:grid-cols-2">
          <Panel title="Who is running this Agent">
            {(card?.users ?? []).length === 0 ? (
              <div className="text-muted-foreground px-4 py-8 text-sm">
                No runner usage in this range.
              </div>
            ) : null}
            {(card?.users ?? []).map((user) => (
              <div
                key={user.userId}
                className="border-border flex items-center justify-between border-b px-4 py-3 text-sm last:border-b-0"
              >
                <div className="min-w-0">
                  <div className="text-foreground truncate font-medium">{user.userName}</div>
                  <div className="text-muted-foreground truncate text-xs">{user.userEmail}</div>
                </div>
                <div className="text-right">
                  <div className="font-mono font-semibold">{formatCurrency(user.totalCostUsd)}</div>
                  <div className="text-muted-foreground text-xs">
                    {formatCompactNumber(user.requestCount)} sessions
                  </div>
                </div>
              </div>
            ))}
          </Panel>

          <Panel title="Model usage">
            {(card?.models ?? []).map((model) => (
              <div
                key={`${model.provider}-${model.model}`}
                className="border-border flex items-center justify-between border-b px-4 py-3 text-sm last:border-b-0"
              >
                <div className="min-w-0">
                  <div className="text-foreground truncate font-medium">{model.model}</div>
                  <div className="text-muted-foreground text-xs">{model.vendor}</div>
                </div>
                <div className="text-right">
                  <div className="font-mono font-semibold">
                    {formatCurrency(model.totalCostUsd)}
                  </div>
                  <div className="text-muted-foreground text-xs">
                    {formatCompactNumber(tokensTotal(model))} tokens
                  </div>
                </div>
              </div>
            ))}
          </Panel>
        </section>

        <Panel title="Recent sessions">
          {(card?.recentSessions ?? []).map((session) => (
            <div
              key={`${session.createdAt}-${session.sessionRunId ?? session.model}`}
              className="border-border grid grid-cols-[120px_minmax(160px,1fr)_130px_130px_100px] items-center border-b px-4 py-3 text-sm last:border-b-0"
            >
              <div className="text-muted-foreground text-xs" suppressHydrationWarning>
                {new Date(session.createdAt).toLocaleString()}
              </div>
              <div className="min-w-0">
                <div className="text-foreground truncate font-medium">{session.actorName}</div>
                <div className="text-muted-foreground truncate font-mono text-xs">
                  {session.model}
                </div>
              </div>
              <div>{formatCompactNumber(session.inputTokens + session.outputTokens)} tokens</div>
              <div>{formatCompactNumber(session.cacheReadTokens)} cache read</div>
              <div className="text-right font-mono font-semibold">
                {formatCurrency(session.totalCostUsd)}
              </div>
            </div>
          ))}
        </Panel>

        <div className="border-border bg-card text-muted-foreground flex items-center gap-2 rounded-lg border px-4 py-3 text-xs">
          <BarChart3 className="size-3.5" />
          Agent cost includes production, debug, and preview run purposes.
        </div>
      </div>
    </div>
  );
}

function Panel({ children, title }: { children: ReactNode; title: string }) {
  return (
    <div className="border-border bg-card overflow-hidden rounded-lg border">
      <div className="border-border border-b px-4 py-3 text-sm font-semibold">{title}</div>
      {children}
    </div>
  );
}
