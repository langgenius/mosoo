import { readFile, writeFile } from "node:fs/promises";

import { PRESET_MODEL_CATALOG } from "@mosoo/runtime-catalog";

import { createModelsDevPricingCatalog } from "../src/modules/cost/domain/cost-pricing";
import {
  MODELS_DEV_API_URL,
  MODELS_DEV_PROVIDER_IDS,
} from "../src/modules/cost/domain/models-dev-pricing";
import type {
  ModelsDevCost,
  ModelsDevPrices,
  ModelsDevRates,
} from "../src/modules/cost/domain/models-dev-pricing";

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid models.dev ${label}`);
  }
  return value as Record<string, unknown>;
}

function selectRates(value: unknown, label: string): ModelsDevRates {
  const cost = record(value, label);
  const selected: Record<string, number> = {};
  for (const key of ["input", "output", "cache_read", "cache_write"] as const) {
    const rate = cost[key];
    if (rate === undefined && key.startsWith("cache_")) continue;
    // Units are USD per million tokens. Reject malformed or implausible rows.
    if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0 || rate > 1_000) {
      throw new Error(`Invalid models.dev ${label}.${key}: expected USD/million in [0, 1000]`);
    }
    selected[key] = rate;
  }
  return selected;
}

export function selectModelsDevPrices(payload: unknown): ModelsDevPrices {
  const providers = record(payload, "providers");
  return Object.fromEntries(
    Object.entries(MODELS_DEV_PROVIDER_IDS).map(([providerId, upstreamId]) => {
      if (providers[upstreamId] === undefined) {
        throw new Error(`models.dev provider is missing: ${upstreamId}`);
      }
      const provider = record(providers[upstreamId], upstreamId);
      const models = Object.entries(record(provider.models, `${upstreamId}.models`))
        .toSorted(([a], [b]) => a.localeCompare(b, "en"))
        .flatMap(([modelId, modelValue]) => {
          const label = `${upstreamId}.${modelId}`;
          const { cost } = record(modelValue, label);
          if (cost === undefined) return [];
          const raw = record(cost, `${label}.cost`);
          if (raw.tiers !== undefined && !Array.isArray(raw.tiers)) {
            throw new Error(`Invalid models.dev ${label}.tiers`);
          }
          const thresholds = new Set<number>();
          const tiers = (raw.tiers ?? [])
            .flatMap((value: unknown) => {
              const entry = record(value, `${label}.tier`);
              const tier = record(entry.tier, `${label}.tier`);
              if (typeof tier.type !== "string")
                throw new Error(`Invalid models.dev ${label}.tier.type`);
              if (tier.type !== "context") return [];
              if (
                typeof tier.size !== "number" ||
                !Number.isSafeInteger(tier.size) ||
                tier.size < 0 ||
                thresholds.has(tier.size)
              ) {
                throw new Error(`Invalid models.dev ${label}.tier.size`);
              }
              thresholds.add(tier.size);
              return [{ ...selectRates(entry, label), tier: { type: "context", size: tier.size } }];
            })
            .toSorted((a, b) => a.tier.size - b.tier.size);
          const selected: ModelsDevCost = {
            ...selectRates(cost, label),
            ...(tiers.length === 0 ? {} : { tiers }),
          };
          return [[modelId, selected]];
        });
      return [providerId, Object.fromEntries(models)];
    }),
  );
}

/** Show every preset and flag rate moves of at least 50%, including cache/tier changes. */
export function presetPriceChanges(previous: ModelsDevPrices, next: ModelsDevPrices): string[] {
  const oldCatalog = createModelsDevPricingCatalog(previous);
  const newCatalog = createModelsDevPricingCatalog(next);
  return PRESET_MODEL_CATALOG.filter(
    ({ vendorId }) => MODELS_DEV_PROVIDER_IDS[vendorId] !== undefined,
  ).map(({ vendorId, modelId }) => {
    const lookup = { providerId: vendorId, modelId };
    const before = oldCatalog.findModelPricing(lookup);
    const after = newCatalog.findModelPricing(lookup);
    const fields = [
      "inputUsdPerMillion",
      "outputUsdPerMillion",
      "cacheReadUsdPerMillion",
      "cacheWriteUsdPerMillion",
    ] as const;
    const large =
      before !== null &&
      after !== null &&
      ([before, ...before.contextTiers].some((oldRates, index) => {
        const newRates = [after, ...after.contextTiers][index];
        return (
          newRates === undefined ||
          fields.some(
            (key) =>
              oldRates[key] !== newRates[key] &&
              (oldRates[key] === 0 || Math.abs(newRates[key] / oldRates[key] - 1) >= 0.5),
          )
        );
      }) ||
        before.contextTiers.length !== after.contextTiers.length);
    const rates = (pricing: typeof before) =>
      pricing === null
        ? "MISSING"
        : `${fields.map((key) => pricing[key]).join("/")} tiers=${JSON.stringify(pricing.contextTiers)}`;
    return `${large ? "REVIEW >=50%: " : ""}${vendorId}/${modelId}: ${rates(before)} -> ${rates(after)}`;
  });
}

if (import.meta.main) {
  const response = await fetch(MODELS_DEV_API_URL, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`models.dev returned HTTP ${response.status}`);
  const prices = selectModelsDevPrices(await response.json());
  const target = new URL("../src/modules/cost/data/models-dev.json", import.meta.url);
  const previous = JSON.parse(await readFile(target, "utf8")) as ModelsDevPrices;
  for (const [provider, models] of Object.entries(previous)) {
    for (const model of Object.keys(models)) {
      if (prices[provider]?.[model] === undefined) console.warn(`REMOVED: ${provider}/${model}`);
    }
  }
  console.log(
    "USD/million tokens: input/output/cache-read/cache-write; review all preset changes.",
  );
  console.log(presetPriceChanges(previous, prices).join("\n"));
  await writeFile(target, `${JSON.stringify(prices, null, 2)}\n`);
  console.log(`Refreshed prices for ${Object.keys(prices).length} providers. Review the git diff.`);
}
