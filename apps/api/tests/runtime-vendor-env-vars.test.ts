import { describe, expect, test } from "bun:test";

import { VENDOR_OPENCODE, VENDOR_OPENAI } from "@mosoo/runtime-catalog";

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
      model: "deepseek-v4-pro",
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
      model: "opencode/deepseek-v4-pro",
      small_model: "opencode/deepseek-v4-pro",
      provider: {
        opencode: {
          options: {
            apiKey: "{env:OPENCODE_API_KEY}",
          },
        },
      },
    });
  });
});
