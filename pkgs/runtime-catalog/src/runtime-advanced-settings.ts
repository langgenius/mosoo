import type { JsonObject } from "@mosoo/contracts";

export type RuntimeAdvancedSettingType = "number" | "select";
export type RuntimeAdvancedSettingValueType = "integer" | "string";

export interface RuntimeAdvancedSettingOption {
  readonly label: string;
  readonly value: string;
}

export interface RuntimeAdvancedSettingBaseDefinition {
  readonly description: string;
  readonly key: string;
  readonly label: string;
}

export interface RuntimeAdvancedSelectSettingDefinition extends RuntimeAdvancedSettingBaseDefinition {
  readonly defaultValue?: string;
  readonly options: readonly RuntimeAdvancedSettingOption[];
  readonly type: "select";
}

export interface RuntimeAdvancedNumberSettingDefinition extends RuntimeAdvancedSettingBaseDefinition {
  readonly defaultValue?: number;
  readonly min: number;
  readonly step?: number;
  readonly type: "number";
  readonly valueType: RuntimeAdvancedSettingValueType;
}

export type RuntimeAdvancedSettingDefinition =
  | RuntimeAdvancedNumberSettingDefinition
  | RuntimeAdvancedSelectSettingDefinition;

export interface RuntimeAdvancedSettingsValidationIssue {
  readonly code:
    | "runtime_settings_invalid_value"
    | "runtime_settings_security_boundary"
    | "runtime_settings_unsupported";
  readonly key: string;
  readonly message: string;
}

export interface RuntimeAdvancedSettingsValidationResult {
  readonly issues: readonly RuntimeAdvancedSettingsValidationIssue[];
  readonly normalizedSettings: JsonObject;
  readonly ok: boolean;
}

function option(value: string): RuntimeAdvancedSettingOption {
  return {
    label: value,
    value,
  };
}

interface OpenAiModelAdvancedSettingsProfile {
  readonly defaultReasoningEffort: string;
  readonly defaultVerbosity: string;
  readonly reasoningEfforts: readonly string[];
}

const OPENAI_DEFAULT_ADVANCED_SETTINGS_PROFILE: OpenAiModelAdvancedSettingsProfile = {
  defaultReasoningEffort: "medium",
  defaultVerbosity: "medium",
  reasoningEfforts: ["low", "medium", "high", "xhigh"],
};

const OPENAI_MODEL_ADVANCED_SETTINGS_PROFILES: Readonly<
  Record<string, OpenAiModelAdvancedSettingsProfile>
> = {
  "gpt-5.4": {
    defaultReasoningEffort: "medium",
    defaultVerbosity: "low",
    reasoningEfforts: ["low", "medium", "high", "xhigh"],
  },
  "gpt-5.4-mini": {
    defaultReasoningEffort: "medium",
    defaultVerbosity: "medium",
    reasoningEfforts: ["low", "medium", "high", "xhigh"],
  },
  "gpt-5.5": {
    defaultReasoningEffort: "medium",
    defaultVerbosity: "low",
    reasoningEfforts: ["low", "medium", "high", "xhigh"],
  },
  "gpt-5.6-luna": {
    defaultReasoningEffort: "medium",
    defaultVerbosity: "low",
    reasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
  },
  "gpt-5.6-sol": {
    defaultReasoningEffort: "low",
    defaultVerbosity: "low",
    reasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
  },
  "gpt-5.6-terra": {
    defaultReasoningEffort: "medium",
    defaultVerbosity: "low",
    reasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
  },
};

function createOpenAiAdvancedSettings(
  modelId: string | undefined,
): readonly RuntimeAdvancedSettingDefinition[] {
  const profile =
    (modelId === undefined ? undefined : OPENAI_MODEL_ADVANCED_SETTINGS_PROFILES[modelId]) ??
    OPENAI_DEFAULT_ADVANCED_SETTINGS_PROFILE;

  return [
    {
      defaultValue: profile.defaultReasoningEffort,
      description: "Controls Codex reasoning depth for this model.",
      key: "model_reasoning_effort",
      label: "Reasoning effort",
      options: profile.reasoningEfforts.map(option),
      type: "select",
    },
    {
      defaultValue: profile.defaultVerbosity,
      description: "Controls response length for Responses API capable Codex models.",
      key: "model_verbosity",
      label: "Verbosity",
      options: ["low", "medium", "high"].map(option),
      type: "select",
    },
  ];
}

