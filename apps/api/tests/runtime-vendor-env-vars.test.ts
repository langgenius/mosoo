import { describe, expect, test } from "bun:test";

import { VENDOR_OPENAI } from "@mosoo/runtime-catalog";

import { buildRuntimeVendorEnvVars } from "../src/modules/runtime/application/session-definition/hydrate-run-context.service";

describe("runtime vendor env vars", () => {
  test("fails closed before injecting credentials for unsafe stored API bases", () => {
    expect(() =>
      buildRuntimeVendorEnvVars({
        credential: {
          apiBase: "http://api.example.com/v1",
          apiKey: "sk-runtime",
          credentialId: "01J000000000000000000000C3",
          scope: "company",
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
          scope: "company",
        },
        model: "gpt-5.4",
        runtimeId: "openai-runtime",
        vendor: VENDOR_OPENAI,
      }),
    ).toThrow(
      "Custom endpoint cannot target local, private, metadata, or credential-bearing URLs.",
    );
  });
});
