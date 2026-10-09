import type {
  AgentId,
  EnvironmentId,
  FileId,
  McpServerId,
  ProjectId,
  SessionRunId,
  SessionId,
  SkillId,
} from "@mosoo/id";
import { parsePlatformId } from "@mosoo/id";

// Validating conversions for IDs that reach an API call as plain strings: route
// params, query strings, and view state. IDs the API returns are already typed
// PlatformId by GraphQL codegen, so the domain mappers narrow them with a cast.

export function toAgentId(id: string): AgentId {
  return parsePlatformId(id, "Agent ID") as AgentId;
}

export function toEnvironmentId(id: string): EnvironmentId {
  return parsePlatformId(id, "Environment ID") as EnvironmentId;
}

export function toFileId(id: string): FileId {
  return parsePlatformId(id, "File ID") as FileId;
}

export function toFileIds(ids: readonly string[]): FileId[] {
  return ids.map((id, index) => parsePlatformId(id, `File ID[${index}]`));
}

export function toMcpServerId(id: string): McpServerId {
  return parsePlatformId(id, "MCP server ID") as McpServerId;
}

export function toProjectId(id: string): ProjectId {
  return parsePlatformId(id, "Project ID") as ProjectId;
}

export function toSessionId(id: string): SessionId {
  return parsePlatformId(id, "Session ID") as SessionId;
}

export function toNullableSessionRunId(id: string | null | undefined): SessionRunId | null {
  return id == null ? null : (parsePlatformId(id, "Session run ID") as SessionRunId);
}

export function toSkillId(id: string): SkillId {
  return parsePlatformId(id, "Skill ID") as SkillId;
}
