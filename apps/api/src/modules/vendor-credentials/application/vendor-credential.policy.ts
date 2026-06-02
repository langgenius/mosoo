import { admitProviderId } from "@mosoo/contracts/models";
import type { CredentialPolicy, VendorCredentialScope } from "@mosoo/contracts/vendor-credential";
import type { OrganizationId } from "@mosoo/id";
import { ALL_VENDORS, getVendor } from "@mosoo/runtime-catalog";

import type { CredentialPolicyRow } from "./vendor-credential.types";

const ALL_PROVIDER_IDS = ALL_VENDORS.map((vendor) => vendor.vendorId);

function admitKnownProviderId(providerId: string): string {
  const admittedProviderId = admitProviderId(providerId);

  if (getVendor(admittedProviderId) === null) {
    throw new Error(`Unknown vendor: ${admittedProviderId}.`);
  }

  return admittedProviderId;
}

export function parseAllowedProviderIds(raw: string | null): string[] {
  if (raw === null) {
    return ALL_PROVIDER_IDS;
  }

  return raw.split(",").map(admitKnownProviderId);
}

export function serializeAllowedProviderIds(providerIds: string[]): string | null {
  const uniqueProviderIds = [...new Set(providerIds.map(admitKnownProviderId))];

  if (uniqueProviderIds.length === ALL_PROVIDER_IDS.length) {
    const selected = new Set(uniqueProviderIds);

    if (ALL_PROVIDER_IDS.every((providerId) => selected.has(providerId))) {
      return null;
    }
  }

  return uniqueProviderIds.join(",");
}

export function toCredentialPolicy(
  organizationId: OrganizationId,
  row: CredentialPolicyRow,
): CredentialPolicy {
  return {
    allowedProviderIds: parseAllowedProviderIds(row.byokAllowedProviders),
    byokEnabled: row.byokEnabled === 1,
    organizationId,
  };
}

export function isProviderAllowed(policy: CredentialPolicy, vendorId: string): boolean {
  return policy.allowedProviderIds.includes(vendorId);
}

export function isByokAllowed(policy: CredentialPolicy, vendorId: string): boolean {
  return policy.byokEnabled && isProviderAllowed(policy, vendorId);
}

export function credentialDisabledByPolicy(
  policy: CredentialPolicy,
  scope: VendorCredentialScope,
  vendorId: string,
): boolean {
  if (!isProviderAllowed(policy, vendorId)) {
    return true;
  }

  return scope === "personal" && !policy.byokEnabled;
}

export function getPersonalCredentialPolicyError(
  policy: CredentialPolicy,
  vendorId: string,
): string | null {
  if (!isProviderAllowed(policy, vendorId)) {
    return "This provider is disabled by organization policy.";
  }

  if (!policy.byokEnabled) {
    return "BYOK is disabled for this organization.";
  }

  return null;
}
