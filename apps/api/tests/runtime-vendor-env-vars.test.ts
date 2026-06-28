import { describe, expect, test } from "bun:test";

import { VENDOR_DEEPSEEK, VENDOR_OPENCODE, VENDOR_OPENAI } from "@mosoo/runtime-catalog";

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

  test("generates OpenCode custom provider config for DeepSeek official API keys", () => {
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
          name: "DeepSeek",
          npm: "@ai-sdk/openai-compatible",
          options: {
            apiKey: "{env:DEEPSEEK_API_KEY}",
            baseURL: "https://api.deepseek.com",
          },
        },
      },
    });
  });
});
