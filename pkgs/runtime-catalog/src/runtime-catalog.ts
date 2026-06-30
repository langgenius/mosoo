import {
  admitModelId,
  admitProviderId,
  admitRuntimeId,
  createRuntimeModelIdentity,
} from "@mosoo/contracts/models";
import type {
  ModelId,
  PresetModelEntry,
  PresetModelProtocol,
  RuntimeModelIdentity,
  RuntimeModelProviderRef,
} from "@mosoo/contracts/models";

import {
  GENERATED_MODEL_DEFAULT_IDS,
  GENERATED_PLANNED_RUNTIME_DISPLAY_CATALOG,
  GENERATED_PRESET_MODEL_CATALOG,
  GENERATED_RUNTIME_CATALOG,
  GENERATED_VENDOR_CATALOG,
} from "./catalog.generated";

export type RuntimeCatalogTransport = "openai-app-server" | "claude-agent-sdk" | "acp-fallback";
export type RuntimeCatalogVisibility = "internal" | "public";
export type RuntimeDisplaySurface = "landing" | "provider-settings";
export type RuntimeDisplayStatus = "available" | "coming-soon";
export type RuntimeCatalogCapabilityId =
  | "custom_tool_execute"
  | "input_start"
  | "mcp_execute"
  | "native_resume"
  | "permission_request"
  | "session_stop"
  | "thinking_stream"
  | "text_stream"
  | "tool_stream"
  | "turn_cancel"
  | "usage"
  | "visible_activity";

export interface RuntimeCatalogCapability {
  readonly id: RuntimeCatalogCapabilityId;
  readonly status: "supported" | "unsupported";
  readonly version: 1;
}

export type RuntimeCatalogVendorAuthHeader =
  | {
      readonly apiKeyHeader: "Authorization";
      readonly scheme: "bearer";
    }
  | {
      readonly apiKeyHeader: "x-api-key";
      readonly extraHeaders: Readonly<Record<string, string>>;
      readonly scheme: "api-key";
    };

export type RuntimeCatalogVendorModelSource =
  | {
      readonly kind: "manual";
    }
  | {
      readonly kind: "models.dev";
      readonly providerId: string;
    };

export interface RuntimeCatalogOpenCodeProvider {
  readonly apiBaseOption?: "baseURL";
  readonly name: string;
  readonly npmPackage: string;
  /**
   * Provider id expected by OpenCode for this adapter. Mosoo keeps its own
   * product-facing provider id in `vendorId`; this field is only for rendered
   * OpenCode config/model ids when upstream uses a different provider key.
   */
  readonly providerId?: string;
}

/**
 * Describes the vendor whose API key is required to power a runtime,
 * and the env var names used to inject credentials into the agent process.
 *
 * `apiBaseEnvVar` is the env var the CLI reads to override the default
 * API endpoint (e.g. `ANTHROPIC_BASE_URL` for the Anthropic SDK). Absent
 * when the vendor's CLI pipeline offers no supported way to redirect the
 * endpoint via environment; in that case any custom apiBase stored on the
 * credential must be rejected at hydration time rather than silently
 * dropped.
 */
export interface RuntimeCatalogVendor {
  readonly apiBaseEnvVar?: string;
  readonly authHeader: RuntimeCatalogVendorAuthHeader;
  readonly defaultApiBase?: string;
  readonly apiKeyEnvVar: string;
  readonly iconKey: string;
  readonly label: string;
  readonly modelSource?: RuntimeCatalogVendorModelSource;
  readonly openCodeProvider?: RuntimeCatalogOpenCodeProvider;
  readonly vendorId: string;
}

export interface RuntimeCatalogDisplay {
  readonly color?: string;
  readonly iconKey: string;
  readonly providerLabel?: string;
  readonly showcaseLabel?: string;
}

