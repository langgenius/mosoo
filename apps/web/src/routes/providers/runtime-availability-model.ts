import { PUBLIC_RUNTIME_CATALOG, VENDOR_OPENAI_COMPATIBLE } from "@mosoo/runtime-catalog";

import type { VendorCredential } from "@/domains/vendor-credential/api/vendor-credential-client";

export interface RuntimeAvailabilityRow {
  readonly label: string;
  readonly runtimeId: string;
  readonly status: string;
  readonly tone: "muted" | "ready";
}

function formatJoin(items: readonly string[]): string {
  if (items.length <= 2) {
    return items.join(" or ");
  }

  const lastItem = items[items.length - 1];

  if (lastItem === undefined) {
    return "";
  }

  return `${items.slice(0, -1).join(", ")}, or ${lastItem}`;
}

export function listRuntimeAvailabilityRows(
  credentials: readonly VendorCredential[],
): RuntimeAvailabilityRow[] {
  const configuredVendorIds = new Set(credentials.map((credential) => credential.vendorId));

  return PUBLIC_RUNTIME_CATALOG.map((runtime) => {
    const configuredLabels = runtime.vendors
      .filter((vendor) => configuredVendorIds.has(vendor.vendorId))
      .map((vendor) => vendor.label);
    const customProviderReady =
      runtime.acceptsCustomProvider && configuredVendorIds.has(VENDOR_OPENAI_COMPATIBLE.vendorId);
    const readyLabels = [...configuredLabels, ...(customProviderReady ? ["Custom model"] : [])];
    const ready = readyLabels.length > 0;
    const requiredLabels = [
      ...runtime.vendors.map((vendor) => vendor.label),
      ...(runtime.acceptsCustomProvider ? ["custom model"] : []),
    ];
    const status =
      runtime.disabledReason ??
      (ready
        ? `Ready · ${readyLabels.join(" / ")} configured`
        : `Needs key · Add ${formatJoin(requiredLabels)}`);

    return {
      label: runtime.label,
      runtimeId: runtime.runtimeId,
      status,
      tone: ready && runtime.disabledReason === undefined ? "ready" : "muted",
    };
  });
}
