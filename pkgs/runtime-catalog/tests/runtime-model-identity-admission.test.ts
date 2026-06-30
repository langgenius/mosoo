import { describe, expect, test } from "bun:test";

import { createRuntimeModelIdentity } from "@mosoo/contracts/models";
import {
  ANTHROPIC_DEFAULT_MODEL_ID,
  OPENAI_DEFAULT_MODEL_ID,
  PUBLIC_RUNTIME_DISPLAY_CATALOG,
  RUNTIME_CATALOG,
  SYSTEM_AGENT_RUNTIME_ID,
  VENDOR_ANTHROPIC,
  VENDOR_DEEPSEEK,
  VENDOR_OPENAI,
  VENDOR_OPENAI_COMPATIBLE,
  admitRuntimeModelIdentity,
  admitRuntimeModelIdentityForCatalog,
  getRuntimeDisplayColor,
  getRuntimeIconKey,
  listPlannedRuntimeDisplayEntries,
  listRuntimeShowcaseDisplayEntries,
} from "@mosoo/runtime-catalog";
import type { RuntimeCatalogEntry } from "@mosoo/runtime-catalog";

describe("runtime catalog identity admission", () => {
  test("rejects custom and preset provider kind mismatches", () => {
    const customPresetVendor = admitRuntimeModelIdentity(
      createRuntimeModelIdentity({
        modelId: OPENAI_DEFAULT_MODEL_ID,
        provider: {
          kind: "custom",
          providerId: VENDOR_OPENAI.vendorId,
        },
        runtimeId: "openai-runtime",
      }),
    );
    const presetCustomVendor = admitRuntimeModelIdentity(
      createRuntimeModelIdentity({
        modelId: OPENAI_DEFAULT_MODEL_ID,
        provider: {
          kind: "preset",
          providerId: VENDOR_OPENAI_COMPATIBLE.vendorId,
        },
        runtimeId: "openai-runtime",
      }),
    );

    expect(customPresetVendor).toMatchObject({
      code: "custom-provider-kind-mismatch",
      ok: false,
    });
    expect(presetCustomVendor).toMatchObject({
      code: "custom-provider-kind-mismatch",
      ok: false,
    });
  });

  test("rejects disabled runtimes before provider and model lookup", () => {
    const admission = admitRuntimeModelIdentity(
      createRuntimeModelIdentity({
        modelId: OPENAI_DEFAULT_MODEL_ID,
        provider: {
          kind: "preset",
          providerId: VENDOR_OPENAI.vendorId,
        },
        runtimeId: SYSTEM_AGENT_RUNTIME_ID,
      }),
    );

    expect(admission).toMatchObject({
      code: "runtime-disabled",
      ok: false,
    });
  });

  test("rejects unsupported provider and model", () => {
    const unsupportedProvider = admitRuntimeModelIdentity(
      createRuntimeModelIdentity({
        modelId: OPENAI_DEFAULT_MODEL_ID,
        provider: {
          kind: "preset",
          providerId: VENDOR_OPENAI.vendorId,
        },
        runtimeId: "claude-agent-sdk",
      }),
    );
    const unsupportedModel = admitRuntimeModelIdentityForCatalog(
      [
        createRuntimeFixture({
          supportedModelIds: [OPENAI_DEFAULT_MODEL_ID],
        }),
      ],
      createRuntimeModelIdentity({
        modelId: "gpt-5.5",
        provider: {
          kind: "preset",
          providerId: VENDOR_OPENAI.vendorId,
        },
        runtimeId: "openai-runtime",
      }),
    );
    const unknownModel = admitRuntimeModelIdentity(
      createRuntimeModelIdentity({
        modelId: "not-a-preset-model",
        provider: {
          kind: "preset",
          providerId: VENDOR_OPENAI.vendorId,
        },
        runtimeId: "openai-runtime",
      }),
    );

    expect(unsupportedProvider).toMatchObject({
      code: "provider-unsupported",
      ok: false,
    });
    expect(unsupportedModel).toMatchObject({
      code: "model-unsupported",
      ok: false,
    });
    expect(unknownModel).toMatchObject({
      code: "model-unknown",
      ok: false,
    });
  });

  test("admits supported preset and ACP custom runtime model identities", () => {
    const preset = admitRuntimeModelIdentity(
      createRuntimeModelIdentity({
        modelId: ANTHROPIC_DEFAULT_MODEL_ID,
        provider: {
          kind: "preset",
          providerId: VENDOR_ANTHROPIC.vendorId,
        },
        runtimeId: "claude-agent-sdk",
      }),
    );
    const custom = admitRuntimeModelIdentity(
      createRuntimeModelIdentity({
        modelId: "qwen-coder",
        provider: {
          kind: "custom",
          providerId: VENDOR_OPENAI_COMPATIBLE.vendorId,
        },
        runtimeId: "acp-fallback",
      }),
    );
    const deepseekPreset = admitRuntimeModelIdentity(
      createRuntimeModelIdentity({
        modelId: "deepseek-v4-pro",
        provider: {
          kind: "preset",
          providerId: VENDOR_DEEPSEEK.vendorId,
        },
        runtimeId: "acp-fallback",
      }),
    );

    expect(preset).toMatchObject({
      ok: true,
      model: {
        modelId: ANTHROPIC_DEFAULT_MODEL_ID,
        vendorId: VENDOR_ANTHROPIC.vendorId,
      },
      vendor: {
        vendorId: VENDOR_ANTHROPIC.vendorId,
      },
    });
    expect(custom).toMatchObject({
      ok: true,
      model: null,
      vendor: {
        vendorId: VENDOR_OPENAI_COMPATIBLE.vendorId,
      },
    });
    expect(deepseekPreset).toMatchObject({
      ok: true,
      model: {
        modelId: "deepseek-v4-pro",
        vendorId: VENDOR_DEEPSEEK.vendorId,
      },
      vendor: {
        vendorId: VENDOR_DEEPSEEK.vendorId,
      },
    });
  });

  test("rejects custom providers for OpenAI app-server runtime", () => {
    const systemAgentRuntime = RUNTIME_CATALOG.find(
      (runtime) => runtime.runtimeId === SYSTEM_AGENT_RUNTIME_ID,
    );
    const openAiRuntime = RUNTIME_CATALOG.find((runtime) => runtime.runtimeId === "openai-runtime");
    const custom = admitRuntimeModelIdentity(
      createRuntimeModelIdentity({
        modelId: "qwen-coder",
        provider: {
          kind: "custom",
          providerId: VENDOR_OPENAI_COMPATIBLE.vendorId,
        },
        runtimeId: "openai-runtime",
      }),
    );
    const systemAgentCustom = admitRuntimeModelIdentity(
      createRuntimeModelIdentity({
        modelId: "qwen-coder",
        provider: {
          kind: "custom",
          providerId: VENDOR_OPENAI_COMPATIBLE.vendorId,
        },
        runtimeId: SYSTEM_AGENT_RUNTIME_ID,
      }),
    );

    expect(systemAgentRuntime?.acceptsCustomProvider).toBe(false);
    expect(openAiRuntime?.acceptsCustomProvider).toBe(false);
    expect(custom).toMatchObject({
      code: "provider-unsupported",
      ok: false,
    });
    expect(systemAgentCustom).toMatchObject({
      code: "runtime-disabled",
      ok: false,
    });
  });

  test("admits enabled runtime defaults", () => {
    for (const runtime of RUNTIME_CATALOG) {
      expect(runtime.defaultIdentity.runtimeId).toBe(runtime.runtimeId);

      const admission = admitRuntimeModelIdentity(runtime.defaultIdentity);

      if (runtime.disabledReason !== undefined && runtime.disabledReason !== "") {
        expect(admission).toMatchObject({
          code: "runtime-disabled",
          ok: false,
        });
        continue;
      }

      expect(admission).toMatchObject({
        ok: true,
        runtime: {
          runtimeId: runtime.runtimeId,
        },
        vendor: {
          vendorId: runtime.defaultIdentity.provider.providerId,
        },
      });
    }
  });

  test("exposes display metadata without changing runtime admission", () => {
    expect(PUBLIC_RUNTIME_DISPLAY_CATALOG.every((entry) => entry.status === "available")).toBe(
      true,
    );
    expect(listRuntimeShowcaseDisplayEntries()).toContainEqual(
      expect.objectContaining({
        iconKey: "opencode",
        label: "OpenCode",
        runtimeId: "acp-fallback",
        status: "available",
      }),
    );
    expect(listRuntimeShowcaseDisplayEntries()).not.toContainEqual(
      expect.objectContaining({
        runtimeId: "opencode",
      }),
    );
    expect(listPlannedRuntimeDisplayEntries("provider-settings")).toEqual([]);
    expect(listPlannedRuntimeDisplayEntries("landing")).toEqual([]);
    expect(listRuntimeShowcaseDisplayEntries()).toEqual(PUBLIC_RUNTIME_DISPLAY_CATALOG);
    expect(getRuntimeIconKey("acp-fallback")).toBe("opencode");
    expect(getRuntimeDisplayColor("openai-runtime")).toBe("#7A9DFF");
  });
});

function createRuntimeFixture(
  overrides: Partial<Pick<RuntimeCatalogEntry, "supportedModelIds">> = {},
): RuntimeCatalogEntry {
  const defaultIdentity = createRuntimeModelIdentity({
    modelId: OPENAI_DEFAULT_MODEL_ID,
    provider: {
      kind: "preset",
      providerId: VENDOR_OPENAI.vendorId,
    },
    runtimeId: "openai-runtime",
  });

  return {
    acceptsCustomProvider: false,
    capabilities: [],
    defaultIdentity,
    defaultModel: defaultIdentity.modelId,
    defaultProvider: defaultIdentity.provider.providerId,
    label: "OpenAI Runtime",
    runtimeId: defaultIdentity.runtimeId,
    supportedModelIds: undefined,
    transport: "openai-app-server",
    vendors: [VENDOR_OPENAI],
    visibility: "public",
    ...overrides,
  };
}
