import { PUBLIC_RUNTIME_CATALOG, VENDOR_OPENAI_COMPATIBLE } from "@mosoo/runtime-catalog";

import type { VendorCredential } from "@/domains/vendor-credential/api/vendor-credential-client";

export interface RuntimeAvailabilityRow {
  readonly label: string;
  readonly runtimeId: string;
  readonly status: string;
  readonly tone: "muted" | "ready";
}

type Translate = (key: string, variables?: Record<string, string>) => string;

const DEFAULT_TRANSLATIONS: Record<string, string> = {
  "providers.customModel": "Custom model",
  "providers.customModelRequired": "custom model",
  "providers.needsKeyAdd": "Needs key · Add {{vendors}}",
  "providers.or": "or",
  "providers.readyConfigured": "Ready · {{vendors}} configured",
};

const defaultTranslate: Translate = (key, variables) =>
  Object.entries(variables ?? {}).reduce(
    (text, [name, value]) => text.replaceAll(`{{${name}}}`, value),
    DEFAULT_TRANSLATIONS[key] ?? key,
  );

function formatJoin(
  items: readonly string[],
  t: Translate,
): string {
  if (items.length <= 2) {
    return items.join(` ${t("providers.or")} `);
  }

  const lastItem = items[items.length - 1];

  if (lastItem === undefined) {
    return "";
  }

  return `${items.slice(0, -1).join(", ")}, ${t("providers.or")} ${lastItem}`;
}

export function listRuntimeAvailabilityRows(
  credentials: readonly VendorCredential[],
  t: Translate = defaultTranslate,
): RuntimeAvailabilityRow[] {
  const configuredVendorIds = new Set(credentials.map((credential) => credential.vendorId));

  return PUBLIC_RUNTIME_CATALOG.map((runtime) => {
    const configuredLabels = runtime.vendors
      .filter((vendor) => configuredVendorIds.has(vendor.vendorId))
      .map((vendor) => vendor.label);
    const customProviderReady =
      runtime.acceptsCustomProvider && configuredVendorIds.has(VENDOR_OPENAI_COMPATIBLE.vendorId);
    const readyLabels = [
      ...configuredLabels,
      ...(customProviderReady ? [t("providers.customModel")] : []),
    ];
    const ready = readyLabels.length > 0;
    const requiredLabels = [
      ...runtime.vendors.map((vendor) => vendor.label),
      ...(runtime.acceptsCustomProvider ? [t("providers.customModelRequired")] : []),
    ];
    const status =
      runtime.disabledReason ??
      (ready
        ? t("providers.readyConfigured", { vendors: readyLabels.join(" / ") })
        : t("providers.needsKeyAdd", { vendors: formatJoin(requiredLabels, t) }));

    return {
      label: runtime.label,
      runtimeId: runtime.runtimeId,
      status,
      tone: ready && runtime.disabledReason === undefined ? "ready" : "muted",
    };
  });
}
