import { createPlatformId, parsePlatformId } from "@mosoo/id";
import type {
  AccountId,
  AgentId,
  AgentMcpBindingId,
  CredentialId,
  McpOAuthFlowId,
  McpServerId,
  OrganizationId,
  PlatformId,
  AppId,
} from "@mosoo/id";

type IdInput = PlatformId | string;

function readPlatformSemanticId(value: IdInput, label: string): PlatformId {
  return parsePlatformId(value, label);
}

function createPlatformSemanticId(): PlatformId {
  return createPlatformId();
}

export function readAccountId(value: IdInput, label = "accountId"): AccountId {
  return readPlatformSemanticId(value, label) as AccountId;
}

export function readAgentId(value: IdInput, label = "agentId"): AgentId {
  return readPlatformSemanticId(value, label) as AgentId;
}

export function readCredentialId(value: IdInput, label = "credentialId"): CredentialId {
  return readPlatformSemanticId(value, label) as CredentialId;
}

export function readMcpOAuthFlowId(value: IdInput, label = "flowId"): McpOAuthFlowId {
  return readPlatformSemanticId(value, label) as McpOAuthFlowId;
}

export function readMcpServerId(value: IdInput, label = "serverId"): McpServerId {
  return readPlatformSemanticId(value, label) as McpServerId;
}

export function readOrganizationId(value: IdInput, label = "organizationId"): OrganizationId {
  return readPlatformSemanticId(value, label) as OrganizationId;
}

export function readAppId(value: IdInput, label = "appId"): AppId {
  return readPlatformSemanticId(value, label) as AppId;
}

export function createAgentMcpBindingId(): AgentMcpBindingId {
  return createPlatformSemanticId() as AgentMcpBindingId;
}

export function createCredentialId(): CredentialId {
  return createPlatformSemanticId() as CredentialId;
}

export function createMcpOAuthFlowId(): McpOAuthFlowId {
  return createPlatformSemanticId() as McpOAuthFlowId;
}

export function createMcpServerId(): McpServerId {
  return createPlatformSemanticId() as McpServerId;
}

export function normalizeMcpServerIds(serverIds: readonly IdInput[]): McpServerId[] {
  const ids: McpServerId[] = [];
  const seen = new Set<McpServerId>();

  for (const rawId of serverIds) {
    const id = readMcpServerId(typeof rawId === "string" ? rawId.trim() : rawId, "serverId");

    if (seen.has(id)) {
      continue;
    }

    seen.add(id);
    ids.push(id);
  }

  return ids;
}
