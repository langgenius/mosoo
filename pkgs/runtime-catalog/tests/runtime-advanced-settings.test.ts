import { describe, expect, test } from "bun:test";

import {
  listRuntimeAdvancedSettings,
  normalizeRuntimeAdvancedSettings,
  validateRuntimeAdvancedSettings,
} from "@mosoo/runtime-catalog";

describe("runtime advanced settings", () => {
  test("exposes the Codex MVP allowlist", () => {
    expect(listRuntimeAdvancedSettings("openai-runtime").map((setting) => setting.key)).toEqual([
      "model_reasoning_effort",
      "model_verbosity",
    ]);
    expect(listRuntimeAdvancedSettings("claude-agent-sdk").map((setting) => setting.key)).toEqual([
      "effort",
      "maxTurns",
    ]);
  });

  test("accepts supported settings and removes default values from storage", () => {
    const validation = validateRuntimeAdvancedSettings({
      runtimeId: "openai-runtime",
      settings: {
        model_reasoning_effort: "high",
        model_verbosity: "medium",
      },
    });

    expect(validation.ok).toBe(true);
    expect(validation.normalizedSettings).toEqual({
      model_reasoning_effort: "high",
    });
  });

  test("uses model-specific Codex defaults and reasoning levels", () => {
    const terraDefinitions = listRuntimeAdvancedSettings("openai-runtime", "gpt-5.6-terra");
    const terraReasoning = terraDefinitions.find(
      (definition) => definition.key === "model_reasoning_effort",
    );
    const terraVerbosity = terraDefinitions.find(
      (definition) => definition.key === "model_verbosity",
    );
    const solReasoning = listRuntimeAdvancedSettings("openai-runtime", "gpt-5.6-sol").find(
      (definition) => definition.key === "model_reasoning_effort",
    );

    expect(terraReasoning).toMatchObject({
      defaultValue: "medium",
      options: [
        { value: "low" },
        { value: "medium" },
        { value: "high" },
        { value: "xhigh" },
        { value: "max" },
      ],
    });
    expect(terraVerbosity).toMatchObject({ defaultValue: "low" });
    expect(solReasoning).toMatchObject({ defaultValue: "low" });
  });

  test("accepts GPT-5.6 max but removes it when switching to an older model", () => {
    const validation = validateRuntimeAdvancedSettings({
      modelId: "gpt-5.6-terra",
      runtimeId: "openai-runtime",
      settings: {
        model_reasoning_effort: "max",
        model_verbosity: "medium",
      },
    });

    expect(validation.ok).toBe(true);
    expect(validation.normalizedSettings).toEqual({
      model_reasoning_effort: "max",
      model_verbosity: "medium",
    });
    expect(
      normalizeRuntimeAdvancedSettings({
        modelId: "gpt-5.5",
        runtimeId: "openai-runtime",
        settings: validation.normalizedSettings,
      }),
    ).toEqual({ model_verbosity: "medium" });
  });

  test("rejects GPT-5.6-only reasoning levels on older Codex models", () => {
    const validation = validateRuntimeAdvancedSettings({
      modelId: "gpt-5.5",
      runtimeId: "openai-runtime",
      settings: {
        model_reasoning_effort: "max",
      },
    });

    expect(validation.ok).toBe(false);
    expect(validation.issues[0]?.code).toBe("runtime_settings_invalid_value");
  });

  test("rejects unsupported runtime settings", () => {
    const validation = validateRuntimeAdvancedSettings({
      runtimeId: "claude-agent-sdk",
      settings: {
        model_reasoning_effort: "high",
      },
    });

    expect(validation.ok).toBe(false);
    expect(validation.issues[0]?.code).toBe("runtime_settings_unsupported");
  });

  test("accepts Claude Agent SDK settings without writing unset runtime defaults", () => {
    const validation = validateRuntimeAdvancedSettings({
      runtimeId: "claude-agent-sdk",
      settings: {
        effort: "xhigh",
        maxTurns: 8,
      },
    });

    expect(validation.ok).toBe(true);
    expect(validation.normalizedSettings).toEqual({
      effort: "xhigh",
      maxTurns: 8,
    });

    const emptyValidation = validateRuntimeAdvancedSettings({
      runtimeId: "claude-agent-sdk",
      settings: {},
    });

    expect(emptyValidation.ok).toBe(true);
    expect(emptyValidation.normalizedSettings).toEqual({});
  });

  test("rejects invalid Claude Agent SDK settings", () => {
    const validation = validateRuntimeAdvancedSettings({
      runtimeId: "claude-agent-sdk",
      settings: {
        effort: "minimal",
        maxTurns: 0,
      },
    });

    expect(validation.ok).toBe(false);
    expect(validation.issues.map((issue) => issue.key)).toEqual(["effort", "maxTurns"]);
  });

  test("rejects platform boundary settings", () => {
    const validation = validateRuntimeAdvancedSettings({
      runtimeId: "openai-runtime",
      settings: {
        approval_policy: "never",
        sandbox_mode: "danger-full-access",
      },
    });

    expect(validation.ok).toBe(false);
    expect(validation.issues.map((issue) => issue.code)).toEqual([
      "runtime_settings_security_boundary",
      "runtime_settings_security_boundary",
    ]);
  });
});
