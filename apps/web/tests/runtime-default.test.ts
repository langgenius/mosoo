import { describe, expect, test } from "bun:test";

import type { VendorCredential } from "../src/domains/vendor-credential/api/vendor-credential-client";
import { resolveDefaultAgentRuntime } from "../src/routes/agent/runtime-default";

function credential(vendorId: string): VendorCredential {
  return {
    apiBase: null,
    id: "01J000000000000000000000AA",
    isDefault: true,
    maskedApiKey: "sk-***",
    models: null,
    name: "Default",
    appId: "01J00000000000000000000009",
    vendorId,
  };
}

describe("default agent runtime", () => {
  test("uses the official DeepSeek provider when only DeepSeek is configured", () => {
    expect(resolveDefaultAgentRuntime([credential("deepseek")])).toEqual({
      model: "deepseek-v4-pro",
      provider: "deepseek",
      runtimeId: "acp-fallback",
    });
  });

  test("uses an OpenCode Zen model when only OpenCode Zen is configured", () => {
    expect(resolveDefaultAgentRuntime([credential("opencode")])).toEqual({
      model: "qwen3.6-plus",
      provider: "opencode",
      runtimeId: "acp-fallback",
    });
  });
});
