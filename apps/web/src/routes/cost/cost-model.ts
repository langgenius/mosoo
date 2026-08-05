import type {
  CostAgentRow,
  CostAttributionCard,
  CostDailyPoint,
  CostModelRow,
  CostRangeInput,
  CostRecentSession,
  CostRunPurpose,
  CostTotals,
  OrganizationBillingCostCard,
  AppCostCard,
} from "@/domains/cost/api/cost-client";
import { getCurrentLocale } from "@/shared/i18n";
import type { SupportedLocale } from "@/shared/i18n/locales";

export const COST_RANGES = ["7d", "30d", "mtd", "90d"] as const;

export type CostRange = (typeof COST_RANGES)[number];
export type CostTab = "overview" | "agents" | "models";
export type AgentCostSort = "cost_asc" | "cost_desc" | "runs_desc" | "spike_desc";

export interface CostVendorRow {
  modelCount: number;
  requestCount: number;
  totalCostUsd: number;
  vendor: string;
}

export interface RunMixSegment {
  className: string;
  label: string;
  value: number;
}

export interface ModelPricingSummary {
  cacheHitLabel: string;
  cacheReadPriceLabel: string;
  cacheWritePriceLabel: string;
  inputOutputPriceLabel: string;
  needsPricingAction: boolean;
}

export const COST_TABS: { id: CostTab; labelKey: string }[] = [
  { id: "overview", labelKey: "cost.overview" },
  { id: "agents", labelKey: "cost.byAgent" },
  { id: "models", labelKey: "cost.byModel" },
];

export const RUN_PURPOSE_FILTERS: {
  label: string;
  labelKey: string;
  value: CostRunPurpose | "all";
}[] = [
  { label: "All", labelKey: "cost.all", value: "all" },
  { label: "Production", labelKey: "cost.production", value: "production" },
  { label: "Debug", labelKey: "cost.debug", value: "debug" },
];

// The UI only distinguishes production vs. debug usage. "Debug" covers every
// non-production development run, so it expands to both the `debug` and
// `preview` backend purposes (the latter being editor runs on a published
// agent). The backend keeps the two purposes separate for granularity.
export function runPurposeToQuery(value: CostRunPurpose | "all"): CostRunPurpose[] {
  if (value === "all") {
    return [];
  }
  if (value === "debug") {
    return ["debug", "preview"];
  }
  return [value];
}

export function formatCurrency(value: number, locale: SupportedLocale = getCurrentLocale()): string {
  return new Intl.NumberFormat(locale, {
    currency: "USD",
    maximumFractionDigits: value >= 100 ? 0 : 2,
    style: "currency",
  }).format(value);
}

export function formatCompactNumber(value: number, locale: SupportedLocale = getCurrentLocale()): string {
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: 1,
    notation: "compact",
  }).format(value);
}

export function formatPercent(value: number, locale: SupportedLocale = getCurrentLocale()): string {
  const amount = new Intl.NumberFormat(locale).format(Math.round(value * 100));
  return `${value >= 0 ? "+" : ""}${amount}%`;
}

export function formatPlainPercent(value: number, locale: SupportedLocale = getCurrentLocale()): string {
  return `${new Intl.NumberFormat(locale).format(Math.round(value * 100))}%`;
}

export function rangeToInput(range: CostRange): CostRangeInput {
  if (range === "7d") {
    return "LAST_7_DAYS";
  }
  if (range === "mtd") {
    return "MONTH_TO_DATE";
  }
  if (range === "90d") {
    return "LAST_90_DAYS";
  }
  return "LAST_30_DAYS";
}

export function rangeLabel(range: CostRange): string {
  if (range === "7d") {
    return "cost.rangeLast7d";
  }
  if (range === "mtd") {
    return "cost.rangeMonthToDate";
  }
  if (range === "90d") {
    return "cost.rangeLast90d";
  }
  return "cost.rangeLast30d";
}

export function rangeLabelKey(range: CostRange): string {
  if (range === "7d") {
    return "cost.range7d";
  }
  if (range === "30d") {
    return "cost.range30d";
  }
  if (range === "mtd") {
    return "cost.rangeMtd";
  }
  return "cost.range90d";
}

