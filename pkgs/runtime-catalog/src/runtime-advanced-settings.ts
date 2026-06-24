import type { JsonObject } from "@mosoo/contracts";

export type RuntimeAdvancedSettingType = "select";

export interface RuntimeAdvancedSettingOption {
  readonly label: string;
  readonly value: string;
}

export interface RuntimeAdvancedSettingDefinition {
  readonly defaultValue: string;
  readonly description: string;
  readonly key: string;
  readonly label: string;
  readonly options: readonly RuntimeAdvancedSettingOption[];
  readonly type: RuntimeAdvancedSettingType;
}

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

export const RUNTIME_ADVANCED_SETTINGS_REGISTRY = {
  "claude-agent-sdk": [],
  "openai-runtime": [
    {
      defaultValue: "medium",
      description: "Controls Codex reasoning depth for this runtime.",
      key: "model_reasoning_effort",
      label: "Reasoning effort",
      options: ["minimal", "low", "medium", "high", "xhigh"].map(option),
      type: "select",
    },
    {
      defaultValue: "medium",
      description: "Controls response length for Responses API capable Codex models.",
      key: "model_verbosity",
      label: "Verbosity",
      options: ["low", "medium", "high"].map(option),
      type: "select",
    },
  ],
} as const satisfies Record<string, readonly RuntimeAdvancedSettingDefinition[]>;

const RUNTIME_ADVANCED_SETTINGS_BY_ID: Readonly<
  Record<string, readonly RuntimeAdvancedSettingDefinition[]>
> = RUNTIME_ADVANCED_SETTINGS_REGISTRY;

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

function listDefinitions(runtimeId: string): readonly RuntimeAdvancedSettingDefinition[] {
  return RUNTIME_ADVANCED_SETTINGS_BY_ID[runtimeId] ?? [];
}

function createDefinitionMap(
  runtimeId: string,
): ReadonlyMap<string, RuntimeAdvancedSettingDefinition> {
  const definitions = new Map<string, RuntimeAdvancedSettingDefinition>();

  for (const definition of listDefinitions(runtimeId)) {
    definitions.set(definition.key, definition);
  }

  return definitions;
}

function hasOption(definition: RuntimeAdvancedSettingDefinition, value: string): boolean {
  return definition.options.some((optionEntry) => optionEntry.value === value);
}

export function listRuntimeAdvancedSettings(
  runtimeId: string,
): readonly RuntimeAdvancedSettingDefinition[] {
  return listDefinitions(runtimeId);
}

export function hasRuntimeAdvancedSettings(runtimeId: string): boolean {
  return listDefinitions(runtimeId).length > 0;
}

export function normalizeRuntimeAdvancedSettings(input: {
  readonly runtimeId: string;
  readonly settings: JsonObject;
}): JsonObject {
  const definitions = createDefinitionMap(input.runtimeId);
  const normalized: JsonObject = {};

  for (const [key, value] of Object.entries(input.settings)) {
    const definition = definitions.get(key);

    if (definition === undefined || value === definition.defaultValue) {
      continue;
    }

    normalized[key] = value;
  }

  return normalized;
}

export function validateRuntimeAdvancedSettings(input: {
  readonly runtimeId: string;
  readonly settings: JsonObject;
}): RuntimeAdvancedSettingsValidationResult {
  const definitions = createDefinitionMap(input.runtimeId);
  const issues: RuntimeAdvancedSettingsValidationIssue[] = [];

  for (const [key, value] of Object.entries(input.settings)) {
    const definition = definitions.get(key);

    if (definition === undefined) {
      issues.push(
        SECURITY_BOUNDARY_SETTING_KEYS.has(key)
          ? {
              code: "runtime_settings_security_boundary",
              key,
              message: `Runtime setting ${key} is managed by Mosoo platform policy and cannot be set here.`,
            }
          : {
              code: "runtime_settings_unsupported",
              key,
              message: `Runtime setting ${key} is not supported for ${input.runtimeId}.`,
            },
      );
      continue;
    }

    if (typeof value !== "string" || !hasOption(definition, value)) {
      issues.push({
        code: "runtime_settings_invalid_value",
        key,
        message: `Runtime setting ${key} must be one of ${definition.options
          .map((optionEntry) => optionEntry.value)
          .join(", ")}.`,
      });
    }
  }

  return {
    issues,
    normalizedSettings:
      issues.length === 0 ? normalizeRuntimeAdvancedSettings(input) : input.settings,
    ok: issues.length === 0,
  };
}
