import { type } from "arktype";

import type {
  AccountId,
  AgentMcpBindingId,
  CredentialId,
  McpOAuthFlowId,
  McpServerId,
  AppId,
} from "../id/id.contract";

export const MCP_SERVER_SOURCES = ["app"] as const;
export const McpServerSource = type.enumerated(...MCP_SERVER_SOURCES);
export type McpServerSource = typeof McpServerSource.infer;

export const MCP_AUTH_TYPES = ["oauth", "bearer"] as const;
export const McpAuthType = type.enumerated(...MCP_AUTH_TYPES);
export type McpAuthType = typeof McpAuthType.infer;

export const MCP_CREDENTIAL_SCOPES = ["app"] as const;
export const McpCredentialScope = type.enumerated(...MCP_CREDENTIAL_SCOPES);
export type McpCredentialScope = typeof McpCredentialScope.infer;

export const MCP_CREDENTIAL_RECORD_SCOPES = [...MCP_CREDENTIAL_SCOPES, "agent"] as const;
export const McpCredentialRecordScope = type.enumerated(...MCP_CREDENTIAL_RECORD_SCOPES);
export type McpCredentialRecordScope = typeof McpCredentialRecordScope.infer;

export const AGENT_MCP_CREDENTIAL_MODES = ["runtime_resolved", "agent_bound"] as const;
export const AgentMcpCredentialMode = type.enumerated(...AGENT_MCP_CREDENTIAL_MODES);
export type AgentMcpCredentialMode = typeof AgentMcpCredentialMode.infer;

export const MCP_CREDENTIAL_STATUSES = ["none", "active", "expired", "revoked"] as const;
export const McpCredentialStatus = type.enumerated(...MCP_CREDENTIAL_STATUSES);
export type McpCredentialStatus = typeof McpCredentialStatus.infer;

export const MCP_PERSISTED_CREDENTIAL_STATUSES = [
  "active",
  "expired",
  "revoked",
] as const satisfies readonly McpCredentialStatus[];
export const PersistedMcpCredentialStatus = type.enumerated(...MCP_PERSISTED_CREDENTIAL_STATUSES);
export type PersistedMcpCredentialStatus = typeof PersistedMcpCredentialStatus.infer;

export const MCP_UNAVAILABLE_CREDENTIAL_STATUSES = [
  "none",
  "expired",
  "revoked",
] as const satisfies readonly McpCredentialStatus[];
export const UnavailableMcpCredentialStatus = type.enumerated(
  ...MCP_UNAVAILABLE_CREDENTIAL_STATUSES,
);
export type UnavailableMcpCredentialStatus = typeof UnavailableMcpCredentialStatus.infer;

export const ActiveMcpCredentialStatus = type('"active"');
export type ActiveMcpCredentialStatus = typeof ActiveMcpCredentialStatus.infer;

export const MCP_AUTHORIZATION_STATES = [
  "active",
  "authorization_required",
  "disabled",
  "expired",
  "revoked",
] as const;
export const McpAuthorizationState = type.enumerated(...MCP_AUTHORIZATION_STATES);
export type McpAuthorizationState = typeof McpAuthorizationState.infer;

export const MCP_UNAVAILABLE_AUTHORIZATION_STATES = [
  "authorization_required",
  "disabled",
  "expired",
  "revoked",
] as const satisfies readonly McpAuthorizationState[];
export const UnavailableMcpAuthorizationState = type.enumerated(
  ...MCP_UNAVAILABLE_AUTHORIZATION_STATES,
);
export type UnavailableMcpAuthorizationState = typeof UnavailableMcpAuthorizationState.infer;

export const ActiveMcpAuthorizationState = type('"active"');
export type ActiveMcpAuthorizationState = typeof ActiveMcpAuthorizationState.infer;

export const MCP_OAUTH_FLOW_STATUSES = ["pending", "succeeded", "failed", "expired"] as const;
export const McpOAuthFlowStatus = type.enumerated(...MCP_OAUTH_FLOW_STATUSES);
export type McpOAuthFlowStatus = typeof McpOAuthFlowStatus.infer;

export interface McpCredentialSummary {
  authType: McpAuthType;
  createdAt: string;
  expiresAt: string | null;
  id: CredentialId;
  scope: McpCredentialRecordScope;
  scopeValues: string[];
  status: McpCredentialStatus;
  subjectLabel: string | null;
  updatedAt: string;
}

export interface McpServer {
  authType: McpAuthType;
  createdAt: string;
  credentialScope: McpCredentialScope;
  description: string | null;
  enabled: boolean;
  hasCredential: boolean;
  id: McpServerId;
  iconUrl: string | null;
  name: string;
  ownerId: AccountId;
  ownerName: string;
  appId: AppId;
  source: McpServerSource;
  updatedAt: string;
  url: string;
}

export interface McpServerWithCredential extends McpServer {
  authorizationState: McpAuthorizationState;
  credential: McpCredentialSummary | null;
  credentialStatus: McpCredentialStatus;
}

export interface McpRegistry {
  currentUserEmail: string;
  currentUserId: AccountId;
  currentUserName: string;
  appId: AppId;
  servers: McpServerWithCredential[];
}

export interface AgentMcpBinding {
  authType: McpAuthType;
  authorizationState: McpAuthorizationState;
  createdAt: string;
  credentialMode: AgentMcpCredentialMode;
  credentialScope: McpCredentialScope;
  credentialStatus: McpCredentialStatus;
  credentialSubject: string | null;
  enabled: boolean;
  hasCredential: boolean;
  iconUrl: string | null;
  id: AgentMcpBindingId;
  name: string;
  serverId: McpServerId;
  source: McpServerSource;
  updatedAt: string;
  url: string;
}

export interface CreateAppMcpServerInput {
  authType: McpAuthType;
  description?: string | null;
  iconUrl?: string | null;
  name: string;
  oauthClientId?: string | null;
  oauthClientSecret?: string | null;
  appId: AppId;
  url: string;
}

export interface UpdateAppMcpServerInput {
  appId: AppId;
  description?: string | null;
  iconUrl?: string | null;
  name: string;
  serverId: McpServerId;
  url: string;
}

export interface ConnectMcpBearerInput {
  appId: AppId;
  serverId: McpServerId;
  subjectLabel?: string | null;
  token: string;
}

export interface StartMcpOAuthInput {
  appId: AppId;
  returnUrl?: string | null;
  serverId: McpServerId;
}

export interface StartMcpOAuthPayload {
  authorizationUrl: string;
  flowId: McpOAuthFlowId;
}

export interface McpOAuthFlowState {
  authorizationState: McpAuthorizationState | null;
  errorMessage: string | null;
  flowId: McpOAuthFlowId;
  serverId: McpServerId;
  status: McpOAuthFlowStatus;
  subjectLabel: string | null;
}
