import { describe, expect, test } from "bun:test";

import type { PresetModelProtocol } from "@mosoo/contracts/models";
import {
  PRESET_MODEL_CATALOG,
  RUNTIME_CATALOG,
  admitRuntimeModelIdentity,
  admitRuntimeModelIdentityForCatalog,
  createCatalogRuntimeModelIdentity,
  getRuntimeCatalogEntry,
  resolveRuntimeModelProtocol,
} from "@mosoo/runtime-catalog";

const PROTOCOLS: readonly PresetModelProtocol[] = [
  "anthropic-messages",
  "google-gemini",
  "openai-chat-completions",
  "openai-responses",
];

describe("runtime model protocol resolution", () => {
  test("admits every declared preset for Pi and OpenCode with the exact provider/model protocol", () => {
    for (const runtimeId of ["pi", "acp-fallback"]) {
      for (const model of PRESET_MODEL_CATALOG) {
        expect(
          resolveRuntimeModelProtocol({
            runtimeId,
            vendorId: model.vendorId,
            modelId: model.modelId,
          }),
        ).toEqual({ modelProtocol: model.protocol, ok: true });
      }
    }
  });

  test("keeps mixed protocols within one provider and different protocols for the same model name", () => {
    const cases = [
      ["opencode", "deepseek-v4-pro", "openai-chat-completions"],
      ["opencode", "qwen3.6-plus", "anthropic-messages"],
      ["opencode", "gemini-3.5-flash", "google-gemini"],
      ["gemini", "gemini-3.5-flash", "openai-chat-completions"],
    ] as const;
    for (const [vendorId, modelId, modelProtocol] of cases) {
      expect(resolveRuntimeModelProtocol({ runtimeId: "pi", vendorId, modelId })).toEqual({
        modelProtocol,
        ok: true,
      });
    }
  });

  test("checks the complete custom protocol and runtime matrix", () => {
    for (const runtimeId of [
      "claude-agent-sdk",
      "system-agent",
      "openai-runtime",
      "acp-fallback",
      "pi",
    ]) {
      for (const customModelProtocol of PROTOCOLS) {
        const result = resolveRuntimeModelProtocol({
          customModelProtocol,
          modelId: "namespace/custom-model",
          runtimeId,
          vendorId: "openai-compatible",
        });
        if (runtimeId === "system-agent") {
          expect(result).toMatchObject({ code: "runtime-disabled", ok: false });
        } else if (runtimeId === "claude-agent-sdk") {
          expect(result).toMatchObject({ code: "provider-unsupported", ok: false });
        } else if (runtimeId === "openai-runtime" && customModelProtocol !== "openai-responses") {
          expect(result).toMatchObject({ code: "protocol-unsupported", ok: false });
        } else {
          expect(result).toEqual({ modelProtocol: customModelProtocol, ok: true });
        }
      }
    }
  });

  test("preserves omitted and null legacy custom protocols by runtime", () => {
    for (const runtimeId of ["openai-runtime", "acp-fallback", "pi"]) {
      const selection = { modelId: "custom-model", runtimeId, vendorId: "openai-compatible" };
      const expected = {
        modelProtocol:
          runtimeId === "openai-runtime" ? "openai-responses" : "openai-chat-completions",
        ok: true,
      };
      expect(resolveRuntimeModelProtocol(selection)).toEqual(expected);
      expect(resolveRuntimeModelProtocol({ ...selection, customModelProtocol: null })).toEqual(
        expected,
      );
    }
  });

  test("identity admission shares explicit protocol validation and cannot override preset protocols", () => {
    const identity = createCatalogRuntimeModelIdentity({
      modelId: "custom-model",
      providerId: "openai-compatible",
      runtimeId: "openai-runtime",
    });
    expect(
      admitRuntimeModelIdentity(identity, { customModelProtocol: "openai-chat-completions" }),
    ).toMatchObject({
      code: "protocol-unsupported",
      ok: false,
    });
    expect(
      resolveRuntimeModelProtocol({
        customModelProtocol: "openai-chat-completions",
        modelId: "gpt-5.5",
        runtimeId: "pi",
        vendorId: "openai",
      }),
    ).toEqual({ modelProtocol: "openai-responses", ok: true });
  });

  test("a vendor-scoped allowlist cannot admit another vendor's model with the same name", () => {
    const runtime = getRuntimeCatalogEntry("pi");
    if (runtime === null) throw new Error("Pi runtime missing from catalog.");
    const permitted = PRESET_MODEL_CATALOG.find(
      (model) => model.vendorId === "gemini" && model.modelId === "gemini-3.5-flash",
    );
    if (permitted === undefined) throw new Error("Gemini fixture missing from catalog.");
    const catalog = [
      { ...runtime, supportedModelIds: [permitted.modelId], supportedModelIdentities: [permitted] },
    ];
    for (const providerId of ["gemini", "opencode"]) {
      const identity = createCatalogRuntimeModelIdentity({
        modelId: permitted.modelId,
        providerId,
        runtimeId: "pi",
      });
      expect(admitRuntimeModelIdentityForCatalog(catalog, identity)).toMatchObject(
        providerId === "gemini"
          ? { modelProtocol: "openai-chat-completions", ok: true }
          : { code: "model-unsupported", ok: false },
      );
    }
  });

  test("rejects a preset protocol outside the runtime adapter even when its model is allowed", () => {
    const runtime = getRuntimeCatalogEntry("pi");
    if (runtime === null) throw new Error("Pi runtime missing from catalog.");
    const supportedModelProtocols: PresetModelProtocol[] = ["openai-responses"];
    expect(
      admitRuntimeModelIdentityForCatalog(
        [{ ...runtime, supportedModelProtocols }],
        createCatalogRuntimeModelIdentity({
          modelId: "gemini-3.5-flash",
          providerId: "gemini",
          runtimeId: "pi",
        }),
      ),
    ).toMatchObject({ code: "protocol-unsupported", ok: false });
  });

  test("rejects unknown runtime, provider and model instead of inferring a protocol", () => {
    for (const [runtimeId, vendorId, modelId, code] of [
      ["missing-runtime", "openai", "gpt-5.5", "runtime-unknown"],
      ["pi", "missing-provider", "gpt-5.5", "provider-unsupported"],
      ["pi", "openai", "gemini-3.5-flash", "model-unknown"],
      ["pi", "openai", "", "identity-invalid"],
      ["claude-agent-sdk", "openai", "gpt-5.5", "provider-unsupported"],
    ] as const) {
      expect(resolveRuntimeModelProtocol({ runtimeId, vendorId, modelId })).toMatchObject({
        code,
        ok: false,
      });
    }
  });

  test("generated runtime protocol declarations retain the existing native boundaries", () => {
    for (const runtime of RUNTIME_CATALOG) {
      expect(runtime.supportedModelProtocols).toEqual(
        runtime.runtimeId === "claude-agent-sdk"
          ? ["anthropic-messages"]
          : runtime.transport === "openai-app-server"
            ? ["openai-responses"]
            : PROTOCOLS,
      );
    }
  });
});
