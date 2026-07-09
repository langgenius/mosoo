import type { PricingStatus } from "./usage-contract";

export interface ModelPricing {
  cacheReadUsdPerMillion: number;
  cacheWriteUsdPerMillion: number;
  inputUsdPerMillion: number;
  model: string;
  outputUsdPerMillion: number;
  provider: string;
  vendor: string;
}

export interface CostCalculationResult {
  priceSnapshotJson: string | null;
  pricing: ModelPricing | null;
  pricingStatus: PricingStatus;
  totalCostUsd: number;
}

export interface ModelPricingLookup {
  atMs?: number;
  modelId: string;
  providerId: string;
}

interface ModelPricingScheduleEntry extends ModelPricing {
  effectiveFromMs?: number;
  effectiveUntilMs?: number;
}

const CLAUDE_SONNET_5_STANDARD_PRICE_START_MS = Date.UTC(2026, 8, 1);
const OPENAI_LONG_CONTEXT_INPUT_THRESHOLD = 272_000;
const OPENAI_LONG_CONTEXT_MODEL_IDS = new Set([
  "gpt-5.4",
  "gpt-5.5",
  "gpt-5.6-luna",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
]);

const MODEL_PRICING: readonly ModelPricingScheduleEntry[] = [
  {
    ...anthropicPricing({
      inputUsdPerMillion: 2,
      model: "claude-sonnet-5",
      outputUsdPerMillion: 10,
    }),
    effectiveUntilMs: CLAUDE_SONNET_5_STANDARD_PRICE_START_MS,
  },
  {
    ...anthropicPricing({
      inputUsdPerMillion: 3,
      model: "claude-sonnet-5",
      outputUsdPerMillion: 15,
    }),
    effectiveFromMs: CLAUDE_SONNET_5_STANDARD_PRICE_START_MS,
  },
  anthropicPricing({
    inputUsdPerMillion: 10,
    model: "claude-fable-5",
    outputUsdPerMillion: 50,
  }),
  anthropicPricing({
    inputUsdPerMillion: 15,
    model: "claude-opus-4-7",
    outputUsdPerMillion: 75,
  }),
  anthropicPricing({
    inputUsdPerMillion: 15,
    model: "claude-opus-4-6",
    outputUsdPerMillion: 75,
  }),
  anthropicPricing({
    inputUsdPerMillion: 15,
    model: "claude-opus-4-5",
    outputUsdPerMillion: 75,
  }),
  anthropicPricing({
    inputUsdPerMillion: 3,
    model: "claude-sonnet-4-6",
    outputUsdPerMillion: 15,
  }),
  anthropicPricing({
    inputUsdPerMillion: 3,
    model: "claude-sonnet-4-5",
    outputUsdPerMillion: 15,
  }),
  anthropicPricing({
    inputUsdPerMillion: 0.8,
    model: "claude-haiku-4-5",
    outputUsdPerMillion: 4,
  }),
  openAiPricing({
    inputUsdPerMillion: 5,
    model: "gpt-5.6-sol",
    outputUsdPerMillion: 30,
  }),
  openAiPricing({
    inputUsdPerMillion: 2.5,
    model: "gpt-5.6-terra",
    outputUsdPerMillion: 15,
  }),
  openAiPricing({
    inputUsdPerMillion: 1,
    model: "gpt-5.6-luna",
    outputUsdPerMillion: 6,
  }),
  openAiPricing({
    inputUsdPerMillion: 5,
    model: "gpt-5.5",
    outputUsdPerMillion: 30,
  }),
  openAiPricing({
    inputUsdPerMillion: 2.5,
    model: "gpt-5.4",
    outputUsdPerMillion: 15,
  }),
  openAiPricing({
    inputUsdPerMillion: 0.75,
    model: "gpt-5.4-mini",
    outputUsdPerMillion: 4.5,
  }),
  openAiPricing({
    inputUsdPerMillion: 1.75,
    model: "gpt-5.3",
    outputUsdPerMillion: 14,
  }),
  openAiPricing({
    inputUsdPerMillion: 1.75,
    model: "gpt-5.2",
    outputUsdPerMillion: 14,
  }),
  deepseekPricing({
    cacheReadUsdPerMillion: 0.003625,
    inputUsdPerMillion: 0.435,
    model: "deepseek-v4-pro",
    outputUsdPerMillion: 0.87,
  }),
  deepseekPricing({
    cacheReadUsdPerMillion: 0.0028,
    inputUsdPerMillion: 0.14,
    model: "deepseek-v4-flash",
    outputUsdPerMillion: 0.28,
  }),
  providerPricing({
    cacheReadUsdPerMillion: 0.15,
    inputUsdPerMillion: 1.5,
    model: "gemini-3.5-flash",
    outputUsdPerMillion: 9,
    provider: "gemini",
    vendor: "Google",
  }),
  providerPricing({
    cacheReadUsdPerMillion: 0.0552,
    inputUsdPerMillion: 0.276,
    model: "qwen3.7-plus",
    outputUsdPerMillion: 1.101,
    provider: "qwen",
    vendor: "Alibaba",
  }),
  providerPricing({
    cacheReadUsdPerMillion: 0.0552,
    inputUsdPerMillion: 0.276,
    model: "qwen3.6-plus",
    outputUsdPerMillion: 1.651,
    provider: "qwen",
    vendor: "Alibaba",
  }),
  providerPricing({
    cacheReadUsdPerMillion: 0.16,
    inputUsdPerMillion: 0.95,
    model: "kimi-k2.6",
    outputUsdPerMillion: 4,
    provider: "kimi",
    vendor: "Moonshot AI",
  }),
  providerPricing({
    cacheReadUsdPerMillion: 0.19,
    inputUsdPerMillion: 0.95,
    model: "kimi-k2.7-code",
    outputUsdPerMillion: 4,
    provider: "kimi",
    vendor: "Moonshot AI",
  }),
  providerPricing({
    cacheReadUsdPerMillion: 0.11,
    inputUsdPerMillion: 0.6,
    model: "glm-4.7",
    outputUsdPerMillion: 2.2,
    provider: "zhipu",
    vendor: "Z.ai",
  }),
  providerPricing({
    cacheReadUsdPerMillion: 0.11,
    inputUsdPerMillion: 0.6,
    model: "glm-4.6",
    outputUsdPerMillion: 2.2,
    provider: "zhipu",
    vendor: "Z.ai",
  }),
  providerPricing({
    cacheReadUsdPerMillion: 0.09,
    inputUsdPerMillion: 0.45,
    model: "MiniMax-M3",
    outputUsdPerMillion: 1.8,
    provider: "minimax",
    vendor: "MiniMax",
  }),
  providerPricing({
    cacheReadUsdPerMillion: 0.06,
    cacheWriteUsdPerMillion: 0.375,
    inputUsdPerMillion: 0.3,
    model: "MiniMax-M2.7",
    outputUsdPerMillion: 1.2,
    provider: "minimax",
    vendor: "MiniMax",
  }),
  // Keep legacy upstream provider IDs for usage rows written before Mosoo provider IDs were canonical.
  providerPricing({
    cacheReadUsdPerMillion: 0.125,
    cacheWriteUsdPerMillion: 1.875,
    inputUsdPerMillion: 1.25,
    model: "gemini-2.5-pro",
    outputUsdPerMillion: 10,
    provider: "google",
    vendor: "Google",
  }),
  providerPricing({
    cacheReadUsdPerMillion: 0.12,
    cacheWriteUsdPerMillion: 1.5,
    inputUsdPerMillion: 1.2,
    model: "qwen3-max",
    outputUsdPerMillion: 6,
    provider: "alibaba",
    vendor: "Alibaba",
  }),
  opencodePricing({
    cacheReadUsdPerMillion: 0.145,
    inputUsdPerMillion: 1.74,
    model: "deepseek-v4-pro",
    outputUsdPerMillion: 3.48,
  }),
  opencodePricing({
    cacheReadUsdPerMillion: 0.05,
    cacheWriteUsdPerMillion: 0.625,
    inputUsdPerMillion: 0.5,
    model: "qwen3.6-plus",
    outputUsdPerMillion: 3,
  }),
  opencodePricing({
    cacheReadUsdPerMillion: 0.26,
    inputUsdPerMillion: 1.4,
    model: "glm-5.2",
    outputUsdPerMillion: 4.4,
  }),
  opencodePricing({
    cacheReadUsdPerMillion: 0.06,
    cacheWriteUsdPerMillion: 0.375,
    inputUsdPerMillion: 0.3,
    model: "minimax-m2.7",
    outputUsdPerMillion: 1.2,
  }),
  opencodePricing({
    cacheReadUsdPerMillion: 0.15,
    inputUsdPerMillion: 1.5,
    model: "gemini-3.5-flash",
    outputUsdPerMillion: 9,
  }),
];

