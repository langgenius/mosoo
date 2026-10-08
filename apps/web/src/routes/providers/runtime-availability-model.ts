import {
  PUBLIC_RUNTIME_CATALOG,
  VENDOR_OPENAI_COMPATIBLE,
  listPresetModelsForVendor,
  resolveRuntimeModelProtocol,
} from "@mosoo/runtime-catalog";

import type { VendorCredential } from "@/domains/vendor-credential/api/vendor-credential-client";
import { listEffectiveCustomCredentialModels } from "@/domains/vendor-credential/model/custom-credential-models";

export interface RuntimeAvailabilityRow {
  readonly label: string;
  readonly runtimeId: string;
  readonly status: string;
  readonly tone: "muted" | "ready";
}

type Translate = (key: string, variables?: Record<string, string>) => string;

const DEFAULT_TRANSLATIONS: Record<string, string> = {
  "providers.customProvider": "Custom Provider",
  "providers.customProviderRequired": "custom provider",
  "providers.needsKeyAdd": "Needs key · Add {{vendors}}",
  "providers.or": "or",
  "providers.readyConfigured": "Configured · {{vendors}}",
  "providers.protocolUnspecifiedConfigured": "Protocol unspecified · {{vendors}}",
  "providers.noCompatibleModels": "No compatible models · Check provider protocol and models",
};

const defaultTranslate: Translate = (key, variables) =>
  Object.entries(variables ?? {}).reduce(
    (text, [name, value]) => text.replaceAll(`{{${name}}}`, value),
    DEFAULT_TRANSLATIONS[key] ?? key,
  );

function formatJoin(items: readonly string[], t: Translate): string {
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
  const customModels = listEffectiveCustomCredentialModels(credentials);
  return PUBLIC_RUNTIME_CATALOG.map((runtime) => {
    const readyLabels = new Set<string>();
    const unspecifiedLabels = new Set<string>();
    let hasRelevantCredential = false;

    for (const credential of credentials) {
      const isCustom = credential.vendorId === VENDOR_OPENAI_COMPATIBLE.vendorId;
      const vendor = runtime.vendors.find((entry) => entry.vendorId === credential.vendorId);
      if (isCustom ? !runtime.acceptsCustomProvider : vendor === undefined) {
        continue;
      }
      hasRelevantCredential = true;
      const modelIds = isCustom
        ? customModels
            .filter((entry) => entry.credential.id === credential.id)
            .map((entry) => entry.modelId)
        : listPresetModelsForVendor(credential.vendorId).map((model) => model.modelId);
      const hasCompatibleModel = modelIds.some(
        (modelId) =>
          resolveRuntimeModelProtocol({
            customModelProtocol: credential.modelProtocol,
            modelId,
            runtimeId: runtime.runtimeId,
            vendorId: credential.vendorId,
          }).ok,
      );
      if (!hasCompatibleModel) {
        continue;
      }
      if (isCustom && credential.modelProtocol === null) {
        unspecifiedLabels.add(credential.name);
      } else {
        readyLabels.add(isCustom ? credential.name : (vendor?.label ?? credential.vendorId));
      }
    }
    const ready = readyLabels.size > 0;
    const requiredLabels = [
      ...runtime.vendors.map((vendor) => vendor.label),
      ...(runtime.acceptsCustomProvider ? [t("providers.customProviderRequired")] : []),
    ];
    const status =
      runtime.disabledReason ??
      (ready
        ? t("providers.readyConfigured", { vendors: [...readyLabels].join(" / ") })
        : unspecifiedLabels.size > 0
          ? t("providers.protocolUnspecifiedConfigured", {
              vendors: [...unspecifiedLabels].join(" / "),
            })
          : hasRelevantCredential
            ? t("providers.noCompatibleModels")
            : t("providers.needsKeyAdd", { vendors: formatJoin(requiredLabels, t) }));

    return {
      label: runtime.label,
      runtimeId: runtime.runtimeId,
      status,
      tone: ready && runtime.disabledReason === undefined ? "ready" : "muted",
    };
  });
}
