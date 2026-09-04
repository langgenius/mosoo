import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Link } from "react-router-dom";

import { fetchAgentCost } from "@/domains/cost/api/cost-client";
import { exportAttributionCostCsv } from "@/routes/cost/cost-csv";
import {
  COST_RANGES,
  RUN_PURPOSE_FILTERS,
  cacheHitRate,
  formatCompactNumber,
  formatCurrency,
  formatPlainPercent,
  rangeToInput,
  runPurposeToQuery,
  tokensTotal,
} from "@/routes/cost/cost-model";
import type { CostRange, CostRunPurpose } from "@/routes/cost/cost-model";
import { toAgentId, toProjectId } from "@/routes/typed-id";
import { getCurrentLocale, useTranslation } from "@/shared/i18n";
import { cn } from "@/shared/lib/class-names";
import { BarChart3, Download, ExternalLink } from "@/shared/ui/icons";

const COST_RANGE_KEYS = {
  "7d": "cost.range7d",
  "30d": "cost.range30d",
  mtd: "cost.rangeMtd",
  "90d": "cost.range90d",
} as const satisfies Record<CostRange, string>;

export function AgentCostTab({
  agentId,
  projectId,
}: {
  agentId: string;
  projectId: string;
}): ReactElement {
  const { t } = useTranslation();
  const [range, setRange] = useState<CostRange>("30d");
  const [purpose, setPurpose] = useState<CostRunPurpose | "all">("all");
  const runPurposes = runPurposeToQuery(purpose);
  const { data: card, isLoading } = useQuery({
    queryFn: async () =>
      fetchAgentCost({
        agentId: toAgentId(agentId),
        projectId: toProjectId(projectId),
        range: rangeToInput(range),
        runPurposes,
      }),
    queryKey: ["cost", "agent-card", projectId, agentId, range, purpose],
  });
  const totals = card?.totals;

  return (
    <div className="bg-paper-200 h-full overflow-y-auto px-6 py-5">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-foreground text-lg font-semibold">{t("cost.cost")}</h2>
            <p className="text-muted-foreground mt-1 text-sm">{t("cost.agentCostSubtitle")}</p>
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
                  {t(COST_RANGE_KEYS[value])}
                </button>
              ))}
            </div>
            <Link
              to="/cost"
              className="border-border hover:bg-muted inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm font-semibold"
            >
              <ExternalLink className="size-3.5" />
              {t("cost.openProjectUsage")}
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
              {t("cost.exportCsv")}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {RUN_PURPOSE_FILTERS.map((item) => (
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
              {t(item.labelKey)}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="border-border bg-card text-muted-foreground rounded-lg border px-4 py-10 text-center text-sm">
            {t("cost.loadingAgentCost")}
          </div>
        ) : null}

        <section className="grid gap-3 md:grid-cols-4">
          {[
            [
              t("cost.agentSpend"),
              formatCurrency(totals?.totalCostUsd ?? 0),
              t("cost.cacheAdjusted"),
            ],
            [t("cost.runs"), formatCompactNumber(totals?.requestCount ?? 0), t("cost.modelCalls")],
            [
              t("cost.avgTokensPerRun"),
              formatCompactNumber(
                totals && totals.requestCount > 0 ? tokensTotal(totals) / totals.requestCount : 0,
              ),
              t("cost.inputPlusOutput"),
            ],
            [
              t("cost.cacheHit"),
              formatPlainPercent(totals ? cacheHitRate(totals) : 0),
              t("cost.readTokensPerInput"),
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

        <section>
          <Panel title={t("agent.modelUsage")}>
            {(card?.models ?? []).length === 0 ? (
              <div className="text-muted-foreground px-4 py-8 text-sm">
                {t("cost.noModelUsageInRange")}
              </div>
            ) : null}
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
                    {t("cost.tokenCount", { count: formatCompactNumber(tokensTotal(model)) })}
                  </div>
                </div>
              </div>
            ))}
          </Panel>
        </section>

        <Panel title={t("agent.recentSessions")}>
          {(card?.recentSessions ?? []).length === 0 ? (
            <div className="text-muted-foreground px-4 py-8 text-sm">
              {t("cost.noSessionsInRange")}
            </div>
          ) : null}
          {(card?.recentSessions ?? []).map((session) => (
            <div
              key={`${session.createdAt}-${session.sessionRunId ?? session.model}`}
              className="border-border grid grid-cols-[120px_minmax(160px,1fr)_130px_130px_100px] items-center border-b px-4 py-3 text-sm last:border-b-0"
            >
              <div className="text-muted-foreground text-xs" suppressHydrationWarning>
                {new Date(session.createdAt).toLocaleString(getCurrentLocale())}
              </div>
              <div className="min-w-0">
                <div className="text-foreground truncate font-medium">{session.actorName}</div>
                <div className="text-muted-foreground truncate font-mono text-xs">
                  {session.model}
                </div>
              </div>
              <div>
                {t("cost.tokenCount", {
                  count: formatCompactNumber(session.inputTokens + session.outputTokens),
                })}
              </div>
              <div>
                {t("cost.cacheReadCount", {
                  count: formatCompactNumber(session.cacheReadTokens),
                })}
              </div>
              <div className="text-right font-mono font-semibold">
                {formatCurrency(session.totalCostUsd)}
              </div>
            </div>
          ))}
        </Panel>

        <div className="border-border bg-card text-muted-foreground flex items-center gap-2 rounded-lg border px-4 py-3 text-xs">
          <BarChart3 className="size-3.5" />
          {t("cost.agentCostPurposeNote")}
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