function anthropicPricing(input: {
  inputUsdPerMillion: number;
  model: string;
  outputUsdPerMillion: number;
}): ModelPricing {
  return {
    cacheReadUsdPerMillion: scalePrice(input.inputUsdPerMillion, 0.1),
    cacheWriteUsdPerMillion: scalePrice(input.inputUsdPerMillion, 1.25),
    inputUsdPerMillion: input.inputUsdPerMillion,
    model: input.model,
    outputUsdPerMillion: input.outputUsdPerMillion,
    provider: "anthropic",
    vendor: "Anthropic",
  };
}

function openAiPricing(input: {
  inputUsdPerMillion: number;
  model: string;
  outputUsdPerMillion: number;
}): ModelPricing {
  return {
    cacheReadUsdPerMillion: scalePrice(input.inputUsdPerMillion, 0.1),
    cacheWriteUsdPerMillion: scalePrice(input.inputUsdPerMillion, 1.25),
    inputUsdPerMillion: input.inputUsdPerMillion,
    model: input.model,
    outputUsdPerMillion: input.outputUsdPerMillion,
    provider: "openai",
    vendor: "OpenAI",
  };
}

function deepseekPricing(input: {
  cacheReadUsdPerMillion: number;
  cacheWriteUsdPerMillion?: number;
  inputUsdPerMillion: number;
  model: string;
  outputUsdPerMillion: number;
}): ModelPricing {
  return {
    cacheReadUsdPerMillion: input.cacheReadUsdPerMillion,
    cacheWriteUsdPerMillion: input.cacheWriteUsdPerMillion ?? 0,
    inputUsdPerMillion: input.inputUsdPerMillion,
    model: input.model,
    outputUsdPerMillion: input.outputUsdPerMillion,
    provider: "deepseek",
    vendor: "DeepSeek",
  };
}

