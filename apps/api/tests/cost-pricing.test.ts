import { describe, expect, test } from "bun:test";

import { PRESET_MODEL_CATALOG } from "@mosoo/runtime-catalog";

import { calculateUsageCost, findModelPricing } from "../src/modules/cost/domain/cost-pricing";

const COST_PRICED_PROVIDER_IDS = new Set([
  "anthropic",
  "deepseek",
  "gemini",
  "kimi",
  "minimax",
  "opencode",
  "openai",
  "qwen",
  "zhipu",
]);

function requiresCostPricing(model: (typeof PRESET_MODEL_CATALOG)[number]): boolean {
  return COST_PRICED_PROVIDER_IDS.has(model.vendorId);
}

describe("cost pricing", () => {
  test("has pricing for cost-managed preset models", () => {
    for (const model of PRESET_MODEL_CATALOG.filter(requiresCostPricing)) {
      expect(
        findModelPricing({
          modelId: model.modelId,
          providerId: model.vendorId,
        }),
        `${model.vendorId}:${model.modelId}`,
      ).not.toBeNull();
    }
  });

  test("does not price a model under a different provider", () => {
    expect(
      findModelPricing({
        modelId: "claude-sonnet-4-5",
        providerId: "openai",
      }),
    ).toBeNull();
  });

  test("selects Claude Sonnet 5 pricing from the usage timestamp", () => {
    expect(
      findModelPricing({
        atMs: Date.UTC(2026, 7, 31, 23, 59, 59),
        modelId: "claude-sonnet-5",
        providerId: "anthropic",
      }),
    ).toMatchObject({
      inputUsdPerMillion: 2,
      outputUsdPerMillion: 10,
    });
    expect(
      findModelPricing({
        atMs: Date.UTC(2026, 8, 1),
        modelId: "claude-sonnet-5",
        providerId: "anthropic",
      }),
    ).toMatchObject({
      inputUsdPerMillion: 3,
      outputUsdPerMillion: 15,
    });
  });

  test("uses current GPT-5.4 prices", () => {
    expect(
      findModelPricing({
        modelId: "gpt-5.4",
        providerId: "openai",
      }),
    ).toMatchObject({
      inputUsdPerMillion: 2.5,
      outputUsdPerMillion: 15,
    });
    expect(
      findModelPricing({
        modelId: "gpt-5.4-mini",
        providerId: "openai",
      }),
    ).toMatchObject({
      inputUsdPerMillion: 0.75,
      outputUsdPerMillion: 4.5,
    });
  });

  test("normalizes model IDs emitted by OpenCode-compatible providers", () => {
    const cases = [
      {
        expectedModel: "kimi-k2.6",
        modelId: "kimi/kimi-k2.6",
        providerId: "kimi",
      },
      {
        expectedModel: "kimi-k2.7-code",
        modelId: "kimi-k2.7-code-2026-06-25",
        providerId: "kimi",
      },
      {
        expectedModel: "glm-4.6",
        modelId: "zai/glm-4.6",
        providerId: "zhipu",
      },
      {
        expectedModel: "MiniMax-M3",
        modelId: "minimax/minimax-m3",
        providerId: "minimax",
      },
      {
        expectedModel: "qwen3.6-plus",
        modelId: "opencode/qwen3.6-plus",
        providerId: "opencode",
      },
    ];

    for (const testCase of cases) {
      const pricing = findModelPricing({
        modelId: testCase.modelId,
        providerId: testCase.providerId,
      });

      expect(pricing?.model, `${testCase.providerId}:${testCase.modelId}`).toBe(
        testCase.expectedModel,
      );
    }
  });

  test("prices Kimi usage without driver-provided cost", () => {
    const result = calculateUsageCost({
      cacheCreationTokens: 40,
      cacheReadTokens: 100,
      inputTokens: 1_000,
      model: "kimi-k2.6",
      outputTokens: 200,
      provider: "kimi",
    });

    expect(result.pricingStatus).toBe("priced");
    expect(result.totalCostUsd).toBeCloseTo(0.001671, 8);
    expect(JSON.parse(result.priceSnapshotJson ?? "{}")).toMatchObject({
      billableInputTokens: 900,
      cacheReadUsdPerMillion: 0.16,
      inputUsdPerMillion: 0.95,
      model: "kimi-k2.6",
      outputUsdPerMillion: 4,
      provider: "kimi",
    });
  });

  test("applies GPT long-context prices only above the published threshold", () => {
    const thresholdResult = calculateUsageCost({
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      inputTokens: 272_000,
      model: "gpt-5.6-terra",
      outputTokens: 1_000,
      provider: "openai",
    });
    const longContextResult = calculateUsageCost({
      cacheCreationTokens: 10_000,
      cacheReadTokens: 100_000,
      inputTokens: 272_001,
      model: "gpt-5.6-terra",
      outputTokens: 1_000,
      provider: "openai",
    });

    expect(JSON.parse(thresholdResult.priceSnapshotJson ?? "{}")).toMatchObject({
      inputUsdPerMillion: 2.5,
      longContextApplied: false,
      outputUsdPerMillion: 15,
    });
    expect(JSON.parse(longContextResult.priceSnapshotJson ?? "{}")).toMatchObject({
      cacheReadUsdPerMillion: 0.5,
      cacheWriteUsdPerMillion: 6.25,
      inputUsdPerMillion: 5,
      longContextApplied: true,
      outputUsdPerMillion: 22.5,
    });
    expect(longContextResult.totalCostUsd).toBeCloseTo(0.995005, 8);
  });
});
