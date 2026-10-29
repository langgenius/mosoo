import { describe, expect, test } from "bun:test";

import { PRESET_MODEL_CATALOG } from "@mosoo/runtime-catalog";

import { presetPriceChanges, selectModelsDevPrices } from "../bin/refresh-models-dev";
import {
  calculateUsageCost,
  createModelsDevPricingCatalog,
  findModelPricing,
} from "../src/modules/cost/domain/cost-pricing";
import type { UsageCostInput } from "../src/modules/cost/domain/cost-pricing";
import { MODELS_DEV_PROVIDER_IDS } from "../src/modules/cost/domain/models-dev-pricing";
import type { ModelsDevCost } from "../src/modules/cost/domain/models-dev-pricing";
import { normalizeUsageTokens } from "../src/modules/cost/domain/usage-contract";

const USAGE: UsageCostInput = {
  cacheCreationTokens: 40,
  cacheReadTokens: 100,
  inputTokens: 1_000,
  model: "test-model",
  outputTokens: 200,
  provider: "openai",
};

function catalogFor(cost: ModelsDevCost) {
  return createModelsDevPricingCatalog({ openai: { "test-model": cost } });
}

function snapshot(result: { priceSnapshotJson: string | null }) {
  return JSON.parse(result.priceSnapshotJson ?? "{}");
}

