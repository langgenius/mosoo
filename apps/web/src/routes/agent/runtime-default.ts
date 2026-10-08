import {
  PUBLIC_RUNTIME_CATALOG,
  VENDOR_OPENAI_COMPATIBLE,
  getDefaultModelIdForVendor,
  listPresetModelsForVendor,
  resolveRuntimeModelProtocol,
} from "@mosoo/runtime-catalog";

import type { VendorCredential } from "@/domains/vendor-credential/api/vendor-credential-client";
import { listEffectiveCustomCredentialModels } from "@/domains/vendor-credential/model/custom-credential-models";

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
): string | null {
  const defaultModel = getDefaultModelIdForVendor(vendorId);
  const candidates = [
    ...(vendorId === entry.defaultProvider ? [entry.defaultModel] : []),
    ...(defaultModel === null ? [] : [defaultModel]),
    ...listPresetModelsForVendor(vendorId).map((model) => model.modelId),
  ];
  return (
    candidates.find(
      (modelId) =>
        resolveRuntimeModelProtocol({
          modelId,
          runtimeId: entry.runtimeId,
          vendorId,
        }).ok,
    ) ?? null
  );
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
    for (const vendor of entry.vendors) {
      if (
        vendor.vendorId === VENDOR_OPENAI_COMPATIBLE.vendorId ||
        !configuredVendorIds.has(vendor.vendorId)
      ) {
        continue;
      }
      const model = defaultModelForVendor(entry, vendor.vendorId);
      if (model !== null) {
        return { model, provider: vendor.vendorId, runtimeId: entry.runtimeId };
      }
    }
  }

  const customRuntime = runtimes.find(
    (entry) =>
      entry.runtimeId === (selectedRuntimeId ?? DEFAULT_CUSTOM_PROVIDER_RUNTIME_ID) &&
      entry.acceptsCustomProvider,
  );
  if (customRuntime !== undefined) {
    const customModel = listEffectiveCustomCredentialModels(credentials).find(
      ({ credential, modelId }) =>
        resolveRuntimeModelProtocol({
          customModelProtocol: credential.modelProtocol,
          modelId,
          runtimeId: customRuntime.runtimeId,
          vendorId: credential.vendorId,
        }).ok,
    );
    if (customModel !== undefined) {
      return {
        model: customModel.modelId,
        provider: VENDOR_OPENAI_COMPATIBLE.vendorId,
        runtimeId: customRuntime.runtimeId,
      };
    }
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
