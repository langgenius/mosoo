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
  AgentMcpBindingId,
  CredentialId,
  McpOAuthFlowId,
  McpServerId,
  ProjectId,
} from "@mosoo/id";

export interface ViewerRow {
  email: string | null;
  name: string | null;
}

export interface ServerRow {
  authType: "oauth" | "bearer";
  byoClientId: string | null;
  byoClientSecretSecretId: string | null;
  createdAt: number;
  credentialScope: McpCredentialScope;
  description: string | null;
  enabled: boolean;
  iconUrl: string | null;
  id: McpServerId;
  name: string;
  ownerId: AccountId;
  ownerName: string | null;
  projectId: ProjectId;
  source: McpServerSource;
  updatedAt: number;
  url: string;
}

export interface CredentialRow {
  authType: "oauth" | "bearer";
  createdAt: number;
  expiresAt: number | null;
  id: CredentialId;
  oauthClientId: string | null;
  oauthClientSecretSecretId: string | null;
  projectId: ProjectId;
  refreshSecretId: string | null;
  scope: McpCredentialRecordScope;
  scopeValuesJson: string | null;
  secretId: string;
  serverId: McpServerId;
  status: Exclude<McpCredentialStatus, "none">;
  subjectLabel: string | null;
  updatedAt: number;
}

export interface AgentBindingRow {
  agentCredentialId: CredentialId | null;
  authType: "oauth" | "bearer";
  createdAt: number;
  credentialMode: AgentMcpCredentialMode;
  credentialScope: McpCredentialScope;
  enabled: boolean;
  iconUrl: string | null;
  id: AgentMcpBindingId;
  name: string;
  serverId: McpServerId;
  serverEnabled: boolean;
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
  errorMessage: string | null;
  expiresAt: number;
  id: McpOAuthFlowId;
  initiatorUserId: AccountId;
  oauthClientId: string;
  oauthClientSecretSecretId: string | null;
  scopeValuesJson: string | null;
  serverId: McpServerId;
  status: McpOAuthFlowStatus;
  subjectLabel: string | null;
  tokenEndpoint: string;
  projectId: ProjectId;
}
