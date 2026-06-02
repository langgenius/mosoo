import { PRESET_MODEL_CATALOG } from "./catalog";
import type { PresetModelEntry } from "./model-catalog.types";
import type { RuntimeModelIdentity, RuntimeModelProviderRef } from "./model-identity";

export type { PresetModelEntry, PresetModelProtocol } from "./model-catalog.types";
export type {
  ModelId,
  ProviderId,
  RuntimeId,
  RuntimeModelIdentity,
  RuntimeModelProviderKind,
  RuntimeModelProviderRef,
} from "./model-identity";
export {
  ANTHROPIC_DEFAULT_MODEL_ID,
  OPENAI_DEFAULT_MODEL_ID,
  PRESET_MODEL_CATALOG,
} from "./catalog";
export {
  RuntimeModelIdentityInput,
  RuntimeModelProviderKindSchema,
  admitModelId,
  admitProviderId,
  admitRuntimeId,
  createRuntimeModelIdentity,
  createRuntimeModelProviderRef,
  isCustomRuntimeModelProvider,
  parseRuntimeModelIdentity,
} from "./model-identity";

export function listPresetModelsForProvider(provider: RuntimeModelProviderRef): PresetModelEntry[] {
  if (provider.kind !== "preset") {
    return [];
  }

  return PRESET_MODEL_CATALOG.filter((entry) => entry.vendorId === provider.providerId);
}

export function listPresetModelsForVendor(vendorId: string): PresetModelEntry[] {
  return PRESET_MODEL_CATALOG.filter((entry) => entry.vendorId === vendorId);
}

export function getPresetModelForIdentity(identity: RuntimeModelIdentity): PresetModelEntry | null {
  if (identity.provider.kind !== "preset") {
    return null;
  }

  return (
    PRESET_MODEL_CATALOG.find(
      (entry) =>
        entry.vendorId === identity.provider.providerId && entry.modelId === identity.modelId,
    ) ?? null
  );
}

export function getPresetModel(input: {
  modelId: string;
  vendorId: string;
}): PresetModelEntry | null {
  return (
    PRESET_MODEL_CATALOG.find(
      (entry) => entry.vendorId === input.vendorId && entry.modelId === input.modelId,
    ) ?? null
  );
}