const RUNTIME_ADVANCED_SETTINGS: Readonly<
  Record<string, readonly RuntimeAdvancedSettingDefinition[]>
> = {
  "claude-agent-sdk": [
    {
      description: "Controls Claude Agent SDK reasoning effort for this runtime.",
      key: "effort",
      label: "Effort",
      options: ["low", "medium", "high", "xhigh", "max"].map(option),
      type: "select",
    },
    {
      description: "Maximum number of Claude Agent SDK conversation turns before stopping.",
      key: "maxTurns",
      label: "Max turns",
      min: 1,
      step: 1,
      type: "number",
      valueType: "integer",
    },
  ],
};

const SECURITY_BOUNDARY_SETTING_KEYS = new Set([
  "additionalDirectories",
  "agent",
  "agents",
  "allowDangerouslySkipPermissions",
  "allowedTools",
  "approval_policy",
  "canUseTool",
  "cwd",
  "default_permissions",
  "disallowedTools",
  "env",
  "features",
  "mcpServers",
  "mcp_servers",
  "model",
  "model_provider",
  "model_providers",
  "openai_base_url",
  "pathToClaudeCodeExecutable",
  "permissionMode",
  "sandbox_mode",
  "service_tier",
  "shell_environment_policy",
  "systemPrompt",
]);

export function listRuntimeAdvancedSettings(
  runtimeId: string,
  modelId?: string,
): readonly RuntimeAdvancedSettingDefinition[] {
  if (runtimeId === "openai-runtime") {
    return createOpenAiAdvancedSettings(modelId);
  }

  return RUNTIME_ADVANCED_SETTINGS[runtimeId] ?? [];
}

function createDefinitionMap(
  runtimeId: string,
  modelId?: string,
): ReadonlyMap<string, RuntimeAdvancedSettingDefinition> {
  return new Map(
    listRuntimeAdvancedSettings(runtimeId, modelId).map((definition) => [
      definition.key,
      definition,
    ]),
  );
}

function settingValueIssue(
  definition: RuntimeAdvancedSettingDefinition,
  value: unknown,
): string | null {
  if (definition.type === "select") {
    return definition.options.some((optionEntry) => optionEntry.value === value)
      ? null
      : `Runtime setting ${definition.key} must be one of ${definition.options
          .map((optionEntry) => optionEntry.value)
          .join(", ")}.`;
  }

  return typeof value === "number" &&
    Number.isFinite(value) &&
    (definition.valueType !== "integer" || Number.isInteger(value)) &&
    value >= definition.min
    ? null
    : `Runtime setting ${definition.key} must be an integer greater than or equal to ${definition.min}.`;
}

export function normalizeRuntimeAdvancedSettings(input: {
  readonly modelId?: string;
  readonly runtimeId: string;
  readonly settings: JsonObject;
}): JsonObject {
  const definitions = createDefinitionMap(input.runtimeId, input.modelId);
  const normalized: JsonObject = {};

  for (const [key, value] of Object.entries(input.settings)) {
    const definition = definitions.get(key);

    if (
      definition !== undefined &&
      value !== definition.defaultValue &&
      settingValueIssue(definition, value) === null
    ) {
      normalized[key] = value;
    }
  }

  return normalized;
}

export function validateRuntimeAdvancedSettings(input: {
  readonly modelId?: string;
  readonly runtimeId: string;
  readonly settings: JsonObject;
}): RuntimeAdvancedSettingsValidationResult {
  const definitions = createDefinitionMap(input.runtimeId, input.modelId);
  const issues: RuntimeAdvancedSettingsValidationIssue[] = [];

  for (const [key, value] of Object.entries(input.settings)) {
    const definition = definitions.get(key);

    if (definition === undefined) {
      issues.push(
        SECURITY_BOUNDARY_SETTING_KEYS.has(key)
          ? {
              code: "runtime_settings_security_boundary",
              key,
              message: `Runtime setting ${key} is managed by mosoo platform policy and cannot be set here.`,
            }
          : {
              code: "runtime_settings_unsupported",
              key,
              message: `Runtime setting ${key} is not supported for ${input.runtimeId}.`,
            },
      );
      continue;
    }

    const message = settingValueIssue(definition, value);

    if (message !== null) {
      issues.push({ code: "runtime_settings_invalid_value", key, message });
    }
  }

  return {
    issues,
    normalizedSettings:
      issues.length === 0 ? normalizeRuntimeAdvancedSettings(input) : input.settings,
    ok: issues.length === 0,
  };
}
