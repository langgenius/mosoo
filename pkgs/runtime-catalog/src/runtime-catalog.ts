import {
  ANTHROPIC_DEFAULT_MODEL_ID,
  OPENAI_DEFAULT_MODEL_ID,
  admitProviderId,
  admitRuntimeId,
  createRuntimeModelIdentity,
  getPresetModelForIdentity,
  listPresetModelsForVendor,
} from "@mosoo/contracts/models";
import type { PresetModelEntry, RuntimeModelIdentity } from "@mosoo/contracts/models";

export type RuntimeCatalogTransport = "openai-app-server" | "claude-agent-sdk" | "acp-fallback";
export type RuntimeCatalogVisibility = "internal" | "public";
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
  readonly label: string;
  readonly vendorId: string;
}

export interface RuntimeCatalogEntry {
  readonly acceptsCustomProvider: boolean;
  readonly capabilities: readonly RuntimeCatalogCapability[];
  readonly defaultIdentity: RuntimeModelIdentity;
  readonly defaultModel: string;
  readonly defaultProvider: string;
  readonly disabledReason?: string;
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

type RuntimeCatalogVendorInput = Omit<RuntimeCatalogVendor, "vendorId"> & {
  readonly vendorId: string;
};

type RuntimeCatalogEntryInput = Omit<
  RuntimeCatalogEntry,
  "defaultModel" | "defaultProvider" | "runtimeId"
> & {
  readonly runtimeId: string;
};

function runtimeCatalogVendor(input: RuntimeCatalogVendorInput): RuntimeCatalogVendor {
  return {
    ...input,
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

export const VENDOR_ANTHROPIC = runtimeCatalogVendor({
  apiBaseEnvVar: "ANTHROPIC_BASE_URL",
  apiKeyEnvVar: "ANTHROPIC_API_KEY",
  authHeader: {
    apiKeyHeader: "x-api-key",
    extraHeaders: {
      "anthropic-version": "2023-06-01",
    },
    scheme: "api-key",
  },
  defaultApiBase: "https://api.anthropic.com",
  label: "Anthropic",
  vendorId: "anthropic",
});

export const VENDOR_OPENAI = runtimeCatalogVendor({
  apiBaseEnvVar: "OPENAI_BASE_URL",
  apiKeyEnvVar: "OPENAI_API_KEY",
  authHeader: {
    apiKeyHeader: "Authorization",
    scheme: "bearer",
  },
  defaultApiBase: "https://api.openai.com/v1",
  label: "OpenAI",
  vendorId: "openai",
});

export const VENDOR_OPENAI_COMPATIBLE = runtimeCatalogVendor({
  apiBaseEnvVar: "OPENAI_COMPATIBLE_BASE_URL",
  apiKeyEnvVar: "OPENAI_COMPATIBLE_API_KEY",
  authHeader: {
    apiKeyHeader: "Authorization",
    scheme: "bearer",
  },
  label: "OpenAI-Compatible",
  vendorId: "openai-compatible",
});

export const ALL_VENDORS = [
  VENDOR_ANTHROPIC,
  VENDOR_OPENAI,
  VENDOR_OPENAI_COMPATIBLE,
] as const satisfies readonly RuntimeCatalogVendor[];

function modelIdsForVendor(vendorId: string): readonly string[] {
  return listPresetModelsForVendor(vendorId).map((model) => model.modelId);
}

const CLAUDE_AGENT_SDK_SUPPORTED_MODEL_IDS = modelIdsForVendor(VENDOR_ANTHROPIC.vendorId);
const OPENAI_RUNTIME_SUPPORTED_MODEL_IDS = modelIdsForVendor(VENDOR_OPENAI.vendorId);

const ACP_FALLBACK_SUPPORTED_MODEL_IDS = [
  ...CLAUDE_AGENT_SDK_SUPPORTED_MODEL_IDS,
  ...OPENAI_RUNTIME_SUPPORTED_MODEL_IDS,
] as const;

const STANDARD_RUNTIME_CAPABILITIES = [
  { id: "custom_tool_execute", status: "unsupported", version: 1 },
  { id: "input_start", status: "supported", version: 1 },
  { id: "mcp_execute", status: "supported", version: 1 },
  { id: "native_resume", status: "supported", version: 1 },
  { id: "permission_request", status: "supported", version: 1 },
  { id: "session_stop", status: "supported", version: 1 },
  { id: "thinking_stream", status: "supported", version: 1 },
  { id: "text_stream", status: "supported", version: 1 },
  { id: "tool_stream", status: "supported", version: 1 },
  { id: "turn_cancel", status: "supported", version: 1 },
  { id: "usage", status: "supported", version: 1 },
  { id: "visible_activity", status: "supported", version: 1 },
] as const satisfies readonly RuntimeCatalogCapability[];

export const SYSTEM_AGENT_RUNTIME_ID = "system-agent";

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

export const RUNTIME_CATALOG = [
  runtimeCatalogEntry({
    acceptsCustomProvider: false,
    capabilities: STANDARD_RUNTIME_CAPABILITIES,
    defaultIdentity: createCatalogRuntimeModelIdentity({
      modelId: ANTHROPIC_DEFAULT_MODEL_ID,
      providerId: VENDOR_ANTHROPIC.vendorId,
      runtimeId: "claude-agent-sdk",
    }),
    label: "Claude Agent SDK",
    runtimeId: "claude-agent-sdk",
    supportedModelIds: CLAUDE_AGENT_SDK_SUPPORTED_MODEL_IDS,
    transport: "claude-agent-sdk",
    vendors: [VENDOR_ANTHROPIC],
    visibility: "public",
  }),
  runtimeCatalogEntry({
    acceptsCustomProvider: true,
    capabilities: [],
    defaultIdentity: createCatalogRuntimeModelIdentity({
      modelId: OPENAI_DEFAULT_MODEL_ID,
      providerId: VENDOR_OPENAI.vendorId,
      runtimeId: SYSTEM_AGENT_RUNTIME_ID,
    }),
    disabledReason: "System Agent is an internal configuration helper.",
    label: "System Agent",
    runtimeId: SYSTEM_AGENT_RUNTIME_ID,
    supportedModelIds: OPENAI_RUNTIME_SUPPORTED_MODEL_IDS,
    transport: "openai-app-server",
    vendors: [VENDOR_OPENAI],
    visibility: "internal",
  }),
  runtimeCatalogEntry({
    acceptsCustomProvider: true,
    capabilities: STANDARD_RUNTIME_CAPABILITIES,
    defaultIdentity: createCatalogRuntimeModelIdentity({
      modelId: OPENAI_DEFAULT_MODEL_ID,
      providerId: VENDOR_OPENAI.vendorId,
      runtimeId: "openai-runtime",
    }),
    label: "OpenAI Runtime",
    runtimeId: "openai-runtime",
    supportedModelIds: OPENAI_RUNTIME_SUPPORTED_MODEL_IDS,
    transport: "openai-app-server",
    vendors: [VENDOR_OPENAI],
    visibility: "public",
  }),
  runtimeCatalogEntry({
    acceptsCustomProvider: false,
    capabilities: STANDARD_RUNTIME_CAPABILITIES,
    defaultIdentity: createCatalogRuntimeModelIdentity({
      modelId: OPENAI_DEFAULT_MODEL_ID,
      providerId: VENDOR_OPENAI.vendorId,
      runtimeId: "acp-fallback",
    }),
    disabledReason: "ACP fallback is an internal transport.",
    label: "ACP Fallback",
    runtimeId: "acp-fallback",
    supportedModelIds: ACP_FALLBACK_SUPPORTED_MODEL_IDS,
    transport: "acp-fallback",
    vendors: [VENDOR_OPENAI, VENDOR_ANTHROPIC],
    visibility: "internal",
  }),
] as const satisfies readonly RuntimeCatalogEntry[];

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

function runtimeSupportsPresetModel(runtime: RuntimeCatalogEntry, modelId: string): boolean {
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