export interface RuntimeCatalogEntry {
  readonly acceptsCustomProvider: boolean;
  readonly capabilities: readonly RuntimeCatalogCapability[];
  readonly defaultIdentity: RuntimeModelIdentity;
  readonly defaultModel: string;
  readonly defaultProvider: string;
  readonly disabledReason?: string;
  readonly display: RuntimeCatalogDisplay;
  readonly label: string;
  readonly runtimeId: string;
  /**
   * Per-runtime preset model allowlist. When defined, only preset models whose
   * `modelId` is listed here are surfaced as `available` for this runtime;
   * other presets are returned with `reason: "wrong-runtime"`. Custom
   * (OpenAI-Compatible) credentials are NOT constrained by this list — the
   * vendor-level `acceptsCustomProvider` switch governs them instead.
   *
   * Omit when every preset model for the runtime vendors is allowed.
   */
  readonly supportedModelIds?: readonly string[];
  readonly transport: RuntimeCatalogTransport;
  readonly vendors: readonly RuntimeCatalogVendor[];
  readonly visibility: RuntimeCatalogVisibility;
}

export interface RuntimeDisplayCatalogEntry {
  readonly color?: string;
  readonly iconKey: string;
  readonly label: string;
  readonly providerLabel: string;
  readonly runtimeId: string;
  readonly status: RuntimeDisplayStatus;
}

export interface PlannedRuntimeDisplayEntry {
  readonly iconKey: string;
  readonly label: string;
  readonly providerLabel: string;
  readonly runtimeId: string;
  readonly surfaces: readonly RuntimeDisplaySurface[];
}

interface GeneratedPlannedRuntimeDisplayEntry {
  readonly iconKey: string;
  readonly label: string;
  readonly providerLabel: string;
  readonly runtimeId: string;
  readonly surfaces: readonly string[];
}

type RuntimeCatalogEntryInput = Omit<
  RuntimeCatalogEntry,
  "defaultModel" | "defaultProvider" | "runtimeId"
> & {
  readonly runtimeId: string;
};

function presetModel(input: (typeof GENERATED_PRESET_MODEL_CATALOG)[number]): PresetModelEntry {
  return {
    displayName: input.displayName,
    modelId: admitModelId(input.modelId),
    protocol: input.protocol as PresetModelProtocol,
    vendorId: admitProviderId(input.vendorId),
    vendorLabel: input.vendorLabel,
  };
}

function runtimeCatalogVendorAuthHeader(
  input: (typeof GENERATED_VENDOR_CATALOG)[number]["authHeader"],
): RuntimeCatalogVendorAuthHeader {
  if (input.scheme === "bearer") {
    return {
      apiKeyHeader: "Authorization",
      scheme: "bearer",
    };
  }

  return {
    apiKeyHeader: "x-api-key",
    extraHeaders: input.extraHeaders,
    scheme: "api-key",
  };
}

function runtimeCatalogVendor(
  input: (typeof GENERATED_VENDOR_CATALOG)[number],
): RuntimeCatalogVendor {
  const apiBaseEnvVar = "apiBaseEnvVar" in input ? input.apiBaseEnvVar : undefined;
  const defaultApiBase = "defaultApiBase" in input ? input.defaultApiBase : undefined;
  const modelSource = "modelSource" in input ? input.modelSource : undefined;
  const openCodeProvider = "openCodeProvider" in input ? input.openCodeProvider : undefined;

  return {
    ...(apiBaseEnvVar !== undefined ? { apiBaseEnvVar } : {}),
    ...(defaultApiBase !== undefined ? { defaultApiBase } : {}),
    ...(modelSource !== undefined ? { modelSource } : {}),
    apiKeyEnvVar: input.apiKeyEnvVar,
    authHeader: runtimeCatalogVendorAuthHeader(input.authHeader),
    iconKey: input.iconKey,
    label: input.label,
    ...(openCodeProvider !== undefined
      ? {
          openCodeProvider: {
            ...("apiBaseOption" in openCodeProvider
              ? { apiBaseOption: openCodeProvider.apiBaseOption }
              : {}),
            name: openCodeProvider.name,
            npmPackage: openCodeProvider.npmPackage,
            ...("providerId" in openCodeProvider
              ? { providerId: openCodeProvider.providerId }
              : {}),
          },
        }
      : {}),
    vendorId: admitProviderId(input.vendorId),
  };
}

