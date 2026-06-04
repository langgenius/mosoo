import { PUBLIC_VENDORS } from "@mosoo/runtime-catalog";

export function canUseCustomEndpoint(providerId: string): boolean {
  return PUBLIC_VENDORS.some(
    (vendor) => vendor.vendorId === providerId && Boolean(vendor.apiBaseEnvVar),
  );
}
