import {
  PUBLIC_RUNTIME_CATALOG,
  VENDOR_OPENAI_COMPATIBLE,
  getDefaultModelIdForVendor,
  listPresetModelsForVendor,
} from "@mosoo/runtime-catalog";

import type { VendorCredential } from "@/domains/vendor-credential/api/vendor-credential-client";

const DEFAULT_CUSTOM_PROVIDER_RUNTIME_ID = "acp-fallback";

export interface DefaultAgentRuntimeSelection {
  readonly model: string;
  readonly provider: string;
  readonly runtimeId: string;
}

function toConfiguredVendorIds(credentials: readonly VendorCredential[]): ReadonlySet<string> {
  return new Set(credentials.map((credential) => credential.vendorId));
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
  selectedRuntimeId?: string,
): DefaultAgentRuntimeSelection | null {
  const configuredVendorIds = toConfiguredVendorIds(credentials);
  const runtimes =
    selectedRuntimeId === undefined
      ? PUBLIC_RUNTIME_CATALOG
      : PUBLIC_RUNTIME_CATALOG.filter((entry) => entry.runtimeId === selectedRuntimeId);

  for (const entry of runtimes) {
    const configuredVendor = entry.vendors.find(
      (vendor) =>
        vendor.vendorId !== VENDOR_OPENAI_COMPATIBLE.vendorId &&
        configuredVendorIds.has(vendor.vendorId),
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
  const customRuntime = runtimes.find(
    (entry) =>
      entry.runtimeId === (selectedRuntimeId ?? DEFAULT_CUSTOM_PROVIDER_RUNTIME_ID) &&
      entry.acceptsCustomProvider,
  );
  const customModel = customCredential?.models?.[0];

  if (customCredential !== undefined && customRuntime !== undefined && customModel !== undefined) {
    return {
      model: customModel,
      provider: VENDOR_OPENAI_COMPATIBLE.vendorId,
      runtimeId: customRuntime.runtimeId,
    };
  }

  const fallback = runtimes[0];

  if (fallback === undefined) {
    return null;
  }

  // No compatible provider is configured yet. Preserve the selected runtime so
  // the editor can surface its missing provider setup inline.
  return {
    model: fallback.defaultModel,
    provider: fallback.defaultProvider,
    runtimeId: fallback.runtimeId,
  };
}
