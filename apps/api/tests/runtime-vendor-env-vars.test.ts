import { describe, expect, test } from "bun:test";

import {
  VENDOR_DEEPSEEK,
  VENDOR_GEMINI,
  VENDOR_KIMI,
  VENDOR_MINIMAX,
  VENDOR_OPENAI,
  VENDOR_OPENAI_COMPATIBLE,
  VENDOR_OPENCODE,
  VENDOR_QWEN,
  VENDOR_ZHIPU,
} from "@mosoo/runtime-catalog";
import type { RuntimeCatalogVendor } from "@mosoo/runtime-catalog";

import { buildRuntimeVendorEnvVars } from "../src/modules/runtime/application/session-definition/hydrate-run-context.service";

describe("runtime vendor env vars", () => {
  test("fails closed before injecting credentials for unsafe stored API bases", () => {
    expect(() =>
      buildRuntimeVendorEnvVars({
        credential: {
          apiBase: "http://api.example.com/v1",
          apiKey: "sk-runtime",
          credentialId: "01J000000000000000000000C3",
        },
        model: "gpt-5.4",
        runtimeId: "openai-runtime",
        vendor: VENDOR_OPENAI,
      }),
    ).toThrow("Custom endpoint must use HTTPS.");
  });

  test("fails closed before injecting credentials for trailing-dot localhost API bases", () => {
    expect(() =>
      buildRuntimeVendorEnvVars({
        credential: {
          apiBase: "https://localhost./v1",
          apiKey: "sk-runtime",
          credentialId: "01J000000000000000000000C4",
        },
        model: "gpt-5.4",
        runtimeId: "openai-runtime",
        vendor: VENDOR_OPENAI,
      }),
    ).toThrow(
      "Custom endpoint cannot target local, private, metadata, or credential-bearing URLs.",
    );
  });

  test("generates OpenCode config for ACP fallback runtime", () => {
    const envVars = buildRuntimeVendorEnvVars({
      credential: {
        apiBase: null,
        apiKey: "sk-opencode",
        credentialId: "01J000000000000000000000C5",
      },
      model: "qwen3.6-plus",
      runtimeId: "acp-fallback",
      vendor: VENDOR_OPENCODE,
    });
    const config = JSON.parse(envVars["OPENCODE_CONFIG_CONTENT"] ?? "{}") as Record<
      string,
      unknown
    >;

    expect(envVars["OPENCODE_API_KEY"]).toBe("sk-opencode");
    expect(config).toMatchObject({
      enabled_providers: ["opencode"],
      model: "opencode/qwen3.6-plus",
      small_model: "opencode/qwen3.6-plus",
      provider: {
        opencode: {
          options: {
            apiKey: "{env:OPENCODE_API_KEY}",
          },
        },
      },
    });
  });

  test("generates OpenCode native provider config for DeepSeek official API keys", () => {
    const envVars = buildRuntimeVendorEnvVars({
      credential: {
        apiBase: null,
        apiKey: "sk-deepseek",
        credentialId: "01J000000000000000000000C6",
      },
      model: "deepseek-v4-pro",
      runtimeId: "acp-fallback",
      vendor: VENDOR_DEEPSEEK,
    });
    const config = JSON.parse(envVars["OPENCODE_CONFIG_CONTENT"] ?? "{}") as Record<
      string,
      unknown
    >;

    expect(envVars["DEEPSEEK_API_KEY"]).toBe("sk-deepseek");
    expect(config).toMatchObject({
      enabled_providers: ["deepseek"],
      model: "deepseek/deepseek-v4-pro",
      small_model: "deepseek/deepseek-v4-pro",
      provider: {
        deepseek: {
          options: {
            apiKey: "{env:DEEPSEEK_API_KEY}",
          },
        },
      },
    });
  });

  test.each([
    {
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
      model: "gemini-3.5-flash",
      name: "Gemini",
      npm: "@ai-sdk/openai-compatible",
      vendor: VENDOR_GEMINI,
    },
    {
      baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
      model: "qwen3.7-plus",
      name: "Qwen",
      npm: "@ai-sdk/openai-compatible",
      vendor: VENDOR_QWEN,
    },
    {
      baseURL: "https://api.moonshot.ai/v1",
      model: "kimi-k2.6",
      name: "Kimi",
      npm: "@ai-sdk/openai-compatible",
      vendor: VENDOR_KIMI,
    },
    {
      baseURL: "https://api.z.ai/api/paas/v4",
      model: "glm-4.7",
      name: "Zhipu",
      npm: "@ai-sdk/openai-compatible",
      vendor: VENDOR_ZHIPU,
    },
    {
      baseURL: "https://api.minimax.io/anthropic/v1",
      model: "MiniMax-M3",
      name: "MiniMax",
      npm: "@ai-sdk/anthropic",
      vendor: VENDOR_MINIMAX,
    },
  ])(
    "generates OpenCode adapter provider config for $name official API keys",
    ({ baseURL, model, name, npm, vendor }) => {
      const typedVendor: RuntimeCatalogVendor = vendor;
      const envVars = buildRuntimeVendorEnvVars({
        credential: {
          apiBase: null,
          apiKey: "sk-provider",
          credentialId: "01J000000000000000000000C7",
        },
        model,
        runtimeId: "acp-fallback",
        vendor: typedVendor,
      });
      const config = JSON.parse(envVars["OPENCODE_CONFIG_CONTENT"] ?? "{}") as Record<
        string,
        unknown
      >;

      expect(envVars[typedVendor.apiKeyEnvVar]).toBe("sk-provider");
      expect(config).toMatchObject({
        enabled_providers: [typedVendor.vendorId],
        model: `${typedVendor.vendorId}/${model}`,
        small_model: `${typedVendor.vendorId}/${model}`,
        provider: {
          [typedVendor.vendorId]: {
            name,
            npm,
            options: {
              apiKey: `{env:${typedVendor.apiKeyEnvVar}}`,
              baseURL,
            },
          },
        },
      });
    },
  );

  test("generates OpenCode custom provider config from stored OpenAI-compatible Base URL", () => {
    const envVars = buildRuntimeVendorEnvVars({
      credential: {
        apiBase: "https://models.example.com/v1",
        apiKey: "sk-custom",
        credentialId: "01J000000000000000000000C8",
      },
      model: "qwen-coder",
      runtimeId: "acp-fallback",
      vendor: VENDOR_OPENAI_COMPATIBLE,
    });
    const config = JSON.parse(envVars["OPENCODE_CONFIG_CONTENT"] ?? "{}") as Record<
      string,
      unknown
    >;

    expect(envVars["OPENAI_COMPATIBLE_API_KEY"]).toBe("sk-custom");
    expect(envVars["OPENAI_COMPATIBLE_BASE_URL"]).toBe("https://models.example.com/v1");
    expect(config).toMatchObject({
      enabled_providers: ["openai-compatible"],
      model: "openai-compatible/qwen-coder",
      small_model: "openai-compatible/qwen-coder",
      provider: {
        "openai-compatible": {
          name: "OpenAI Compatible",
          npm: "@ai-sdk/openai-compatible",
          options: {
            apiKey: "{env:OPENAI_COMPATIBLE_API_KEY}",
            baseURL: "https://models.example.com/v1",
          },
        },
      },
    });
  });
});
