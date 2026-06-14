import type {
  AgentMcpCredentialMode,
  McpCredentialRecordScope,
  McpCredentialScope,
  McpCredentialStatus,
  McpOAuthFlowStatus,
  McpServerSource,
} from "@mosoo/contracts/mcp";
import type {
  AccountId,
  AgentId,
  AgentMcpBindingId,
  CredentialId,
  McpOAuthFlowId,
  McpServerId,
  OrganizationId,
  AppId,
} from "@mosoo/id";

export interface ViewerRow {
  email: string | null;
  imageUrl: string | null;
  name: string | null;
}

export interface ServerRow {
  authType: "oauth" | "bearer";
  byoClientId: string | null;
  byoClientSecretSecretId: string | null;
  createdAt: number;
  credentialScope: McpCredentialScope;
  description: string | null;
  enabled: number;
  iconUrl: string | null;
  id: McpServerId;
  name: string;
  oauthMetadataJson: string | null;
  organizationId: OrganizationId;
  ownerId: AccountId;
  ownerName: string | null;
  appId: AppId;
  source: McpServerSource;
  updatedAt: number;
  url: string;
}

export interface CredentialRow {
  agentId: AgentId | null;
  authType: "oauth" | "bearer";
  createdAt: number;
  expiresAt: number | null;
  id: CredentialId;
  lastRefreshedAt: number | null;
  oauthClientId: string | null;
  oauthClientSecretSecretId: string | null;
  appId: AppId;
  refreshSecretId: string | null;
  scope: McpCredentialRecordScope;
  scopeValuesJson: string | null;
  secretId: string;
  serverId: McpServerId;
  status: Exclude<McpCredentialStatus, "none">;
  subjectLabel: string | null;
  updatedAt: number;
  userId: AccountId | null;
}

export interface AgentBindingRow {
  agentCredentialId: CredentialId | null;
  agentId: AgentId;
  authType: "oauth" | "bearer";
  createdAt: number;
  credentialMode: AgentMcpCredentialMode;
  credentialScope: McpCredentialScope;
  enabled: number;
  iconUrl: string | null;
  id: AgentMcpBindingId;
  name: string;
  serverId: McpServerId;
  serverEnabled: number;
  source: McpServerSource;
  updatedAt: number;
  url: string;
}

export interface OAuthMetadata {
  authorization_endpoint: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
  token_endpoint: string;
}

export interface OAuthTokenResponse {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
}

export interface OAuthFlowRow {
  codeVerifier: string;
  createdAt: number;
  errorMessage: string | null;
  expiresAt: number;
  id: McpOAuthFlowId;
  initiatorUserId: AccountId;
  oauthClientId: string;
  oauthClientSecretSecretId: string | null;
  returnUrl: string | null;
  scopeValuesJson: string | null;
  serverId: McpServerId;
  status: McpOAuthFlowStatus;
  subjectLabel: string | null;
  tokenEndpoint: string;
  organizationId: OrganizationId;
  appId: AppId;
}

export interface RefreshedRuntimeCredential {
  credentialId: CredentialId;
  expiresAt: string | null;
  subjectLabel: string | null;
}