function providerPricing(input: {
  cacheReadUsdPerMillion: number;
  cacheWriteUsdPerMillion?: number;
  inputUsdPerMillion: number;
  model: string;
  outputUsdPerMillion: number;
  provider: string;
  vendor: string;
}): ModelPricing {
  return {
    cacheReadUsdPerMillion: input.cacheReadUsdPerMillion,
    cacheWriteUsdPerMillion: input.cacheWriteUsdPerMillion ?? 0,
    inputUsdPerMillion: input.inputUsdPerMillion,
    model: input.model,
    outputUsdPerMillion: input.outputUsdPerMillion,
    provider: input.provider,
    vendor: input.vendor,
  };
}

function opencodePricing(input: {
  cacheReadUsdPerMillion: number;
  cacheWriteUsdPerMillion?: number;
  inputUsdPerMillion: number;
  model: string;
  outputUsdPerMillion: number;
}): ModelPricing {
  return {
    cacheReadUsdPerMillion: input.cacheReadUsdPerMillion,
    cacheWriteUsdPerMillion: input.cacheWriteUsdPerMillion ?? 0,
    inputUsdPerMillion: input.inputUsdPerMillion,
    model: input.model,
    outputUsdPerMillion: input.outputUsdPerMillion,
    provider: "opencode",
    vendor: "OpenCode Zen",
  };
}

function scalePrice(value: number, factor: number): number {
  return Number((value * factor).toFixed(6));
}

function normalizeProviderId(providerId: string): string {
  return providerId.trim().toLowerCase();
}

function normalizeModelId(modelId: string): string {
  return modelId.trim().toLowerCase();
}

function stripProviderPrefix(modelId: string): string {
  const separatorIndex = modelId.lastIndexOf("/");

  return separatorIndex === -1 ? modelId : modelId.slice(separatorIndex + 1);
}

function stripContextWindowSuffix(modelId: string): string {
  return modelId.replace(/\[[^\]]+\]$/u, "");
}

function stripVersionSuffix(modelId: string): string {
  return modelId.replace(/-(?:latest|\d{8}|\d{4}-\d{2}-\d{2})$/u, "");
}

function normalizeAnthropicSeparator(modelId: string): string {
  return modelId.startsWith("claude-") ? modelId.replace(/\./gu, "-") : modelId;
}

function appendModelKey(keys: string[], modelId: string): void {
  const normalizedModelId = normalizeModelId(modelId);

  if (normalizedModelId.length === 0) {
    return;
  }

  const candidates = [
    normalizedModelId,
    stripProviderPrefix(normalizedModelId),
    stripContextWindowSuffix(normalizedModelId),
    stripVersionSuffix(normalizedModelId),
    stripVersionSuffix(stripContextWindowSuffix(stripProviderPrefix(normalizedModelId))),
    normalizeAnthropicSeparator(normalizedModelId),
  ];

  for (const candidate of candidates) {
    if (candidate.length > 0 && !keys.includes(candidate)) {
      keys.push(candidate);
    }
  }
}

function modelLookupKeys(modelId: string): readonly string[] {
  const keys: string[] = [];

  appendModelKey(keys, modelId);

  return keys;
}

function pricingMapKey(providerId: string, modelId: string): string {
  return `${normalizeProviderId(providerId)}:${normalizeModelId(modelId)}`;
}

