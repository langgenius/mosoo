import prices from "../data/models-dev.json" with { type: "json" };
import { MODELS_DEV_API_URL } from "./models-dev-pricing";
import type { ModelsDevCost, ModelsDevPrices, ModelsDevRates } from "./models-dev-pricing";
import type { PricingStatus } from "./usage-contract";

interface PricingRates {
  cacheReadUsdPerMillion: number;
  cacheWriteUsdPerMillion: number;
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
}

interface ModelPricingContextTier extends PricingRates {
  thresholdTokens: number;
}

export interface ModelPricing extends PricingRates {
  contextTiers: readonly ModelPricingContextTier[];
  model: string;
  provider: string;
  source: string;
  vendor: string;
}

export interface CostCalculationResult {
  priceSnapshotJson: string | null;
  pricingStatus: PricingStatus;
  totalCostUsd: number;
}

export interface ModelPricingLookup {
  modelId: string;
  providerId: string;
}

export interface UsageCostInput {
  contextTiersAvailable?: boolean;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  inputTokens: number;
  model: string;
  outputTokens: number;
  providedCostUsd?: number | null;
  provider: string;
}

export interface ModelsDevPricingCatalog {
  findModelPricing: (input: ModelPricingLookup) => ModelPricing | null;
  calculateUsageCost: (input: UsageCostInput) => CostCalculationResult;
}

const VENDOR_BY_PROVIDER: Readonly<Record<string, string>> = {
  anthropic: "Anthropic",
  deepseek: "DeepSeek",
  gemini: "Google",
  kimi: "Moonshot AI",
  minimax: "MiniMax",
  openai: "OpenAI",
  opencode: "OpenCode Zen",
  qwen: "Alibaba",
  zhipu: "Z.ai",
};

// Retain the reviewed Mosoo rates for the preset absent from models.dev.
const PRICING_OVERRIDES: ModelsDevPrices = {
  openai: {
    "gpt-5.3": { input: 1.75, output: 14, cache_read: 0.175 },
  },
};

function finiteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function pricingRates(cost: ModelsDevRates): PricingRates | null {
  if (
    !finiteNonNegative(cost.input) ||
    !finiteNonNegative(cost.output) ||
    (cost.cache_read !== undefined && !finiteNonNegative(cost.cache_read)) ||
    (cost.cache_write !== undefined && !finiteNonNegative(cost.cache_write))
  )
    return null;

  return {
    cacheReadUsdPerMillion: cost.cache_read ?? cost.input,
    cacheWriteUsdPerMillion: cost.cache_write ?? cost.input,
    inputUsdPerMillion: cost.input,
    outputUsdPerMillion: cost.output,
  };
}

function modelPricing(
  provider: string,
  model: string,
  cost: ModelsDevCost,
  source: string,
): ModelPricing | null {
  const rates = pricingRates(cost);
  if (rates === null) return null;
  const contextTiers: ModelPricingContextTier[] = [];
  const thresholds = new Set<number>();
  for (const { tier, ...costTier } of cost.tiers ?? []) {
    const tierRates = pricingRates(costTier);
    if (
      tier.type !== "context" ||
      !Number.isInteger(tier.size) ||
      tier.size < 0 ||
      thresholds.has(tier.size) ||
      tierRates === null
    )
      return null;
    thresholds.add(tier.size);
    contextTiers.push({ ...tierRates, thresholdTokens: tier.size });
  }
  return {
    ...rates,
    contextTiers: contextTiers.toSorted((a, b) => a.thresholdTokens - b.thresholdTokens),
    model,
    provider,
    source,
    vendor: VENDOR_BY_PROVIDER[provider] ?? provider,
  };
}

function normalizeModelId(modelId: string): string {
  const normalized = modelId.trim().toLowerCase();
  return normalized.startsWith("claude-") ? normalized.replace(/\./gu, "-") : normalized;
}

function modelCandidates(modelId: string): readonly string[] {
  const exact = modelId.trim().toLowerCase();
  const unprefixed = exact.slice(exact.lastIndexOf("/") + 1);
  const withoutContext = unprefixed.replace(/\[[^\]]+\]$/u, "");
  const withoutVersion = withoutContext.replace(/-(?:latest|\d{8}|\d{4}-\d{2}-\d{2})$/u, "");
  return [...new Set([exact, unprefixed, withoutContext, withoutVersion].map(normalizeModelId))];
}

