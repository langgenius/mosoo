import { getVendor } from "@mosoo/runtime-catalog";

// A vendor supports a custom Base URL when it declares an apiBaseEnvVar. This
// must consult the full vendor catalog (getVendor), not PUBLIC_VENDORS, because
// the OpenAI-Compatible custom provider is excluded from the public list yet
// always requires a Base URL.
export function canUseCustomEndpoint(providerId: string): boolean {
  return Boolean(getVendor(providerId)?.apiBaseEnvVar);
}
