import { PUBLIC_RUNTIME_CATALOG, PUBLIC_VENDORS } from "@mosoo/runtime-catalog";

import type { VendorCredential } from "../api/vendor-credential-client";

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
    if (credential.scope === "personal" && credential.isPreferred) {
      map.set(credential.vendorId, credential);
    }
  }

  return map;
}