function runtimeCatalogEntry(input: RuntimeCatalogEntryInput): RuntimeCatalogEntry {
  const runtimeId = admitRuntimeId(input.runtimeId);

  if (input.defaultIdentity.runtimeId !== runtimeId) {
    throw new Error(`Runtime ${input.runtimeId} default identity has mismatched runtime id.`);
  }

  return {
    ...input,
    defaultModel: input.defaultIdentity.modelId,
    defaultProvider: input.defaultIdentity.provider.providerId,
    runtimeId,
  };
}

function runtimeCatalogCapability(input: {
  readonly id: string;
  readonly status: "supported" | "unsupported";
  readonly version: 1;
}): RuntimeCatalogCapability {
  return {
    id: input.id as RuntimeCatalogCapabilityId,
    status: input.status,
    version: input.version,
  };
}

function requireVendor(vendorId: string): RuntimeCatalogVendor {
  const vendor = ALL_VENDORS.find((candidate) => candidate.vendorId === vendorId);

  if (vendor === undefined) {
    throw new Error(`Runtime catalog references unknown vendor ${vendorId}.`);
  }

  return vendor;
}

function createGeneratedRuntimeCatalogEntry(
  input: (typeof GENERATED_RUNTIME_CATALOG)[number],
): RuntimeCatalogEntry {
  const disabledReason = "disabledReason" in input ? input.disabledReason : undefined;
  const color = "color" in input.display ? input.display.color : undefined;
  const providerLabel = "providerLabel" in input.display ? input.display.providerLabel : undefined;
  const showcaseLabel = "showcaseLabel" in input.display ? input.display.showcaseLabel : undefined;

  return runtimeCatalogEntry({
    acceptsCustomProvider: input.acceptsCustomProvider,
    capabilities: input.capabilities.map(runtimeCatalogCapability),
    defaultIdentity: createCatalogRuntimeModelIdentity({
      modelId: input.defaultIdentity.modelId,
      providerId: input.defaultIdentity.providerId,
      runtimeId: input.runtimeId,
    }),
    ...(disabledReason !== undefined ? { disabledReason } : {}),
    display: {
      ...(color !== undefined ? { color } : {}),
      ...(providerLabel !== undefined ? { providerLabel } : {}),
      ...(showcaseLabel !== undefined ? { showcaseLabel } : {}),
      iconKey: input.display.iconKey,
    },
    label: input.label,
    runtimeId: input.runtimeId,
    supportedModelIds: input.supportedModelIds.map((modelId) => admitModelId(modelId)),
    transport: input.transport,
    vendors: input.vendorIds.map(requireVendor),
    visibility: input.visibility,
  });
}

function plannedRuntimeDisplayEntry(
  input: GeneratedPlannedRuntimeDisplayEntry,
): PlannedRuntimeDisplayEntry {
  return {
    iconKey: input.iconKey,
    label: input.label,
    providerLabel: input.providerLabel,
    runtimeId: input.runtimeId,
    surfaces: input.surfaces.map(admitRuntimeDisplaySurface),
  };
}

function admitRuntimeDisplaySurface(value: string): RuntimeDisplaySurface {
  if (value === "landing" || value === "provider-settings") {
    return value;
  }

  throw new Error(`Unsupported runtime display surface ${value}.`);
}

function toPublicRuntimeDisplayEntry(entry: RuntimeCatalogEntry): RuntimeDisplayCatalogEntry {
  return {
    ...(entry.display.color !== undefined ? { color: entry.display.color } : {}),
    iconKey: entry.display.iconKey,
    label: entry.display.showcaseLabel ?? entry.label,
    providerLabel: entry.display.providerLabel ?? entry.vendors[0]?.label ?? entry.defaultProvider,
    runtimeId: entry.runtimeId,
    status: "available",
  };
}

function toComingSoonRuntimeDisplayEntry(
  entry: PlannedRuntimeDisplayEntry,
): RuntimeDisplayCatalogEntry {
  return {
    iconKey: entry.iconKey,
    label: entry.label,
    providerLabel: entry.providerLabel,
    runtimeId: entry.runtimeId,
    status: "coming-soon",
  };
}

export const PRESET_MODEL_CATALOG: readonly PresetModelEntry[] =
  GENERATED_PRESET_MODEL_CATALOG.map(presetModel);

