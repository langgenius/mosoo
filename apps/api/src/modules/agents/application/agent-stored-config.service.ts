import type { AgentBuiltInToolConfig } from "@mosoo/contracts/agent";
import {
  createDefaultAgentBuiltInTools,
  isAgentBuiltInToolName,
  normalizeAgentBuiltInTools,
} from "@mosoo/contracts/agent";
import type {
  AgentManifestMcpServerBinding,
  AgentPackageResolutionSource,
  AgentPackageResolutionState,
  AgentResolutionIssue,
  AgentResolutionSeverity,
  AgentResolutionStatus,
  AgentResolutionTargetType,
} from "@mosoo/contracts/agent-manifest";
import { parseJsonObject } from "@mosoo/contracts/validation";
import type { JsonObject } from "@mosoo/contracts/validation";
import type { SkillId, SkillSnapshotId } from "@mosoo/id";

import { isTruthy } from "../../../shared/truthiness";
import { readSkillId, readSkillSnapshotId } from "./agent-platform-ids";

interface StoredAgentConfig {
  builtInTools: AgentBuiltInToolConfig[];
  packageMcpServers: AgentManifestMcpServerBinding[];
  packageSkills: AgentStoredPackageSkill[];
  packageResolution: AgentPackageResolutionState | null;
  providerOptions: JsonObject;
}

export interface AgentStoredPackageSkill {
  currentSnapshotId: SkillSnapshotId;
  ownerName: string | null;
  packagePath: string;
  skillId: SkillId;
  skillName: string;
  sortOrder: number;
}

const AGENT_RESOLUTION_SEVERITIES: AgentResolutionSeverity[] = ["error", "info", "warning"];
const AGENT_RESOLUTION_STATUSES: AgentResolutionStatus[] = [
  "missing",
  "needs_reconnect",
  "permission_denied",
  "resolved",
  "unavailable",
  "unsupported",
  "warning",
];
const AGENT_RESOLUTION_TARGET_TYPES: AgentResolutionTargetType[] = [
  "agent",
  "channel",
  "environment",
  "model",
  "mcp_server",
  "provider",
  "runtime",
  "skill",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readRecord(value: unknown, fieldName: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`Agent stored config ${fieldName} must be an object.`);
  }

  return value;
}

function readArray(value: unknown, fieldName: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`Agent stored config ${fieldName} must be an array.`);
  }

  return value;
}

function readString(value: unknown, fieldName: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`Agent stored config ${fieldName} must be a string.`);
  }

  return value;
}

function readNonEmptyString(value: unknown, fieldName: string): string {
  const text = readString(value, fieldName);

  if (!isTruthy(text)) {
    throw new Error(`Agent stored config ${fieldName} must not be empty.`);
  }

  return text;
}

function readNullableString(value: unknown, fieldName: string): string | null {
  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new TypeError(`Agent stored config ${fieldName} must be a string or null.`);
  }

  return value;
}

function readBoolean(value: unknown, fieldName: string): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(`Agent stored config ${fieldName} must be a boolean.`);
  }

  return value;
}

function readBuiltInToolConfig(value: unknown): AgentBuiltInToolConfig {
  const record = readRecord(value, "builtInTools entry");
  const name = readString(record["name"], "builtInTools name");

  if (!isAgentBuiltInToolName(name)) {
    throw new Error("Agent stored config builtInTools name is invalid.");
  }

  return {
    enabled: readBoolean(record["enabled"], "builtInTools enabled"),
    name,
  };
}

function readBuiltInTools(value: unknown): AgentBuiltInToolConfig[] {
  if (value === undefined) {
    return createDefaultAgentBuiltInTools();
  }

  return normalizeAgentBuiltInTools(readArray(value, "builtInTools").map(readBuiltInToolConfig));
}

function readNumber(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`Agent stored config ${fieldName} must be a finite number.`);
  }

  return value;
}

function readMcpAuthType(value: unknown): AgentManifestMcpServerBinding["authType"] {
  if (value === "bearer" || value === "oauth") {
    return value;
  }

  throw new Error("Agent stored config packageMcpServers authType is invalid.");
}

