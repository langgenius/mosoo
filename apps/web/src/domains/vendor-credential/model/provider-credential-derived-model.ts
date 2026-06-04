import { PUBLIC_RUNTIME_CATALOG, PUBLIC_VENDORS } from "@mosoo/runtime-catalog";
import { useMemo } from "react";

import type { VendorCredential } from "../api/vendor-credential-client";
import {
  listActivePersonalCredentialsByVendor,
  listCompanyDefaultCredentialsByVendor,
  listCredentialsByVendor,
  listRuntimesByVendor,
} from "./provider-credential-derived-state";

interface ProviderCredentialDerivedModel {
  activePersonalByVendor: Map<string, VendorCredential>;
  credentialsByVendor: Map<string, VendorCredential[]>;
  defaultCredentialByVendor: Map<string, VendorCredential>;
  runtimesByVendor: Map<string, string[]>;
  visibleRuntimes: typeof PUBLIC_RUNTIME_CATALOG;
  visibleVendors: typeof PUBLIC_VENDORS;
}

export function useProviderCredentialDerivedModel(input: {
  credentials: VendorCredential[];
}): ProviderCredentialDerivedModel {
  const { credentials } = input;

  return {
    activePersonalByVendor: useMemo(
      () => listActivePersonalCredentialsByVendor(credentials),
      [credentials],
    ),
    credentialsByVendor: useMemo(() => listCredentialsByVendor(credentials), [credentials]),
    defaultCredentialByVendor: useMemo(
      () => listCompanyDefaultCredentialsByVendor(credentials),
      [credentials],
    ),
    runtimesByVendor: useMemo(() => listRuntimesByVendor(), []),
    visibleRuntimes: PUBLIC_RUNTIME_CATALOG,
    visibleVendors: PUBLIC_VENDORS,
  };
}
