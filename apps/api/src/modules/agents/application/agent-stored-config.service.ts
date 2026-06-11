import type {
  AgentConfigBuilderAgentTypeDecision,
  AgentConfigBuilderMetadata,
  AgentConfigBuilderComponentDecision,
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
  builder: AgentConfigBuilderMetadata;
  packageMcpServers: AgentManifestMcpServerBinding[];
  packageSkills: AgentStoredPackageSkill[];
  packageSharingEnabled: boolean;
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
  "space",
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

function readBuilderComponentDecision(value: unknown): AgentConfigBuilderComponentDecision {
  if (value === "bound" || value === "created" || value === "skipped") {
    return value;
  }

  throw new Error("Agent stored config builder component decision is invalid.");
}

function readBuilderAgentTypeDecision(value: unknown): AgentConfigBuilderAgentTypeDecision {
  if (value === "decided" || value === "skipped") {
    return value;
  }

  throw new Error("Agent stored config builder agent type decision is invalid.");
}

function readBuilderMetadata(value: unknown): AgentConfigBuilderMetadata {
  if (value === undefined) {
    return { componentDecisions: {} };
  }

  const builder = readRecord(value, "builder");
  const componentDecisionsValue = builder["componentDecisions"];

  if (componentDecisionsValue === undefined) {
    return { componentDecisions: {} };
  }

  const componentDecisions = readRecord(componentDecisionsValue, "builder componentDecisions");
  const agentType = componentDecisions["agentType"];
  const environment = componentDecisions["environment"];

  return {
    componentDecisions: {
      ...(agentType === undefined ? {} : { agentType: readBuilderAgentTypeDecision(agentType) }),
      ...(environment === undefined
        ? {}
        : { environment: readBuilderComponentDecision(environment) }),
    },
  };
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
  if (value === "organization_shared" || value === "user") {
    return value;
  }

  throw new Error("Agent stored config packageMcpServers credentialScope is invalid.");
}

function readMcpSource(value: unknown): AgentManifestMcpServerBinding["source"] {
  if (value === "organization_shared" || value === "personal") {
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
    builder: { componentDecisions: {} },
    packageMcpServers: [],
    packageSkills: [],
    packageResolution: null,
    packageSharingEnabled: false,
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
        boundSpaceCount: readNumber(
          summary["boundSpaceCount"],
          "packageResolution boundSpaceCount",
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
    builder: readBuilderMetadata(parsed["builder"]),
    packageMcpServers: readPackageMcpServers(parsed["packageMcpServers"]),
    packageSkills: readPackageSkills(parsed["packageSkills"]),
    packageResolution: readPackageResolutionState(parsed["packageResolution"]),
    packageSharingEnabled: readBoolean(parsed["packageSharingEnabled"], "packageSharingEnabled"),
    providerOptions:
      parsed["providerOptions"] === undefined
        ? {}
        : parseJsonObject(parsed["providerOptions"], "Agent stored config providerOptions"),
  };
}

export function serializeAgentStoredConfig(input: StoredAgentConfig): string {
  return JSON.stringify({
    builder: readBuilderMetadata(input.builder),
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
    packageSharingEnabled: input.packageSharingEnabled,
    providerOptions: parseJsonObject(input.providerOptions, "Agent stored config providerOptions"),
  });
}

export function normalizeAgentStoredConfigJson(configJson: string): string {
  return serializeAgentStoredConfig(parseAgentStoredConfig(configJson));
}
