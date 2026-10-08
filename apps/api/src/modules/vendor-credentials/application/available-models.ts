import type { PresetModelEntry, PresetModelProtocol } from "@mosoo/contracts/models";
import type { ProjectId } from "@mosoo/id";
import {
  PRESET_MODEL_CATALOG,
  VENDOR_OPENAI_COMPATIBLE,
  getRuntimeCatalogEntry,
  resolveRuntimeModelProtocol,
} from "@mosoo/runtime-catalog";

import { isTruthy } from "../../../shared/truthiness";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { ensureProjectOwnership } from "../../projects/application/project.service";
import { listEffectiveCustomCredentialModelRows } from "./vendor-credential-custom-models";
import { listProjectVendorCredentialRows } from "./vendor-credential.repository";
import { collectAvailableVendorIds } from "./vendor-credential.secret-resolution";
import type { VendorCredentialRow } from "./vendor-credential.types";
export interface AvailableModelsInput {
  currentModelId?: string;
  currentVendorId?: string;
  projectId: ProjectId;
  runtimeId: string;
}

export type ModelCatalogSource = "custom" | "preset";
export type ResolvedModelReason =
  | "needs-key"
  | "unknown-model"
  | "unknown-provider"
  | "wrong-protocol"
  | "wrong-runtime";

export interface ResolvedModelEntry {
  available: boolean;
  displayName: string;
  modelId: string;
  modelProtocol?: PresetModelProtocol | null;
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
  runtimeId: string,
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

  const protocol = resolveRuntimeModelProtocol({
    runtimeId,
    vendorId: entry.vendorId,
    modelId: entry.modelId,
  });
  if (!protocol.ok) {
    return {
      available: false,
      displayName: entry.displayName,
      modelId: entry.modelId,
      source: "preset",
      ...(protocol.code === "protocol-unsupported"
        ? wrongProtocolStatus(protocol.message)
        : wrongRuntimeStatus(entry.vendorLabel, runtimeLabel)),
      vendorId: entry.vendorId,
      vendorLabel: entry.vendorLabel,
    };
  }

  if (!availableVendorIds.has(entry.vendorId)) {
    return {
      available: false,
      displayName: entry.displayName,
      modelId: entry.modelId,
      modelProtocol: protocol.modelProtocol,
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
    modelProtocol: protocol.modelProtocol,
    source: "preset",
    ...availableStatus(),
    vendorId: entry.vendorId,
    vendorLabel: entry.vendorLabel,
  };
}

function resolveCustomEntries(
  runtimeId: string,
  acceptsCustomProvider: boolean,
  runtimeLabel: string | null,
  credentialRows: readonly VendorCredentialRow[],
): ResolvedModelEntry[] {
  const rows = credentialRows.filter((row) => row.vendorId === VENDOR_OPENAI_COMPATIBLE.vendorId);
  const entries: ResolvedModelEntry[] = [];

  for (const { modelId, row } of listEffectiveCustomCredentialModelRows(rows)) {
    const protocol = resolveRuntimeModelProtocol({
      runtimeId,
      vendorId: VENDOR_OPENAI_COMPATIBLE.vendorId,
      modelId,
      customModelProtocol: row.modelProtocol ?? null,
    });
    entries.push({
      available: acceptsCustomProvider && protocol.ok,
      displayName: `${modelId} (custom)`,
      modelId,
      ...(protocol.ok ? { modelProtocol: protocol.modelProtocol } : {}),
      source: "custom",
      ...(!acceptsCustomProvider || (!protocol.ok && protocol.code !== "protocol-unsupported")
        ? wrongRuntimeStatus(`Custom · ${row.name}`, runtimeLabel)
        : protocol.ok
          ? availableStatus()
          : wrongProtocolStatus(protocol.message)),
      vendorId: VENDOR_OPENAI_COMPATIBLE.vendorId,
      vendorLabel: `Custom · ${row.name}`,
    });
  }

  return entries;
}

function wrongProtocolStatus(
  message: string,
): Pick<ResolvedModelEntry, "reason" | "statusDetail" | "statusLabel"> {
  return {
    reason: "wrong-protocol",
    statusDetail: message,
    statusLabel: "Incompatible protocol",
  };
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
  const credentialRows = await listProjectVendorCredentialRows(database, input.projectId);
  const availableVendorIds = collectAvailableVendorIds(credentialRows);
  const customEntries = resolveCustomEntries(
    input.runtimeId,
    scope.acceptsCustomProvider,
    scope.label,
    credentialRows,
  );
  // Custom providers only expose models explicitly declared by their credentials.
  const presetEntries = PRESET_MODEL_CATALOG.filter(
    (entry) => entry.vendorId !== VENDOR_OPENAI_COMPATIBLE.vendorId,
  ).map((entry) =>
    resolvePresetEntry(
      entry,
      input.runtimeId,
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
    projectId: ProjectId;
    runtimeId: string;
  },
): Promise<ResolvedModelEntry[]> {
  await ensureProjectOwnership(database, viewer.id, input.projectId);

  return resolveAvailableModels(database, {
    ...(isTruthy(input.currentModelId) ? { currentModelId: input.currentModelId } : {}),
    ...(isTruthy(input.currentVendorId) ? { currentVendorId: input.currentVendorId } : {}),
    projectId: input.projectId,
    runtimeId: input.runtimeId,
  });
}