function buildPricingMap(): ReadonlyMap<string, readonly ModelPricingScheduleEntry[]> {
  const pricingMap = new Map<string, ModelPricingScheduleEntry[]>();

  for (const pricing of MODEL_PRICING) {
    const key = pricingMapKey(pricing.provider, pricing.model);
    const entries = pricingMap.get(key) ?? [];

    entries.push(pricing);
    pricingMap.set(key, entries);
  }

  return pricingMap;
}

function isPricingEffective(pricing: ModelPricingScheduleEntry, atMs: number): boolean {
  return (
    (pricing.effectiveFromMs === undefined || atMs >= pricing.effectiveFromMs) &&
    (pricing.effectiveUntilMs === undefined || atMs < pricing.effectiveUntilMs)
  );
}

function toModelPricing(pricing: ModelPricingScheduleEntry): ModelPricing {
  return {
    cacheReadUsdPerMillion: pricing.cacheReadUsdPerMillion,
    cacheWriteUsdPerMillion: pricing.cacheWriteUsdPerMillion,
    inputUsdPerMillion: pricing.inputUsdPerMillion,
    model: pricing.model,
    outputUsdPerMillion: pricing.outputUsdPerMillion,
    provider: pricing.provider,
    vendor: pricing.vendor,
  };
}

const PRICING_BY_PROVIDER_MODEL = buildPricingMap();

export function findModelPricing(input: ModelPricingLookup): ModelPricing | null {
  const atMs = input.atMs ?? Date.now();
  const providerId = normalizeProviderId(input.providerId);

  for (const modelId of modelLookupKeys(input.modelId)) {
    const pricing = PRICING_BY_PROVIDER_MODEL.get(`${providerId}:${modelId}`)?.find((entry) =>
      isPricingEffective(entry, atMs),
    );

    if (pricing) {
      return toModelPricing(pricing);
    }
  }

  return null;
}

export function calculateUsageCost(input: {
  cacheCreationTokens: number;
  cacheReadTokens: number;
  inputTokens: number;
  model: string;
  outputTokens: number;
  pricedAtMs?: number;
  providedCostUsd?: number | null;
  provider: string;
}): CostCalculationResult {
  const pricing = findModelPricing({
    ...(input.pricedAtMs === undefined ? {} : { atMs: input.pricedAtMs }),
    modelId: input.model,
    providerId: input.provider,
  });

  if (!pricing) {
    return {
      priceSnapshotJson: null,
      pricing,
      pricingStatus: "unknown",
      totalCostUsd: input.providedCostUsd ?? 0,
    };
  }

  const longContextApplied =
    pricing.provider === "openai" &&
    OPENAI_LONG_CONTEXT_MODEL_IDS.has(pricing.model) &&
    input.inputTokens > OPENAI_LONG_CONTEXT_INPUT_THRESHOLD;
  const inputPriceFactor = longContextApplied ? 2 : 1;
  const outputPriceFactor = longContextApplied ? 1.5 : 1;
  const effectivePricing: ModelPricing = {
    ...pricing,
    cacheReadUsdPerMillion: scalePrice(pricing.cacheReadUsdPerMillion, inputPriceFactor),
    cacheWriteUsdPerMillion: scalePrice(pricing.cacheWriteUsdPerMillion, inputPriceFactor),
    inputUsdPerMillion: scalePrice(pricing.inputUsdPerMillion, inputPriceFactor),
    outputUsdPerMillion: scalePrice(pricing.outputUsdPerMillion, outputPriceFactor),
  };
  const billableInputTokens = Math.max(0, input.inputTokens - input.cacheReadTokens);
  const inputCost = (billableInputTokens * effectivePricing.inputUsdPerMillion) / 1_000_000;
  const outputCost = (input.outputTokens * effectivePricing.outputUsdPerMillion) / 1_000_000;
  const cacheReadCost =
    (input.cacheReadTokens * effectivePricing.cacheReadUsdPerMillion) / 1_000_000;
  const cacheWriteCost =
    (input.cacheCreationTokens * effectivePricing.cacheWriteUsdPerMillion) / 1_000_000;
  const totalCostUsd = inputCost + outputCost + cacheReadCost + cacheWriteCost;

  return {
    priceSnapshotJson: JSON.stringify({
      billableInputTokens,
      cacheReadUsdPerMillion: effectivePricing.cacheReadUsdPerMillion,
      cacheWriteUsdPerMillion: effectivePricing.cacheWriteUsdPerMillion,
      inputUsdPerMillion: effectivePricing.inputUsdPerMillion,
      longContextApplied,
      model: effectivePricing.model,
      outputUsdPerMillion: effectivePricing.outputUsdPerMillion,
      provider: effectivePricing.provider,
      source: "mosoo_seed_2026_07_10",
    }),
    pricing: effectivePricing,
    pricingStatus: "priced",
    totalCostUsd,
  };
}
