import { readRecord } from "./app-server-json";
import type { JsonObject } from "./app-server-json";

function readNonNegativeNumber(value: JsonObject | null, key: string): number | null {
  const entry = value?.[key];

  return typeof entry === "number" && Number.isFinite(entry) && entry >= 0 ? entry : null;
}

export function toOpenAiErrorMessage(message: string, additionalDetails: string | null): string {
  const details = additionalDetails?.trim();

  if (!details || details === message) {
    return message;
  }

  return `${message}\n${details}`;
}

export function toOpenAiSessionUsageSummary(params: JsonObject) {
  const tokenUsage = readRecord(params, "tokenUsage");
  const usage =
    readRecord(tokenUsage, "last") ??
    readRecord(tokenUsage, "total") ??
    readRecord(params, "usage") ??
    params;

  return {
    cachedReadTokens: readNonNegativeNumber(usage, "cachedInputTokens"),
    cachedWriteTokens: null,
    costAmount: null,
    costCurrency: null,
    inputTokens: readNonNegativeNumber(usage, "inputTokens"),
    outputTokens: readNonNegativeNumber(usage, "outputTokens"),
    size: null,
    source: "session_update" as const,
    thoughtTokens:
      readNonNegativeNumber(usage, "reasoningOutputTokens") ??
      readNonNegativeNumber(usage, "reasoningTokens"),
    totalTokens: readNonNegativeNumber(usage, "totalTokens"),
    usageContract: "openai_runtime_total_with_cached_breakdown" as const,
    used: null,
  };
}

export function toOpenAiPlanStatus(status: string | null): "pending" | "in_progress" | "completed" {
  if (status === "inProgress") {
    return "in_progress";
  }

  if (status === "completed") {
    return "completed";
  }

  return "pending";
}
