import type {
  CredentialPolicy,
  VendorCredential,
  VendorCredentialScope,
} from "@mosoo/contracts/vendor-credential";

import { isTruthy } from "../../../shared/truthiness";
import { credentialDisabledByPolicy } from "./vendor-credential.policy";
import type { VendorCredentialRow } from "./vendor-credential.types";
function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 8) {
    return "••••••••";
  }

  return `${apiKey.slice(0, 4)}••••${apiKey.slice(-4)}`;
}

export function parseCredentialModels(modelsJson: string | null): string[] | null {
  if (!isTruthy(modelsJson)) {
    return null;
  }

  const parsed: unknown = JSON.parse(modelsJson);

  if (!Array.isArray(parsed)) {
    throw new TypeError("Credential models must be stored as an array.");
  }

  return parsed.map((model) => {
    if (typeof model !== "string") {
      throw new TypeError("Credential models must be stored as strings.");
    }

    return model;
  });
}

export function credentialScope(row: VendorCredentialRow): VendorCredentialScope {
  return isTruthy(row.ownerUserId) ? "personal" : "company";
}

export function toVendorCredentialWithSecret(
  row: VendorCredentialRow,
  policy: CredentialPolicy,
  apiKey: string,
): VendorCredential {
  const scope = credentialScope(row);

  return {
    apiBase: row.apiBase,
    disabledByPolicy: credentialDisabledByPolicy(policy, scope, row.vendorId),
    id: row.id,
    isDefault: row.isDefault === 1,
    isPreferred: row.isPreferred === 1,
    maskedApiKey: maskApiKey(apiKey),
    models: parseCredentialModels(row.modelsJson),
    name: row.name,
    organizationId: row.organizationId,
    ownerUserId: row.ownerUserId,
    scope,
    vendorId: row.vendorId,
  };
}
