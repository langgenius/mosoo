import type { VendorCredential } from "@mosoo/contracts/vendor-credential";

import type { VendorCredentialRow } from "./vendor-credential.types";
function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 8) {
    return "••••••••";
  }

  return `${apiKey.slice(0, 4)}••••${apiKey.slice(-4)}`;
}

export function parseCredentialModels(modelsJson: readonly string[] | null): string[] | null {
  if (modelsJson === null || modelsJson.length === 0) {
    return null;
  }

  return [...modelsJson];
}

export function toVendorCredentialWithSecret(
  row: VendorCredentialRow,
  apiKey: string,
): VendorCredential {
  return {
    apiBase: row.apiBase,
    id: row.id,
    maskedApiKey: maskApiKey(apiKey),
    models: parseCredentialModels(row.modelsJson),
    name: row.name,
    appId: row.appId,
    vendorId: row.vendorId,
  };
}
