import { expect, test } from "bun:test";

import {
  PUBLIC_VENDORS,
  getDefaultModelIdForVendor,
  getVendor,
  resolveRuntimeModelProtocol,
  getPresetModel,
} from "@mosoo/runtime-catalog";

test("Given a Go subscription, When choosing a provider, Then Go stays distinct from Zen", () => {
  expect(PUBLIC_VENDORS.find((vendor) => vendor.vendorId === "opencode-go")).toMatchObject({
    label: "OpenCode Go",
    iconKey: "opencode",
    defaultApiBase: "https://opencode.ai/zen/go/v1",
    apiKeyEnvVar: "OPENCODE_GO_API_KEY",
  });
  expect(getVendor("opencode")?.defaultApiBase).toBe("https://opencode.ai/zen/v1");
  expect(getDefaultModelIdForVendor("opencode-go")).toBe("deepseek-v4.1-flash");
});

test.each(["acp-fallback", "pi"])(
  "Given Go models, When %s admits them, Then their official protocols are preserved",
  (runtimeId) => {
    for (const [modelId, modelProtocol] of [
      ["deepseek-v4.1-flash", "openai-chat-completions"],
      ["deepseek-v4-pro", "openai-chat-completions"],
      ["kimi-k2.6", "openai-chat-completions"],
    ]) {
      expect(
        resolveRuntimeModelProtocol({ runtimeId, vendorId: "opencode-go", modelId: modelId }),
      ).toEqual({ ok: true, modelProtocol });
    }
    expect(
      resolveRuntimeModelProtocol({
        runtimeId,
        vendorId: "opencode-go",
        modelId: "gemini-3.5-flash",
      }),
    ).toMatchObject({ ok: false, code: "model-unknown" });
  },
);

test("Go only admits Chat Completions presets until other protocols have real acceptance", () => {
  for (const modelId of ["minimax-m3", "minimax-m2.7", "qwen3.7-plus", "gpt-5.6-luna"]) {
    expect(getPresetModel({ vendorId: "opencode-go", modelId })).toBeNull();
  }
});
