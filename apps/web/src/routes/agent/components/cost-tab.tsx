import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Link } from "react-router-dom";

import { fetchAgentCost } from "@/domains/cost/api/cost-client";
import type { CostRunPurpose } from "@/domains/cost/api/cost-client";
import { exportAttributionCostCsv } from "@/routes/cost/cost-csv";
import {
  COST_RANGES,
  RUN_PURPOSE_FILTERS,
  cacheHitRate,
  formatCompactNumber,
  formatCurrency,
  formatPlainPercent,
  rangeLabelKey,
  rangeToInput,
  runPurposeToQuery,
  tokensTotal,
} from "@/routes/cost/cost-model";
import type { CostRange } from "@/routes/cost/cost-model";
import { toAgentId, toProjectId } from "@/routes/typed-id";
import { getCurrentLocale, useTranslation } from "@/shared/i18n";
import { cn } from "@/shared/lib/class-names";
import { Button } from "@/shared/ui/button";
import { BarChart3, Download, ExternalLink } from "@/shared/ui/icons";
import { SegmentedControl } from "@/shared/ui/segmented-control";

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
            <h2 className="t-section-title">{t("cost.cost")}</h2>
            <p className="text-fg-3 mt-1 text-sm">{t("cost.agentCostSubtitle")}</p>
          </div>
          <div className="flex items-center gap-2">
            <SegmentedControl
              label={t("cost.rangeLabel")}
              onChange={setRange}
              options={COST_RANGES.map((value) => ({ label: t(rangeLabelKey(value)), value }))}
              value={range}
            />
            <Button render={<Link to="/project-settings/usage" />} variant="outline">
              <ExternalLink className="size-3.5" />
              {t("cost.openProjectUsage")}
            </Button>
            <Button
              disabled={!card}
              onClick={() => {
                exportAttributionCostCsv("agent-cost.csv", card, t);
              }}
              variant="outline"
            >
              <Download className="size-3.5" />
              {t("cost.exportCsv")}
            </Button>
          </div>
        </div>

        <SegmentedControl
          label={t("cost.runPurposeLabel")}
          onChange={setPurpose}
          options={RUN_PURPOSE_FILTERS.map((item) => ({
            label: t(item.labelKey),
            value: item.value,
          }))}
          value={purpose}
        />

        {isLoading ? (
          <div className="border-border bg-card text-fg-3 rounded-lg border px-4 py-10 text-center text-sm">
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
                index === 0 ? "bg-sunken" : "",
              )}
            >
              <div className="t-group-label">{label}</div>
              <div className="text-foreground mt-2 text-2xl font-semibold">{value}</div>
              <div className="text-fg-3 mt-1 text-xs">{detail}</div>
            </div>
          ))}
        </section>

        <section>
          <Panel title={t("agent.modelUsage")}>
            {(card?.models ?? []).length === 0 ? (
              <div className="text-fg-3 px-4 py-8 text-sm">{t("cost.noModelUsageInRange")}</div>
            ) : null}
            {(card?.models ?? []).map((model) => (
              <div
                key={`${model.provider}-${model.model}`}
                className="border-border flex items-center justify-between border-b px-4 py-3 text-sm last:border-b-0"
              >
                <div className="min-w-0">
                  <div className="text-foreground truncate font-medium">{model.model}</div>
                  <div className="text-fg-3 text-xs">{model.vendor}</div>
                </div>
                <div className="text-right">
                  <div className="font-mono font-semibold">
                    {formatCurrency(model.totalCostUsd)}
                  </div>
                  <div className="text-fg-3 text-xs">
                    {t("cost.tokenCount", { count: formatCompactNumber(tokensTotal(model)) })}
                  </div>
                </div>
              </div>
            ))}
          </Panel>
        </section>

        <Panel title={t("agent.recentSessions")}>
          {(card?.recentSessions ?? []).length === 0 ? (
            <div className="text-fg-3 px-4 py-8 text-sm">{t("cost.noSessionsInRange")}</div>
          ) : null}
          {(card?.recentSessions ?? []).map((session) => (
            <div
              key={`${session.createdAt}-${session.sessionRunId ?? session.model}`}
              className="border-border grid grid-cols-[120px_minmax(160px,1fr)_130px_130px_100px] items-center border-b px-4 py-3 text-sm last:border-b-0"
            >
              <div className="text-fg-3 text-xs" suppressHydrationWarning>
                {new Date(session.createdAt).toLocaleString(getCurrentLocale())}
              </div>
              <div className="min-w-0">
                <div className="text-foreground truncate font-medium">{session.actorName}</div>
                <div className="text-fg-3 truncate font-mono text-xs">{session.model}</div>
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

        <div className="border-border bg-card text-fg-3 flex items-center gap-2 rounded-lg border px-4 py-3 text-xs">
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
