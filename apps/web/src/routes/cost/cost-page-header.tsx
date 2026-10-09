import type { CostRunPurpose, ProjectCostCard } from "@/domains/cost/api/cost-client";
import { useTranslation } from "@/shared/i18n";
import { Button } from "@/shared/ui/button";
import { Download } from "@/shared/ui/icons";
import { SegmentedControl } from "@/shared/ui/segmented-control";

import { downloadCsv } from "./cost-csv";
import {
  COST_RANGES,
  RUN_PURPOSE_FILTERS,
  formatCurrency,
  formatModelPricingSummary,
  rangeLabel,
  rangeLabelKey,
} from "./cost-model";
import type { CostRange, CostTab } from "./cost-model";

export function CostPageHeader({
  card,
  effectiveTab,
  range,
  runPurpose,
  setRange,
  setRunPurpose,
}: {
  card: ProjectCostCard | undefined;
  effectiveTab: CostTab;
  range: CostRange;
  runPurpose: CostRunPurpose | "all";
  setRange: (range: CostRange) => void;
  setRunPurpose: (value: CostRunPurpose | "all") => void;
}) {
  const { t } = useTranslation();

  return (
    <header className="border-border-soft flex min-h-12 shrink-0 flex-col items-stretch gap-2 border-b px-4 py-3 sm:px-6 lg:h-12 lg:flex-row lg:items-center lg:justify-between lg:py-0">
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="text-sm font-medium">{t("cost.projectUsage")}</span>
        <span className="text-fg-3 hidden truncate text-xs sm:inline">
          {`${card?.projectName ?? t("nav.project")} · ${t(rangeLabel(range))} · ${formatCurrency(card?.totals.totalCostUsd ?? 0)}`}
        </span>
      </div>
      <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto lg:flex-nowrap">
        <SegmentedControl
          label={t("cost.runPurposeLabel")}
          onChange={setRunPurpose}
          options={RUN_PURPOSE_FILTERS.map((item) => ({
            label: t(item.labelKey),
            value: item.value,
          }))}
          value={runPurpose}
        />
        <SegmentedControl
          label={t("cost.rangeLabel")}
          onChange={setRange}
          options={COST_RANGES.map((value) => ({ label: t(rangeLabelKey(value)), value }))}
          value={range}
        />
        <Button
          variant="outline"
          size="xs"
          onClick={() => {
            exportCostCsv(effectiveTab, card, t);
          }}
          disabled={!card}
        >
          <Download className="size-3.5" />
          {t("cost.exportCsv")}
        </Button>
      </div>
    </header>
  );
}

function exportCostCsv(
  effectiveTab: CostTab,
  card: ProjectCostCard | undefined,
  t: (key: string, variables?: Record<string, string>) => string,
) {
  if (!card) {
    return;
  }

  if (effectiveTab === "agents") {
    downloadCsv("agent-costs.csv", [
      [
        "agent",
        "owner",
        "cost",
        "requests",
        "production_cost",
        "debug_cost",
        "input_tokens",
        "output_tokens",
        "cache_read",
      ],
      ...card.agents.map((row) => [
        row.agentName,
        row.ownerName,
        String(row.totalCostUsd),
        String(row.requestCount),
        String(row.productionCostUsd),
        String(row.debugCostUsd + row.previewCostUsd),
        String(row.inputTokens),
        String(row.outputTokens),
        String(row.cacheReadTokens),
      ]),
    ]);
    return;
  }

  if (effectiveTab === "models") {
    downloadCsv("model-costs.csv", [
      [
        "vendor",
        "provider",
        "model",
        "cost",
        "requests",
        "input_price",
        "output_price",
        "cache_read_price",
        "cache_write_price",
        "cache_hit",
        "unpriced_requests",
        "tokens",
      ],
      ...card.models.map((row) => {
        const pricing = formatModelPricingSummary(row, t);

        return [
          row.vendor,
          row.provider,
          row.model,
          String(row.totalCostUsd),
          String(row.requestCount),
          String(row.inputUsdPerMillion ?? ""),
          String(row.outputUsdPerMillion ?? ""),
          String(row.cacheReadUsdPerMillion ?? ""),
          String(row.cacheWriteUsdPerMillion ?? ""),
          pricing.cacheHitLabel,
          String(row.unpricedRequestCount),
          String(row.inputTokens + row.outputTokens),
        ];
      }),
    ]);
    return;
  }

  downloadCsv("cost-overview.csv", [
    ["date", "cost", "requests", "input_tokens", "output_tokens", "cache_read"],
    ...card.daily.map((row) => [
      row.date,
      String(row.totalCostUsd),
      String(row.requestCount),
      String(row.inputTokens),
      String(row.outputTokens),
      String(row.cacheReadTokens),
    ]),
  ]);
}
