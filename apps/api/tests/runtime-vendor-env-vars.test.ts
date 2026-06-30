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
          models: null,
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
          models: null,
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
        models: null,
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
        models: null,
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
      openCodeProviderId: "zai",
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
    ({ baseURL, model, name, npm, openCodeProviderId, vendor }) => {
      const typedVendor: RuntimeCatalogVendor = vendor;
      const providerId = openCodeProviderId ?? typedVendor.vendorId;
      const envVars = buildRuntimeVendorEnvVars({
        credential: {
          apiBase: null,
          apiKey: "sk-provider",
          credentialId: "01J000000000000000000000C7",
          models: null,
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
        enabled_providers: [providerId],
        model: `${providerId}/${model}`,
        small_model: `${providerId}/${model}`,
        provider: {
          [providerId]: {
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

  test("rewrites Mosoo Zhipu model prefix to OpenCode's Z.ai provider id", () => {
    const envVars = buildRuntimeVendorEnvVars({
      credential: {
        apiBase: null,
        apiKey: "sk-zhipu",
        credentialId: "01J000000000000000000000C9",
        models: null,
      },
      model: "zhipu/glm-4.6",
      runtimeId: "acp-fallback",
      vendor: VENDOR_ZHIPU,
    });
    const config = JSON.parse(envVars["OPENCODE_CONFIG_CONTENT"] ?? "{}") as Record<
      string,
      unknown
    >;

    expect(config).toMatchObject({
      enabled_providers: ["zai"],
      model: "zai/glm-4.6",
      provider: {
        zai: {
          options: {
            apiKey: "{env:ZHIPU_API_KEY}",
            baseURL: "https://api.z.ai/api/paas/v4",
          },
        },
      },
      small_model: "zai/glm-4.6",
    });
  });

  test("generates OpenCode custom provider config for a DeepSeek-backed OpenAI-compatible model", () => {
    const envVars = buildRuntimeVendorEnvVars({
      credential: {
        apiBase: "https://api.deepseek.com",
        apiKey: "sk-custom",
        credentialId: "01J000000000000000000000C8",
        models: ["deepseek-v4-flash"],
      },
      model: "deepseek-v4-flash",
      runtimeId: "acp-fallback",
      vendor: VENDOR_OPENAI_COMPATIBLE,
    });
    const config = JSON.parse(envVars["OPENCODE_CONFIG_CONTENT"] ?? "{}") as Record<
      string,
      unknown
    >;

    expect(envVars["OPENAI_COMPATIBLE_API_KEY"]).toBe("sk-custom");
    expect(envVars["OPENAI_COMPATIBLE_BASE_URL"]).toBe("https://api.deepseek.com");
    expect(config).toMatchObject({
      enabled_providers: ["openai-compatible"],
      model: "openai-compatible/deepseek-v4-flash",
      small_model: "openai-compatible/deepseek-v4-flash",
      provider: {
        "openai-compatible": {
          models: {
            "deepseek-v4-flash": {
              name: "deepseek-v4-flash",
            },
          },
          name: "OpenAI Compatible",
          npm: "@ai-sdk/openai-compatible",
          options: {
            apiKey: "{env:OPENAI_COMPATIBLE_API_KEY}",
            baseURL: "https://api.deepseek.com",
          },
        },
      },
    });
  });
});
