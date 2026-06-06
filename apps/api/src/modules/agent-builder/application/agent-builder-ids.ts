import type { AgentBuilderStarterPackItemAssetType } from "@mosoo/contracts/agent-builder";
import { createPlatformId, parsePlatformId } from "@mosoo/id";
import type {
  AccountId,
  AgentBuilderMessageId,
  AgentBuilderPlannerRunId,
  AgentBuilderThreadId,
  AgentId,
  ChannelBindingId,
  EnvironmentId,
  McpServerId,
  OrganizationId,
  PlatformId,
  SkillId,
  SpaceId,
} from "@mosoo/id";

export type AgentBuilderBindableAssetId = EnvironmentId | McpServerId | SkillId | SpaceId;
export type AgentBuilderBindableAssetType = Exclude<
  AgentBuilderStarterPackItemAssetType,
  "agent_field"
>;

type ParsePlatformIdValue<TId extends PlatformId> = (value: unknown, label: string) => TId;

function parseIdList<TId extends PlatformId>(
  values: readonly unknown[],
  label: string,
  parseId: ParsePlatformIdValue<TId>,
): TId[] {
  return values.map((value, index) => parseId(value, `${label}[${index}]`));
}

export function createAgentBuilderMessageId(): AgentBuilderMessageId {
  return createPlatformId<AgentBuilderMessageId>();
}

export function createAgentBuilderPlannerRunId(): AgentBuilderPlannerRunId {
  return createPlatformId<AgentBuilderPlannerRunId>();
}

export function createAgentBuilderThreadId(): AgentBuilderThreadId {
  return createPlatformId<AgentBuilderThreadId>();
}

export function parseAccountId(value: unknown, label = "accountId"): AccountId {
  return parsePlatformId<AccountId>(value, label);
}

export function parseAgentId(value: unknown, label = "agentId"): AgentId {
  return parsePlatformId<AgentId>(value, label);
}

export function parseAgentBuilderMessageId(
  value: unknown,
  label = "agentBuilderMessageId",
): AgentBuilderMessageId {
  return parsePlatformId<AgentBuilderMessageId>(value, label);
}

export function parseAgentBuilderPlannerRunId(
  value: unknown,
  label = "agentBuilderPlannerRunId",
): AgentBuilderPlannerRunId {
  return parsePlatformId<AgentBuilderPlannerRunId>(value, label);
}

export function parseAgentBuilderThreadId(
  value: unknown,
  label = "agentBuilderThreadId",
): AgentBuilderThreadId {
  return parsePlatformId<AgentBuilderThreadId>(value, label);
}

function parseChannelBindingId(value: unknown, label = "channelBindingId"): ChannelBindingId {
  return parsePlatformId<ChannelBindingId>(value, label);
}

export function parseEnvironmentId(value: unknown, label = "environmentId"): EnvironmentId {
  return parsePlatformId<EnvironmentId>(value, label);
}

export function parseMcpServerId(value: unknown, label = "mcpServerId"): McpServerId {
  return parsePlatformId<McpServerId>(value, label);
}

export function parseOrganizationId(value: unknown, label = "organizationId"): OrganizationId {
  return parsePlatformId<OrganizationId>(value, label);
}

export function parseSkillId(value: unknown, label = "skillId"): SkillId {
  return parsePlatformId<SkillId>(value, label);
}

export function parseSpaceId(value: unknown, label = "spaceId"): SpaceId {
  return parsePlatformId<SpaceId>(value, label);
}

export function parseNullableEnvironmentId(
  value: unknown,
  label = "environmentId",
): EnvironmentId | null {
  return value === null || value === undefined ? null : parseEnvironmentId(value, label);
}

export function parseChannelBindingIdList(
  values: readonly unknown[],
  label = "channelIds",
): ChannelBindingId[] {
  return parseIdList(values, label, parseChannelBindingId);
}

export function parseMcpServerIdList(
  values: readonly unknown[],
  label = "mcpServerIds",
): McpServerId[] {
  return parseIdList(values, label, parseMcpServerId);
}

export function parseSkillIdList(values: readonly unknown[], label = "skillIds"): SkillId[] {
  return parseIdList(values, label, parseSkillId);
}

export function parseSpaceIdList(values: readonly unknown[], label = "spaceIds"): SpaceId[] {
  return parseIdList(values, label, parseSpaceId);
}

export function parseAgentBuilderBindableAssetId(input: {
  readonly assetType: AgentBuilderBindableAssetType | "mcp_server";
  readonly label?: string;
  readonly value: unknown;
}): AgentBuilderBindableAssetId {
  if (input.assetType === "environment") {
    return parseEnvironmentId(input.value, input.label ?? "environmentId");
  }

  if (input.assetType === "mcp" || input.assetType === "mcp_server") {
    return parseMcpServerId(input.value, input.label ?? "mcpServerId");
  }

  if (input.assetType === "skill") {
    return parseSkillId(input.value, input.label ?? "skillId");
  }

  return parseSpaceId(input.value, input.label ?? "spaceId");
}
