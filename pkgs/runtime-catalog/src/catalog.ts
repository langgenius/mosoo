import type { PresetModelProtocol } from "@mosoo/contracts/models";

export type RuntimeCatalogTransport =
  | "openai-app-server"
  | "claude-agent-sdk"
  | "acp-fallback"
  | "pi-rpc";

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

export interface RuntimeCatalogOpenCodeProvider {
  readonly name: string;
  readonly npmPackage: string;
  /**
   * Provider id expected by OpenCode for this adapter. mosoo keeps its own
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
  readonly apiKeyEnvVar: string;
  readonly authHeader: RuntimeCatalogVendorAuthHeader;
  readonly defaultApiBase?: string;
  readonly iconKey: string;
  readonly label: string;
  readonly openCodeProvider?: RuntimeCatalogOpenCodeProvider;
  readonly vendorId: string;
}

export interface RuntimeCatalogPresetModel {
  readonly displayName: string;
  readonly modelId: string;
  readonly protocol: PresetModelProtocol;
  readonly vendor: RuntimeCatalogVendor;
}

export interface RuntimeCatalogRuntime {
  readonly acceptsCustomProvider: boolean;
  readonly defaultModel: string;
  readonly defaultProvider: string;
  readonly display: {
    readonly color?: string;
    readonly iconKey: string;
    readonly providerLabel: string;
  };
  readonly label: string;
  readonly runtimeId: string;
  readonly supportedModelProtocols: readonly PresetModelProtocol[];
  readonly transport: RuntimeCatalogTransport;
  readonly vendors: readonly RuntimeCatalogVendor[];
}

const BEARER_AUTH = { apiKeyHeader: "Authorization", scheme: "bearer" } as const;
const ANTHROPIC_API_KEY_AUTH = {
  apiKeyHeader: "x-api-key",
  extraHeaders: { "anthropic-version": "2023-06-01" },
  scheme: "api-key",
} as const;

export const VENDOR_ANTHROPIC: RuntimeCatalogVendor = {
  apiBaseEnvVar: "ANTHROPIC_BASE_URL",
  apiKeyEnvVar: "ANTHROPIC_API_KEY",
  authHeader: ANTHROPIC_API_KEY_AUTH,
  defaultApiBase: "https://api.anthropic.com",
  iconKey: "anthropic",
  label: "Anthropic",
  vendorId: "anthropic",
};

export const VENDOR_OPENAI: RuntimeCatalogVendor = {
  apiBaseEnvVar: "OPENAI_BASE_URL",
  apiKeyEnvVar: "OPENAI_API_KEY",
  authHeader: BEARER_AUTH,
  defaultApiBase: "https://api.openai.com/v1",
  iconKey: "openai",
  label: "OpenAI",
  vendorId: "openai",
};

export const VENDOR_OPENAI_COMPATIBLE: RuntimeCatalogVendor = {
  apiBaseEnvVar: "OPENAI_COMPATIBLE_BASE_URL",
  apiKeyEnvVar: "OPENAI_COMPATIBLE_API_KEY",
  authHeader: BEARER_AUTH,
  iconKey: "openai",
  label: "OpenAI-Compatible",
  openCodeProvider: { name: "OpenAI Compatible", npmPackage: "@ai-sdk/openai-compatible" },
  vendorId: "openai-compatible",
};

export const VENDOR_DEEPSEEK: RuntimeCatalogVendor = {
  apiBaseEnvVar: "DEEPSEEK_BASE_URL",
  apiKeyEnvVar: "DEEPSEEK_API_KEY",
  authHeader: BEARER_AUTH,
  defaultApiBase: "https://api.deepseek.com",
  iconKey: "deepseek",
  label: "DeepSeek",
  vendorId: "deepseek",
};

export const VENDOR_GEMINI: RuntimeCatalogVendor = {
  apiBaseEnvVar: "GEMINI_BASE_URL",
  apiKeyEnvVar: "GEMINI_API_KEY",
  authHeader: BEARER_AUTH,
  defaultApiBase: "https://generativelanguage.googleapis.com/v1beta/openai",
  iconKey: "gemini",
  label: "Gemini",
  openCodeProvider: { name: "Gemini", npmPackage: "@ai-sdk/openai-compatible" },
  vendorId: "gemini",
};

export const VENDOR_QWEN: RuntimeCatalogVendor = {
  apiBaseEnvVar: "QWEN_BASE_URL",
  apiKeyEnvVar: "QWEN_API_KEY",
  authHeader: BEARER_AUTH,
  defaultApiBase: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
  iconKey: "qwen",
  label: "Qwen",
  openCodeProvider: { name: "Qwen", npmPackage: "@ai-sdk/openai-compatible" },
  vendorId: "qwen",
};

export const VENDOR_KIMI: RuntimeCatalogVendor = {
  apiBaseEnvVar: "KIMI_BASE_URL",
  apiKeyEnvVar: "KIMI_API_KEY",
  authHeader: BEARER_AUTH,
  defaultApiBase: "https://api.moonshot.ai/v1",
  iconKey: "kimi",
  label: "Kimi",
  openCodeProvider: { name: "Kimi", npmPackage: "@ai-sdk/openai-compatible" },
  vendorId: "kimi",
};

export const VENDOR_ZHIPU: RuntimeCatalogVendor = {
  apiBaseEnvVar: "ZHIPU_BASE_URL",
  apiKeyEnvVar: "ZHIPU_API_KEY",
  authHeader: BEARER_AUTH,
  defaultApiBase: "https://api.z.ai/api/paas/v4",
  iconKey: "zhipu",
  label: "Zhipu",
  openCodeProvider: { name: "Zhipu", npmPackage: "@ai-sdk/openai-compatible", providerId: "zai" },
  vendorId: "zhipu",
};

export const VENDOR_MINIMAX: RuntimeCatalogVendor = {
  apiBaseEnvVar: "MINIMAX_BASE_URL",
  apiKeyEnvVar: "MINIMAX_API_KEY",
  authHeader: ANTHROPIC_API_KEY_AUTH,
  defaultApiBase: "https://api.minimax.io/anthropic/v1",
  iconKey: "minimax",
  label: "MiniMax",
  openCodeProvider: { name: "MiniMax", npmPackage: "@ai-sdk/anthropic" },
  vendorId: "minimax",
};

const VENDOR_OPENCODE: RuntimeCatalogVendor = {
  apiKeyEnvVar: "OPENCODE_API_KEY",
  authHeader: BEARER_AUTH,
  defaultApiBase: "https://opencode.ai/zen/v1",
  iconKey: "opencode",
  label: "OpenCode Zen",
  vendorId: "opencode",
};

export const VENDORS: readonly RuntimeCatalogVendor[] = [
  VENDOR_ANTHROPIC,
  VENDOR_OPENAI,
  VENDOR_OPENAI_COMPATIBLE,
  VENDOR_DEEPSEEK,
  VENDOR_GEMINI,
  VENDOR_QWEN,
  VENDOR_KIMI,
  VENDOR_ZHIPU,
  VENDOR_MINIMAX,
  VENDOR_OPENCODE,
];

export const MODEL_DEFAULTS: Readonly<Record<string, string>> = {
  anthropic: "claude-sonnet-5",
  deepseek: "deepseek-v4-pro",
  gemini: "gemini-3.5-flash",
  kimi: "kimi-k2.6",
  minimax: "MiniMax-M3",
  opencode: "deepseek-v4-pro",
  openai: "gpt-5.5",
  qwen: "qwen3.7-plus",
  zhipu: "glm-4.7",
};

export const PRESET_MODELS: readonly RuntimeCatalogPresetModel[] = [
  {
    displayName: "Claude Fable 5",
    modelId: "claude-fable-5",
    protocol: "anthropic-messages",
    vendor: VENDOR_ANTHROPIC,
  },
  {
    displayName: "Claude Sonnet 5",
    modelId: "claude-sonnet-5",
    protocol: "anthropic-messages",
    vendor: VENDOR_ANTHROPIC,
  },
  {
    displayName: "Claude Opus 4.7",
    modelId: "claude-opus-4-7",
    protocol: "anthropic-messages",
    vendor: VENDOR_ANTHROPIC,
  },
  {
    displayName: "Claude Opus 4.6",
    modelId: "claude-opus-4-6",
    protocol: "anthropic-messages",
    vendor: VENDOR_ANTHROPIC,
  },
  {
    displayName: "Claude Opus 4.5",
    modelId: "claude-opus-4-5",
    protocol: "anthropic-messages",
    vendor: VENDOR_ANTHROPIC,
  },
  {
    displayName: "Claude Sonnet 4.6",
    modelId: "claude-sonnet-4-6",
    protocol: "anthropic-messages",
    vendor: VENDOR_ANTHROPIC,
  },
  {
    displayName: "Claude Sonnet 4.5",
    modelId: "claude-sonnet-4-5",
    protocol: "anthropic-messages",
    vendor: VENDOR_ANTHROPIC,
  },
  {
    displayName: "Claude Haiku 4.5",
    modelId: "claude-haiku-4-5",
    protocol: "anthropic-messages",
    vendor: VENDOR_ANTHROPIC,
  },
  {
    displayName: "GPT-5.6 Sol (Limited preview)",
    modelId: "gpt-5.6-sol",
    protocol: "openai-responses",
    vendor: VENDOR_OPENAI,
  },
  {
    displayName: "GPT-5.6 Terra (Limited preview)",
    modelId: "gpt-5.6-terra",
    protocol: "openai-responses",
    vendor: VENDOR_OPENAI,
  },
  {
    displayName: "GPT-5.6 Luna (Limited preview)",
    modelId: "gpt-5.6-luna",
    protocol: "openai-responses",
    vendor: VENDOR_OPENAI,
  },
  {
    displayName: "GPT-5.5",
    modelId: "gpt-5.5",
    protocol: "openai-responses",
    vendor: VENDOR_OPENAI,
  },
  {
    displayName: "GPT-5.4",
    modelId: "gpt-5.4",
    protocol: "openai-responses",
    vendor: VENDOR_OPENAI,
  },
  {
    displayName: "GPT-5.4 mini",
    modelId: "gpt-5.4-mini",
    protocol: "openai-responses",
    vendor: VENDOR_OPENAI,
  },
  {
    displayName: "GPT-5.3",
    modelId: "gpt-5.3",
    protocol: "openai-responses",
    vendor: VENDOR_OPENAI,
  },
  {
    displayName: "GPT-5.2",
    modelId: "gpt-5.2",
    protocol: "openai-responses",
    vendor: VENDOR_OPENAI,
  },
  {
    displayName: "DeepSeek V4 Pro",
    modelId: "deepseek-v4-pro",
    protocol: "openai-chat-completions",
    vendor: VENDOR_DEEPSEEK,
  },
  {
    displayName: "DeepSeek V4 Flash",
    modelId: "deepseek-v4-flash",
    protocol: "openai-chat-completions",
    vendor: VENDOR_DEEPSEEK,
  },
  {
    displayName: "Gemini 3.5 Flash",
    modelId: "gemini-3.5-flash",
    protocol: "openai-chat-completions",
    vendor: VENDOR_GEMINI,
  },
  {
    displayName: "Qwen3.7 Plus",
    modelId: "qwen3.7-plus",
    protocol: "openai-chat-completions",
    vendor: VENDOR_QWEN,
  },
  {
    displayName: "Qwen3.6 Plus",
    modelId: "qwen3.6-plus",
    protocol: "openai-chat-completions",
    vendor: VENDOR_QWEN,
  },
  {
    displayName: "Kimi K2.6",
    modelId: "kimi-k2.6",
    protocol: "openai-chat-completions",
    vendor: VENDOR_KIMI,
  },
  {
    displayName: "Kimi K2.7 Code",
    modelId: "kimi-k2.7-code",
    protocol: "openai-chat-completions",
    vendor: VENDOR_KIMI,
  },
  {
    displayName: "GLM-4.7",
    modelId: "glm-4.7",
    protocol: "openai-chat-completions",
    vendor: VENDOR_ZHIPU,
  },
  {
    displayName: "GLM-4.6",
    modelId: "glm-4.6",
    protocol: "openai-chat-completions",
    vendor: VENDOR_ZHIPU,
  },
  {
    displayName: "MiniMax M3",
    modelId: "MiniMax-M3",
    protocol: "anthropic-messages",
    vendor: VENDOR_MINIMAX,
  },
  {
    displayName: "MiniMax M2.7",
    modelId: "MiniMax-M2.7",
    protocol: "anthropic-messages",
    vendor: VENDOR_MINIMAX,
  },
  {
    displayName: "DeepSeek V4 Pro",
    modelId: "deepseek-v4-pro",
    protocol: "openai-chat-completions",
    vendor: VENDOR_OPENCODE,
  },
  {
    displayName: "Qwen3.6 Plus",
    modelId: "qwen3.6-plus",
    protocol: "anthropic-messages",
    vendor: VENDOR_OPENCODE,
  },
  {
    displayName: "GLM 5.2",
    modelId: "glm-5.2",
    protocol: "openai-chat-completions",
    vendor: VENDOR_OPENCODE,
  },
  {
    displayName: "MiniMax M2.7",
    modelId: "minimax-m2.7",
    protocol: "openai-chat-completions",
    vendor: VENDOR_OPENCODE,
  },
  {
    displayName: "Gemini 3.5 Flash",
    modelId: "gemini-3.5-flash",
    protocol: "google-gemini",
    vendor: VENDOR_OPENCODE,
  },
];

const ALL_MODEL_PROTOCOLS: readonly PresetModelProtocol[] = [
  "anthropic-messages",
  "google-gemini",
  "openai-chat-completions",
  "openai-responses",
];

const MULTI_PROVIDER_VENDORS: readonly RuntimeCatalogVendor[] = [
  VENDOR_OPENAI,
  VENDOR_ANTHROPIC,
  VENDOR_DEEPSEEK,
  VENDOR_GEMINI,
  VENDOR_QWEN,
  VENDOR_KIMI,
  VENDOR_ZHIPU,
  VENDOR_MINIMAX,
  VENDOR_OPENCODE,
];

export const RUNTIMES: readonly RuntimeCatalogRuntime[] = [
  {
    acceptsCustomProvider: false,
    defaultModel: "claude-sonnet-5",
    defaultProvider: "anthropic",
    display: { color: "#D97757", iconKey: "claude-code", providerLabel: "Anthropic" },
    label: "Claude Agent SDK",
    runtimeId: "claude-agent-sdk",
    supportedModelProtocols: ["anthropic-messages"],
    transport: "claude-agent-sdk",
    vendors: [VENDOR_ANTHROPIC],
  },
  {
    acceptsCustomProvider: true,
    defaultModel: "gpt-5.5",
    defaultProvider: "openai",
    display: { color: "#7A9DFF", iconKey: "openai", providerLabel: "OpenAI" },
    label: "OpenAI Runtime",
    runtimeId: "openai-runtime",
    supportedModelProtocols: ["openai-responses"],
    transport: "openai-app-server",
    vendors: [VENDOR_OPENAI],
  },
  {
    acceptsCustomProvider: true,
    defaultModel: "gpt-5.5",
    defaultProvider: "openai",
    display: { iconKey: "opencode", providerLabel: "OpenCode" },
    label: "OpenCode",
    runtimeId: "acp-fallback",
    supportedModelProtocols: ALL_MODEL_PROTOCOLS,
    transport: "acp-fallback",
    vendors: MULTI_PROVIDER_VENDORS,
  },
  {
    acceptsCustomProvider: true,
    // Preserve the custom-provider default; callers may also select a preset model.
    defaultModel: "custom-model",
    defaultProvider: "openai-compatible",
    display: { iconKey: "pi", providerLabel: "Multiple providers" },
    label: "Pi",
    runtimeId: "pi",
    supportedModelProtocols: ALL_MODEL_PROTOCOLS,
    transport: "pi-rpc",
    vendors: [VENDOR_OPENAI_COMPATIBLE, ...MULTI_PROVIDER_VENDORS],
  },
];
