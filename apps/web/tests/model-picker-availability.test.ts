import { describe, expect, test } from "bun:test";

import type { ResolvedModelEntry } from "../src/domains/vendor-credential/api/vendor-credential-client";
import {
  findCurrentModelEntry,
  listModelPickerEntries,
} from "../src/routes/agent/components/editor/model-picker-availability";

function entry(overrides: Partial<ResolvedModelEntry>): ResolvedModelEntry {
  return {
    available: true,
    displayName: "GPT",
    modelId: "gpt-5.4",
    reason: null,
    source: "preset",
    statusDetail: null,
    statusLabel: "Available",
    vendorId: "openai",
    vendorLabel: "OpenAI",
    ...overrides,
  };
}

describe("model picker availability projection", () => {
  test("keeps the API-projected unavailable current model ahead of available entries", () => {
    const current = entry({
      available: false,
      displayName: "legacy-gpt",
      modelId: "legacy-gpt",
      reason: "unknown-model",
      statusDetail: "Model legacy-gpt is not in the runtime catalog.",
      statusLabel: "Unknown model",
    });
    const available = entry({
      displayName: "GPT 5.4",
      modelId: "gpt-5.4",
    });
    const wrongRuntime = entry({
      available: false,
      displayName: "Claude",
      modelId: "claude-sonnet-4-5",
      reason: "wrong-runtime",
      statusDetail: "Anthropic is not available for OpenAI Runtime.",
      statusLabel: "Not available",
      vendorId: "anthropic",
      vendorLabel: "Anthropic",
    });

    expect(findCurrentModelEntry([available, wrongRuntime, current], "legacy-gpt", "openai")).toBe(
      current,
    );
    expect(
      listModelPickerEntries([available, wrongRuntime, current], "legacy-gpt", "openai"),
    ).toEqual([current, available]);
  });

  test("uses the exact vendor match when two providers expose the same model id", () => {
    const openAi = entry({ modelId: "shared-model", vendorId: "openai" });
    const custom = entry({
      displayName: "shared-model (custom)",
      modelId: "shared-model",
      source: "custom",
      vendorId: "openai-compatible",
      vendorLabel: "Custom Provider",
    });

    expect(findCurrentModelEntry([openAi, custom], "shared-model", "openai-compatible")).toBe(
      custom,
    );
  });
});
