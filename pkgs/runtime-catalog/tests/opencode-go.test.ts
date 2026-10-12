import { expect, test } from "bun:test";

import {
  PUBLIC_VENDORS,
  getDefaultModelIdForVendor,
  getVendor,
  resolveRuntimeModelProtocol,
} from "@mosoo/runtime-catalog";

test("Given a Go subscription, When choosing a provider, Then Go stays distinct from Zen", () => {
  expect(PUBLIC_VENDORS.find((vendor) => vendor.vendorId === "opencode-go")).toMatchObject({
    label: "OpenCode Go",
    iconKey: "opencode",
    defaultApiBase: "https://opencode.ai/zen/go/v1",
    apiKeyEnvVar: "OPENCODE_GO_API_KEY",
  });
  expect(getVendor("opencode")?.defaultApiBase).toBe("https://opencode.ai/zen/v1");
  expect(getDefaultModelIdForVendor("opencode-go")).toBe("deepseek-v4-flash");
});

test.each(["acp-fallback", "pi"])(
  "Given Go models, When %s admits them, Then their official protocols are preserved",
  (runtimeId) => {
    for (const [modelId, modelProtocol] of [
      ["deepseek-v4-flash", "openai-chat-completions"],
      ["minimax-m2.7", "anthropic-messages"],
      ["gpt-5.6-luna", "openai-responses"],
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
