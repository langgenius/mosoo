export type UsageContract =
  | "anthropic_bucketed"
  | "openai_runtime_total_with_cached_breakdown"
  | "openai_total_with_cached_breakdown";

export type AgentPublicationStateAtRun =
  | "archived"
  | "draft_of_published"
  | "published"
  | "unpublished";

export type PricingStatus = "priced" | "unknown";

export type RunPurpose = "channel" | "debug" | "eval" | "preview" | "production" | "scheduled";

export interface UsageTokenInput {
  cacheCreationTokens: number;
  cacheReadTokens: number;
  inputTokens: number;
  outputTokens: number;
  usageContract: UsageContract;
}

export interface NormalizedUsageTokens {
  cacheCreationTokens: number;
  cacheReadTokens: number;
  inputTokens: number;
  outputTokens: number;
}

export function normalizeUsageTokens(input: UsageTokenInput): NormalizedUsageTokens {
  if (input.usageContract === "anthropic_bucketed") {
    return {
      cacheCreationTokens: input.cacheCreationTokens,
      cacheReadTokens: input.cacheReadTokens,
      inputTokens: input.inputTokens + input.cacheReadTokens,
      outputTokens: input.outputTokens,
    };
  }

  return {
    cacheCreationTokens: input.cacheCreationTokens,
    cacheReadTokens: input.cacheReadTokens,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
  };
}
