import { describe, expect, test } from "bun:test";

import { PRESET_MODEL_CATALOG } from "@mosoo/runtime-catalog";

import { findModelPricing } from "../src/modules/cost/domain/cost-pricing";

const COST_PRICED_PROVIDER_IDS = new Set(["anthropic", "openai", "opencode"]);

function requiresCostPricing(model: (typeof PRESET_MODEL_CATALOG)[number]): boolean {
  return (
    COST_PRICED_PROVIDER_IDS.has(model.vendorId) ||
    (model.vendorId === "deepseek" && model.modelId === "deepseek-v4-pro")
  );
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
});
