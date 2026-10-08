import { describe, expect, test } from "bun:test";

import type { VendorCredential } from "../src/domains/vendor-credential/api/vendor-credential-client";
import { resolveDefaultAgentRuntime } from "../src/routes/agent/runtime-default";

function credential(vendorId: string, models: readonly string[] | null = null): VendorCredential {
  return {
    apiBase: null,
    id: "01J000000000000000000000AA",
    isDefault: true,
    maskedApiKey: "sk-***",
    modelProtocol: null,
    models,
    name: "Default",
    projectId: "01J00000000000000000000009",
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
      model: "deepseek-v4-pro",
      provider: "opencode",
      runtimeId: "acp-fallback",
    });
  });

  test("uses OpenCode for custom OpenAI-compatible credentials", () => {
    expect(resolveDefaultAgentRuntime([credential("openai-compatible", ["qwen-coder"])])).toEqual({
      model: "qwen-coder",
      provider: "openai-compatible",
      runtimeId: "acp-fallback",
    });
  });

  test("does not select Pi's incomplete default for an undeclared custom model", () => {
    expect(resolveDefaultAgentRuntime([credential("openai-compatible")])).toEqual(
      resolveDefaultAgentRuntime([]),
    );
  });

  test("uses a configured custom model when the launcher explicitly selects Pi", () => {
    const credentials = [credential("openai-compatible", ["qwen-coder", "another-model"])];

    expect(resolveDefaultAgentRuntime(credentials)?.runtimeId).toBe("acp-fallback");
    expect(resolveDefaultAgentRuntime(credentials, "pi")).toEqual({
      model: "qwen-coder",
      provider: "openai-compatible",
      runtimeId: "pi",
    });
  });

  test("preserves Pi setup when the launcher selects it without a declared custom model", () => {
    expect(resolveDefaultAgentRuntime([credential("openai-compatible")], "pi")).toEqual({
      model: "custom-model",
      provider: "openai-compatible",
      runtimeId: "pi",
    });
  });

  test("Pi can select a configured preset provider using its catalog protocol", () => {
    expect(resolveDefaultAgentRuntime([credential("openai")], "pi")).toEqual({
      model: "gpt-5.5",
      provider: "openai",
      runtimeId: "pi",
    });
  });

  test("does not select a Chat Completions credential for OpenAI Runtime", () => {
    const custom = {
      ...credential("openai-compatible", ["custom-chat"]),
      modelProtocol: "openai-chat-completions" as const,
    };
    expect(resolveDefaultAgentRuntime([custom], "openai-runtime")?.provider).toBe("openai");
  });

  test("selects an explicit Responses custom credential for OpenAI Runtime", () => {
    const custom = {
      ...credential("openai-compatible", ["custom-responses"]),
      modelProtocol: "openai-responses" as const,
    };
    expect(resolveDefaultAgentRuntime([custom], "openai-runtime")).toEqual({
      model: "custom-responses",
      provider: "openai-compatible",
      runtimeId: "openai-runtime",
    });
  });

  test("keeps OpenCode as the default for every supported custom protocol", () => {
    for (const modelProtocol of [
      "openai-chat-completions",
      "openai-responses",
      "anthropic-messages",
      "google-gemini",
    ] as const) {
      const custom = { ...credential("openai-compatible", ["custom-model"]), modelProtocol };
      expect(resolveDefaultAgentRuntime([custom])?.runtimeId).toBe("acp-fallback");
    }
  });

  test("chooses a compatible credential after rejecting a different model protocol", () => {
    const chat = {
      ...credential("openai-compatible", ["chat-model"]),
      name: "A chat",
      modelProtocol: "openai-chat-completions" as const,
    };
    const responses = {
      ...credential("openai-compatible", ["responses-model"]),
      name: "B responses",
      modelProtocol: "openai-responses" as const,
    };
    expect(resolveDefaultAgentRuntime([chat, responses], "openai-runtime")?.model).toBe(
      "responses-model",
    );
  });

  test("does not pick a duplicate model from a credential the server would not resolve", () => {
    const chat = {
      ...credential("openai-compatible", ["shared-model"]),
      name: "A chat",
      modelProtocol: "openai-chat-completions" as const,
    };
    const responses = {
      ...credential("openai-compatible", ["shared-model"]),
      name: "B responses",
      modelProtocol: "openai-responses" as const,
    };
    expect(resolveDefaultAgentRuntime([responses, chat], "openai-runtime")?.provider).toBe(
      "openai",
    );
  });

  test("does not silently substitute another runtime for an unsupported explicit selection", () => {
    expect(resolveDefaultAgentRuntime([credential("openai")], "unsupported-runtime")).toBeNull();
  });

  test("uses the mosoo Zhipu provider identity when only Zhipu is configured", () => {
    expect(resolveDefaultAgentRuntime([credential("zhipu")])).toEqual({
      model: "glm-4.7",
      provider: "zhipu",
      runtimeId: "acp-fallback",
    });
  });

  test("keeps runtime catalog priority when multiple providers are configured", () => {
    expect(resolveDefaultAgentRuntime([credential("deepseek"), credential("openai")])).toEqual({
      model: "gpt-5.5",
      provider: "openai",
      runtimeId: "openai-runtime",
    });
  });
});
