import { PRESET_MODEL_CATALOG } from "@mosoo/contracts/models";
import type { PresetModelEntry } from "@mosoo/contracts/models";
import type { AccountId, OrganizationId } from "@mosoo/id";
import { VENDOR_OPENAI_COMPATIBLE, getRuntimeCatalogEntry } from "@mosoo/runtime-catalog";

import { isTruthy } from "../../../shared/truthiness";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { resolveActiveOrganization } from "../../users/application/account-organization-context.service";
import { listEffectiveCustomCredentialModelRows } from "./vendor-credential-custom-models";
import { listVisibleVendorCredentialRows } from "./vendor-credential.repository";
import { collectAvailableVendorIds } from "./vendor-credential.secret-resolution";
import type { VendorCredentialRow } from "./vendor-credential.types";
export interface AvailableModelsInput {
  accountId: AccountId;
  currentModelId?: string;
  currentVendorId?: string;
  organizationId: OrganizationId;
  runtimeId: string;
}

export type ModelCatalogSource = "custom" | "preset";
export type ResolvedModelReason =
  | "needs-key"
  | "unknown-model"
  | "unknown-provider"
  | "wrong-runtime";

export interface ResolvedModelEntry {
  available: boolean;
  displayName: string;
  modelId: string;
  reason?: ResolvedModelReason;
  source: ModelCatalogSource;
  statusDetail: string | null;
  statusLabel: string;
  vendorId: string;
  vendorLabel: string;
}

interface RuntimeModelScope {
  acceptsCustomProvider: boolean;
  label: string | null;
  /**
   * Per-runtime preset model allowlist. `null` means the runtime has no
   * per-model allowlist and falls back to vendor-only filtering; an empty set
   * would mark every preset as wrong-runtime.
   */
  supportedModelIds: ReadonlySet<string> | null;
  vendorIds: Set<string>;
}

function runtimeModelScope(runtimeId: string): RuntimeModelScope {
  const runtime = getRuntimeCatalogEntry(runtimeId);

  if (runtime === null) {
    return {
      acceptsCustomProvider: false,
      label: null,
      supportedModelIds: null,
      vendorIds: new Set<string>(),
    };
  }

  return {
    acceptsCustomProvider: runtime.acceptsCustomProvider,
    label: runtime.label,
    supportedModelIds:
      runtime.supportedModelIds === undefined ? null : new Set(runtime.supportedModelIds),
    vendorIds: new Set(runtime.vendors.map((vendor) => vendor.vendorId)),
  };
}

function availableStatus(): Pick<ResolvedModelEntry, "statusDetail" | "statusLabel"> {
  return {
    statusDetail: null,
    statusLabel: "Available",
  };
}

function needsKeyStatus(
  vendorLabel: string,
): Pick<ResolvedModelEntry, "reason" | "statusDetail" | "statusLabel"> {
  return {
    reason: "needs-key",
    statusDetail: `Configure a Provider key for ${vendorLabel}.`,
    statusLabel: "Provider key required",
  };
}

function wrongRuntimeStatus(
  vendorLabel: string,
  runtimeLabel: string | null,
): Pick<ResolvedModelEntry, "reason" | "statusDetail" | "statusLabel"> {
  const target = runtimeLabel ?? "this runtime";

  return {
    reason: "wrong-runtime",
    statusDetail: `${vendorLabel} is not available for ${target}.`,
    statusLabel: "Not available",
  };
}

function resolvePresetEntry(
  entry: PresetModelEntry,
  availableVendorIds: ReadonlySet<string>,
  runtimeLabel: string | null,
  runtimeSupportsVendor: boolean,
  runtimeSupportsModel: boolean,
): ResolvedModelEntry {
  if (!runtimeSupportsVendor || !runtimeSupportsModel) {
    return {
      available: false,
      displayName: entry.displayName,
      modelId: entry.modelId,
      source: "preset",
      ...wrongRuntimeStatus(entry.vendorLabel, runtimeLabel),
      vendorId: entry.vendorId,
      vendorLabel: entry.vendorLabel,
    };
  }

  if (!availableVendorIds.has(entry.vendorId)) {
    return {
      available: false,
      displayName: entry.displayName,
      modelId: entry.modelId,
      source: "preset",
      ...needsKeyStatus(entry.vendorLabel),
      vendorId: entry.vendorId,
      vendorLabel: entry.vendorLabel,
    };
  }

  return {
    available: true,
    displayName: entry.displayName,
    modelId: entry.modelId,
    source: "preset",
    ...availableStatus(),
    vendorId: entry.vendorId,
    vendorLabel: entry.vendorLabel,
  };
}

function resolveCustomEntries(
  input: AvailableModelsInput,
  acceptsCustomProvider: boolean,
  runtimeLabel: string | null,
  credentialRows: readonly VendorCredentialRow[],
): ResolvedModelEntry[] {
  const rows = credentialRows.filter((row) => row.vendorId === VENDOR_OPENAI_COMPATIBLE.vendorId);
  const entries: ResolvedModelEntry[] = [];

  for (const { modelId, row } of listEffectiveCustomCredentialModelRows(rows)) {
    if (!acceptsCustomProvider && modelId !== input.currentModelId) {
      continue;
    }

    entries.push({
      available: acceptsCustomProvider,
      displayName: `${modelId} (custom)`,
      modelId,
      source: "custom",
      ...(acceptsCustomProvider
        ? availableStatus()
        : wrongRuntimeStatus(`Custom · ${row.name}`, runtimeLabel)),
      vendorId: VENDOR_OPENAI_COMPATIBLE.vendorId,
      vendorLabel: `Custom · ${row.name}`,
    });
  }

  return entries;
}