describe("cost pricing", () => {
  test("has pricing for cost-managed preset models", () => {
    for (const model of PRESET_MODEL_CATALOG) {
      if (MODELS_DEV_PROVIDER_IDS[model.vendorId] === undefined) continue;
      expect(
        findModelPricing({ modelId: model.modelId, providerId: model.vendorId }),
        `${model.vendorId}:${model.modelId}`,
      ).not.toBeNull();
    }
  });

  test.each([
    ["kimi", "kimi/kimi-k2.6", "kimi-k2.6"],
    ["kimi", "kimi-k2.7-code-2026-06-25", "kimi-k2.7-code"],
    ["zhipu", "zai/glm-4.6", "glm-4.6"],
    ["minimax", "minimax/minimax-m3", "MiniMax-M3"],
    ["opencode", "opencode/qwen3.6-plus", "qwen3.6-plus"],
    ["anthropic", "claude-opus-4.7", "claude-opus-4-7"],
    ["anthropic", "anthropic/claude-opus-4.7-20261001[1m]", "claude-opus-4-7"],
    ["openai", " OPENAI/GPT-5.3-latest ", "gpt-5.3"],
  ])("normalizes %s model %s at the current time", (providerId, modelId, expected) => {
    expect(findModelPricing({ modelId, providerId: ` ${providerId.toUpperCase()} ` })?.model).toBe(
      expected,
    );
  });

  test("keeps provider prices separate and prefers exact dated model IDs", () => {
    const catalog = createModelsDevPricingCatalog({
      kimi: { model: { input: 1, output: 2 }, "model-2026-10-01": { input: 3, output: 4 } },
      opencode: { model: { input: 5, output: 6 } },
    });
    expect(
      catalog.findModelPricing({ providerId: "kimi", modelId: "model-2026-10-01" })
        ?.inputUsdPerMillion,
    ).toBe(3);
    expect(
      catalog.findModelPricing({ providerId: "opencode", modelId: "model" })?.inputUsdPerMillion,
    ).toBe(5);
    expect(findModelPricing({ providerId: "openai", modelId: "claude-sonnet-5" })).toBeNull();
    expect(findModelPricing({ providerId: "opencode-go", modelId: "deepseek-v4-pro" })).toBeNull();
  });

  // Reviewed prices-only snapshot, USD per million tokens. Pin every preset.
  test.each([
    ["anthropic", "claude-fable-5", 10, 50, 1, 12.5],
    ["anthropic", "claude-sonnet-5", 2, 10, 0.2, 2.5],
    ["anthropic", "claude-opus-4-7", 5, 25, 0.5, 6.25],
    ["anthropic", "claude-opus-4-6", 5, 25, 0.5, 6.25],
    ["anthropic", "claude-opus-4-5", 5, 25, 0.5, 6.25],
    ["anthropic", "claude-sonnet-4-6", 3, 15, 0.3, 3.75],
    ["anthropic", "claude-sonnet-4-5", 3, 15, 0.3, 3.75],
    ["anthropic", "claude-haiku-4-5", 1, 5, 0.1, 1.25],
    ["openai", "gpt-5.6-sol", 4, 20, 0.4, 5],
    ["openai", "gpt-5.6-terra", 2, 12, 0.2, 2.5],
    ["openai", "gpt-5.6-luna", 0.2, 1.2, 0.02, 0.25],
    ["openai", "gpt-5.5", 5, 30, 0.5, 5],
    ["openai", "gpt-5.4", 2.5, 15, 0.25, 2.5],
    ["openai", "gpt-5.4-mini", 0.75, 4.5, 0.075, 0.75],
    ["openai", "gpt-5.3", 1.75, 14, 0.175, 1.75],
    ["openai", "gpt-5.2", 1.75, 14, 0.175, 1.75],
    ["deepseek", "deepseek-v4-pro", 0.66, 1.98, 0.022, 0.66],
    ["deepseek", "deepseek-v4-flash", 0.15, 0.6, 0.003, 0.15],
    ["gemini", "gemini-3.5-flash", 1.5, 9, 0.15, 1.5],
    ["qwen", "qwen3.7-plus", 0.4, 1.6, 0.04, 0.5],
    ["qwen", "qwen3.6-plus", 0.5, 3, 0.05, 0.625],
    ["kimi", "kimi-k2.6", 0.95, 4, 0.16, 0.95],
    ["kimi", "kimi-k2.7-code", 0.95, 4, 0.19, 0.95],
    ["zhipu", "glm-4.7", 0.6, 2.2, 0.11, 0],
    ["zhipu", "glm-4.6", 0.6, 2.2, 0.11, 0],
    ["minimax", "MiniMax-M3", 0.3, 1.2, 0.06, 0.3],
    ["minimax", "MiniMax-M2.7", 0.3, 1.2, 0.06, 0.375],
    ["opencode", "deepseek-v4-pro", 1.74, 3.48, 0.145, 1.74],
    ["opencode", "qwen3.6-plus", 0.5, 3, 0.05, 0.625],
    ["opencode", "glm-5.2", 1.4, 4.4, 0.26, 1.4],
    ["opencode", "minimax-m2.7", 0.3, 1.2, 0.06, 0.3],
    ["opencode", "gemini-3.5-flash", 1.5, 9, 0.15, 1.5],
  ] as const)(
    "pins rates for %s/%s",
    (providerId, modelId, input, output, cacheRead, cacheWrite) => {
      expect(findModelPricing({ providerId, modelId })).toMatchObject({
        inputUsdPerMillion: input,
        outputUsdPerMillion: output,
        cacheReadUsdPerMillion: cacheRead,
        cacheWriteUsdPerMillion: cacheWrite,
      });
    },
  );

  test("layers reviewed overrides on the same normalized lookup", () => {
    expect(() =>
      createModelsDevPricingCatalog({
        openai: { "gpt-5.3": { input: 99, output: 99 } },
      }),
    ).toThrow("override now exists in models.dev");
    expect(findModelPricing({ providerId: "openai", modelId: "gpt-5.3" })).toMatchObject({
      inputUsdPerMillion: 1.75,
    });
  });

  test.each([
    ["openai", "gpt-5.5"],
    ["openai", "gpt-5.4"],
    ["openai", "gpt-5.4-mini"],
    ["openai", "gpt-5.2"],
    ["openai", "gpt-5.3"],
    ["kimi", "kimi-k2.6"],
    ["kimi", "kimi-k2.7-code"],
    ["minimax", "MiniMax-M3"],
    ["opencode", "deepseek-v4-pro"],
    ["opencode", "glm-5.2"],
    ["opencode", "minimax-m2.7"],
    ["deepseek", "deepseek-v4-pro"],
    ["deepseek", "deepseek-v4-flash"],
    ["gemini", "gemini-3.5-flash"],
    ["opencode", "gemini-3.5-flash"],
  ])("prices cache creation for %s/%s at the input rate when omitted", (provider, model) => {
    const result = calculateUsageCost({ ...USAGE, provider, model });
    const pricing = findModelPricing({ providerId: provider, modelId: model });
    expect(result.pricingStatus).toBe("priced");
    expect(snapshot(result).cacheWriteUsdPerMillion).toBe(pricing?.inputUsdPerMillion);
  });

  test("prices Kimi usage without driver-provided cost", () => {
    const result = calculateUsageCost({ ...USAGE, provider: "kimi", model: "kimi/kimi-k2.6" });
    expect(result.totalCostUsd).toBeCloseTo(0.001709, 12);
    expect(snapshot(result)).toMatchObject({
      billableInputTokens: 900,
      cacheWriteUsdPerMillion: 0.95,
    });
  });

  test.each([false, true])("preserves imported rate precision, tiered: %s", (tiered) => {
    const rates = {
      input: 0.12345678,
      output: 0.23456789,
      cache_read: 0.0000001,
      cache_write: 0.12345678,
    };
    const cost = tiered
      ? { input: 1, output: 2, tiers: [{ ...rates, tier: { size: 100, type: "context" } }] }
      : rates;
    const result = catalogFor(cost).calculateUsageCost({
      ...USAGE,
      cacheCreationTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
      inputTokens: 2_000_000,
      outputTokens: 1_000_000,
    });
    expect(snapshot(result)).toMatchObject({
      inputUsdPerMillion: rates.input,
      outputUsdPerMillion: rates.output,
      cacheReadUsdPerMillion: rates.cache_read,
      cacheWriteUsdPerMillion: rates.cache_write,
    });
    expect(result.totalCostUsd).toBeCloseTo(
      rates.input + rates.output + rates.cache_read + rates.cache_write,
      12,
    );
  });

  test.each([false, true])(
    "falls back to the effective input rate, preserving explicit zero, tiered: %s",
    (tiered) => {
      for (const cache of [{}, { cache_read: 0, cache_write: 0 }]) {
        const rates = { input: 2, output: 3, ...cache };
        const cost = tiered
          ? {
              input: 1,
              output: 1,
              cache_read: 0.1,
              cache_write: 0.2,
              tiers: [{ ...rates, tier: { size: 100, type: "context" } }],
            }
          : rates;
        const result = catalogFor(cost).calculateUsageCost(USAGE);
        const cacheRate = "cache_read" in cache ? 0 : 2;
        expect(result.pricingStatus).toBe("priced");
        expect(snapshot(result)).toMatchObject({
          cacheReadUsdPerMillion: cacheRate,
          cacheWriteUsdPerMillion: cacheRate,
        });
        expect(result.totalCostUsd).toBeCloseTo(
          (900 * 2 + 200 * 3 + 140 * cacheRate) / 1_000_000,
          12,
        );
      }
    },
  );

  test("bills reasoning once at output rate and ignores audio rates at every tier", () => {
    const cost = {
      input: 1,
      output: 2,
      reasoning: 99,
      input_audio: 98,
      output_audio: 97,
      tiers: [
        {
          input: 3,
          output: 4,
          reasoning: 96,
          input_audio: 95,
          output_audio: 94,
          tier: { size: 100, type: "context" },
        },
      ],
    };
    const catalog = catalogFor(cost);
    for (const [inputTokens, inputRate, outputRate] of [
      [100, 1, 2],
      [101, 3, 4],
    ] as const) {
      const result = catalog.calculateUsageCost({
        ...USAGE,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        inputTokens,
      });
      expect(result.pricingStatus).toBe("priced");
      expect(result.totalCostUsd).toBeCloseTo(
        (inputTokens * inputRate + 200 * outputRate) / 1_000_000,
        12,
      );
    }
  });

  test.each([
    "anthropic_bucketed",
    "openai_total_with_cached_breakdown",
    "openai_runtime_total_with_cached_breakdown",
  ] as const)(
    "counts all input buckets once at strict context tier boundaries for %s",
    (usageContract) => {
      const catalog = catalogFor({
        input: 1,
        output: 2,
        tiers: [
          { input: 5, output: 6, tier: { size: 200, type: "context" } },
          { input: 3, output: 4, tier: { size: 100, type: "context" } },
        ],
      });
      for (const contextTokens of [99, 100, 101, 199, 200, 201]) {
        const normalized = normalizeUsageTokens({
          usageContract,
          cacheReadTokens: 30,
          cacheCreationTokens: 20,
          inputTokens: usageContract === "anthropic_bucketed" ? contextTokens - 50 : contextTokens,
          outputTokens: 10,
        });
        const result = catalog.calculateUsageCost({ ...USAGE, ...normalized });
        const inputRate = contextTokens > 200 ? 5 : contextTokens > 100 ? 3 : 1;
        expect(snapshot(result).inputUsdPerMillion).toBe(inputRate);
        expect(result.totalCostUsd).toBeCloseTo(
          (contextTokens * inputRate + 10 * (inputRate + 1)) / 1_000_000,
          12,
        );
      }
    },
  );

  test("ignores legacy context_over_200k in favor of structured tiers", () => {
    const legacy = { input: 1, output: 2, context_over_200k: { input: 99, output: 99 } };
    const result = catalogFor(legacy).calculateUsageCost({ ...USAGE, inputTokens: 300_000 });
    expect(snapshot(result)).toMatchObject({ inputUsdPerMillion: 1, longContextApplied: false });
  });

  test.each([
    { input: -1, output: 2 },
    { input: 1 },
    { input: 1, output: 2, cache_read: -1 },
    {
      input: 1,
      output: 2,
      tiers: [{ input: 3, output: 4, tier: { size: 100.5, type: "context" } }],
    },
    {
      input: 1,
      output: 2,
      tiers: [{ input: 3, output: 4, tier: { size: 100, type: "requests" } }],
    },
    {
      input: 1,
      output: 2,
      tiers: [
        { input: 3, output: 4, tier: { size: 100, type: "context" } },
        { input: 5, output: 6, tier: { size: 100, type: "context" } },
      ],
    },
  ])("keeps invalid required prices or ambiguous tiers unknown: %j", (cost) => {
    expect(catalogFor(cost).calculateUsageCost(USAGE).pricingStatus).toBe("unknown");
  });

  test("preserves runtime-reported USD fallback with and without token counters", () => {
    const unknown = calculateUsageCost({ ...USAGE, model: "unlisted", providedCostUsd: 0.12 });
    expect(unknown).toMatchObject({
      pricingStatus: "unknown",
      priceSnapshotJson: null,
      totalCostUsd: 0.12,
    });
    const reported = calculateUsageCost({
      ...USAGE,
      model: "gpt-5.4",
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      providedCostUsd: 0.12,
    });
    expect(reported).toMatchObject({ pricingStatus: "priced", totalCostUsd: 0.12 });
    expect(snapshot(reported)).toMatchObject({
      source: "runtime_reported_usd",
      tokenCountersUnavailable: true,
    });
  });

  test("refresh selects only mapped provider prices and context tiers", () => {
    const cost = {
      input: 1,
      output: 2,
      cache_read: 0,
      reasoning: 99,
      input_audio: 98,
      context_over_200k: { input: 50, output: 50 },
      tiers: [
        {
          input: 3,
          output: 4,
          cache_write: 0,
          reasoning: 97,
          tier: { type: "context", size: 100 },
        },
        { input: 5, output: 6, tier: { type: "requests", size: 1 } },
      ],
    };
    const providers = Object.fromEntries(
      Object.values(MODELS_DEV_PROVIDER_IDS).map((id) => [
        id,
        {
          models: { priced: { cost, name: "Not imported" }, unpriced: {} },
          name: "Not imported",
        },
      ]),
    );
    providers["opencode-go"] = { models: { priced: { cost } } };
    const selected = selectModelsDevPrices(providers);
    expect(Object.keys(selected)).toEqual(Object.keys(MODELS_DEV_PROVIDER_IDS));
    expect(selected["gemini"]).toEqual({
      priced: {
        input: 1,
        output: 2,
        cache_read: 0,
        tiers: [{ input: 3, output: 4, cache_write: 0, tier: { type: "context", size: 100 } }],
      },
    });
    expect(selected["opencode-go"]).toBeUndefined();
    expect(() => selectModelsDevPrices({})).toThrow("provider is missing");
  });
  test("rejects malformed refresh rows and sorts model and tier keys", () => {
    const providers = (cost: unknown) =>
      Object.fromEntries(
        Object.values(MODELS_DEV_PROVIDER_IDS).map((id) => [
          id,
          { models: { z: { cost }, a: { cost } } },
        ]),
      );
    for (const cost of [
      { input: -1, output: 2 },
      { input: 1 },
      { input: "1", output: 2 },
      { input: Infinity, output: 2 },
      { input: 1001, output: 2 },
      { input: 1, output: 2, tiers: {} },
    ]) {
      expect(() => selectModelsDevPrices(providers(cost))).toThrow("Invalid models.dev");
    }
    expect(
      Object.keys(selectModelsDevPrices(providers({ input: 0, output: 2 })).openai ?? {}),
    ).toEqual(["a", "z"]);
    expect(
      presetPriceChanges(
        { anthropic: { "claude-sonnet-5": { input: 3, output: 15 } } },
        { anthropic: { "claude-sonnet-5": { input: 0.000002, output: 0.00001 } } },
      ).find((line) => line.includes("anthropic/claude-sonnet-5")),
    ).toContain("REVIEW >=50%");
  });
});
