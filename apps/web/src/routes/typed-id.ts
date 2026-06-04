import type {
  AccountId,
  AgentDeploymentVersionId,
  AgentBuilderPlannerRunId,
  AgentId,
  AgentMcpBindingId,
  ChannelBindingId,
  CredentialId,
  EnvironmentId,
  EnvironmentRevisionId,
  FileId,
  McpOAuthFlowId,
  McpServerId,
  OrganizationAccessRequestId,
  OrganizationId,
  OrganizationInvitationId,
  SessionRunId,
  SessionId,
  SkillId,
  SkillSnapshotId,
  SpaceId,
  VendorCredentialId,
} from "@mosoo/contracts/id";
import { parsePlatformId } from "@mosoo/id";

export function toAccountId(id: string): AccountId {
  return parsePlatformId(id, "Account ID") as AccountId;
}

export function toAgentBuilderPlannerRunId(id: string): AgentBuilderPlannerRunId {
  return parsePlatformId(id, "Agent Builder planner run ID") as AgentBuilderPlannerRunId;
}

export function toAgentDeploymentVersionId(id: string): AgentDeploymentVersionId {
  return parsePlatformId(id, "Agent deployment version ID") as AgentDeploymentVersionId;
}

export function toAgentId(id: string): AgentId {
  return parsePlatformId(id, "Agent ID") as AgentId;
}

export function toAgentMcpBindingId(id: string): AgentMcpBindingId {
  return parsePlatformId(id, "Agent MCP binding ID") as AgentMcpBindingId;
}

export function toChannelBindingId(id: string): ChannelBindingId {
  return parsePlatformId(id, "Channel binding ID") as ChannelBindingId;
}

export function toCredentialId(id: string): CredentialId {
  return parsePlatformId(id, "Credential ID") as CredentialId;
}

export function toEnvironmentId(id: string): EnvironmentId {
  return parsePlatformId(id, "Environment ID") as EnvironmentId;
}

export function toEnvironmentRevisionId(id: string): EnvironmentRevisionId {
  return parsePlatformId(id, "Environment revision ID") as EnvironmentRevisionId;
}

export function toFileId(id: string): FileId {
  return parsePlatformId(id, "File ID") as FileId;
}

export function toFileIds(ids: readonly string[]): FileId[] {
  return ids.map((id, index) => parsePlatformId(id, `File ID[${index}]`));
}

export function toMcpOAuthFlowId(id: string): McpOAuthFlowId {
  return parsePlatformId(id, "MCP OAuth flow ID") as McpOAuthFlowId;
}

export function toMcpServerId(id: string): McpServerId {
  return parsePlatformId(id, "MCP server ID") as McpServerId;
}

export function toOrganizationAccessRequestId(id: string): OrganizationAccessRequestId {
  return parsePlatformId(id, "Organization access request ID") as OrganizationAccessRequestId;
}

export function toOrganizationId(id: string): OrganizationId {
  return parsePlatformId(id, "Organization ID") as OrganizationId;
}

export function toOrganizationInvitationId(id: string): OrganizationInvitationId {
  return parsePlatformId(id, "Organization invitation ID") as OrganizationInvitationId;
}

export function toSessionId(id: string): SessionId {
  return parsePlatformId(id, "Session ID") as SessionId;
}

export function toNullableSessionId(id: string | null): SessionId | null {
  return id === null ? null : toSessionId(id);
}

export function toNullableSessionRunId(id: string | null | undefined): SessionRunId | null {
  return id == null ? null : (parsePlatformId(id, "Session run ID") as SessionRunId);
}

export function toSkillId(id: string): SkillId {
  return parsePlatformId(id, "Skill ID") as SkillId;
}

export function toSkillSnapshotId(id: string): SkillSnapshotId {
  return parsePlatformId(id, "Skill snapshot ID") as SkillSnapshotId;
}

export function toSpaceId(id: string): SpaceId {
  return parsePlatformId(id, "Space ID") as SpaceId;
}

export function toVendorCredentialId(id: string): VendorCredentialId {
  return parsePlatformId(id, "Vendor credential ID") as VendorCredentialId;
}
