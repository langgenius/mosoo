import { PUBLIC_VENDORS } from "@mosoo/runtime-catalog";

import type { CredentialPolicy } from "../api/vendor-credential-client";

export function canUseCustomEndpoint(providerId: string): boolean {
  return PUBLIC_VENDORS.some(
    (vendor) => vendor.vendorId === providerId && Boolean(vendor.apiBaseEnvVar),
  );
}

export function isProviderAllowed(policy: CredentialPolicy | null, vendorId: string): boolean {
  return Boolean(policy?.allowedProviderIds.includes(vendorId));
}

export function isPersonalCredentialAllowed(
  policy: CredentialPolicy | null,
  vendorId: string,
): boolean {
  return policy?.byokEnabled === true && policy.allowedProviderIds.includes(vendorId);
}
