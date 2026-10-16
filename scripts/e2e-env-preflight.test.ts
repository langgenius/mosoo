import { afterEach, describe, expect, test } from "bun:test";

import { requirePreviewRuntimeCredential } from "../e2e/lib/env-preflight";
import { getDefaultModelIdForVendor } from "../pkgs/runtime-catalog/src/runtime-catalog";

const keys = [
  "MOSOO_E2E_PROVIDER",
  "MOSOO_E2E_PROVIDER_API_KEY",
  "MOSOO_E2E_GEMINI_API_KEY",
] as const;
const original = new Map(keys.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of keys) {
    const value = original.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("Gemini live E2E preflight", () => {
  test("selects the admitted Gemini model on OpenCode using its provider credential", () => {
    // Given a Gemini credential and no generic override.
    process.env.MOSOO_E2E_PROVIDER = "gemini";
    delete process.env.MOSOO_E2E_PROVIDER_API_KEY;
    process.env.MOSOO_E2E_GEMINI_API_KEY = "fixture-credential";

    // When Preview resolves its live runtime, then provider identity and
    // the reviewed default are retained on the matching runtime.
    expect(requirePreviewRuntimeCredential()).toMatchObject({
      apiKey: "fixture-credential",
      modelId: getDefaultModelIdForVendor("gemini"),
      providerId: "gemini",
      runtimeButtonName: "OpenCode",
    });
  });

  test("keeps the generic credential override ahead of the Gemini-specific value", () => {
    process.env.MOSOO_E2E_PROVIDER = "gemini";
    process.env.MOSOO_E2E_PROVIDER_API_KEY = "fixture-override";
    process.env.MOSOO_E2E_GEMINI_API_KEY = "fixture-credential";
    expect(requirePreviewRuntimeCredential().apiKey).toBe("fixture-override");
  });

  test("rejects missing Gemini credentials before creating test resources", () => {
    process.env.MOSOO_E2E_PROVIDER = "gemini";
    delete process.env.MOSOO_E2E_PROVIDER_API_KEY;
    delete process.env.MOSOO_E2E_GEMINI_API_KEY;
    expect(() => requirePreviewRuntimeCredential()).toThrow("provider credential is missing");
  });
});
