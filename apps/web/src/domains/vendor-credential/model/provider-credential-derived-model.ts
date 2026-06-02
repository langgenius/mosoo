import { useMemo } from "react";

import type { CredentialPolicy, VendorCredential } from "../api/vendor-credential-client";
import {
  listActivePersonalCredentialsByVendor,
  listCompanyDefaultCredentialsByVendor,
  listCredentialsByVendor,
  listRuntimesByVendor,
  listVisibleRuntimes,
  listVisibleVendors,
} from "./provider-credential-derived-state";

interface ProviderCredentialDerivedModel {
  activePersonalByVendor: Map<string, VendorCredential>;
  credentialsByVendor: Map<string, VendorCredential[]>;
  defaultCredentialByVendor: Map<string, VendorCredential>;
  runtimesByVendor: Map<string, string[]>;
  visibleRuntimes: ReturnType<typeof listVisibleRuntimes>;
  visibleVendors: ReturnType<typeof listVisibleVendors>;
}

export function useProviderCredentialDerivedModel(input: {
  credentials: VendorCredential[];
  isAdmin: boolean;
  policy: CredentialPolicy | null;
}): ProviderCredentialDerivedModel {
  const { credentials, isAdmin, policy } = input;

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
    visibleRuntimes: useMemo(() => listVisibleRuntimes(policy, isAdmin), [isAdmin, policy]),
    visibleVendors: useMemo(() => listVisibleVendors(policy, isAdmin), [isAdmin, policy]),
  };
}