function resolveMissingCurrentEntry(input: {
  acceptsCustomProvider: boolean;
  currentModelId?: string;
  currentVendorId?: string;
  entries: readonly ResolvedModelEntry[];
  runtimeLabel: string | null;
  runtimeVendorIds: ReadonlySet<string>;
}): ResolvedModelEntry[] {
  if (
    !isTruthy(input.currentModelId) ||
    !isTruthy(input.currentVendorId) ||
    input.entries.some(
      (entry) => entry.vendorId === input.currentVendorId && entry.modelId === input.currentModelId,
    )
  ) {
    return [];
  }

  if (input.currentVendorId === VENDOR_OPENAI_COMPATIBLE.vendorId) {
    return [
      {
        available: false,
        displayName: `${input.currentModelId} (custom)`,
        modelId: input.currentModelId,
        source: "custom",
        ...(input.acceptsCustomProvider
          ? needsKeyStatus("Custom Provider")
          : wrongRuntimeStatus("Custom Provider", input.runtimeLabel)),
        vendorId: VENDOR_OPENAI_COMPATIBLE.vendorId,
        vendorLabel: "Custom Provider",
      },
    ];
  }

  const presetVendor = PRESET_MODEL_CATALOG.find(
    (entry) => entry.vendorId === input.currentVendorId,
  );

  if (presetVendor === undefined) {
    return [
      {
        available: false,
        displayName: input.currentModelId,
        modelId: input.currentModelId,
        reason: "unknown-provider",
        source: "preset",
        statusDetail: `Provider ${input.currentVendorId} is not in the runtime catalog.`,
        statusLabel: "Unknown provider",
        vendorId: input.currentVendorId,
        vendorLabel: input.currentVendorId,
      },
    ];
  }

  if (!input.runtimeVendorIds.has(input.currentVendorId)) {
    return [
      {
        available: false,
        displayName: input.currentModelId,
        modelId: input.currentModelId,
        source: "preset",
        ...wrongRuntimeStatus(presetVendor.vendorLabel, input.runtimeLabel),
        vendorId: input.currentVendorId,
        vendorLabel: presetVendor.vendorLabel,
      },
    ];
  }

  return [
    {
      available: false,
      displayName: input.currentModelId,
      modelId: input.currentModelId,
      reason: "unknown-model",
      source: "preset",
      statusDetail: `Model ${input.currentModelId} is not in the runtime catalog.`,
      statusLabel: "Unknown model",
      vendorId: input.currentVendorId,
      vendorLabel: presetVendor.vendorLabel,
    },
  ];
}

export async function resolveAvailableModels(
  database: D1Database,
  input: AvailableModelsInput,
): Promise<ResolvedModelEntry[]> {
  const scope = runtimeModelScope(input.runtimeId);
  const credentialRows = await listVisibleVendorCredentialRows(
    database,
    input.accountId,
    input.organizationId,
  );
  const availableVendorIds = collectAvailableVendorIds(input.accountId, credentialRows);
  const customEntries = resolveCustomEntries(
    input,
    scope.acceptsCustomProvider,
    scope.label,
    credentialRows,
  );
  const presetEntries = PRESET_MODEL_CATALOG.map((entry) =>
    resolvePresetEntry(
      entry,
      availableVendorIds,
      scope.label,
      scope.vendorIds.has(entry.vendorId),
      scope.supportedModelIds === null || scope.supportedModelIds.has(entry.modelId),
    ),
  );
  const missingCurrentEntries = resolveMissingCurrentEntry({
    acceptsCustomProvider: scope.acceptsCustomProvider,
    entries: [...presetEntries, ...customEntries],
    runtimeLabel: scope.label,
    runtimeVendorIds: scope.vendorIds,
    ...(isTruthy(input.currentModelId) ? { currentModelId: input.currentModelId } : {}),
    ...(isTruthy(input.currentVendorId) ? { currentVendorId: input.currentVendorId } : {}),
  });

  return [...presetEntries, ...customEntries, ...missingCurrentEntries].toSorted((left, right) => {
    if (left.available !== right.available) {
      return left.available ? -1 : 1;
    }

    if (left.source !== right.source) {
      return left.source === "custom" ? -1 : 1;
    }

    return `${left.vendorLabel} ${left.displayName}`.localeCompare(
      `${right.vendorLabel} ${right.displayName}`,
    );
  });
}

export async function resolveAvailableModelsForViewer(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: {
    currentModelId?: string;
    currentVendorId?: string;
    runtimeId: string;
  },
): Promise<ResolvedModelEntry[]> {
  const activeOrganization = await resolveActiveOrganization(database, viewer.id);

  if (!activeOrganization) {
    throw new Error("Active organization is required.");
  }

  return resolveAvailableModels(database, {
    accountId: viewer.id,
    ...(isTruthy(input.currentModelId) ? { currentModelId: input.currentModelId } : {}),
    ...(isTruthy(input.currentVendorId) ? { currentVendorId: input.currentVendorId } : {}),
    organizationId: activeOrganization.id,
    runtimeId: input.runtimeId,
  });
}

export async function ensureModelAvailableForSelection(
  database: D1Database,
  input: AvailableModelsInput & {
    modelId: string;
    vendorId: string;
  },
): Promise<void> {
  const entries = await resolveAvailableModels(database, {
    accountId: input.accountId,
    ...(input.modelId ? { currentModelId: input.modelId } : {}),
    currentVendorId: input.vendorId,
    organizationId: input.organizationId,
    runtimeId: input.runtimeId,
  });
  const entry = entries.find(
    (candidate) => candidate.vendorId === input.vendorId && candidate.modelId === input.modelId,
  );

  if (!entry || !entry.available) {
    throw new Error(`Model ${input.modelId} is not available for runtime ${input.runtimeId}.`);
  }
}
