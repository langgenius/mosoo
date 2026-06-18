import { parseNullablePlatformId, parsePlatformId } from "@mosoo/id";
import type {
  AccountId,
  AgentDeploymentVersionId,
  AgentId,
  CredentialId,
  EnvironmentId,
  FileId,
  McpServerId,
  OrganizationId,
  AppId,
  SkillId,
  SkillSnapshotId,
} from "@mosoo/id";

export function readAccountId(value: unknown, label = "Account ID"): AccountId {
  return parsePlatformId<AccountId>(value, label);
}

export function readAgentDeploymentVersionId(
  value: unknown,
  label = "Agent deployment version ID",
): AgentDeploymentVersionId {
  return parsePlatformId<AgentDeploymentVersionId>(value, label);
}

export function readAgentId(value: unknown, label = "Agent ID"): AgentId {
  return parsePlatformId<AgentId>(value, label);
}

export function readEnvironmentId(value: unknown, label = "Environment ID"): EnvironmentId {
  return parsePlatformId<EnvironmentId>(value, label);
}

export function readFileId(value: unknown, label = "File ID"): FileId {
  return parsePlatformId<FileId>(value, label);
}

export function readMcpServerId(value: unknown, label = "MCP server ID"): McpServerId {
  return parsePlatformId<McpServerId>(value, label);
}

export function readOrganizationId(value: unknown, label = "Organization ID"): OrganizationId {
  return parsePlatformId<OrganizationId>(value, label);
}

export function readAppId(value: unknown, label = "App ID"): AppId {
  return parsePlatformId<AppId>(value, label);
}

export function readSkillId(value: unknown, label = "Skill ID"): SkillId {
  return parsePlatformId<SkillId>(value, label);
}

export function readSkillSnapshotId(value: unknown, label = "Skill snapshot ID"): SkillSnapshotId {
  return parsePlatformId<SkillSnapshotId>(value, label);
}

export function readNullableCredentialId(
  value: unknown,
  label = "Credential ID",
): CredentialId | null {
  return parseNullablePlatformId<CredentialId>(value, label);
}

export function readNullableEnvironmentId(
  value: unknown,
  label = "Environment ID",
): EnvironmentId | null {
  return parseNullablePlatformId<EnvironmentId>(value, label);
}

export function readNullableSkillSnapshotId(
  value: unknown,
  label = "Skill snapshot ID",
): SkillSnapshotId | null {
  return parseNullablePlatformId<SkillSnapshotId>(value, label);
}
