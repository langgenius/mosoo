import type { CostAttributionCard } from "@/domains/cost/api/cost-client";

type TranslateFn = (key: string, variables?: Record<string, string>) => string;

export function downloadCsv(filename: string, rows: string[][]) {
  const body = rows
    .map((row) => row.map((value) => `"${value.replaceAll('"', '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([body], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function exportAttributionCostCsv(
  filename: string,
  card: CostAttributionCard | undefined,
  t: TranslateFn,
) {
  if (!card) {
    return;
  }

  downloadCsv(filename, [
    ["scope", "kind", "name", "secondary", "cost", "quantity"],
    ["cost", "summary", "total_cost", "", String(card.totals.totalCostUsd), ""],
    ["cost", "summary", "requests", "", "", String(card.totals.requestCount)],
    ["cost", "summary", "input_tokens", "", "", String(card.totals.inputTokens)],
    ["cost", "summary", "output_tokens", "", "", String(card.totals.outputTokens)],
    ["cost", "summary", "cache_read_tokens", "", "", String(card.totals.cacheReadTokens)],
    ...card.agents.map((agent) => [
      "cost",
      "agent",
      agent.agentName,
      agent.ownerName,
      String(agent.totalCostUsd),
      t("cost.csvRequests", { count: String(agent.requestCount) }),
    ]),
    ...card.models.map((model) => [
      "cost",
      "model",
      model.vendor,
      model.model,
      String(model.totalCostUsd),
      t("cost.csvRequestsUnpriced", {
        count: String(model.requestCount),
        unpriced: String(model.unpricedRequestCount),
      }),
    ]),
  ]);
}
