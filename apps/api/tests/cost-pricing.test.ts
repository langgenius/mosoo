import { describe, expect, test } from "bun:test";

import { PRESET_MODEL_CATALOG } from "@mosoo/runtime-catalog";

import { findModelPricing } from "../src/modules/cost/domain/cost-pricing";

describe("cost pricing", () => {
  test("has pricing for every preset model", () => {
    for (const model of PRESET_MODEL_CATALOG) {
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
