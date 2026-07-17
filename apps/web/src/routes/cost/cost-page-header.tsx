import { Download } from "lucide-react";

import { cn } from "@/shared/lib/class-names";
import { Button } from "@/shared/ui/button";

import { downloadCsv } from "./cost-csv";
import {
  COST_RANGES,
  RUN_PURPOSE_FILTERS,
  formatCurrency,
  formatModelPricingSummary,
  rangeLabel,
} from "./cost-model";
import type { CostRange, CostRunPurpose, CostTab, AppCostCard } from "./cost-model";

export function CostPageHeader({
  card,
  effectiveTab,
  range,
  runPurpose,
  setRange,
  setRunPurpose,
}: {
  card: AppCostCard | undefined;
  effectiveTab: CostTab;
  range: CostRange;
  runPurpose: CostRunPurpose | "all";
  setRange: (range: CostRange) => void;
  setRunPurpose: (value: CostRunPurpose | "all") => void;
}) {
  return (
    <header className="border-border-subtle flex min-h-12 shrink-0 flex-col items-stretch gap-2 border-b px-4 py-3 sm:px-6 lg:h-12 lg:flex-row lg:items-center lg:justify-between lg:py-0">
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="text-sm font-medium">App Usage</span>
        <span className="text-fg-3 hidden truncate text-xs sm:inline">
          {`${card?.appName ?? "App"} · ${rangeLabel(range)} · ${formatCurrency(card?.totals.totalCostUsd ?? 0)}`}
        </span>
      </div>
      <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto lg:flex-nowrap">
        <div className="border-border bg-card flex rounded-md border p-0.5">
          {RUN_PURPOSE_FILTERS.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => {
                setRunPurpose(item.value);
              }}
              className={cn(
                "min-h-10 rounded px-2.5 py-1 text-xs font-semibold lg:min-h-0",
                runPurpose === item.value ? "bg-ink-100 text-fg-1" : "text-muted-foreground",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="border-border bg-card flex rounded-md border p-0.5">
          {COST_RANGES.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setRange(value);
              }}
              className={cn(
                "min-h-10 rounded px-3 py-1 text-xs font-semibold uppercase lg:min-h-0",
                range === value ? "bg-ink-100 text-fg-1" : "text-muted-foreground",
              )}
            >
              {value}
            </button>
          ))}
        </div>
        <Button
          variant="outline"
          size="xs"
          onClick={() => {
            exportCostCsv(effectiveTab, card);
          }}
          disabled={!card}
        >
          <Download className="size-3.5" />
          Export CSV
        </Button>
      </div>
    </header>
  );
}

function exportCostCsv(effectiveTab: CostTab, card: AppCostCard | undefined) {
  if (!card) {
    return;
  }

  if (effectiveTab === "agents") {
    downloadCsv("agent-costs.csv", [
      [
        "agent",
        "owner",
        "cost",
        "previous_cost",
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
        String(row.previousCostUsd ?? ""),
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
        const pricing = formatModelPricingSummary(row);

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