export function tokensTotal(row: Pick<CostTotals, "inputTokens" | "outputTokens">): number {
  return row.inputTokens + row.outputTokens;
}

export function cacheHitRate(row: Pick<CostTotals, "cacheReadTokens" | "inputTokens">): number {
  return row.inputTokens > 0 ? row.cacheReadTokens / row.inputTokens : 0;
}

export function costDelta(current: CostTotals, previous?: CostTotals): number {
  if (!previous || previous.totalCostUsd === 0) {
    return 0;
  }

  return (current.totalCostUsd - previous.totalCostUsd) / previous.totalCostUsd;
}

export function modelColor(model: string): string {
  const normalized = model.toLowerCase();

  if (normalized.includes("opus")) {
    return "bg-green-700";
  }
  if (normalized.includes("sonnet")) {
    return "bg-green-500";
  }
  if (normalized.includes("gemini")) {
    return "bg-sky";
  }
  if (normalized.includes("qwen")) {
    return "bg-amber";
  }
  return "bg-ink-500";
}

export function agentCostChange(agent: CostAgentRow): number | null {
  if (agent.previousCostUsd === null || agent.previousCostUsd <= 0) {
    return null;
  }

  return (agent.totalCostUsd - agent.previousCostUsd) / agent.previousCostUsd;
}

export function sortCostAgents(agents: CostAgentRow[], sort: AgentCostSort): CostAgentRow[] {
  return [...agents].toSorted((left, right) => {
    if (sort === "cost_asc") {
      return left.totalCostUsd - right.totalCostUsd;
    }

    if (sort === "runs_desc") {
      return right.requestCount - left.requestCount;
    }

    if (sort === "spike_desc") {
      return (agentCostChange(right) ?? -Infinity) - (agentCostChange(left) ?? -Infinity);
    }

    return right.totalCostUsd - left.totalCostUsd;
  });
}

export function runMixSegments(agent: CostAgentRow): RunMixSegment[] {
  return [
    { className: "bg-green-600", label: "Production", value: agent.productionCostUsd },
    { className: "bg-amber", label: "Debug", value: agent.debugCostUsd + agent.previewCostUsd },
  ].filter((segment) => segment.value > 0);
}

function formatPricePerMillion(
  value: number | null,
  t: (key: string) => string,
  locale: SupportedLocale,
): string {
  return value === null ? t("cost.unknown") : `$${new Intl.NumberFormat(locale).format(value)}`;
}

export function formatModelPricingSummary(
  model: CostModelRow,
  t: (key: string) => string,
  locale: SupportedLocale = getCurrentLocale(),
): ModelPricingSummary {
  return {
    cacheHitLabel: formatPlainPercent(cacheHitRate(model), locale),
    cacheReadPriceLabel: formatPricePerMillion(model.cacheReadUsdPerMillion, t, locale),
    cacheWritePriceLabel: formatPricePerMillion(model.cacheWriteUsdPerMillion, t, locale),
    inputOutputPriceLabel:
      model.inputUsdPerMillion === null || model.outputUsdPerMillion === null
        ? t("cost.unknown")
        : `$${model.inputUsdPerMillion}/$${model.outputUsdPerMillion}`,
    needsPricingAction:
      model.unpricedRequestCount > 0 ||
      model.inputUsdPerMillion === null ||
      model.outputUsdPerMillion === null,
  };
}

export function summarizeCostVendors(models: CostModelRow[]): CostVendorRow[] {
  const rows = new Map<string, CostVendorRow>();

  for (const model of models) {
    const current = rows.get(model.vendor) ?? {
      modelCount: 0,
      requestCount: 0,
      totalCostUsd: 0,
      vendor: model.vendor,
    };

    rows.set(model.vendor, {
      ...current,
      modelCount: current.modelCount + 1,
      requestCount: current.requestCount + model.requestCount,
      totalCostUsd: current.totalCostUsd + model.totalCostUsd,
    });
  }

  return [...rows.values()].toSorted((left, right) => right.totalCostUsd - left.totalCostUsd);
}

export type {
  CostAgentRow,
  CostAttributionCard,
  CostDailyPoint,
  CostRunPurpose,
  CostModelRow,
  CostRecentSession,
  CostTotals,
  OrganizationBillingCostCard,
  AppCostCard,
};
