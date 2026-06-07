import { describe, expect, test } from "bun:test";

import { requirePreviewRuntimeCredential } from "./preview-live-harness";

const ENV_KEYS = [
  "MOSOO_E2E_ANTHROPIC_API_KEY",
  "MOSOO_E2E_OPENAI_API_KEY",
  "MOSOO_E2E_PROVIDER",
  "MOSOO_E2E_PROVIDER_API_KEY",
] as const;

function withPreviewEnv<T>(
  env: Record<(typeof ENV_KEYS)[number], string | undefined>,
  run: () => T,
): T {
  const previous = new Map<string, string | undefined>();

  for (const key of ENV_KEYS) {
    previous.set(key, process.env[key]);
    const value = env[key];

    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return run();
  } finally {
    for (const key of ENV_KEYS) {
      const value = previous.get(key);

      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

describe("Preview live harness credential resolver", () => {
  test("defaults to OpenAI and reads the OpenAI-specific key", () => {
    const credential = withPreviewEnv(
      {
        MOSOO_E2E_ANTHROPIC_API_KEY: undefined,
        MOSOO_E2E_OPENAI_API_KEY: "openai-key",
        MOSOO_E2E_PROVIDER: undefined,
        MOSOO_E2E_PROVIDER_API_KEY: undefined,
      },
      () => requirePreviewRuntimeCredential(),
    );

    expect(credential).toEqual({
      apiKey: "openai-key",
      providerId: "openai",
      runtimeButtonName: "OpenAI",
    });
  });

  test("reads Anthropic credentials for Claude Agent SDK", () => {
    const credential = withPreviewEnv(
      {
        MOSOO_E2E_ANTHROPIC_API_KEY: "anthropic-key",
        MOSOO_E2E_OPENAI_API_KEY: undefined,
        MOSOO_E2E_PROVIDER: "anthropic",
        MOSOO_E2E_PROVIDER_API_KEY: undefined,
      },
      () => requirePreviewRuntimeCredential(),
    );

    expect(credential).toEqual({
      apiKey: "anthropic-key",
      providerId: "anthropic",
      runtimeButtonName: "Claude",
    });
  });

  test("prefers the generic provider key for the selected provider", () => {
    const credential = withPreviewEnv(
      {
        MOSOO_E2E_ANTHROPIC_API_KEY: "anthropic-key",
        MOSOO_E2E_OPENAI_API_KEY: undefined,
        MOSOO_E2E_PROVIDER: "anthropic",
        MOSOO_E2E_PROVIDER_API_KEY: "provider-key",
      },
      () => requirePreviewRuntimeCredential(),
    );

    expect(credential).toEqual({
      apiKey: "provider-key",
      providerId: "anthropic",
      runtimeButtonName: "Claude",
    });
  });

  test("rejects unsupported providers even when a generic key is set", () => {
    expect(() =>
      withPreviewEnv(
        {
          MOSOO_E2E_ANTHROPIC_API_KEY: undefined,
          MOSOO_E2E_OPENAI_API_KEY: undefined,
          MOSOO_E2E_PROVIDER: "other",
          MOSOO_E2E_PROVIDER_API_KEY: "provider-key",
        },
        () => requirePreviewRuntimeCredential(),
      ),
    ).toThrow("MOSOO_E2E_PROVIDER=other is unsupported");
  });

  test("fails fast when the selected provider key is missing", () => {
    expect(() =>
      withPreviewEnv(
        {
          MOSOO_E2E_ANTHROPIC_API_KEY: undefined,
          MOSOO_E2E_OPENAI_API_KEY: undefined,
          MOSOO_E2E_PROVIDER: "openai",
          MOSOO_E2E_PROVIDER_API_KEY: undefined,
        },
        () => requirePreviewRuntimeCredential(),
      ),
    ).toThrow("provider credential is missing");
  });
});
