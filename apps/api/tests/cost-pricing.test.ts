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
});
