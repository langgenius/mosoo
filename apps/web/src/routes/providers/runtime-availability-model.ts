import { PUBLIC_RUNTIME_CATALOG } from "@mosoo/runtime-catalog";

import type { VendorCredential } from "@/domains/vendor-credential/api/vendor-credential-client";

export interface RuntimeAvailabilityRow {
  readonly label: string;
  readonly provider: string;
  readonly runtimeId: string;
  readonly status: string;
  readonly tone: "muted" | "ready";
}

export function listRuntimeAvailabilityRows(
  credentials: readonly VendorCredential[],
): RuntimeAvailabilityRow[] {
  const configuredVendorIds = new Set(credentials.map((credential) => credential.vendorId));

  return PUBLIC_RUNTIME_CATALOG.map((runtime) => {
    const [vendor] = runtime.vendors;
    const ready = vendor !== undefined && configuredVendorIds.has(vendor.vendorId);
    const provider = vendor?.label ?? runtime.defaultProvider;
    const status = runtime.disabledReason ?? (ready ? "Ready" : `Add a ${provider} key`);

    return {
      label: runtime.label,
      provider,
      runtimeId: runtime.runtimeId,
      status,
      tone: ready && runtime.disabledReason === undefined ? "ready" : "muted",
    };
  });
}