function readMcpCredentialScope(value: unknown): AgentManifestMcpServerBinding["credentialScope"] {
  if (value === "app") {
    return value;
  }

  throw new Error("Agent stored config packageMcpServers credentialScope is invalid.");
}

function readMcpSource(value: unknown): AgentManifestMcpServerBinding["source"] {
  if (value === "app") {
    return value;
  }

  throw new Error("Agent stored config packageMcpServers source is invalid.");
}

function readPackageMcpServer(value: unknown): AgentManifestMcpServerBinding {
  const record = readRecord(value, "packageMcpServers entry");
  const authType = readMcpAuthType(record["authType"]);
  const credentialScope = readMcpCredentialScope(record["credentialScope"]);
  const name = readNonEmptyString(record["name"], "packageMcpServers name");
  const source = readMcpSource(record["source"]);
  const url = readNonEmptyString(record["url"], "packageMcpServers url");

  return {
    authType,
    credentialMode: "runtime_resolved",
    credentialScope,
    enabled: readBoolean(record["enabled"], "packageMcpServers enabled"),
    iconUrl: readNullableString(record["iconUrl"], "packageMcpServers iconUrl"),
    name,
    serverId: null,
    source,
    url,
  };
}

function readPackageMcpServers(value: unknown): AgentManifestMcpServerBinding[] {
  return readArray(value, "packageMcpServers").map(readPackageMcpServer);
}

function normalizePackageSkillPath(value: string): string {
  const trimmed = value.trim().replaceAll(/^\/+|\/+$/g, "");

  if (!isTruthy(trimmed)) {
    throw new Error("Agent stored config package skill path must not be empty.");
  }

  return `${trimmed}/`;
}

export function isPackageSkillRuntimeId(skillId: string): boolean {
  return skillId.startsWith("package:");
}

function createEmptyStoredAgentConfig(): StoredAgentConfig {
  return {
    builtInTools: createDefaultAgentBuiltInTools(),
    packageMcpServers: [],
    packageSkills: [],
    packageResolution: null,
    providerOptions: {},
  };
}

function readPackageSkill(value: unknown): AgentStoredPackageSkill {
  const record = readRecord(value, "packageSkills entry");
  const currentSnapshotId = readNonEmptyString(
    record["currentSnapshotId"],
    "packageSkills currentSnapshotId",
  );
  const packagePath = readNonEmptyString(record["packagePath"], "packageSkills packagePath");
  const skillName = readNonEmptyString(record["skillName"], "packageSkills skillName");

  return {
    currentSnapshotId: readSkillSnapshotId(currentSnapshotId, "packageSkills currentSnapshotId"),
    ownerName: readNullableString(record["ownerName"], "packageSkills ownerName"),
    packagePath: normalizePackageSkillPath(packagePath),
    skillId: readSkillId(readNonEmptyString(record["skillId"], "packageSkills skillId")),
    skillName,
    sortOrder: readNumber(record["sortOrder"], "packageSkills sortOrder"),
  };
}

function readPackageSkills(value: unknown): AgentStoredPackageSkill[] {
  return readArray(value, "packageSkills").map(readPackageSkill);
}

function readResolutionSeverity(value: unknown): AgentResolutionSeverity {
  const severity = AGENT_RESOLUTION_SEVERITIES.find((candidate) => candidate === value);

  if (!severity) {
    throw new Error("Agent stored config packageResolution severity is invalid.");
  }

  return severity;
}

function readResolutionStatus(value: unknown): AgentResolutionStatus {
  const status = AGENT_RESOLUTION_STATUSES.find((candidate) => candidate === value);

  if (!status) {
    throw new Error("Agent stored config packageResolution status is invalid.");
  }

  return status;
}

function readResolutionTargetType(value: unknown): AgentResolutionTargetType {
  const targetType = AGENT_RESOLUTION_TARGET_TYPES.find((candidate) => candidate === value);

  if (!targetType) {
    throw new Error("Agent stored config packageResolution targetType is invalid.");
  }

  return targetType;
}

