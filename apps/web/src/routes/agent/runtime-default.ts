import {
  PUBLIC_RUNTIME_CATALOG,
  VENDOR_OPENAI_COMPATIBLE,
  getDefaultModelIdForVendor,
  listPresetModelsForVendor,
} from "@mosoo/runtime-catalog";

import type { VendorCredential } from "@/domains/vendor-credential/api/vendor-credential-client";

export interface DefaultAgentRuntimeSelection {
  readonly model: string;
  readonly provider: string;
  readonly runtimeId: string;
}

function isVendorConfigured(credentials: readonly VendorCredential[], vendorId: string): boolean {
  return credentials.some((credential) => credential.vendorId === vendorId);
}

function defaultModelForVendor(
  entry: (typeof PUBLIC_RUNTIME_CATALOG)[number],
  vendorId: string,
): string {
  if (vendorId === entry.defaultProvider) {
    return entry.defaultModel;
  }

  const supportedModels = entry.supportedModelIds;
  const defaultModel = getDefaultModelIdForVendor(vendorId);

  if (
    defaultModel !== null &&
    (supportedModels === undefined || supportedModels.includes(defaultModel))
  ) {
    return defaultModel;
  }

  const model = listPresetModelsForVendor(vendorId).find(
    (candidate) => supportedModels === undefined || supportedModels.includes(candidate.modelId),
  );

  return model?.modelId ?? entry.defaultModel;
}

export function resolveDefaultAgentRuntime(
  credentials: readonly VendorCredential[],
): DefaultAgentRuntimeSelection | null {
  for (const entry of PUBLIC_RUNTIME_CATALOG) {
    const configuredVendor = entry.vendors.find((vendor) =>
      isVendorConfigured(credentials, vendor.vendorId),
    );

    if (configuredVendor !== undefined) {
      return {
        model: defaultModelForVendor(entry, configuredVendor.vendorId),
        provider: configuredVendor.vendorId,
        runtimeId: entry.runtimeId,
      };
    }
  }

  const customCredential = credentials.find(
    (credential) =>
      credential.vendorId === VENDOR_OPENAI_COMPATIBLE.vendorId &&
      (credential.models?.length ?? 0) > 0,
  );
  const customRuntime = PUBLIC_RUNTIME_CATALOG.find((entry) => entry.acceptsCustomProvider);
  const customModel = customCredential?.models?.[0];

  if (customCredential !== undefined && customRuntime !== undefined && customModel !== undefined) {
    return {
      model: customModel,
      provider: VENDOR_OPENAI_COMPATIBLE.vendorId,
      runtimeId: customRuntime.runtimeId,
    };
  }

  const fallback = PUBLIC_RUNTIME_CATALOG[0];

  if (fallback === undefined) {
    return null;
  }

  // No provider is configured yet. Create with the first public runtime so the
  // editor can surface the missing provider key inline.
  return {
    model: fallback.defaultModel,
    provider: fallback.defaultProvider,
    runtimeId: fallback.runtimeId,
  };
}
