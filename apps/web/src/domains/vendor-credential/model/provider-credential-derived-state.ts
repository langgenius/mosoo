import { PUBLIC_RUNTIME_CATALOG, PUBLIC_VENDORS } from "@mosoo/runtime-catalog";

import type { CredentialPolicy, VendorCredential } from "../api/vendor-credential-client";

export function listRuntimesByVendor(): Map<string, string[]> {
  const map = new Map<string, string[]>();

  for (const vendor of PUBLIC_VENDORS) {
    map.set(
      vendor.vendorId,
      PUBLIC_RUNTIME_CATALOG.flatMap((runtime) =>
        runtime.vendors.some((runtimeVendor) => runtimeVendor.vendorId === vendor.vendorId)
          ? [runtime.label]
          : [],
      ),
    );
  }

  return map;
}

export function listCredentialsByVendor(
  credentials: readonly VendorCredential[],
): Map<string, VendorCredential[]> {
  const map = new Map<string, VendorCredential[]>();

  for (const credential of credentials) {
    const list = map.get(credential.vendorId) ?? [];
    list.push(credential);
    map.set(credential.vendorId, list);
  }

  return map;
}

export function listCompanyDefaultCredentialsByVendor(
  credentials: readonly VendorCredential[],
): Map<string, VendorCredential> {
  const map = new Map<string, VendorCredential>();

  for (const credential of credentials) {
    if (credential.scope === "company" && credential.isDefault) {
      map.set(credential.vendorId, credential);
    }
  }

  return map;
}

export function listActivePersonalCredentialsByVendor(
  credentials: readonly VendorCredential[],
): Map<string, VendorCredential> {
  const map = new Map<string, VendorCredential>();

  for (const credential of credentials) {
    if (credential.scope === "personal" && credential.isPreferred && !credential.disabledByPolicy) {
      map.set(credential.vendorId, credential);
    }
  }

  return map;
}

export function listVisibleRuntimes(
  policy: CredentialPolicy | null,
  isAdmin: boolean,
): typeof PUBLIC_RUNTIME_CATALOG {
  if (!policy) {
    return [];
  }

  if (isAdmin) {
    return PUBLIC_RUNTIME_CATALOG;
  }

  return PUBLIC_RUNTIME_CATALOG.filter((runtime) =>
    runtime.vendors.some((vendor) => policy.allowedProviderIds.includes(vendor.vendorId)),
  );
}

export function listVisibleVendors(
  policy: CredentialPolicy | null,
  isAdmin: boolean,
): typeof PUBLIC_VENDORS {
  if (!policy) {
    return [];
  }

  if (isAdmin) {
    return PUBLIC_VENDORS;
  }

  return PUBLIC_VENDORS.filter((vendor) => policy.allowedProviderIds.includes(vendor.vendorId));
}