export const ANTHROPIC_DEFAULT_MODEL_ID = admitModelId(GENERATED_MODEL_DEFAULT_IDS.anthropic);
export const DEEPSEEK_DEFAULT_MODEL_ID = admitModelId(GENERATED_MODEL_DEFAULT_IDS.deepseek);
export const OPENAI_DEFAULT_MODEL_ID = admitModelId(GENERATED_MODEL_DEFAULT_IDS.openai);

export const ALL_VENDORS: readonly RuntimeCatalogVendor[] =
  GENERATED_VENDOR_CATALOG.map(runtimeCatalogVendor);

export const VENDOR_ANTHROPIC = requireVendor("anthropic");
export const VENDOR_DEEPSEEK = requireVendor("deepseek");
export const VENDOR_GEMINI = requireVendor("gemini");
export const VENDOR_KIMI = requireVendor("kimi");
export const VENDOR_MINIMAX = requireVendor("minimax");
export const VENDOR_OPENAI = requireVendor("openai");
export const VENDOR_OPENAI_COMPATIBLE = requireVendor("openai-compatible");
export const VENDOR_OPENCODE = requireVendor("opencode");
export const VENDOR_QWEN = requireVendor("qwen");
export const VENDOR_ZHIPU = requireVendor("zhipu");

export const SYSTEM_AGENT_RUNTIME_ID = "system-agent";

export function listPresetModelsForProvider(provider: RuntimeModelProviderRef): PresetModelEntry[] {
  if (provider.kind !== "preset") {
    return [];
  }

  return PRESET_MODEL_CATALOG.filter((entry) => entry.vendorId === provider.providerId);
}

export function listPresetModelsForVendor(vendorId: string): PresetModelEntry[] {
  return PRESET_MODEL_CATALOG.filter((entry) => entry.vendorId === vendorId);
}

export function getDefaultModelIdForVendor(vendorId: string): ModelId | null {
  const modelId = (GENERATED_MODEL_DEFAULT_IDS as Readonly<Record<string, string>>)[vendorId];
  return modelId === undefined ? null : admitModelId(modelId);
}

export function getPresetModelForIdentity(identity: RuntimeModelIdentity): PresetModelEntry | null {
  if (identity.provider.kind !== "preset") {
    return null;
  }

  return (
    PRESET_MODEL_CATALOG.find(
      (entry) =>
        entry.vendorId === identity.provider.providerId && entry.modelId === identity.modelId,
    ) ?? null
  );
}

export function getPresetModel(input: {
  readonly modelId: string;
  readonly vendorId: string;
}): PresetModelEntry | null {
  return (
    PRESET_MODEL_CATALOG.find(
      (entry) => entry.vendorId === input.vendorId && entry.modelId === input.modelId,
    ) ?? null
  );
}

export function createCatalogRuntimeModelIdentity(input: {
  readonly modelId: string;
  readonly providerId: string;
  readonly runtimeId: string;
}): RuntimeModelIdentity {
  const providerId = admitProviderId(input.providerId);

  return createRuntimeModelIdentity({
    modelId: input.modelId,
    provider: {
      kind: providerId === VENDOR_OPENAI_COMPATIBLE.vendorId ? "custom" : "preset",
      providerId,
    },
    runtimeId: input.runtimeId,
  });
}

export const RUNTIME_CATALOG: readonly RuntimeCatalogEntry[] = GENERATED_RUNTIME_CATALOG.map(
  createGeneratedRuntimeCatalogEntry,
);

export const PUBLIC_RUNTIME_CATALOG: readonly RuntimeCatalogEntry[] = RUNTIME_CATALOG.filter(
  (entry) => entry.visibility === "public",
);

// Custom providers are created through the dedicated OpenAI-Compatible flow,
// not rendered as a preset vendor card.
export const PUBLIC_VENDORS: readonly RuntimeCatalogVendor[] = ALL_VENDORS.filter(
  (vendor) =>
    vendor.vendorId !== VENDOR_OPENAI_COMPATIBLE.vendorId &&
    PUBLIC_RUNTIME_CATALOG.some((entry) =>
      entry.vendors.some((runtimeVendor) => runtimeVendor.vendorId === vendor.vendorId),
    ),
);

