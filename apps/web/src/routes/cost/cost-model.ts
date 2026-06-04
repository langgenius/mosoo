import type {
  CostAgentRow,
  CostAttributionCard,
  CostDailyPoint,
  CostModelRow,
  CostRangeInput,
  CostRecentSession,
  CostRunPurpose,
  CostTotals,
  CostUserRow,
  MemberCostCard,
  OrganizationCostCard,
} from "@/domains/cost/api/cost-client";

export const COST_RANGES = ["7d", "30d", "mtd", "90d"] as const;

export type CostRange = (typeof COST_RANGES)[number];
export type CostTab = "overview" | "agents" | "users" | "models";
export type UserCostMode = "owned_by" | "used_by";
export type AgentCostSort = "cost_asc" | "cost_desc" | "runs_desc" | "spike_desc";
export type UserCostSort = "cost_asc" | "cost_desc" | "runs_desc" | "spike_desc" | "top_agent";

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

export const COST_TABS: { id: CostTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "agents", label: "By Agent" },
  { id: "users", label: "By User" },
  { id: "models", label: "By Model" },
];

export const RUN_PURPOSE_FILTERS: { label: string; value: CostRunPurpose | "all" }[] = [
  { label: "All", value: "all" },
  { label: "Production", value: "production" },
  { label: "Debug", value: "debug" },
  { label: "Preview", value: "preview" },
];

const CURRENCY_FORMATTER_PRECISE = new Intl.NumberFormat(undefined, {
  currency: "USD",
  maximumFractionDigits: 2,
  style: "currency",
});

const CURRENCY_FORMATTER_WHOLE = new Intl.NumberFormat(undefined, {
  currency: "USD",
  maximumFractionDigits: 0,
  style: "currency",
});

const COMPACT_NUMBER_FORMATTER = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 1,
  notation: "compact",
});

export function formatCurrency(value: number): string {
  return (value >= 100 ? CURRENCY_FORMATTER_WHOLE : CURRENCY_FORMATTER_PRECISE).format(value);
}

export function formatCompactNumber(value: number): string {
  return COMPACT_NUMBER_FORMATTER.format(value);
}

export function formatPercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${Math.round(value * 100)}%`;
}

export function formatPlainPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
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
    return "Last 7 days";
  }
  if (range === "mtd") {
    return "Month to date";
  }
  if (range === "90d") {
    return "Last 90 days";
  }
  return "Last 30 days";
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

export function userCostChange(user: CostUserRow): number | null {
  if (user.previousCostUsd === null || user.previousCostUsd <= 0) {
    return null;
  }

  return (user.totalCostUsd - user.previousCostUsd) / user.previousCostUsd;
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

export function sortCostUsers(users: CostUserRow[], sort: UserCostSort): CostUserRow[] {
  return [...users].toSorted((left, right) => {
    if (sort === "cost_asc") {
      return left.totalCostUsd - right.totalCostUsd;
    }

    if (sort === "runs_desc") {
      return right.requestCount - left.requestCount;
    }

    if (sort === "spike_desc") {
      return (userCostChange(right) ?? -Infinity) - (userCostChange(left) ?? -Infinity);
    }

    if (sort === "top_agent") {
      return (left.topAgentName ?? "\uFFFF").localeCompare(right.topAgentName ?? "\uFFFF");
    }

    return right.totalCostUsd - left.totalCostUsd;
  });
}

export function filterCostUsers(users: CostUserRow[], query: string): CostUserRow[] {
  const normalized = query.trim().toLowerCase();

  if (!normalized) {
    return users;
  }

  return users.filter((user) =>
    [user.userName, user.userEmail, user.topAgentName]
      .filter((value): value is string => Boolean(value))
      .some((value) => value.toLowerCase().includes(normalized)),
  );
}

export function runMixSegments(agent: CostAgentRow): RunMixSegment[] {
  return [
    { className: "bg-green-600", label: "Production", value: agent.productionCostUsd },
    { className: "bg-amber", label: "Debug", value: agent.debugCostUsd },
    { className: "bg-sky", label: "Preview", value: agent.previewCostUsd },
  ].filter((segment) => segment.value > 0);
}

function formatPricePerMillion(value: number | null): string {
  return value === null ? "Unknown" : `$${value}`;
}

export function formatModelPricingSummary(model: CostModelRow): ModelPricingSummary {
  return {
    cacheHitLabel: formatPlainPercent(cacheHitRate(model)),
    cacheReadPriceLabel: formatPricePerMillion(model.cacheReadUsdPerMillion),
    cacheWritePriceLabel: formatPricePerMillion(model.cacheWriteUsdPerMillion),
    inputOutputPriceLabel:
      model.inputUsdPerMillion === null || model.outputUsdPerMillion === null
        ? "Unknown"
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
  MemberCostCard,
  CostModelRow,
  CostRecentSession,
  CostTotals,
  CostUserRow,
  OrganizationCostCard,
};
