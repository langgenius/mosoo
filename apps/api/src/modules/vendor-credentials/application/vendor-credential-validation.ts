import { ALL_VENDORS, VENDOR_OPENAI_COMPATIBLE, getVendor } from "@mosoo/runtime-catalog";

import { isTruthy } from "../../../shared/truthiness";
import { validateVendorProbeBaseUrl } from "./vendor-credential-probe";
export function normalizeCredentialName(input: string): string {
  const name = input.trim();

  if (!name) {
    throw new Error("Credential name is required.");
  }

  return name;
}

export function normalizeApiBase(input: string | null | undefined): string | null {
  const apiBase = input?.trim() ?? "";
  return apiBase || null;
}

function formatUnsafeApiBaseMessage(reason: string): string {
  switch (reason) {
    case "blocked_api_base":
      return "Custom endpoint cannot target local, private, metadata, or credential-bearing URLs.";
    case "insecure_api_base":
      return "Custom endpoint must use HTTPS.";
    case "invalid_api_base":
      return "Custom endpoint must be a valid HTTP(S) URL.";
    default:
      return "Custom endpoint is not available.";
  }
}

export function enforceSafeApiBase(apiBase: string): void {
  const unsafeReason = validateVendorProbeBaseUrl(apiBase);

  if (unsafeReason !== null) {
    throw new Error(formatUnsafeApiBaseMessage(unsafeReason));
  }
}

function readUrlOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function enforcePresetProviderApiBase(vendorId: string, apiBase: string): void {
  if (vendorId === VENDOR_OPENAI_COMPATIBLE.vendorId) {
    return;
  }

  const apiBaseOrigin = readUrlOrigin(apiBase);

  if (apiBaseOrigin === null) {
    return;
  }

  const conflictingVendor = ALL_VENDORS.find(
    (vendor) =>
      vendor.vendorId !== vendorId &&
      vendor.vendorId !== VENDOR_OPENAI_COMPATIBLE.vendorId &&
      vendor.defaultApiBase !== undefined &&
      readUrlOrigin(vendor.defaultApiBase) === apiBaseOrigin,
  );

  if (conflictingVendor !== undefined) {
    throw new Error(
      `Custom endpoint for ${vendorId} cannot target ${conflictingVendor.label}. Choose the matching provider or use OpenAI-Compatible.`,
    );
  }
}

export function enforceApiBaseAllowed(vendorId: string, apiBase: string | null): void {
  const vendor = getVendor(vendorId);

  if (vendor === null) {
    throw new Error(`Unknown vendor: ${vendorId}.`);
  }

  if (Boolean(apiBase) && !isTruthy(vendor.apiBaseEnvVar)) {
    throw new Error("Custom endpoint is not available for this provider.");
  }

  if (isTruthy(apiBase)) {
    enforceSafeApiBase(apiBase);
    enforcePresetProviderApiBase(vendorId, apiBase);
  }
}

export function normalizeCredentialModels(
  input: readonly string[] | null | undefined,
): string[] | null {
  const models = [...new Set((input ?? []).map((model) => model.trim()).filter(Boolean))];
  return models.length > 0 ? models : null;
}

export function enforceCredentialModelShape(
  vendorId: string,
  apiBase: string | null,
  models: string[] | null,
): void {
  const isCustomProvider = vendorId === VENDOR_OPENAI_COMPATIBLE.vendorId;

  if (isCustomProvider && (!isTruthy(apiBase) || !models || models.length === 0)) {
    throw new Error("Custom Provider requires baseURL and at least 1 model id");
  }

  if (!isCustomProvider && models && models.length > 0) {
    throw new Error("Preset provider credentials cannot declare custom models.");
  }
}