function readPackageResolutionSource(value: unknown): AgentPackageResolutionSource {
  if (value === "fork" || value === "import") {
    return value;
  }

  throw new Error("Agent stored config packageResolution source is invalid.");
}

function readResolutionIssue(value: unknown): AgentResolutionIssue {
  const record = readRecord(value, "packageResolution issue");

  return {
    actionLabel: readNullableString(record["actionLabel"], "packageResolution actionLabel"),
    code: readNonEmptyString(record["code"], "packageResolution code"),
    message: readNonEmptyString(record["message"], "packageResolution message"),
    required: readBoolean(record["required"], "packageResolution required"),
    severity: readResolutionSeverity(record["severity"]),
    status: readResolutionStatus(record["status"]),
    targetLabel: readNullableString(record["targetLabel"], "packageResolution targetLabel"),
    targetType: readResolutionTargetType(record["targetType"]),
  };
}

function readPackageResolutionState(value: unknown): AgentPackageResolutionState | null {
  if (value === null) {
    return null;
  }

  const record = readRecord(value, "packageResolution");
  const report = readRecord(record["report"], "packageResolution report");
  const summary = readRecord(report["summary"], "packageResolution summary");
  const issues = readArray(report["issues"], "packageResolution issues").map(readResolutionIssue);

  return {
    recordedAt: readNonEmptyString(record["recordedAt"], "packageResolution recordedAt"),
    report: {
      issues,
      summary: {
        boundMcpServerCount: readNumber(
          summary["boundMcpServerCount"],
          "packageResolution boundMcpServerCount",
        ),
        boundSkillCount: readNumber(
          summary["boundSkillCount"],
          "packageResolution boundSkillCount",
        ),
        copiedAssetCount: readNumber(
          summary["copiedAssetCount"],
          "packageResolution copiedAssetCount",
        ),
        createdMcpServerCount: readNumber(
          summary["createdMcpServerCount"],
          "packageResolution createdMcpServerCount",
        ),
        reusedMcpServerCount: readNumber(
          summary["reusedMcpServerCount"],
          "packageResolution reusedMcpServerCount",
        ),
      },
    },
    source: readPackageResolutionSource(record["source"]),
  };
}

export function parseAgentStoredConfig(configJson: string): StoredAgentConfig {
  const parsed: unknown = JSON.parse(configJson);

  if (!isRecord(parsed)) {
    throw new Error("Agent stored config must be an object.");
  }

  if (Object.keys(parsed).length === 0) {
    return createEmptyStoredAgentConfig();
  }

  return {
    builtInTools: readBuiltInTools(parsed["builtInTools"]),
    packageMcpServers: readPackageMcpServers(parsed["packageMcpServers"]),
    packageSkills: readPackageSkills(parsed["packageSkills"]),
    packageResolution: readPackageResolutionState(parsed["packageResolution"]),
    providerOptions:
      parsed["providerOptions"] === undefined
        ? {}
        : parseJsonObject(parsed["providerOptions"], "Agent stored config providerOptions"),
  };
}

export function serializeAgentStoredConfig(input: StoredAgentConfig): string {
  return JSON.stringify({
    builtInTools: normalizeAgentBuiltInTools(input.builtInTools).map((tool) => ({
      enabled: tool.enabled,
      name: tool.name,
    })),
    packageMcpServers: input.packageMcpServers.map((server) => ({
      authType: server.authType,
      credentialScope: server.credentialScope,
      enabled: server.enabled,
      iconUrl: server.iconUrl,
      name: server.name,
      source: server.source,
      url: server.url,
    })),
    packageSkills: input.packageSkills.map((skill) => ({
      currentSnapshotId: skill.currentSnapshotId,
      ownerName: skill.ownerName,
      packagePath: normalizePackageSkillPath(skill.packagePath),
      skillId: skill.skillId,
      skillName: skill.skillName,
      sortOrder: skill.sortOrder,
    })),
    packageResolution: input.packageResolution,
    providerOptions: parseJsonObject(input.providerOptions, "Agent stored config providerOptions"),
  });
}

export function normalizeAgentStoredConfigJson(configJson: string): string {
  return serializeAgentStoredConfig(parseAgentStoredConfig(configJson));
}
