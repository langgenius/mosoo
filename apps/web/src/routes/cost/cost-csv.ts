import type { CostAttributionCard, MemberCostCard } from "./cost-model";

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

function attributionCsvRows(label: string, card: CostAttributionCard): string[][] {
  return [
    [label, "summary", "total_cost", "", String(card.totals.totalCostUsd), ""],
    [label, "summary", "requests", "", "", String(card.totals.requestCount)],
    [label, "summary", "input_tokens", "", "", String(card.totals.inputTokens)],
    [label, "summary", "output_tokens", "", "", String(card.totals.outputTokens)],
    [label, "summary", "cache_read_tokens", "", "", String(card.totals.cacheReadTokens)],
    ...card.agents.map((agent) => [
      label,
      "agent",
      agent.agentName,
      agent.ownerName,
      String(agent.totalCostUsd),
      `${agent.requestCount} requests`,
    ]),
    ...card.models.map((model) => [
      label,
      "model",
      model.vendor,
      model.model,
      String(model.totalCostUsd),
      `${model.requestCount} requests; unpriced ${model.unpricedRequestCount}`,
    ]),
    ...card.recentSessions.map((session) => [
      label,
      "session",
      session.actorName,
      session.model,
      String(session.totalCostUsd),
      String(session.inputTokens + session.outputTokens),
    ]),
  ];
}

export function exportAttributionCostCsv(filename: string, card: CostAttributionCard | undefined) {
  if (!card) {
    return;
  }

  downloadCsv(filename, [
    ["scope", "kind", "name", "secondary", "cost", "quantity"],
    ...attributionCsvRows("cost", card),
  ]);
}

export function exportMemberUsageCsv(card: MemberCostCard | undefined) {
  if (!card) {
    return;
  }

  downloadCsv("my-usage.csv", [
    ["scope", "kind", "name", "secondary", "cost", "quantity"],
    ...attributionCsvRows("used_by_me", card.used),
    ...attributionCsvRows("owned_by_me", card.owned),
  ]);
}