export function createModelsDevPricingCatalog(snapshot: ModelsDevPrices): ModelsDevPricingCatalog {
  const entries = new Map<string, ModelPricing>();
  for (const [data, source] of [
    [snapshot, MODELS_DEV_API_URL],
    [PRICING_OVERRIDES, "mosoo_override"],
  ] as const) {
    for (const [provider, models] of Object.entries(data)) {
      for (const [model, cost] of Object.entries(models)) {
        if (source === "mosoo_override" && entries.has(`${provider}:${normalizeModelId(model)}`)) {
          throw new Error(`Pricing override now exists in models.dev: ${provider}/${model}`);
        }
        const pricing = modelPricing(provider, model, cost, source);
        if (pricing !== null) entries.set(`${provider}:${normalizeModelId(model)}`, pricing);
      }
    }
  }
  const findPricing = ({ modelId, providerId }: ModelPricingLookup): ModelPricing | null => {
    const provider = providerId.trim().toLowerCase();
    for (const candidate of modelCandidates(modelId)) {
      const pricing = entries.get(`${provider}:${candidate}`);
      if (pricing !== undefined) return pricing;
    }
    return null;
  };
  return {
    findModelPricing: findPricing,
    calculateUsageCost: (input: UsageCostInput) => calculateUsageCostWithLookup(findPricing, input),
  };
}

function calculateUsageCostWithLookup(
  findPricing: (input: ModelPricingLookup) => ModelPricing | null,
  input: UsageCostInput,
): CostCalculationResult {
  const pricing = findPricing({ modelId: input.model, providerId: input.provider });
  const tokensUnavailable =
    input.cacheCreationTokens === 0 &&
    input.cacheReadTokens === 0 &&
    input.inputTokens === 0 &&
    input.outputTokens === 0;
  if (tokensUnavailable && input.providedCostUsd !== null && input.providedCostUsd !== undefined) {
    return {
      priceSnapshotJson:
        pricing === null
          ? null
          : JSON.stringify({
              model: pricing.model,
              provider: pricing.provider,
              reportedCostUsd: input.providedCostUsd,
              source: "runtime_reported_usd",
              tokenCountersUnavailable: true,
            }),
      pricingStatus: pricing === null ? "unknown" : "priced",
      totalCostUsd: input.providedCostUsd,
    };
  }
  if (pricing === null) {
    return {
      priceSnapshotJson: null,
      pricingStatus: "unknown",
      totalCostUsd: input.providedCostUsd ?? 0,
    };
  }

  // Normalized input includes cache reads; cache writes are a separate bucket.
  const contextTokens = input.inputTokens + input.cacheCreationTokens;
  const contextTiers = input.contextTiersAvailable === false ? [] : pricing.contextTiers;
  const tier = contextTiers.findLast(({ thresholdTokens }) => contextTokens > thresholdTokens);
  const rates = tier ?? pricing;
  const billableInputTokens = Math.max(0, input.inputTokens - input.cacheReadTokens);
  // Output already includes reasoning. Audio has no separate usage counter.
  const totalCostUsd =
    (billableInputTokens * rates.inputUsdPerMillion +
      input.outputTokens * rates.outputUsdPerMillion +
      input.cacheReadTokens * rates.cacheReadUsdPerMillion +
      input.cacheCreationTokens * rates.cacheWriteUsdPerMillion) /
    1_000_000;
  return {
    priceSnapshotJson: JSON.stringify({
      baseRates: {
        cacheReadUsdPerMillion: pricing.cacheReadUsdPerMillion,
        cacheWriteUsdPerMillion: pricing.cacheWriteUsdPerMillion,
        inputUsdPerMillion: pricing.inputUsdPerMillion,
        outputUsdPerMillion: pricing.outputUsdPerMillion,
      },
      contextTiers,
      billableInputTokens,
      cacheReadUsdPerMillion: rates.cacheReadUsdPerMillion,
      cacheWriteUsdPerMillion: rates.cacheWriteUsdPerMillion,
      inputUsdPerMillion: rates.inputUsdPerMillion,
      longContextApplied: tier !== undefined,
      model: pricing.model,
      outputUsdPerMillion: rates.outputUsdPerMillion,
      provider: pricing.provider,
      source: pricing.source,
    }),
    pricingStatus: "priced",
    totalCostUsd,
  };
}

const DEFAULT_PRICING_CATALOG = createModelsDevPricingCatalog(prices);

export function findModelPricing(input: ModelPricingLookup): ModelPricing | null {
  return DEFAULT_PRICING_CATALOG.findModelPricing(input);
}

export function calculateUsageCost(input: UsageCostInput): CostCalculationResult {
  return DEFAULT_PRICING_CATALOG.calculateUsageCost(input);
}