export const PLANNED_RUNTIME_DISPLAY_CATALOG: readonly PlannedRuntimeDisplayEntry[] = (
  GENERATED_PLANNED_RUNTIME_DISPLAY_CATALOG as readonly GeneratedPlannedRuntimeDisplayEntry[]
).map(plannedRuntimeDisplayEntry);

export const PUBLIC_RUNTIME_DISPLAY_CATALOG: readonly RuntimeDisplayCatalogEntry[] =
  PUBLIC_RUNTIME_CATALOG.map(toPublicRuntimeDisplayEntry);

export function listPlannedRuntimeDisplayEntries(
  surface: RuntimeDisplaySurface,
): RuntimeDisplayCatalogEntry[] {
  return PLANNED_RUNTIME_DISPLAY_CATALOG.filter((entry) => entry.surfaces.includes(surface)).map(
    toComingSoonRuntimeDisplayEntry,
  );
}

export function listRuntimeShowcaseDisplayEntries(): RuntimeDisplayCatalogEntry[] {
  return [...PUBLIC_RUNTIME_DISPLAY_CATALOG, ...listPlannedRuntimeDisplayEntries("landing")];
}

export function getRuntimeIconKey(runtimeId: string): string | null {
  const publicRuntime = RUNTIME_CATALOG.find((entry) => entry.runtimeId === runtimeId);

  if (publicRuntime !== undefined) {
    return publicRuntime.display.iconKey;
  }

  return (
    PLANNED_RUNTIME_DISPLAY_CATALOG.find((entry) => entry.runtimeId === runtimeId)?.iconKey ?? null
  );
}

export function getRuntimeDisplayColor(runtimeId: string): string | null {
  return RUNTIME_CATALOG.find((entry) => entry.runtimeId === runtimeId)?.display.color ?? null;
}

export function getRuntimeCatalogEntry(runtimeId: string): RuntimeCatalogEntry | null {
  return RUNTIME_CATALOG.find((candidate) => candidate.runtimeId === runtimeId) ?? null;
}

export function getPublicRuntimeCatalogEntry(runtimeId: string): RuntimeCatalogEntry | null {
  return PUBLIC_RUNTIME_CATALOG.find((candidate) => candidate.runtimeId === runtimeId) ?? null;
}

export function isPublicRuntimeCatalogEntry(runtimeId: string): boolean {
  return PUBLIC_RUNTIME_CATALOG.some((entry) => entry.runtimeId === runtimeId);
}

export type RuntimeModelIdentityRejectionCode =
  | "custom-provider-kind-mismatch"
  | "model-unsupported"
  | "model-unknown"
  | "provider-unsupported"
  | "runtime-disabled"
  | "runtime-unknown";

export type RuntimeModelIdentityAdmission =
  | {
      readonly identity: RuntimeModelIdentity;
      readonly model: null;
      readonly ok: true;
      readonly runtime: RuntimeCatalogEntry;
      readonly vendor: RuntimeCatalogVendor;
    }
  | {
      readonly identity: RuntimeModelIdentity;
      readonly model: PresetModelEntry;
      readonly ok: true;
      readonly runtime: RuntimeCatalogEntry;
      readonly vendor: RuntimeCatalogVendor;
    }
  | {
      readonly code: RuntimeModelIdentityRejectionCode;
      readonly message: string;
      readonly ok: false;
    };

function rejectRuntimeModelIdentity(
  code: RuntimeModelIdentityRejectionCode,
  message: string,
): RuntimeModelIdentityAdmission {
  return { code, message, ok: false };
}

function isOpenAiCompatibleProvider(providerId: string): boolean {
  return providerId === VENDOR_OPENAI_COMPATIBLE.vendorId;
}

function runtimeSupportsPresetModel(runtime: RuntimeCatalogEntry, modelId: ModelId): boolean {
  return runtime.supportedModelIds === undefined || runtime.supportedModelIds.includes(modelId);
}

