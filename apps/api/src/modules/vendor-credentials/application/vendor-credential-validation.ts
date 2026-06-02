import { VENDOR_OPENAI_COMPATIBLE, getVendor } from "@mosoo/runtime-catalog";

import { isTruthy } from "../../../shared/truthiness";
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

export function enforceApiBaseAllowed(vendorId: string, apiBase: string | null): void {
  const vendor = getVendor(vendorId);

  if (vendor === null) {
    throw new Error(`Unknown vendor: ${vendorId}.`);
  }

  if (Boolean(apiBase) && !isTruthy(vendor.apiBaseEnvVar)) {
    throw new Error("Custom endpoint is not available for this provider.");
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

export function serializeCredentialModels(models: string[] | null): string | null {
  return models ? JSON.stringify(models) : null;
}
