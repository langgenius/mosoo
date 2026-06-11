import type {
  AgentManifestMcpServerBinding,
  AgentManifestSkillReference,
  AgentManifestSpaceBinding,
  AgentResolutionIssue,
  AgentResolutionSeverity,
  AgentResolutionStatus,
  AgentResolutionTargetType,
} from "./agent-manifest.contract";
import { AgentKind } from "./agent.contract";

const MANIFEST_TOP_LEVEL_KEYS = new Set<string>([
  "advanced",
  "environment",
  "kind",
  "manifestVersion",
  "mcpServers",
  "metadata",
  "prompts",
  "runtime",
  "skills",
  "spaces",
]);

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

export function readAgentKind(value: unknown): AgentKind | null {
  if (AgentKind.allows(value)) {
    return value;
  }
  return null;
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

export function readStringRecord(value: unknown): Record<string, string> {
  if (value === null || value === undefined) {
    return {};
  }

  if (!isRecord(value)) {
    throw new Error("Agent Manifest string record field must be an object.");
  }

  const result: Record<string, string> = {};

  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "string") {
      throw new TypeError(`Agent Manifest string record field ${key} must be a string.`);
    }

    result[key] = entry;
  }

  return result;
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

export function collectUnknownTopLevelFields(
  record: Record<string, unknown>,
): Record<string, unknown> {
  const unknownFields: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(record)) {
    if (!MANIFEST_TOP_LEVEL_KEYS.has(key)) {
      unknownFields[key] = value;
    }
  }

  return unknownFields;
}

export function hasRecordEntries(record: Record<string, unknown>): boolean {
  return Object.keys(record).length > 0;
}

export function readSkillReference(value: unknown): AgentManifestSkillReference | null {
  if (!isRecord(value)) {
    return null;
  }

  const skillId = readString(value, "skillId");
  const skillName = readString(value, "skillName");

  if (!hasRequiredText(skillId) || !hasRequiredText(skillName)) {
    return null;
  }

  const state = readString(value, "state");

  if (state !== "active" && state !== "tombstone") {
    throw new Error("Agent Manifest skill state is invalid.");
  }

  return {
    ownerName: readNullableString(value, "ownerName"),
    skillId,
    skillName,
    state,
  };
}

export function readMcpServerBinding(value: unknown): AgentManifestMcpServerBinding | null {
  if (!isRecord(value)) {
    return null;
  }

  const name = readString(value, "name");
  const url = readString(value, "url");

  if (!hasRequiredText(name) || !hasRequiredText(url)) {
    return null;
  }

  const authType = readString(value, "authType");
  const credentialMode = readString(value, "credentialMode");
  const credentialScope = readString(value, "credentialScope");
  const source = readString(value, "source");

  if (authType !== "bearer" && authType !== "oauth") {
    throw new Error("Agent Manifest MCP authType is invalid.");
  }

  if (credentialMode !== "agent_bound" && credentialMode !== "runtime_resolved") {
    throw new Error("Agent Manifest MCP credentialMode is invalid.");
  }

  if (credentialScope !== "organization_shared" && credentialScope !== "user") {
    throw new Error("Agent Manifest MCP credentialScope is invalid.");
  }

  if (source !== "organization_shared" && source !== "personal") {
    throw new Error("Agent Manifest MCP source is invalid.");
  }

  return {
    authType,
    credentialMode,
    credentialScope,
    enabled: readBooleanOrDefault(value, "enabled", true),
    iconUrl: readNullableString(value, "iconUrl"),
    name,
    serverId: readNullableString(value, "serverId"),
    source,
    url,
  };
}

export function readSpaceBinding(value: unknown): AgentManifestSpaceBinding | null {
  if (!isRecord(value)) {
    return null;
  }

  const alias = readString(value, "alias");
  const mode = readString(value, "mode");

  if (!hasRequiredText(alias)) {
    return null;
  }

  if (mode !== "read") {
    throw new Error("Agent Manifest space mode is invalid.");
  }

  return {
    alias,
    expectedName: readNullableString(value, "expectedName"),
    mode,
    required: readBooleanOrDefault(value, "required", true),
    spaceId: readNullableString(value, "spaceId"),
  };
}