export function admitRuntimeModelIdentity(
  identity: RuntimeModelIdentity,
): RuntimeModelIdentityAdmission {
  return admitRuntimeModelIdentityForCatalog(RUNTIME_CATALOG, identity);
}

export function admitRuntimeModelIdentityForCatalog(
  catalog: readonly RuntimeCatalogEntry[],
  identity: RuntimeModelIdentity,
): RuntimeModelIdentityAdmission {
  const runtime = catalog.find((candidate) => candidate.runtimeId === identity.runtimeId) ?? null;

  if (runtime === null) {
    return rejectRuntimeModelIdentity(
      "runtime-unknown",
      `Runtime ${identity.runtimeId} is not in the catalog.`,
    );
  }

  if (runtime.disabledReason !== undefined && runtime.disabledReason !== "") {
    return rejectRuntimeModelIdentity("runtime-disabled", runtime.disabledReason);
  }

  if (
    identity.provider.kind === "custom" &&
    !isOpenAiCompatibleProvider(identity.provider.providerId)
  ) {
    return rejectRuntimeModelIdentity(
      "custom-provider-kind-mismatch",
      "Custom provider identity must use the OpenAI-Compatible provider.",
    );
  }

  if (
    identity.provider.kind === "preset" &&
    isOpenAiCompatibleProvider(identity.provider.providerId)
  ) {
    return rejectRuntimeModelIdentity(
      "custom-provider-kind-mismatch",
      "OpenAI-Compatible identity must be marked as custom.",
    );
  }

  const vendor = getRuntimeCatalogVendorForProvider(runtime, identity.provider.providerId);

  if (vendor === null) {
    return rejectRuntimeModelIdentity(
      "provider-unsupported",
      `Runtime ${identity.runtimeId} does not support provider ${identity.provider.providerId}.`,
    );
  }

  if (identity.provider.kind === "custom") {
    return {
      identity,
      model: null,
      ok: true,
      runtime,
      vendor,
    };
  }

  const model = getPresetModelForIdentity(identity);

  if (model === null) {
    return rejectRuntimeModelIdentity(
      "model-unknown",
      `Provider ${identity.provider.providerId} does not declare model ${identity.modelId}.`,
    );
  }

  if (!runtimeSupportsPresetModel(runtime, identity.modelId)) {
    return rejectRuntimeModelIdentity(
      "model-unsupported",
      `Runtime ${identity.runtimeId} does not support model ${identity.modelId}.`,
    );
  }

  return {
    identity,
    model,
    ok: true,
    runtime,
    vendor,
  };
}

export function getRuntimeCatalogVendorForIdentity(
  runtime: Pick<RuntimeCatalogEntry, "acceptsCustomProvider" | "vendors">,
  identity: RuntimeModelIdentity,
): RuntimeCatalogVendor | null {
  return getRuntimeCatalogVendorForProvider(runtime, identity.provider.providerId);
}

export function runtimeCatalogEntrySupportsIdentity(
  runtime: Pick<RuntimeCatalogEntry, "acceptsCustomProvider" | "vendors">,
  identity: RuntimeModelIdentity,
): boolean {
  return getRuntimeCatalogVendorForIdentity(runtime, identity) !== null;
}

export function runtimeCatalogEntrySupportsProvider(
  runtime: Pick<RuntimeCatalogEntry, "acceptsCustomProvider" | "vendors">,
  provider: string,
): boolean {
  return getRuntimeCatalogVendorForProvider(runtime, provider) !== null;
}

export function getRuntimeCatalogVendorForProvider(
  runtime: Pick<RuntimeCatalogEntry, "acceptsCustomProvider" | "vendors">,
  provider: string,
): RuntimeCatalogVendor | null {
  const vendor = runtime.vendors.find((candidate) => candidate.vendorId === provider);

  if (vendor) {
    return vendor;
  }

  if (provider === VENDOR_OPENAI_COMPATIBLE.vendorId && runtime.acceptsCustomProvider) {
    return VENDOR_OPENAI_COMPATIBLE;
  }

  return null;
}

export function getVendor(vendorId: string): RuntimeCatalogVendor | null {
  return ALL_VENDORS.find((candidate) => candidate.vendorId === vendorId) ?? null;
}
