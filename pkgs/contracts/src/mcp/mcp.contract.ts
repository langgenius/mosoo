import type {
  AccountId,
  AgentMcpBindingId,
  CredentialId,
  McpOAuthFlowId,
  McpServerId,
  ProjectId,
} from "@mosoo/id";

// "app" is a frozen manifest / D1 discriminator. ProjectId is the canonical
// scope identifier; changing this token requires a versioned manifest rollout.
export type McpServerSource = "app";

export type McpAuthType = "oauth" | "bearer";

export type McpCredentialScope = "app";

export type McpCredentialRecordScope = McpCredentialScope | "agent";

export type AgentMcpCredentialMode = "runtime_resolved" | "agent_bound";

export type McpCredentialStatus = "none" | "active" | "expired" | "revoked";

export type UnavailableMcpCredentialStatus = "none" | "expired" | "revoked";

export type ActiveMcpCredentialStatus = "active";

export type McpAuthorizationState =
  | "active"
  | "authorization_required"
  | "disabled"
  | "expired"
  | "revoked";

export type UnavailableMcpAuthorizationState =
  | "authorization_required"
  | "disabled"
  | "expired"
  | "revoked";

export type ActiveMcpAuthorizationState = "active";

export type McpOAuthFlowStatus = "pending" | "succeeded" | "failed" | "expired";

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
  projectId: ProjectId;
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
  projectId: ProjectId;
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

export interface CreateProjectMcpServerInput {
  authType: McpAuthType;
  description?: string | null;
  iconUrl?: string | null;
  name: string;
  oauthClientId?: string | null;
  oauthClientSecret?: string | null;
  projectId: ProjectId;
  url: string;
}

export interface UpdateProjectMcpServerInput {
  projectId: ProjectId;
  description?: string | null;
  iconUrl?: string | null;
  name: string;
  serverId: McpServerId;
  url: string;
}

export interface ConnectMcpBearerInput {
  projectId: ProjectId;
  serverId: McpServerId;
  subjectLabel?: string | null;
  token: string;
}

export interface StartMcpOAuthInput {
  projectId: ProjectId;
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
