import { admitModelId, admitProviderId, createRuntimeModelIdentity } from "@mosoo/contracts/models";
import type {
  ModelId,
  PresetModelEntry,
  PresetModelProtocol,
  RuntimeModelIdentity,
} from "@mosoo/contracts/models";

import {
  MODEL_DEFAULTS,
  PRESET_MODELS,
  RUNTIMES,
  VENDOR_OPENAI_COMPATIBLE,
  VENDORS,
} from "./catalog";
import type { RuntimeCatalogRuntime, RuntimeCatalogVendor } from "./catalog";

export type { RuntimeCatalogVendor } from "./catalog";
export {
  VENDOR_ANTHROPIC,
  VENDOR_DEEPSEEK,
  VENDOR_GEMINI,
  VENDOR_KIMI,
  VENDOR_MINIMAX,
  VENDOR_OPENAI,
  VENDOR_OPENAI_COMPATIBLE,
  VENDOR_QWEN,
  VENDOR_ZHIPU,
} from "./catalog";

export interface RuntimeCatalogEntry extends RuntimeCatalogRuntime {
  readonly supportedModelIds: readonly string[];
}

type RuntimeModelProtocolResolution =
  | { readonly ok: true; readonly modelProtocol: PresetModelProtocol }
  | {
      readonly code:
        | "identity-invalid"
        | "model-unknown"
        | "protocol-unsupported"
        | "provider-unsupported"
        | "runtime-unknown";
      readonly message: string;
      readonly ok: false;
    };

export const ALL_VENDORS: readonly RuntimeCatalogVendor[] = VENDORS;

export const PRESET_MODEL_CATALOG: readonly PresetModelEntry[] = PRESET_MODELS.map((model) => ({
  displayName: model.displayName,
  modelId: admitModelId(model.modelId),
  protocol: model.protocol,
  vendorId: admitProviderId(model.vendor.vendorId),
  vendorLabel: model.vendor.label,
}));

export const RUNTIME_CATALOG: readonly RuntimeCatalogEntry[] = RUNTIMES.map((runtime) =>
  Object.assign({}, runtime, {
    supportedModelIds: [
      ...new Set(
        PRESET_MODEL_CATALOG.filter((model) =>
          runtime.vendors.some((vendor) => vendor.vendorId === model.vendorId),
        ).map((model) => model.modelId),
      ),
    ],
  }),
);

const RUNTIME_CATALOG_BY_ID = new Map(RUNTIME_CATALOG.map((entry) => [entry.runtimeId, entry]));
const RUNTIME_VENDOR_IDS = new Set(
  RUNTIME_CATALOG.flatMap((entry) => entry.vendors.map((vendor) => vendor.vendorId)),
);

// Custom providers are created through the dedicated OpenAI-Compatible flow,
// not rendered as a preset vendor card.
export const PUBLIC_VENDORS: readonly RuntimeCatalogVendor[] = ALL_VENDORS.filter(
  (vendor) => vendor !== VENDOR_OPENAI_COMPATIBLE && RUNTIME_VENDOR_IDS.has(vendor.vendorId),
);

export function listPresetModelsForVendor(vendorId: string): PresetModelEntry[] {
  return PRESET_MODEL_CATALOG.filter((model) => model.vendorId === vendorId);
}

export function getDefaultModelIdForVendor(vendorId: string): ModelId | null {
  const modelId = MODEL_DEFAULTS[vendorId];
  return modelId === undefined ? null : admitModelId(modelId);
}

export function getPresetModel(input: {
  readonly modelId: string;
  readonly vendorId: string;
}): PresetModelEntry | null {
  return (
    PRESET_MODEL_CATALOG.find(
      (model) => model.vendorId === input.vendorId && model.modelId === input.modelId,
    ) ?? null
  );
}

export function createCatalogRuntimeModelIdentity(input: {
  readonly modelId: string;
  readonly providerId: string;
  readonly runtimeId: string;
}): RuntimeModelIdentity {
  const providerId = admitProviderId(input.providerId);

  return createRuntimeModelIdentity({
    modelId: input.modelId,
    provider: {
      kind: providerId === VENDOR_OPENAI_COMPATIBLE.vendorId ? "custom" : "preset",
      providerId,
    },
    runtimeId: input.runtimeId,
  });
}

export function getRuntimeCatalogEntry(runtimeId: string): RuntimeCatalogEntry | null {
  return RUNTIME_CATALOG_BY_ID.get(runtimeId) ?? null;
}

export function resolveRuntimeModelProtocol(input: {
  readonly customModelProtocol?: PresetModelProtocol | null;
  readonly modelId: string;
  readonly runtimeId: string;
  readonly vendorId: string;
}): RuntimeModelProtocolResolution {
  try {
    createCatalogRuntimeModelIdentity({
      modelId: input.modelId,
      providerId: input.vendorId,
      runtimeId: input.runtimeId,
    });
  } catch {
    return { code: "identity-invalid", message: "Invalid runtime model identity.", ok: false };
  }

  const runtime = RUNTIME_CATALOG_BY_ID.get(input.runtimeId);

  if (runtime === undefined) {
    return {
      code: "runtime-unknown",
      message: `Runtime ${input.runtimeId} is not in the catalog.`,
      ok: false,
    };
  }

  if (getRuntimeCatalogVendorForProvider(runtime, input.vendorId) === null) {
    return {
      code: "provider-unsupported",
      message: `Runtime ${input.runtimeId} does not support provider ${input.vendorId}.`,
      ok: false,
    };
  }

  let modelProtocol: PresetModelProtocol;

  if (input.vendorId === VENDOR_OPENAI_COMPATIBLE.vendorId) {
    // Historical custom credentials have no protocol declaration. Preserve their
    // existing runtime-specific route until the credential explicitly declares one.
    modelProtocol =
      input.customModelProtocol ??
      (runtime.transport === "openai-app-server" ? "openai-responses" : "openai-chat-completions");
  } else {
    const model = getPresetModel(input);

    if (model === null) {
      return {
        code: "model-unknown",
        message: `Provider ${input.vendorId} does not declare model ${input.modelId}.`,
        ok: false,
      };
    }

    modelProtocol = model.protocol;
  }

  if (!runtime.supportedModelProtocols.includes(modelProtocol)) {
    return {
      code: "protocol-unsupported",
      message: `Runtime ${runtime.runtimeId} does not support model protocol ${modelProtocol}.`,
      ok: false,
    };
  }

  return { modelProtocol, ok: true };
}

export function getRuntimeCatalogVendorForProvider(
  runtime: Pick<RuntimeCatalogEntry, "acceptsCustomProvider" | "vendors">,
  provider: string,
): RuntimeCatalogVendor | null {
  const vendor = runtime.vendors.find((candidate) => candidate.vendorId === provider);

  if (vendor) {
    return vendor;
  }

  if (provider === VENDOR_OPENAI_COMPATIBLE.vendorId && runtime.acceptsCustomProvider) {
    return VENDOR_OPENAI_COMPATIBLE;
  }

  return null;
}

export function getVendor(vendorId: string): RuntimeCatalogVendor | null {
  return ALL_VENDORS.find((vendor) => vendor.vendorId === vendorId) ?? null;
}
