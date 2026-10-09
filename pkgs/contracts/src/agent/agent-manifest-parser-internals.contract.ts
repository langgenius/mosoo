import type { EnvironmentPackageSpec } from "../environment/environment.contract";
import type {
  AgentResolutionIssue,
  AgentResolutionSeverity,
  AgentResolutionStatus,
  AgentResolutionTargetType,
} from "./agent-manifest.contract";
import { isAgentBuiltInToolName } from "./agent.contract";
import type { AgentBuiltInToolConfig } from "./agent.contract";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function readRecordField(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const value = record[key];
  return isRecord(value) ? value : {};
}

export function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

export function readNullableString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (value === null || value === undefined) {
    return null;
  }
  return typeof value === "string" ? value : null;
}

export function hasRequiredText(value: string | null): value is string {
  return value !== null && value.length > 0;
}

export function readBooleanOrDefault(
  record: Record<string, unknown>,
  key: string,
  defaultValue: boolean,
): boolean {
  const value = record[key];

  if (value === undefined) {
    return defaultValue;
  }

  if (typeof value !== "boolean") {
    throw new TypeError(`Agent Manifest ${key} must be a boolean.`);
  }

  return value;
}

export function readEnvironmentPackageSpec(value: unknown): EnvironmentPackageSpec | null {
  if (!isRecord(value)) {
    return null;
  }

  const manager = readString(value, "manager");
  if (
    manager !== "apt" &&
    manager !== "cargo" &&
    manager !== "gem" &&
    manager !== "go" &&
    manager !== "npm" &&
    manager !== "pip"
  ) {
    return null;
  }
  const packages = value["packages"];
  if (!Array.isArray(packages) || !packages.every((entry) => typeof entry === "string")) {
    return null;
  }
  return { manager, packages };
}

export function readJsonObjectField(value: unknown, label: string): Record<string, unknown> {
  if (value === null || value === undefined) {
    return {};
  }

  if (!isRecord(value)) {
    throw new Error(`Agent Manifest ${label} must be a JSON object.`);
  }

  return value;
}

export function readParsedArray<T>(
  record: Record<string, unknown>,
  key: string,
  reader: (entry: unknown) => T | null,
): T[] {
  const value = record[key];

  if (value === null || value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new TypeError(`Agent Manifest ${key} must be an array.`);
  }

  return value.map((entry) => {
    const result = reader(entry);

    if (result === null) {
      throw new Error(`Agent Manifest ${key} entry is invalid.`);
    }

    return result;
  });
}

export function createValidationIssue(input: {
  actionLabel?: string | null;
  code: string;
  message: string;
  required?: boolean;
  severity?: AgentResolutionSeverity;
  status?: AgentResolutionStatus;
  targetLabel?: string | null;
  targetType: AgentResolutionTargetType;
}): AgentResolutionIssue {
  return {
    actionLabel: input.actionLabel ?? null,
    code: input.code,
    message: input.message,
    required: input.required ?? true,
    severity: input.severity ?? "error",
    status: input.status ?? "missing",
    targetLabel: input.targetLabel ?? null,
    targetType: input.targetType,
  };
}

export function readBuiltInToolConfig(value: unknown): AgentBuiltInToolConfig | null {
  if (!isRecord(value)) {
    return null;
  }

  const name = readString(value, "name");

  if (!isAgentBuiltInToolName(name)) {
    throw new Error("Agent Manifest builtInTools name is invalid.");
  }

  return {
    enabled: readBooleanOrDefault(value, "enabled", true),
    name,
  };
}
