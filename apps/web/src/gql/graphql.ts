/* eslint-disable */
/** Internal type. DO NOT USE DIRECTLY. */
type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
/** Internal type. DO NOT USE DIRECTLY. */
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
import type { JsonObject, PrimitiveRecord } from '@mosoo/contracts';
import type { PlatformId } from '@mosoo/id';
import type { DocumentTypeDecoration } from '@graphql-typed-document-node/core';
export type AddSessionResourceFileInput = {
  contentType: string;
  name: string;
  size: number;
};

export type AddSessionResourceInput = {
  file: AddSessionResourceFileInput;
  projectId: PlatformId;
  sessionId: PlatformId;
};

export type AgentBuiltInToolConfigInput = {
  enabled: boolean;
  name: AgentBuiltInToolName;
};

export type AgentBuiltInToolName =
  | 'bash'
  | 'edit'
  | 'glob'
  | 'grep'
  | 'read'
  | 'web_fetch'
  | 'web_search'
  | 'write';

export type AgentEnvironmentConfigInput = {
  environmentId?: PlatformId | null | undefined;
};

export type AgentKind =
  | 'cattle'
  | 'pet';

export type AgentMcpCredentialMode =
  | 'agent_bound'
  | 'runtime_resolved';

export type AgentPackageResolutionSource =
  | 'fork'
  | 'import';

export type AgentReadinessSeverity =
  | 'error'
  | 'warning';

export type AgentResolutionSeverity =
  | 'error'
  | 'info'
  | 'warning';

export type AgentResolutionStatus =
  | 'missing'
  | 'needs_reconnect'
  | 'permission_denied'
  | 'resolved'
  | 'unavailable'
  | 'unsupported'
  | 'warning';

export type AgentResolutionTargetType =
  | 'agent'
  | 'environment'
  | 'mcp_server'
  | 'model'
  | 'provider'
  | 'runtime'
  | 'skill';

export type AgentSessionActionCapabilityName =
  | 'add_session_resource'
  | 'archive_session'
  | 'connect_stream'
  | 'create_session'
  | 'delete_session'
  | 'permission_decision'
  | 'retrieve_session'
  | 'send_user_message'
  | 'unarchive_session'
  | 'user_interrupt';

export type AgentSessionActionCapabilityStatus =
  | 'available'
  | 'degraded'
  | 'unavailable';

export type AgentSessionEventInput = {
  attachmentIds?: Array<PlatformId> | null | undefined;
  clientRequestId?: string | null | undefined;
  decision?: AgentSessionPermissionDecision | null | undefined;
  requestId?: string | null | undefined;
  runId?: PlatformId | null | undefined;
  text?: string | null | undefined;
  type: AgentSessionEventType;
};

export type AgentSessionEventType =
  | 'permission_decision'
  | 'user_interrupt'
  | 'user_message';

export type AgentSessionPermissionDecision =
  | 'allow_once'
  | 'reject_once';

export type AgentSkillState =
  | 'active'
  | 'tombstone';

export type AgentStatus =
  | 'draft'
  | 'published';

export type AgentViewerRole =
  | 'owner';

export type AgentVisibility =
  | 'private';

export type BootstrapOnboardingInput = {
  name?: string | null | undefined;
};

export type ConnectMcpBearerInput = {
  projectId: PlatformId;
  serverId: PlatformId;
  subjectLabel?: string | null | undefined;
  token: string;
};

export type CostRange =
  | 'LAST_7_DAYS'
  | 'LAST_30_DAYS'
  | 'LAST_90_DAYS'
  | 'MONTH_TO_DATE';

export type CostRunPurpose =
  | 'debug'
  | 'preview'
  | 'production';

export type CreateAgentForkInput = {
  agentId: PlatformId;
  /** @deprecated Forks do not select a runtime ownership type. */
  kind?: AgentKind | null | undefined;
  projectId: PlatformId;
};

export type CreateAgentInput = {
  description?: string | null | undefined;
  /** @deprecated Every new Session has isolated execution. */
  kind?: AgentKind | null | undefined;
  model: string;
  name: string;
  projectId: PlatformId;
  prompt: string;
  provider: string;
  runtimeId: string;
  skillIds: Array<PlatformId>;
};

export type CreateAgentSessionInput = {
  agentId: PlatformId;
  projectId: PlatformId;
  type?: SessionType | null | undefined;
};

export type CreateEnvironmentInput = {
  allowedHosts: Array<string>;
  description?: string | null | undefined;
  envVars: Array<EnvironmentVariableInput>;
  name: string;
  networkPolicy: EnvironmentNetworkPolicy;
  packages: Array<EnvironmentPackageSpecInput>;
  projectId: PlatformId;
  setupScript: string;
};

export type CreateProjectInput = {
  name: string;
  organizationId: PlatformId;
};

export type CreateProjectMcpServerInput = {
  authType: McpAuthType;
  description?: string | null | undefined;
  iconUrl?: string | null | undefined;
  name: string;
  oauthClientId?: string | null | undefined;
  oauthClientSecret?: string | null | undefined;
  projectId: PlatformId;
  url: string;
};

export type CreateSkillForkInput = {
  projectId: PlatformId;
  skillId: PlatformId;
};

export type CreateVendorCredentialInput = {
  apiBase?: string | null | undefined;
  apiKey: string;
  modelProtocol?: string | null | undefined;
  models?: Array<string> | null | undefined;
  name: string;
  projectId: PlatformId;
  vendorId: string;
};

export type DeleteAgentInput = {
  agentId: PlatformId;
  projectId: PlatformId;
};

export type DeleteEnvironmentInput = {
  environmentId: PlatformId;
  projectId: PlatformId;
};

export type DeleteVendorCredentialInput = {
  id: PlatformId;
  projectId: PlatformId;
};

export type EnvironmentNetworkPolicy =
  | 'full'
  | 'limited';

export type EnvironmentPackageManager =
  | 'apt'
  | 'cargo'
  | 'gem'
  | 'go'
  | 'npm'
  | 'pip';

export type EnvironmentPackageSpecInput = {
  manager: EnvironmentPackageManager;
  packages: Array<string>;
};

export type EnvironmentVariableInput = {
  key: string;
  value?: string | null | undefined;
};

export type EnvironmentVariableStatus =
  | 'configured'
  | 'pending';

export type FileListInput = {
  projectId: PlatformId;
  scopeKind?: FileScopeKind | null | undefined;
  sessionId?: PlatformId | null | undefined;
  sessionKind?: FileSessionKind | null | undefined;
};

export type FileScopeKind =
  | 'account'
  | 'agent_package'
  | 'app_draft'
  | 'library'
  | 'session';

export type FileSessionKind =
  | 'artifact'
  | 'attachment';

export type FileUploadStatus =
  | 'aborted'
  | 'completed'
  | 'completing'
  | 'expired'
  | 'failed'
  | 'pending'
  | 'uploading';

export type FileUploadStrategy =
  | 'multipart'
  | 'single_put';

export type ImportAgentPackageInput = {
  fileId: PlatformId;
  projectId: PlatformId;
};

export type McpAuthType =
  | 'bearer'
  | 'oauth';

export type McpAuthorizationState =
  | 'active'
  | 'authorization_required'
  | 'disabled'
  | 'expired'
  | 'revoked';

export type McpCredentialRecordScope =
  | 'agent'
  | 'app';

export type McpCredentialScope =
  | 'app';

export type McpCredentialStatus =
  | 'active'
  | 'expired'
  | 'none'
  | 'revoked';

export type McpOAuthFlowStatus =
  | 'expired'
  | 'failed'
  | 'pending'
  | 'succeeded';

export type McpServerSource =
  | 'app';

export type ModelCatalogSource =
  | 'custom'
  | 'preset';

export type PublishAgentInput = {
  agentId: PlatformId;
  projectId: PlatformId;
};

export type RenameOrganizationInput = {
  name: string;
  organizationId: PlatformId;
};

export type RenameProjectInput = {
  name: string;
  projectId: PlatformId;
};

export type RunStatus =
  | 'booting'
  | 'cancelled'
  | 'completed'
  | 'expired'
  | 'failed'
  | 'queued'
  | 'running'
  | 'waiting_input';

export type SessionMessagePlanPriority =
  | 'high'
  | 'low'
  | 'medium';

export type SessionMessagePlanStatus =
  | 'completed'
  | 'in_progress'
  | 'pending';

export type SessionMessageRole =
  | 'assistant'
  | 'user';

export type SessionMessageSegmentKind =
  | 'text'
  | 'tool_result'
  | 'tool_use';

export type SessionProcessEventStatus =
  | 'available'
  | 'error'
  | 'unsupported';

export type SessionProcessEventType =
  | 'agent_message_delta'
  | 'agent_thinking_delta'
  | 'file_changed'
  | 'run_completed'
  | 'run_failed'
  | 'run_started'
  | 'session_files_updated'
  | 'session_status'
  | 'tool_confirmation_required'
  | 'tool_use_completed'
  | 'tool_use_started'
  | 'usage_updated'
  | 'user_message';

export type SessionRunTrigger =
  | 'resume'
  | 'retry'
  | 'system'
  | 'user_prompt';

export type SessionStatus =
  | 'IDLE'
  | 'RESCHEDULING'
  | 'RUNNING'
  | 'TERMINATED';

export type SessionType =
  | 'preview'
  | 'ui';

export type SetDefaultVendorCredentialInput = {
  id: PlatformId;
  projectId: PlatformId;
};

export type SetProjectDefaultEnvironmentInput = {
  environmentId: PlatformId;
  projectId: PlatformId;
};

export type SkillSnapshotEntryKind =
  | 'directory'
  | 'file';

export type StartMcpOAuthInput = {
  projectId: PlatformId;
  serverId: PlatformId;
};

export type TestVendorCredentialInput = {
  apiBase?: string | null | undefined;
  apiKey: string;
  modelId?: string | null | undefined;
  modelProtocol?: string | null | undefined;
  projectId: PlatformId;
  vendorId: string;
};

export type UpdateAccountProfileInput = {
  imageUrl?: string | null | undefined;
  name: string;
};

export type UpdateAgentConfigInput = {
  agentId: PlatformId;
  builtInTools?: Array<AgentBuiltInToolConfigInput> | null | undefined;
  description?: string | null | undefined;
  environment: AgentEnvironmentConfigInput;
  /** @deprecated Configuration changes do not select a runtime ownership type. */
  kind?: AgentKind | null | undefined;
  mcpServerIds: Array<PlatformId>;
  model: string;
  name: string;
  projectId: PlatformId;
  prompt: string;
  provider: string;
  providerOptions: JsonObject;
  runtimeId: string;
  skillIds: Array<PlatformId>;
};

export type UpdateEnvironmentInput = {
  allowedHosts: Array<string>;
  description?: string | null | undefined;
  envVars: Array<EnvironmentVariableInput>;
  environmentId: PlatformId;
  name: string;
  networkPolicy: EnvironmentNetworkPolicy;
  packages: Array<EnvironmentPackageSpecInput>;
  projectId: PlatformId;
  setupScript: string;
};

export type UpdateProjectMcpServerInput = {
  description?: string | null | undefined;
  iconUrl?: string | null | undefined;
  name: string;
  projectId: PlatformId;
  serverId: PlatformId;
  url: string;
};

export type UpdateVendorCredentialInput = {
  apiBase?: string | null | undefined;
  apiKey?: string | null | undefined;
  id: PlatformId;
  modelProtocol?: string | null | undefined;
  models?: Array<string> | null | undefined;
  name?: string | null | undefined;
  projectId: PlatformId;
};

export type AgentFieldsFragment = { createdAt: string, description: string | null, id: PlatformId, model: string, name: string, projectId: PlatformId, prompt: string, provider: string, runtimeId: string, status: AgentStatus, updatedAt: string, visibility: AgentVisibility, liveVersion: { agentId: PlatformId, createdAt: string, createdByAccountId: PlatformId, environmentId: PlatformId | null, id: PlatformId, isLive: boolean, model: string, provider: string, runtimeId: string, summary: string, versionNumber: number } | null, skills: Array<{ ownerName: string | null, skillId: PlatformId, skillName: string, state: AgentSkillState }> };

export type AgentToolSummaryFieldsFragment = { enabled: boolean, iconUrl: string | null, name: string, serverId: PlatformId };

export type AgentDeploymentVersionFieldsFragment = { agentId: PlatformId, createdAt: string, createdByAccountId: PlatformId, environmentId: PlatformId | null, id: PlatformId, isLive: boolean, model: string, provider: string, runtimeId: string, summary: string, versionNumber: number };

export type AgentOwnerFieldsFragment = { id: PlatformId, imageUrl: string | null, name: string | null };

export type CreateAgentMutationVariables = Exact<{
  input: CreateAgentInput;
}>;


export type CreateAgentMutation = { createAgent: { createdAt: string, description: string | null, id: PlatformId, model: string, name: string, projectId: PlatformId, prompt: string, provider: string, runtimeId: string, status: AgentStatus, updatedAt: string, visibility: AgentVisibility, liveVersion: { agentId: PlatformId, createdAt: string, createdByAccountId: PlatformId, environmentId: PlatformId | null, id: PlatformId, isLive: boolean, model: string, provider: string, runtimeId: string, summary: string, versionNumber: number } | null, skills: Array<{ ownerName: string | null, skillId: PlatformId, skillName: string, state: AgentSkillState }> } };

export type DeleteAgentMutationVariables = Exact<{
  input: DeleteAgentInput;
}>;


export type DeleteAgentMutation = { deleteAgent: { ok: boolean } };

export type AccessibleAgentsQueryVariables = Exact<{
  projectId: PlatformId;
}>;


export type AccessibleAgentsQuery = { accessibleAgentList: Array<{ createdAt: string, description: string | null, id: PlatformId, name: string, projectId: PlatformId, runtimeId: string, status: AgentStatus, updatedAt: string, viewerRole: AgentViewerRole, visibility: AgentVisibility, owner: { id: PlatformId, imageUrl: string | null, name: string | null }, tools: Array<{ enabled: boolean, iconUrl: string | null, name: string, serverId: PlatformId }> }> };

export type AgentQueryVariables = Exact<{
  agentId: PlatformId;
  projectId: PlatformId;
}>;


export type AgentQuery = { agent: { createdAt: string, description: string | null, id: PlatformId, model: string, name: string, projectId: PlatformId, prompt: string, provider: string, runtimeId: string, status: AgentStatus, updatedAt: string, viewerRole: AgentViewerRole, visibility: AgentVisibility, liveVersion: { agentId: PlatformId, createdAt: string, createdByAccountId: PlatformId, environmentId: PlatformId | null, id: PlatformId, isLive: boolean, model: string, provider: string, runtimeId: string, summary: string, versionNumber: number } | null, owner: { id: PlatformId, imageUrl: string | null, name: string | null }, skills: Array<{ ownerName: string | null, skillId: PlatformId, skillName: string, state: AgentSkillState }>, tools: Array<{ enabled: boolean, iconUrl: string | null, name: string, serverId: PlatformId }>, versions: Array<{ agentId: PlatformId, createdAt: string, createdByAccountId: PlatformId, environmentId: PlatformId | null, id: PlatformId, isLive: boolean, model: string, provider: string, runtimeId: string, summary: string, versionNumber: number }> } };

export type AgentEditorStateQueryVariables = Exact<{
  agentId: PlatformId;
  projectId: PlatformId;
}>;


export type AgentEditorStateQuery = { agentEditorState: { id: PlatformId, providerOptions: JsonObject, builtInTools: Array<{ enabled: boolean, name: AgentBuiltInToolName }>, environment: { environmentId: PlatformId | null }, packageResolution: { recordedAt: string, source: AgentPackageResolutionSource, report: { issues: Array<{ actionLabel: string | null, code: string, message: string, required: boolean, severity: AgentResolutionSeverity, status: AgentResolutionStatus, targetLabel: string | null, targetType: AgentResolutionTargetType }>, summary: { boundMcpServerCount: number, boundSkillCount: number, copiedAssetCount: number, createdMcpServerCount: number, reusedMcpServerCount: number } } } | null, mcpBindings: Array<{ authType: McpAuthType, authorizationState: McpAuthorizationState, createdAt: string, credentialMode: AgentMcpCredentialMode, credentialScope: McpCredentialScope, credentialStatus: McpCredentialStatus, credentialSubject: string | null, enabled: boolean, hasCredential: boolean, iconUrl: string | null, id: PlatformId, name: string, serverId: PlatformId, source: McpServerSource, updatedAt: string, url: string }>, readiness: { checkedAt: string, ready: boolean, issues: Array<{ code: string, message: string, severity: AgentReadinessSeverity }> } } };

export type UpdateAgentConfigMutationVariables = Exact<{
  input: UpdateAgentConfigInput;
}>;


export type UpdateAgentConfigMutation = { updateAgentConfig: { createdAt: string, description: string | null, id: PlatformId, model: string, name: string, projectId: PlatformId, prompt: string, provider: string, runtimeId: string, status: AgentStatus, updatedAt: string, visibility: AgentVisibility, liveVersion: { agentId: PlatformId, createdAt: string, createdByAccountId: PlatformId, environmentId: PlatformId | null, id: PlatformId, isLive: boolean, model: string, provider: string, runtimeId: string, summary: string, versionNumber: number } | null, skills: Array<{ ownerName: string | null, skillId: PlatformId, skillName: string, state: AgentSkillState }> } };

export type AgentManifestQueryVariables = Exact<{
  agentId: PlatformId;
  projectId: PlatformId;
}>;


export type AgentManifestQuery = { agentManifest: { agentId: PlatformId, json: string, yaml: string } };

export type ExportAgentPackageQueryVariables = Exact<{
  agentId: PlatformId;
  projectId: PlatformId;
}>;


export type ExportAgentPackageQuery = { exportAgentPackage: { agentId: PlatformId, contentType: string, fileId: PlatformId, fileName: string, manifestYaml: string, size: number } };

export type ImportAgentPackageMutationVariables = Exact<{
  input: ImportAgentPackageInput;
}>;


export type ImportAgentPackageMutation = { importAgentPackage: { agent: { createdAt: string, description: string | null, id: PlatformId, model: string, name: string, projectId: PlatformId, prompt: string, provider: string, runtimeId: string, status: AgentStatus, updatedAt: string, visibility: AgentVisibility, liveVersion: { agentId: PlatformId, createdAt: string, createdByAccountId: PlatformId, environmentId: PlatformId | null, id: PlatformId, isLive: boolean, model: string, provider: string, runtimeId: string, summary: string, versionNumber: number } | null, skills: Array<{ ownerName: string | null, skillId: PlatformId, skillName: string, state: AgentSkillState }> }, resolution: { issues: Array<{ actionLabel: string | null, code: string, message: string, required: boolean, severity: AgentResolutionSeverity, status: AgentResolutionStatus, targetLabel: string | null, targetType: AgentResolutionTargetType }>, summary: { boundMcpServerCount: number, boundSkillCount: number, copiedAssetCount: number, createdMcpServerCount: number, reusedMcpServerCount: number } } } };

export type CreateAgentForkMutationVariables = Exact<{
  input: CreateAgentForkInput;
}>;


export type CreateAgentForkMutation = { createAgentFork: { agent: { createdAt: string, description: string | null, id: PlatformId, model: string, name: string, projectId: PlatformId, prompt: string, provider: string, runtimeId: string, status: AgentStatus, updatedAt: string, visibility: AgentVisibility, liveVersion: { agentId: PlatformId, createdAt: string, createdByAccountId: PlatformId, environmentId: PlatformId | null, id: PlatformId, isLive: boolean, model: string, provider: string, runtimeId: string, summary: string, versionNumber: number } | null, skills: Array<{ ownerName: string | null, skillId: PlatformId, skillName: string, state: AgentSkillState }> }, resolution: { issues: Array<{ actionLabel: string | null, code: string, message: string, required: boolean, severity: AgentResolutionSeverity, status: AgentResolutionStatus, targetLabel: string | null, targetType: AgentResolutionTargetType }>, summary: { boundMcpServerCount: number, boundSkillCount: number, copiedAssetCount: number, createdMcpServerCount: number, reusedMcpServerCount: number } } } };

export type PublishAgentMutationVariables = Exact<{
  input: PublishAgentInput;
}>;


export type PublishAgentMutation = { publishAgent: { createdAt: string, description: string | null, id: PlatformId, model: string, name: string, projectId: PlatformId, prompt: string, provider: string, runtimeId: string, status: AgentStatus, updatedAt: string, visibility: AgentVisibility, liveVersion: { agentId: PlatformId, createdAt: string, createdByAccountId: PlatformId, environmentId: PlatformId | null, id: PlatformId, isLive: boolean, model: string, provider: string, runtimeId: string, summary: string, versionNumber: number } | null, skills: Array<{ ownerName: string | null, skillId: PlatformId, skillName: string, state: AgentSkillState }> } };

export type UnpublishAgentMutationVariables = Exact<{
  agentId: PlatformId;
  projectId: PlatformId;
}>;


export type UnpublishAgentMutation = { unpublishAgent: { createdAt: string, description: string | null, id: PlatformId, model: string, name: string, projectId: PlatformId, prompt: string, provider: string, runtimeId: string, status: AgentStatus, updatedAt: string, visibility: AgentVisibility, liveVersion: { agentId: PlatformId, createdAt: string, createdByAccountId: PlatformId, environmentId: PlatformId | null, id: PlatformId, isLive: boolean, model: string, provider: string, runtimeId: string, summary: string, versionNumber: number } | null, skills: Array<{ ownerName: string | null, skillId: PlatformId, skillName: string, state: AgentSkillState }> } };

type CostTotalsFields_CostAgentRow_Fragment = { activeUsers: number, cacheCreationTokens: number, cacheReadTokens: number, inputTokens: number, outputTokens: number, requestCount: number, totalCostUsd: number, unpricedRequestCount: number };

type CostTotalsFields_CostDailyPoint_Fragment = { activeUsers: number, cacheCreationTokens: number, cacheReadTokens: number, inputTokens: number, outputTokens: number, requestCount: number, totalCostUsd: number, unpricedRequestCount: number };

type CostTotalsFields_CostModelRow_Fragment = { activeUsers: number, cacheCreationTokens: number, cacheReadTokens: number, inputTokens: number, outputTokens: number, requestCount: number, totalCostUsd: number, unpricedRequestCount: number };

type CostTotalsFields_CostTotals_Fragment = { activeUsers: number, cacheCreationTokens: number, cacheReadTokens: number, inputTokens: number, outputTokens: number, requestCount: number, totalCostUsd: number, unpricedRequestCount: number };

export type CostTotalsFieldsFragment =
  | CostTotalsFields_CostAgentRow_Fragment
  | CostTotalsFields_CostDailyPoint_Fragment
  | CostTotalsFields_CostModelRow_Fragment
  | CostTotalsFields_CostTotals_Fragment
;

export type CostDailyFieldsFragment = { activeUsers: number, cacheCreationTokens: number, cacheReadTokens: number, date: string, inputTokens: number, outputTokens: number, requestCount: number, totalCostUsd: number, unpricedRequestCount: number };

export type CostAgentFieldsFragment = { activeUsers: number, agentId: PlatformId | null, agentName: string, cacheCreationTokens: number, cacheReadTokens: number, debugCostUsd: number, inputTokens: number, outputTokens: number, ownerEmail: string | null, ownerId: PlatformId, ownerName: string, previewCostUsd: number, productionCostUsd: number, requestCount: number, totalCostUsd: number, unpricedRequestCount: number };

export type CostModelFieldsFragment = { activeUsers: number, cacheCreationTokens: number, cacheReadTokens: number, cacheReadUsdPerMillion: number | null, cacheWriteUsdPerMillion: number | null, inputTokens: number, inputUsdPerMillion: number | null, model: string, outputTokens: number, outputUsdPerMillion: number | null, provider: string, requestCount: number, totalCostUsd: number, unpricedRequestCount: number, vendor: string };

export type CostRecentSessionFieldsFragment = { actorEmail: string | null, actorName: string, cacheCreationTokens: number, cacheReadTokens: number, createdAt: string, inputTokens: number, model: string, outputTokens: number, provider: string, runPurpose: string, sessionId: PlatformId | null, sessionRunId: PlatformId | null, totalCostUsd: number };

export type ProjectCostCardQueryVariables = Exact<{
  projectId: PlatformId;
  range: CostRange;
  runPurposes?: Array<CostRunPurpose> | null | undefined;
}>;


export type ProjectCostCardQuery = { projectCostCard: { projectId: PlatformId, projectName: string, agents: Array<{ activeUsers: number, agentId: PlatformId | null, agentName: string, cacheCreationTokens: number, cacheReadTokens: number, debugCostUsd: number, inputTokens: number, outputTokens: number, ownerEmail: string | null, ownerId: PlatformId, ownerName: string, previewCostUsd: number, productionCostUsd: number, requestCount: number, totalCostUsd: number, unpricedRequestCount: number }>, daily: Array<{ activeUsers: number, cacheCreationTokens: number, cacheReadTokens: number, date: string, inputTokens: number, outputTokens: number, requestCount: number, totalCostUsd: number, unpricedRequestCount: number }>, models: Array<{ activeUsers: number, cacheCreationTokens: number, cacheReadTokens: number, cacheReadUsdPerMillion: number | null, cacheWriteUsdPerMillion: number | null, inputTokens: number, inputUsdPerMillion: number | null, model: string, outputTokens: number, outputUsdPerMillion: number | null, provider: string, requestCount: number, totalCostUsd: number, unpricedRequestCount: number, vendor: string }>, previousTotals: { activeUsers: number, cacheCreationTokens: number, cacheReadTokens: number, inputTokens: number, outputTokens: number, requestCount: number, totalCostUsd: number, unpricedRequestCount: number }, recentSessions: Array<{ actorEmail: string | null, actorName: string, cacheCreationTokens: number, cacheReadTokens: number, createdAt: string, inputTokens: number, model: string, outputTokens: number, provider: string, runPurpose: string, sessionId: PlatformId | null, sessionRunId: PlatformId | null, totalCostUsd: number }>, totals: { activeUsers: number, cacheCreationTokens: number, cacheReadTokens: number, inputTokens: number, outputTokens: number, requestCount: number, totalCostUsd: number, unpricedRequestCount: number } } };

export type AgentCostCardQueryVariables = Exact<{
  projectId: PlatformId;
  agentId: PlatformId;
  range: CostRange;
  runPurposes?: Array<CostRunPurpose> | null | undefined;
}>;


export type AgentCostCardQuery = { agentCostCard: { agentId: PlatformId, agentName: string, ownerId: PlatformId, ownerName: string, agents: Array<{ activeUsers: number, agentId: PlatformId | null, agentName: string, cacheCreationTokens: number, cacheReadTokens: number, debugCostUsd: number, inputTokens: number, outputTokens: number, ownerEmail: string | null, ownerId: PlatformId, ownerName: string, previewCostUsd: number, productionCostUsd: number, requestCount: number, totalCostUsd: number, unpricedRequestCount: number }>, daily: Array<{ activeUsers: number, cacheCreationTokens: number, cacheReadTokens: number, date: string, inputTokens: number, outputTokens: number, requestCount: number, totalCostUsd: number, unpricedRequestCount: number }>, models: Array<{ activeUsers: number, cacheCreationTokens: number, cacheReadTokens: number, cacheReadUsdPerMillion: number | null, cacheWriteUsdPerMillion: number | null, inputTokens: number, inputUsdPerMillion: number | null, model: string, outputTokens: number, outputUsdPerMillion: number | null, provider: string, requestCount: number, totalCostUsd: number, unpricedRequestCount: number, vendor: string }>, recentSessions: Array<{ actorEmail: string | null, actorName: string, cacheCreationTokens: number, cacheReadTokens: number, createdAt: string, inputTokens: number, model: string, outputTokens: number, provider: string, runPurpose: string, sessionId: PlatformId | null, sessionRunId: PlatformId | null, totalCostUsd: number }>, totals: { activeUsers: number, cacheCreationTokens: number, cacheReadTokens: number, inputTokens: number, outputTokens: number, requestCount: number, totalCostUsd: number, unpricedRequestCount: number } } };

export type EnvironmentPackageFieldsFragment = { manager: EnvironmentPackageManager, packages: Array<string> };

export type EnvironmentVariableFieldsFragment = { key: string, preview: string, status: EnvironmentVariableStatus };

export type EnvironmentSummaryFieldsFragment = { allowedHosts: Array<string>, canDelete: boolean, canEdit: boolean, createdAt: string, currentRevisionId: PlatformId, description: string, id: PlatformId, isBuiltIn: boolean, isDefault: boolean, name: string, networkPolicy: EnvironmentNetworkPolicy, setupScript: string, updatedAt: string, usedByAgentCount: number, projectId: PlatformId, envVars: Array<{ key: string, preview: string, status: EnvironmentVariableStatus }>, forkOrigin: { environmentId: PlatformId, name: string, ownerName: string } | null, packages: Array<{ manager: EnvironmentPackageManager, packages: Array<string> }> };

export type EnvironmentDetailFieldsFragment = { allowedHosts: Array<string>, canDelete: boolean, canEdit: boolean, createdAt: string, currentRevisionId: PlatformId, description: string, id: PlatformId, isBuiltIn: boolean, isDefault: boolean, name: string, networkPolicy: EnvironmentNetworkPolicy, setupScript: string, updatedAt: string, usedByAgentCount: number, projectId: PlatformId, envVars: Array<{ key: string, preview: string, status: EnvironmentVariableStatus }>, forkOrigin: { environmentId: PlatformId, name: string, ownerName: string } | null, packages: Array<{ manager: EnvironmentPackageManager, packages: Array<string> }> };

export type ProjectEnvironmentsQueryVariables = Exact<{
  projectId: PlatformId;
}>;


export type ProjectEnvironmentsQuery = { projectEnvironmentList: Array<{ allowedHosts: Array<string>, canDelete: boolean, canEdit: boolean, createdAt: string, currentRevisionId: PlatformId, description: string, id: PlatformId, isBuiltIn: boolean, isDefault: boolean, name: string, networkPolicy: EnvironmentNetworkPolicy, setupScript: string, updatedAt: string, usedByAgentCount: number, projectId: PlatformId, envVars: Array<{ key: string, preview: string, status: EnvironmentVariableStatus }>, forkOrigin: { environmentId: PlatformId, name: string, ownerName: string } | null, packages: Array<{ manager: EnvironmentPackageManager, packages: Array<string> }> }> };

export type EnvironmentDetailQueryVariables = Exact<{
  projectId: PlatformId;
  environmentId: PlatformId;
}>;


export type EnvironmentDetailQuery = { environment: { allowedHosts: Array<string>, canDelete: boolean, canEdit: boolean, createdAt: string, currentRevisionId: PlatformId, description: string, id: PlatformId, isBuiltIn: boolean, isDefault: boolean, name: string, networkPolicy: EnvironmentNetworkPolicy, setupScript: string, updatedAt: string, usedByAgentCount: number, projectId: PlatformId, envVars: Array<{ key: string, preview: string, status: EnvironmentVariableStatus }>, forkOrigin: { environmentId: PlatformId, name: string, ownerName: string } | null, packages: Array<{ manager: EnvironmentPackageManager, packages: Array<string> }> } };

export type CreateEnvironmentMutationVariables = Exact<{
  input: CreateEnvironmentInput;
}>;


export type CreateEnvironmentMutation = { createEnvironment: { allowedHosts: Array<string>, canDelete: boolean, canEdit: boolean, createdAt: string, currentRevisionId: PlatformId, description: string, id: PlatformId, isBuiltIn: boolean, isDefault: boolean, name: string, networkPolicy: EnvironmentNetworkPolicy, setupScript: string, updatedAt: string, usedByAgentCount: number, projectId: PlatformId, envVars: Array<{ key: string, preview: string, status: EnvironmentVariableStatus }>, forkOrigin: { environmentId: PlatformId, name: string, ownerName: string } | null, packages: Array<{ manager: EnvironmentPackageManager, packages: Array<string> }> } };

export type UpdateEnvironmentMutationVariables = Exact<{
  input: UpdateEnvironmentInput;
}>;


export type UpdateEnvironmentMutation = { updateEnvironment: { allowedHosts: Array<string>, canDelete: boolean, canEdit: boolean, createdAt: string, currentRevisionId: PlatformId, description: string, id: PlatformId, isBuiltIn: boolean, isDefault: boolean, name: string, networkPolicy: EnvironmentNetworkPolicy, setupScript: string, updatedAt: string, usedByAgentCount: number, projectId: PlatformId, envVars: Array<{ key: string, preview: string, status: EnvironmentVariableStatus }>, forkOrigin: { environmentId: PlatformId, name: string, ownerName: string } | null, packages: Array<{ manager: EnvironmentPackageManager, packages: Array<string> }> } };

export type DeleteEnvironmentMutationVariables = Exact<{
  input: DeleteEnvironmentInput;
}>;


export type DeleteEnvironmentMutation = { deleteEnvironment: { ok: boolean } };

export type SetProjectDefaultEnvironmentMutationVariables = Exact<{
  input: SetProjectDefaultEnvironmentInput;
}>;


export type SetProjectDefaultEnvironmentMutation = { setProjectDefaultEnvironment: { allowedHosts: Array<string>, canDelete: boolean, canEdit: boolean, createdAt: string, currentRevisionId: PlatformId, description: string, id: PlatformId, isBuiltIn: boolean, isDefault: boolean, name: string, networkPolicy: EnvironmentNetworkPolicy, setupScript: string, updatedAt: string, usedByAgentCount: number, projectId: PlatformId, envVars: Array<{ key: string, preview: string, status: EnvironmentVariableStatus }>, forkOrigin: { environmentId: PlatformId, name: string, ownerName: string } | null, packages: Array<{ manager: EnvironmentPackageManager, packages: Array<string> }> } };

export type FileListQueryVariables = Exact<{
  input: FileListInput;
}>;


export type FileListQuery = { fileList: { files: Array<{ createdAt: string, createdBy: PlatformId, etag: string | null, expiresAt: string | null, id: PlatformId, mimeType: string | null, name: string, path: string, sessionKind: FileSessionKind | null, sourcePath: string | null, size: number, status: string, updatedAt: string, version: number, scope: { id: PlatformId | null, kind: FileScopeKind } }> } };

export type McpCredentialFieldsFragment = { authType: McpAuthType, createdAt: string, expiresAt: string | null, id: PlatformId, scope: McpCredentialRecordScope, scopeValues: Array<string>, status: McpCredentialStatus, subjectLabel: string | null, updatedAt: string };

export type McpServerFieldsFragment = { authType: McpAuthType, authorizationState: McpAuthorizationState, createdAt: string, credentialScope: McpCredentialScope, credentialStatus: McpCredentialStatus, description: string | null, enabled: boolean, hasCredential: boolean, iconUrl: string | null, id: PlatformId, name: string, ownerId: PlatformId, ownerName: string, projectId: PlatformId, source: McpServerSource, updatedAt: string, url: string, credential: { authType: McpAuthType, createdAt: string, expiresAt: string | null, id: PlatformId, scope: McpCredentialRecordScope, scopeValues: Array<string>, status: McpCredentialStatus, subjectLabel: string | null, updatedAt: string } | null };

export type McpRegistryQueryVariables = Exact<{
  projectId: PlatformId;
}>;


export type McpRegistryQuery = { mcpRegistry: { projectId: PlatformId, servers: Array<{ authType: McpAuthType, authorizationState: McpAuthorizationState, createdAt: string, credentialScope: McpCredentialScope, credentialStatus: McpCredentialStatus, description: string | null, enabled: boolean, hasCredential: boolean, iconUrl: string | null, id: PlatformId, name: string, ownerId: PlatformId, ownerName: string, projectId: PlatformId, source: McpServerSource, updatedAt: string, url: string, credential: { authType: McpAuthType, createdAt: string, expiresAt: string | null, id: PlatformId, scope: McpCredentialRecordScope, scopeValues: Array<string>, status: McpCredentialStatus, subjectLabel: string | null, updatedAt: string } | null }> } };

export type CreateProjectMcpServerMutationVariables = Exact<{
  input: CreateProjectMcpServerInput;
}>;


export type CreateProjectMcpServerMutation = { createProjectMcpServer: { authType: McpAuthType, authorizationState: McpAuthorizationState, createdAt: string, credentialScope: McpCredentialScope, credentialStatus: McpCredentialStatus, description: string | null, enabled: boolean, hasCredential: boolean, iconUrl: string | null, id: PlatformId, name: string, ownerId: PlatformId, ownerName: string, projectId: PlatformId, source: McpServerSource, updatedAt: string, url: string, credential: { authType: McpAuthType, createdAt: string, expiresAt: string | null, id: PlatformId, scope: McpCredentialRecordScope, scopeValues: Array<string>, status: McpCredentialStatus, subjectLabel: string | null, updatedAt: string } | null } };

export type ConnectMcpBearerMutationVariables = Exact<{
  input: ConnectMcpBearerInput;
}>;


export type ConnectMcpBearerMutation = { connectMcpBearer: { authType: McpAuthType, authorizationState: McpAuthorizationState, createdAt: string, credentialScope: McpCredentialScope, credentialStatus: McpCredentialStatus, description: string | null, enabled: boolean, hasCredential: boolean, iconUrl: string | null, id: PlatformId, name: string, ownerId: PlatformId, ownerName: string, projectId: PlatformId, source: McpServerSource, updatedAt: string, url: string, credential: { authType: McpAuthType, createdAt: string, expiresAt: string | null, id: PlatformId, scope: McpCredentialRecordScope, scopeValues: Array<string>, status: McpCredentialStatus, subjectLabel: string | null, updatedAt: string } | null } };

export type RevokeMcpCredentialMutationVariables = Exact<{
  projectId: PlatformId;
  serverId: PlatformId;
}>;


export type RevokeMcpCredentialMutation = { revokeMcpCredential: { authType: McpAuthType, authorizationState: McpAuthorizationState, createdAt: string, credentialScope: McpCredentialScope, credentialStatus: McpCredentialStatus, description: string | null, enabled: boolean, hasCredential: boolean, iconUrl: string | null, id: PlatformId, name: string, ownerId: PlatformId, ownerName: string, projectId: PlatformId, source: McpServerSource, updatedAt: string, url: string, credential: { authType: McpAuthType, createdAt: string, expiresAt: string | null, id: PlatformId, scope: McpCredentialRecordScope, scopeValues: Array<string>, status: McpCredentialStatus, subjectLabel: string | null, updatedAt: string } | null } };

export type SetMcpServerEnabledMutationVariables = Exact<{
  projectId: PlatformId;
  serverId: PlatformId;
  enabled: boolean;
}>;


export type SetMcpServerEnabledMutation = { setMcpServerEnabled: { authType: McpAuthType, authorizationState: McpAuthorizationState, createdAt: string, credentialScope: McpCredentialScope, credentialStatus: McpCredentialStatus, description: string | null, enabled: boolean, hasCredential: boolean, iconUrl: string | null, id: PlatformId, name: string, ownerId: PlatformId, ownerName: string, projectId: PlatformId, source: McpServerSource, updatedAt: string, url: string, credential: { authType: McpAuthType, createdAt: string, expiresAt: string | null, id: PlatformId, scope: McpCredentialRecordScope, scopeValues: Array<string>, status: McpCredentialStatus, subjectLabel: string | null, updatedAt: string } | null } };

export type UpdateProjectMcpServerMutationVariables = Exact<{
  input: UpdateProjectMcpServerInput;
}>;


export type UpdateProjectMcpServerMutation = { updateProjectMcpServer: { authType: McpAuthType, authorizationState: McpAuthorizationState, createdAt: string, credentialScope: McpCredentialScope, credentialStatus: McpCredentialStatus, description: string | null, enabled: boolean, hasCredential: boolean, iconUrl: string | null, id: PlatformId, name: string, ownerId: PlatformId, ownerName: string, projectId: PlatformId, source: McpServerSource, updatedAt: string, url: string, credential: { authType: McpAuthType, createdAt: string, expiresAt: string | null, id: PlatformId, scope: McpCredentialRecordScope, scopeValues: Array<string>, status: McpCredentialStatus, subjectLabel: string | null, updatedAt: string } | null } };

export type DeleteMcpServerMutationVariables = Exact<{
  projectId: PlatformId;
  serverId: PlatformId;
}>;


export type DeleteMcpServerMutation = { deleteMcpServer: { ok: boolean } };

export type StartMcpOAuthMutationVariables = Exact<{
  input: StartMcpOAuthInput;
}>;


export type StartMcpOAuthMutation = { startMcpOAuth: { authorizationUrl: string, flowId: PlatformId } };

export type McpOAuthFlowStatusQueryVariables = Exact<{
  flowId: PlatformId;
}>;


export type McpOAuthFlowStatusQuery = { mcpOAuthFlowStatus: { authorizationState: McpAuthorizationState | null, errorMessage: string | null, flowId: PlatformId, serverId: PlatformId, status: McpOAuthFlowStatus, subjectLabel: string | null } };

export type OnboardingBootstrapMutationVariables = Exact<{
  input: BootstrapOnboardingInput;
}>;


export type OnboardingBootstrapMutation = { onboardingBootstrap: { completed: boolean, organization: { createdAt: string, id: PlatformId, name: string } | null } };

export type RenameOrganizationMutationVariables = Exact<{
  input: RenameOrganizationInput;
}>;


export type RenameOrganizationMutation = { renameOrganization: { createdAt: string, id: PlatformId, name: string } };

export type ProjectFieldsFragment = { createdAt: string, defaultEnvironmentId: PlatformId | null, id: PlatformId, name: string, ownerAccountId: PlatformId };

export type ProjectListQueryVariables = Exact<{
  organizationId: PlatformId;
}>;


export type ProjectListQuery = { projectList: Array<{ createdAt: string, defaultEnvironmentId: PlatformId | null, id: PlatformId, name: string, ownerAccountId: PlatformId }> };

export type CreateProjectMutationVariables = Exact<{
  input: CreateProjectInput;
}>;


export type CreateProjectMutation = { createProject: { createdAt: string, defaultEnvironmentId: PlatformId | null, id: PlatformId, name: string, ownerAccountId: PlatformId } };

export type RenameProjectMutationVariables = Exact<{
  input: RenameProjectInput;
}>;


export type RenameProjectMutation = { renameProject: { createdAt: string, defaultEnvironmentId: PlatformId | null, id: PlatformId, name: string, ownerAccountId: PlatformId } };

export type AgentSessionDiagnosticsQueryVariables = Exact<{
  projectId: PlatformId;
  sessionId: PlatformId;
}>;


export type AgentSessionDiagnosticsQuery = { agentSessionDiagnostics: { generatedAt: string, execution: { binding: { deploymentVersionId: PlatformId | null, deploymentVersionNumber: number | null, model: string, provider: string, runtimeId: string, sessionId: PlatformId }, skills: Array<{ skillId: PlatformId, skillName: string }>, tools: Array<{ credentialMode: string, serverId: PlatformId }> } | null, nativeRuntimeRef: { kind: string | null, runtimeId: string | null, status: string, valuePreview: string | null }, session: { deploymentVersionId: PlatformId | null, deploymentVersionNumber: number | null, id: PlatformId, model: string, provider: string, runtimeId: string, status: SessionStatus, title: string | null, lastRun: { deploymentVersionId: PlatformId | null, deploymentVersionNumber: number | null, id: PlatformId, model: string | null, provider: string | null, status: RunStatus, traceId: string } | null } } };

export type SessionFieldsFragment = { agentId: PlatformId | null, archivedAt: string | null, createdAt: string, deploymentVersionId: PlatformId | null, deploymentVersionNumber: number | null, id: PlatformId, lastMessageAt: string | null, model: string, provider: string, projectId: PlatformId, runtimeId: string, status: SessionStatus, title: string | null, type: SessionType, updatedAt: string, lastRun: { completedAt: string | null, createdAt: string, deploymentVersionId: PlatformId | null, deploymentVersionNumber: number | null, id: PlatformId, model: string | null, provider: string | null, startedAt: string | null, status: RunStatus, traceId: string, trigger: SessionRunTrigger, updatedAt: string, error: { code: string, details: PrimitiveRecord, message: string, retryable: boolean } | null } | null };

export type CreateAgentSessionMutationVariables = Exact<{
  input: CreateAgentSessionInput;
}>;


export type CreateAgentSessionMutation = { createAgentSession: { agentId: PlatformId | null, archivedAt: string | null, createdAt: string, deploymentVersionId: PlatformId | null, deploymentVersionNumber: number | null, id: PlatformId, lastMessageAt: string | null, model: string, provider: string, projectId: PlatformId, runtimeId: string, status: SessionStatus, title: string | null, type: SessionType, updatedAt: string, lastRun: { completedAt: string | null, createdAt: string, deploymentVersionId: PlatformId | null, deploymentVersionNumber: number | null, id: PlatformId, model: string | null, provider: string | null, startedAt: string | null, status: RunStatus, traceId: string, trigger: SessionRunTrigger, updatedAt: string, error: { code: string, details: PrimitiveRecord, message: string, retryable: boolean } | null } | null } };

export type AgentSessionListQueryVariables = Exact<{
  agentId: PlatformId;
  archived?: boolean | null | undefined;
  projectId: PlatformId;
  sessionId?: PlatformId | null | undefined;
  type?: SessionType | null | undefined;
}>;


export type AgentSessionListQuery = { agentSessionList: { nodes: Array<{ agentId: PlatformId | null, archivedAt: string | null, createdAt: string, deploymentVersionId: PlatformId | null, deploymentVersionNumber: number | null, id: PlatformId, lastMessageAt: string | null, model: string, provider: string, projectId: PlatformId, runtimeId: string, status: SessionStatus, title: string | null, type: SessionType, updatedAt: string, lastRun: { completedAt: string | null, createdAt: string, deploymentVersionId: PlatformId | null, deploymentVersionNumber: number | null, id: PlatformId, model: string | null, provider: string | null, startedAt: string | null, status: RunStatus, traceId: string, trigger: SessionRunTrigger, updatedAt: string, error: { code: string, details: PrimitiveRecord, message: string, retryable: boolean } | null } | null }> } };

export type ThreadSessionMessagesQueryVariables = Exact<{
  projectId: PlatformId;
  sessionId: PlatformId;
}>;


export type ThreadSessionMessagesQuery = { threadSessionMessages: Array<{ content: string, createdAt: string, createdBy: PlatformId, id: PlatformId, role: SessionMessageRole, plan: Array<{ content: string, priority: SessionMessagePlanPriority, status: SessionMessagePlanStatus }>, segments: Array<{ argsText: string | null, kind: SessionMessageSegmentKind, output: string | null, path: string | null, text: string | null, tool: string | null, toolCallId: string | null }> }> };

export type SendAgentSessionEventsMutationVariables = Exact<{
  projectId: PlatformId;
  sessionId: PlatformId;
  events: Array<AgentSessionEventInput>;
}>;


export type SendAgentSessionEventsMutation = { sendAgentSessionEvents: { acceptedAt: string, warnings: Array<{ code: string, message: string }> } };

export type PrewarmAgentSessionMutationVariables = Exact<{
  projectId: PlatformId;
  sessionId: PlatformId;
}>;


export type PrewarmAgentSessionMutation = { prewarmAgentSession: { scheduledAt: string, sessionId: PlatformId } };

export type ThreadAgentSessionListQueryVariables = Exact<{
  projectId: PlatformId;
  archived?: boolean | null | undefined;
  beforeCursor?: string | null | undefined;
  type?: SessionType | null | undefined;
}>;


export type ThreadAgentSessionListQuery = { threadAgentSessionList: { nodes: Array<{ capabilities: Array<{ action: AgentSessionActionCapabilityName, reason: string | null, status: AgentSessionActionCapabilityStatus }>, session: { agentId: PlatformId | null, archivedAt: string | null, createdAt: string, deploymentVersionId: PlatformId | null, deploymentVersionNumber: number | null, id: PlatformId, lastMessageAt: string | null, model: string, provider: string, projectId: PlatformId, runtimeId: string, status: SessionStatus, title: string | null, type: SessionType, updatedAt: string, lastRun: { completedAt: string | null, createdAt: string, deploymentVersionId: PlatformId | null, deploymentVersionNumber: number | null, id: PlatformId, model: string | null, provider: string | null, startedAt: string | null, status: RunStatus, traceId: string, trigger: SessionRunTrigger, updatedAt: string, error: { code: string, details: PrimitiveRecord, message: string, retryable: boolean } | null } | null } }>, pageInfo: { endCursor: string | null, hasMore: boolean } } };

export type ArchiveSessionMutationVariables = Exact<{
  projectId: PlatformId;
  sessionId: PlatformId;
}>;


export type ArchiveSessionMutation = { archiveAgentSession: { ok: boolean } };

export type RestoreSessionMutationVariables = Exact<{
  projectId: PlatformId;
  sessionId: PlatformId;
}>;


export type RestoreSessionMutation = { unarchiveAgentSession: { ok: boolean } };

export type DeleteAgentSessionMutationVariables = Exact<{
  projectId: PlatformId;
  sessionId: PlatformId;
}>;


export type DeleteAgentSessionMutation = { deleteAgentSession: { ok: boolean } };

export type AddSessionResourceMutationVariables = Exact<{
  input: AddSessionResourceInput;
}>;


export type AddSessionResourceMutation = { addSessionResource: { contentType: string, expectedSize: number, expiresAt: string, fileId: PlatformId, partSize: number | null, path: string, status: FileUploadStatus, strategy: FileUploadStrategy } };

export type RestartSessionDriverMutationVariables = Exact<{
  projectId: PlatformId;
  sessionId: PlatformId;
}>;


export type RestartSessionDriverMutation = { restartSessionDriver: { ok: boolean, sessionId: PlatformId } };

export type RecreateSessionSandboxMutationVariables = Exact<{
  projectId: PlatformId;
  sessionId: PlatformId;
}>;


export type RecreateSessionSandboxMutation = { recreateSessionSandbox: { ok: boolean, sessionId: PlatformId } };

export type SessionProcessEventsQueryVariables = Exact<{
  limit: number;
  projectId: PlatformId;
  sessionId: PlatformId;
}>;


export type SessionProcessEventsQuery = { threadSessionProcessEvents: Array<{ content: string, durationMs: number | null, id: PlatformId, occurredAt: string, status: SessionProcessEventStatus, tokens: number | null, type: SessionProcessEventType }> };

export type SkillSummaryFieldsFragment = { author: string, createdAt: string, description: string, fileCount: number, id: PlatformId, name: string, ownerId: PlatformId, ownerName: string, projectId: PlatformId, snapshotId: PlatformId, updatedAt: string, forkOrigin: { name: string, ownerName: string, skillId: PlatformId } | null };

export type SkillDetailFieldsFragment = { author: string, createdAt: string, description: string, fileCount: number, id: PlatformId, name: string, ownerId: PlatformId, ownerName: string, projectId: PlatformId, snapshotId: PlatformId, updatedAt: string, forkOrigin: { name: string, ownerName: string, skillId: PlatformId } | null, currentSnapshot: { archiveFormat: string, author: string, blobKey: string, blobSha256: string, blobSize: number, compression: string, createdAt: string, description: string, id: PlatformId, name: string, skillMarkdownPath: string, uncompressedSize: number, version: string | null }, entries: Array<{ entryKind: SkillSnapshotEntryKind, isExecutable: boolean, mimeType: string | null, path: string, sha256: string | null, size: number }> };

export type SkillDetailQueryVariables = Exact<{
  projectId: PlatformId;
  skillId: PlatformId;
}>;


export type SkillDetailQuery = { skillDetail: { author: string, createdAt: string, description: string, fileCount: number, id: PlatformId, name: string, ownerId: PlatformId, ownerName: string, projectId: PlatformId, snapshotId: PlatformId, updatedAt: string, forkOrigin: { name: string, ownerName: string, skillId: PlatformId } | null, currentSnapshot: { archiveFormat: string, author: string, blobKey: string, blobSha256: string, blobSize: number, compression: string, createdAt: string, description: string, id: PlatformId, name: string, skillMarkdownPath: string, uncompressedSize: number, version: string | null }, entries: Array<{ entryKind: SkillSnapshotEntryKind, isExecutable: boolean, mimeType: string | null, path: string, sha256: string | null, size: number }> } };

export type ProjectSkillsQueryVariables = Exact<{
  projectId: PlatformId;
}>;


export type ProjectSkillsQuery = { projectSkillList: Array<{ author: string, createdAt: string, description: string, fileCount: number, id: PlatformId, name: string, ownerId: PlatformId, ownerName: string, projectId: PlatformId, snapshotId: PlatformId, updatedAt: string, forkOrigin: { name: string, ownerName: string, skillId: PlatformId } | null }> };

export type CreateSkillForkMutationVariables = Exact<{
  input: CreateSkillForkInput;
}>;


export type CreateSkillForkMutation = { createSkillFork: { author: string, createdAt: string, description: string, fileCount: number, id: PlatformId, name: string, ownerId: PlatformId, ownerName: string, projectId: PlatformId, snapshotId: PlatformId, updatedAt: string, forkOrigin: { name: string, ownerName: string, skillId: PlatformId } | null } };

export type DeleteOwnedSkillMutationVariables = Exact<{
  projectId: PlatformId;
  skillId: PlatformId;
}>;


export type DeleteOwnedSkillMutation = { deleteOwnedSkill: { ok: boolean } };

export type ViewerQueryVariables = Exact<{ [key: string]: never; }>;


export type ViewerQuery = { viewer: { account: { email: string, id: PlatformId, imageUrl: string | null, name: string } | null, activeOrganization: { createdAt: string, id: PlatformId, name: string } | null, organizations: Array<{ createdAt: string, id: PlatformId, name: string }> } };

export type UpdateProfileMutationVariables = Exact<{
  input: UpdateAccountProfileInput;
}>;


export type UpdateProfileMutation = { updateProfile: { imageUrl: string | null, name: string } };

export type VendorCredentialFieldsFragment = { apiBase: string | null, id: PlatformId, isDefault: boolean, maskedApiKey: string, modelProtocol: string | null, models: Array<string> | null, name: string, projectId: PlatformId, vendorId: string };

export type VendorCredentialListQueryVariables = Exact<{
  projectId: PlatformId;
}>;


export type VendorCredentialListQuery = { vendorCredentialList: Array<{ apiBase: string | null, id: PlatformId, isDefault: boolean, maskedApiKey: string, modelProtocol: string | null, models: Array<string> | null, name: string, projectId: PlatformId, vendorId: string }> };

export type CreateVendorCredentialMutationVariables = Exact<{
  input: CreateVendorCredentialInput;
}>;


export type CreateVendorCredentialMutation = { createVendorCredential: { apiBase: string | null, id: PlatformId, isDefault: boolean, maskedApiKey: string, modelProtocol: string | null, models: Array<string> | null, name: string, projectId: PlatformId, vendorId: string } };

export type UpdateVendorCredentialMutationVariables = Exact<{
  input: UpdateVendorCredentialInput;
}>;


export type UpdateVendorCredentialMutation = { updateVendorCredential: { apiBase: string | null, id: PlatformId, isDefault: boolean, maskedApiKey: string, modelProtocol: string | null, models: Array<string> | null, name: string, projectId: PlatformId, vendorId: string } };

export type DeleteVendorCredentialMutationVariables = Exact<{
  input: DeleteVendorCredentialInput;
}>;


export type DeleteVendorCredentialMutation = { deleteVendorCredential: { ok: boolean } };

export type SetDefaultVendorCredentialMutationVariables = Exact<{
  input: SetDefaultVendorCredentialInput;
}>;


export type SetDefaultVendorCredentialMutation = { setDefaultVendorCredential: { apiBase: string | null, id: PlatformId, isDefault: boolean, maskedApiKey: string, modelProtocol: string | null, models: Array<string> | null, name: string, projectId: PlatformId, vendorId: string } };

export type AvailableAgentModelsQueryVariables = Exact<{
  projectId: PlatformId;
  runtimeId: string;
  currentModelId?: string | null | undefined;
  currentVendorId?: string | null | undefined;
}>;


export type AvailableAgentModelsQuery = { availableAgentModels: Array<{ available: boolean, displayName: string, modelId: string, modelProtocol: string | null, reason: string | null, source: ModelCatalogSource, statusDetail: string | null, statusLabel: string, vendorId: string, vendorLabel: string }> };

export type TestVendorCredentialMutationVariables = Exact<{
  input: TestVendorCredentialInput;
}>;


export type TestVendorCredentialMutation = { testVendorCredential: { errorCode: string | null, latencyMs: number, ok: boolean } };

export class TypedDocumentString<TResult, TVariables>
  extends String
  implements DocumentTypeDecoration<TResult, TVariables>
{
  __apiType?: NonNullable<DocumentTypeDecoration<TResult, TVariables>['__apiType']>;
  private value: string;
  public __meta__?: Record<string, any> | undefined;

  constructor(value: string, __meta__?: Record<string, any> | undefined) {
    super(value);
    this.value = value;
    this.__meta__ = __meta__;
  }

  override toString(): string & DocumentTypeDecoration<TResult, TVariables> {
    return this.value;
  }
}
export const AgentDeploymentVersionFieldsFragmentDoc = new TypedDocumentString(`
    fragment AgentDeploymentVersionFields on AgentDeploymentVersion {
  agentId
  createdAt
  createdByAccountId
  environmentId
  id
  isLive
  model
  provider
  runtimeId
  summary
  versionNumber
}
    `, {"fragmentName":"AgentDeploymentVersionFields"}) as unknown as TypedDocumentString<AgentDeploymentVersionFieldsFragment, unknown>;
export const AgentFieldsFragmentDoc = new TypedDocumentString(`
    fragment AgentFields on Agent {
  createdAt
  description
  id
  liveVersion {
    ...AgentDeploymentVersionFields
  }
  model
  name
  projectId
  prompt
  provider
  runtimeId
  skills {
    ownerName
    skillId
    skillName
    state
  }
  status
  updatedAt
  visibility
}
    fragment AgentDeploymentVersionFields on AgentDeploymentVersion {
  agentId
  createdAt
  createdByAccountId
  environmentId
  id
  isLive
  model
  provider
  runtimeId
  summary
  versionNumber
}`, {"fragmentName":"AgentFields"}) as unknown as TypedDocumentString<AgentFieldsFragment, unknown>;
export const AgentToolSummaryFieldsFragmentDoc = new TypedDocumentString(`
    fragment AgentToolSummaryFields on AgentToolSummary {
  enabled
  iconUrl
  name
  serverId
}
    `, {"fragmentName":"AgentToolSummaryFields"}) as unknown as TypedDocumentString<AgentToolSummaryFieldsFragment, unknown>;
export const AgentOwnerFieldsFragmentDoc = new TypedDocumentString(`
    fragment AgentOwnerFields on AgentOwnerSummary {
  id
  imageUrl
  name
}
    `, {"fragmentName":"AgentOwnerFields"}) as unknown as TypedDocumentString<AgentOwnerFieldsFragment, unknown>;
export const CostTotalsFieldsFragmentDoc = new TypedDocumentString(`
    fragment CostTotalsFields on CostAggregate {
  activeUsers
  cacheCreationTokens
  cacheReadTokens
  inputTokens
  outputTokens
  requestCount
  totalCostUsd
  unpricedRequestCount
}
    `, {"fragmentName":"CostTotalsFields"}) as unknown as TypedDocumentString<CostTotalsFieldsFragment, unknown>;
export const CostDailyFieldsFragmentDoc = new TypedDocumentString(`
    fragment CostDailyFields on CostDailyPoint {
  activeUsers
  cacheCreationTokens
  cacheReadTokens
  date
  inputTokens
  outputTokens
  requestCount
  totalCostUsd
  unpricedRequestCount
}
    `, {"fragmentName":"CostDailyFields"}) as unknown as TypedDocumentString<CostDailyFieldsFragment, unknown>;
export const CostAgentFieldsFragmentDoc = new TypedDocumentString(`
    fragment CostAgentFields on CostAgentRow {
  activeUsers
  agentId
  agentName
  cacheCreationTokens
  cacheReadTokens
  debugCostUsd
  inputTokens
  outputTokens
  ownerEmail
  ownerId
  ownerName
  previewCostUsd
  productionCostUsd
  requestCount
  totalCostUsd
  unpricedRequestCount
}
    `, {"fragmentName":"CostAgentFields"}) as unknown as TypedDocumentString<CostAgentFieldsFragment, unknown>;
export const CostModelFieldsFragmentDoc = new TypedDocumentString(`
    fragment CostModelFields on CostModelRow {
  activeUsers
  cacheCreationTokens
  cacheReadTokens
  cacheReadUsdPerMillion
  cacheWriteUsdPerMillion
  inputTokens
  inputUsdPerMillion
  model
  outputTokens
  outputUsdPerMillion
  provider
  requestCount
  totalCostUsd
  unpricedRequestCount
  vendor
}
    `, {"fragmentName":"CostModelFields"}) as unknown as TypedDocumentString<CostModelFieldsFragment, unknown>;
export const CostRecentSessionFieldsFragmentDoc = new TypedDocumentString(`
    fragment CostRecentSessionFields on CostRecentSession {
  actorEmail
  actorName
  cacheCreationTokens
  cacheReadTokens
  createdAt
  inputTokens
  model
  outputTokens
  provider
  runPurpose
  sessionId
  sessionRunId
  totalCostUsd
}
    `, {"fragmentName":"CostRecentSessionFields"}) as unknown as TypedDocumentString<CostRecentSessionFieldsFragment, unknown>;
export const EnvironmentVariableFieldsFragmentDoc = new TypedDocumentString(`
    fragment EnvironmentVariableFields on EnvironmentVariablePreview {
  key
  preview
  status
}
    `, {"fragmentName":"EnvironmentVariableFields"}) as unknown as TypedDocumentString<EnvironmentVariableFieldsFragment, unknown>;
export const EnvironmentPackageFieldsFragmentDoc = new TypedDocumentString(`
    fragment EnvironmentPackageFields on EnvironmentPackageSpec {
  manager
  packages
}
    `, {"fragmentName":"EnvironmentPackageFields"}) as unknown as TypedDocumentString<EnvironmentPackageFieldsFragment, unknown>;
export const EnvironmentSummaryFieldsFragmentDoc = new TypedDocumentString(`
    fragment EnvironmentSummaryFields on EnvironmentSummary {
  allowedHosts
  canDelete
  canEdit
  createdAt
  currentRevisionId
  description
  envVars {
    ...EnvironmentVariableFields
  }
  forkOrigin {
    environmentId
    name
    ownerName
  }
  id
  isBuiltIn
  isDefault
  name
  networkPolicy
  packages {
    ...EnvironmentPackageFields
  }
  setupScript
  updatedAt
  usedByAgentCount
  projectId
}
    fragment EnvironmentPackageFields on EnvironmentPackageSpec {
  manager
  packages
}
fragment EnvironmentVariableFields on EnvironmentVariablePreview {
  key
  preview
  status
}`, {"fragmentName":"EnvironmentSummaryFields"}) as unknown as TypedDocumentString<EnvironmentSummaryFieldsFragment, unknown>;
export const EnvironmentDetailFieldsFragmentDoc = new TypedDocumentString(`
    fragment EnvironmentDetailFields on EnvironmentDetail {
  allowedHosts
  canDelete
  canEdit
  createdAt
  currentRevisionId
  description
  envVars {
    ...EnvironmentVariableFields
  }
  forkOrigin {
    environmentId
    name
    ownerName
  }
  id
  isBuiltIn
  isDefault
  name
  networkPolicy
  packages {
    ...EnvironmentPackageFields
  }
  setupScript
  updatedAt
  usedByAgentCount
  projectId
}
    fragment EnvironmentPackageFields on EnvironmentPackageSpec {
  manager
  packages
}
fragment EnvironmentVariableFields on EnvironmentVariablePreview {
  key
  preview
  status
}`, {"fragmentName":"EnvironmentDetailFields"}) as unknown as TypedDocumentString<EnvironmentDetailFieldsFragment, unknown>;
export const McpCredentialFieldsFragmentDoc = new TypedDocumentString(`
    fragment McpCredentialFields on McpCredentialSummary {
  authType
  createdAt
  expiresAt
  id
  scope
  scopeValues
  status
  subjectLabel
  updatedAt
}
    `, {"fragmentName":"McpCredentialFields"}) as unknown as TypedDocumentString<McpCredentialFieldsFragment, unknown>;
export const McpServerFieldsFragmentDoc = new TypedDocumentString(`
    fragment McpServerFields on McpServerWithCredential {
  authType
  authorizationState
  createdAt
  credentialScope
  credentialStatus
  description
  enabled
  hasCredential
  iconUrl
  id
  name
  ownerId
  ownerName
  projectId
  source
  updatedAt
  url
  credential {
    ...McpCredentialFields
  }
}
    fragment McpCredentialFields on McpCredentialSummary {
  authType
  createdAt
  expiresAt
  id
  scope
  scopeValues
  status
  subjectLabel
  updatedAt
}`, {"fragmentName":"McpServerFields"}) as unknown as TypedDocumentString<McpServerFieldsFragment, unknown>;
export const ProjectFieldsFragmentDoc = new TypedDocumentString(`
    fragment ProjectFields on Project {
  createdAt
  defaultEnvironmentId
  id
  name
  ownerAccountId
}
    `, {"fragmentName":"ProjectFields"}) as unknown as TypedDocumentString<ProjectFieldsFragment, unknown>;
export const SessionFieldsFragmentDoc = new TypedDocumentString(`
    fragment SessionFields on Session {
  agentId
  archivedAt
  createdAt
  deploymentVersionId
  deploymentVersionNumber
  id
  lastMessageAt
  lastRun {
    completedAt
    createdAt
    deploymentVersionId
    deploymentVersionNumber
    error {
      code
      details
      message
      retryable
    }
    id
    model
    provider
    startedAt
    status
    traceId
    trigger
    updatedAt
  }
  model
  provider
  projectId
  runtimeId
  status
  title
  type
  updatedAt
}
    `, {"fragmentName":"SessionFields"}) as unknown as TypedDocumentString<SessionFieldsFragment, unknown>;
export const SkillSummaryFieldsFragmentDoc = new TypedDocumentString(`
    fragment SkillSummaryFields on SkillSummary {
  author
  createdAt
  description
  fileCount
  forkOrigin {
    name
    ownerName
    skillId
  }
  id
  name
  ownerId
  ownerName
  projectId
  snapshotId
  updatedAt
}
    `, {"fragmentName":"SkillSummaryFields"}) as unknown as TypedDocumentString<SkillSummaryFieldsFragment, unknown>;
export const SkillDetailFieldsFragmentDoc = new TypedDocumentString(`
    fragment SkillDetailFields on SkillDetail {
  author
  createdAt
  description
  fileCount
  forkOrigin {
    name
    ownerName
    skillId
  }
  id
  name
  ownerId
  ownerName
  projectId
  snapshotId
  updatedAt
  currentSnapshot {
    archiveFormat
    author
    blobKey
    blobSha256
    blobSize
    compression
    createdAt
    description
    id
    name
    skillMarkdownPath
    uncompressedSize
    version
  }
  entries {
    entryKind
    isExecutable
    mimeType
    path
    sha256
    size
  }
}
    `, {"fragmentName":"SkillDetailFields"}) as unknown as TypedDocumentString<SkillDetailFieldsFragment, unknown>;
export const VendorCredentialFieldsFragmentDoc = new TypedDocumentString(`
    fragment VendorCredentialFields on VendorCredential {
  apiBase
  id
  isDefault
  maskedApiKey
  modelProtocol
  models
  name
  projectId
  vendorId
}
    `, {"fragmentName":"VendorCredentialFields"}) as unknown as TypedDocumentString<VendorCredentialFieldsFragment, unknown>;
export const CreateAgentDocument = new TypedDocumentString(`
    mutation CreateAgent($input: CreateAgentInput!) {
  createAgent(input: $input) {
    ...AgentFields
  }
}
    fragment AgentFields on Agent {
  createdAt
  description
  id
  liveVersion {
    ...AgentDeploymentVersionFields
  }
  model
  name
  projectId
  prompt
  provider
  runtimeId
  skills {
    ownerName
    skillId
    skillName
    state
  }
  status
  updatedAt
  visibility
}
fragment AgentDeploymentVersionFields on AgentDeploymentVersion {
  agentId
  createdAt
  createdByAccountId
  environmentId
  id
  isLive
  model
  provider
  runtimeId
  summary
  versionNumber
}`) as unknown as TypedDocumentString<CreateAgentMutation, CreateAgentMutationVariables>;
export const DeleteAgentDocument = new TypedDocumentString(`
    mutation DeleteAgent($input: DeleteAgentInput!) {
  deleteAgent(input: $input) {
    ok
  }
}
    `) as unknown as TypedDocumentString<DeleteAgentMutation, DeleteAgentMutationVariables>;
export const AccessibleAgentsDocument = new TypedDocumentString(`
    query AccessibleAgents($projectId: ULID!) {
  accessibleAgentList(projectId: $projectId) {
    createdAt
    description
    id
    name
    projectId
    owner {
      ...AgentOwnerFields
    }
    runtimeId
    status
    tools {
      ...AgentToolSummaryFields
    }
    updatedAt
    viewerRole
    visibility
  }
}
    fragment AgentToolSummaryFields on AgentToolSummary {
  enabled
  iconUrl
  name
  serverId
}
fragment AgentOwnerFields on AgentOwnerSummary {
  id
  imageUrl
  name
}`) as unknown as TypedDocumentString<AccessibleAgentsQuery, AccessibleAgentsQueryVariables>;
export const AgentDocument = new TypedDocumentString(`
    query Agent($agentId: ULID!, $projectId: ULID!) {
  agent(agentId: $agentId, projectId: $projectId) {
    createdAt
    description
    id
    liveVersion {
      ...AgentDeploymentVersionFields
    }
    model
    name
    projectId
    owner {
      ...AgentOwnerFields
    }
    prompt
    provider
    runtimeId
    skills {
      ownerName
      skillId
      skillName
      state
    }
    status
    tools {
      ...AgentToolSummaryFields
    }
    updatedAt
    versions {
      ...AgentDeploymentVersionFields
    }
    viewerRole
    visibility
  }
}
    fragment AgentToolSummaryFields on AgentToolSummary {
  enabled
  iconUrl
  name
  serverId
}
fragment AgentDeploymentVersionFields on AgentDeploymentVersion {
  agentId
  createdAt
  createdByAccountId
  environmentId
  id
  isLive
  model
  provider
  runtimeId
  summary
  versionNumber
}
fragment AgentOwnerFields on AgentOwnerSummary {
  id
  imageUrl
  name
}`) as unknown as TypedDocumentString<AgentQuery, AgentQueryVariables>;
export const AgentEditorStateDocument = new TypedDocumentString(`
    query AgentEditorState($agentId: ULID!, $projectId: ULID!) {
  agentEditorState(agentId: $agentId, projectId: $projectId) {
    id
    builtInTools {
      enabled
      name
    }
    environment {
      environmentId
    }
    packageResolution {
      recordedAt
      source
      report {
        issues {
          actionLabel
          code
          message
          required
          severity
          status
          targetLabel
          targetType
        }
        summary {
          boundMcpServerCount
          boundSkillCount
          copiedAssetCount
          createdMcpServerCount
          reusedMcpServerCount
        }
      }
    }
    providerOptions
    mcpBindings {
      authType
      authorizationState
      createdAt
      credentialMode
      credentialScope
      credentialStatus
      credentialSubject
      enabled
      hasCredential
      iconUrl
      id
      name
      serverId
      source
      updatedAt
      url
    }
    readiness {
      checkedAt
      ready
      issues {
        code
        message
        severity
      }
    }
  }
}
    `) as unknown as TypedDocumentString<AgentEditorStateQuery, AgentEditorStateQueryVariables>;
export const UpdateAgentConfigDocument = new TypedDocumentString(`
    mutation UpdateAgentConfig($input: UpdateAgentConfigInput!) {
  updateAgentConfig(input: $input) {
    ...AgentFields
  }
}
    fragment AgentFields on Agent {
  createdAt
  description
  id
  liveVersion {
    ...AgentDeploymentVersionFields
  }
  model
  name
  projectId
  prompt
  provider
  runtimeId
  skills {
    ownerName
    skillId
    skillName
    state
  }
  status
  updatedAt
  visibility
}
fragment AgentDeploymentVersionFields on AgentDeploymentVersion {
  agentId
  createdAt
  createdByAccountId
  environmentId
  id
  isLive
  model
  provider
  runtimeId
  summary
  versionNumber
}`) as unknown as TypedDocumentString<UpdateAgentConfigMutation, UpdateAgentConfigMutationVariables>;
export const AgentManifestDocument = new TypedDocumentString(`
    query AgentManifest($agentId: ULID!, $projectId: ULID!) {
  agentManifest(agentId: $agentId, projectId: $projectId) {
    agentId
    json
    yaml
  }
}
    `) as unknown as TypedDocumentString<AgentManifestQuery, AgentManifestQueryVariables>;
export const ExportAgentPackageDocument = new TypedDocumentString(`
    query ExportAgentPackage($agentId: ULID!, $projectId: ULID!) {
  exportAgentPackage(agentId: $agentId, projectId: $projectId) {
    agentId
    contentType
    fileId
    fileName
    manifestYaml
    size
  }
}
    `) as unknown as TypedDocumentString<ExportAgentPackageQuery, ExportAgentPackageQueryVariables>;
export const ImportAgentPackageDocument = new TypedDocumentString(`
    mutation ImportAgentPackage($input: ImportAgentPackageInput!) {
  importAgentPackage(input: $input) {
    agent {
      ...AgentFields
    }
    resolution {
      issues {
        actionLabel
        code
        message
        required
        severity
        status
        targetLabel
        targetType
      }
      summary {
        boundMcpServerCount
        boundSkillCount
        copiedAssetCount
        createdMcpServerCount
        reusedMcpServerCount
      }
    }
  }
}
    fragment AgentFields on Agent {
  createdAt
  description
  id
  liveVersion {
    ...AgentDeploymentVersionFields
  }
  model
  name
  projectId
  prompt
  provider
  runtimeId
  skills {
    ownerName
    skillId
    skillName
    state
  }
  status
  updatedAt
  visibility
}
fragment AgentDeploymentVersionFields on AgentDeploymentVersion {
  agentId
  createdAt
  createdByAccountId
  environmentId
  id
  isLive
  model
  provider
  runtimeId
  summary
  versionNumber
}`) as unknown as TypedDocumentString<ImportAgentPackageMutation, ImportAgentPackageMutationVariables>;
export const CreateAgentForkDocument = new TypedDocumentString(`
    mutation CreateAgentFork($input: CreateAgentForkInput!) {
  createAgentFork(input: $input) {
    agent {
      ...AgentFields
    }
    resolution {
      issues {
        actionLabel
        code
        message
        required
        severity
        status
        targetLabel
        targetType
      }
      summary {
        boundMcpServerCount
        boundSkillCount
        copiedAssetCount
        createdMcpServerCount
        reusedMcpServerCount
      }
    }
  }
}
    fragment AgentFields on Agent {
  createdAt
  description
  id
  liveVersion {
    ...AgentDeploymentVersionFields
  }
  model
  name
  projectId
  prompt
  provider
  runtimeId
  skills {
    ownerName
    skillId
    skillName
    state
  }
  status
  updatedAt
  visibility
}
fragment AgentDeploymentVersionFields on AgentDeploymentVersion {
  agentId
  createdAt
  createdByAccountId
  environmentId
  id
  isLive
  model
  provider
  runtimeId
  summary
  versionNumber
}`) as unknown as TypedDocumentString<CreateAgentForkMutation, CreateAgentForkMutationVariables>;
export const PublishAgentDocument = new TypedDocumentString(`
    mutation PublishAgent($input: PublishAgentInput!) {
  publishAgent(input: $input) {
    ...AgentFields
  }
}
    fragment AgentFields on Agent {
  createdAt
  description
  id
  liveVersion {
    ...AgentDeploymentVersionFields
  }
  model
  name
  projectId
  prompt
  provider
  runtimeId
  skills {
    ownerName
    skillId
    skillName
    state
  }
  status
  updatedAt
  visibility
}
fragment AgentDeploymentVersionFields on AgentDeploymentVersion {
  agentId
  createdAt
  createdByAccountId
  environmentId
  id
  isLive
  model
  provider
  runtimeId
  summary
  versionNumber
}`) as unknown as TypedDocumentString<PublishAgentMutation, PublishAgentMutationVariables>;
export const UnpublishAgentDocument = new TypedDocumentString(`
    mutation UnpublishAgent($agentId: ULID!, $projectId: ULID!) {
  unpublishAgent(agentId: $agentId, projectId: $projectId) {
    ...AgentFields
  }
}
    fragment AgentFields on Agent {
  createdAt
  description
  id
  liveVersion {
    ...AgentDeploymentVersionFields
  }
  model
  name
  projectId
  prompt
  provider
  runtimeId
  skills {
    ownerName
    skillId
    skillName
    state
  }
  status
  updatedAt
  visibility
}
fragment AgentDeploymentVersionFields on AgentDeploymentVersion {
  agentId
  createdAt
  createdByAccountId
  environmentId
  id
  isLive
  model
  provider
  runtimeId
  summary
  versionNumber
}`) as unknown as TypedDocumentString<UnpublishAgentMutation, UnpublishAgentMutationVariables>;
export const ProjectCostCardDocument = new TypedDocumentString(`
    query ProjectCostCard($projectId: ULID!, $range: CostRange!, $runPurposes: [CostRunPurpose!]) {
  projectCostCard(projectId: $projectId, range: $range, runPurposes: $runPurposes) {
    projectId
    projectName
    agents {
      ...CostAgentFields
    }
    daily {
      ...CostDailyFields
    }
    models {
      ...CostModelFields
    }
    previousTotals {
      ...CostTotalsFields
    }
    recentSessions {
      ...CostRecentSessionFields
    }
    totals {
      ...CostTotalsFields
    }
  }
}
    fragment CostTotalsFields on CostAggregate {
  activeUsers
  cacheCreationTokens
  cacheReadTokens
  inputTokens
  outputTokens
  requestCount
  totalCostUsd
  unpricedRequestCount
}
fragment CostDailyFields on CostDailyPoint {
  activeUsers
  cacheCreationTokens
  cacheReadTokens
  date
  inputTokens
  outputTokens
  requestCount
  totalCostUsd
  unpricedRequestCount
}
fragment CostAgentFields on CostAgentRow {
  activeUsers
  agentId
  agentName
  cacheCreationTokens
  cacheReadTokens
  debugCostUsd
  inputTokens
  outputTokens
  ownerEmail
  ownerId
  ownerName
  previewCostUsd
  productionCostUsd
  requestCount
  totalCostUsd
  unpricedRequestCount
}
fragment CostModelFields on CostModelRow {
  activeUsers
  cacheCreationTokens
  cacheReadTokens
  cacheReadUsdPerMillion
  cacheWriteUsdPerMillion
  inputTokens
  inputUsdPerMillion
  model
  outputTokens
  outputUsdPerMillion
  provider
  requestCount
  totalCostUsd
  unpricedRequestCount
  vendor
}
fragment CostRecentSessionFields on CostRecentSession {
  actorEmail
  actorName
  cacheCreationTokens
  cacheReadTokens
  createdAt
  inputTokens
  model
  outputTokens
  provider
  runPurpose
  sessionId
  sessionRunId
  totalCostUsd
}`) as unknown as TypedDocumentString<ProjectCostCardQuery, ProjectCostCardQueryVariables>;
export const AgentCostCardDocument = new TypedDocumentString(`
    query AgentCostCard($projectId: ULID!, $agentId: ULID!, $range: CostRange!, $runPurposes: [CostRunPurpose!]) {
  agentCostCard(
    projectId: $projectId
    agentId: $agentId
    range: $range
    runPurposes: $runPurposes
  ) {
    agentId
    agentName
    agents {
      ...CostAgentFields
    }
    daily {
      ...CostDailyFields
    }
    models {
      ...CostModelFields
    }
    ownerId
    ownerName
    recentSessions {
      ...CostRecentSessionFields
    }
    totals {
      ...CostTotalsFields
    }
  }
}
    fragment CostTotalsFields on CostAggregate {
  activeUsers
  cacheCreationTokens
  cacheReadTokens
  inputTokens
  outputTokens
  requestCount
  totalCostUsd
  unpricedRequestCount
}
fragment CostDailyFields on CostDailyPoint {
  activeUsers
  cacheCreationTokens
  cacheReadTokens
  date
  inputTokens
  outputTokens
  requestCount
  totalCostUsd
  unpricedRequestCount
}
fragment CostAgentFields on CostAgentRow {
  activeUsers
  agentId
  agentName
  cacheCreationTokens
  cacheReadTokens
  debugCostUsd
  inputTokens
  outputTokens
  ownerEmail
  ownerId
  ownerName
  previewCostUsd
  productionCostUsd
  requestCount
  totalCostUsd
  unpricedRequestCount
}
fragment CostModelFields on CostModelRow {
  activeUsers
  cacheCreationTokens
  cacheReadTokens
  cacheReadUsdPerMillion
  cacheWriteUsdPerMillion
  inputTokens
  inputUsdPerMillion
  model
  outputTokens
  outputUsdPerMillion
  provider
  requestCount
  totalCostUsd
  unpricedRequestCount
  vendor
}
fragment CostRecentSessionFields on CostRecentSession {
  actorEmail
  actorName
  cacheCreationTokens
  cacheReadTokens
  createdAt
  inputTokens
  model
  outputTokens
  provider
  runPurpose
  sessionId
  sessionRunId
  totalCostUsd
}`) as unknown as TypedDocumentString<AgentCostCardQuery, AgentCostCardQueryVariables>;
export const ProjectEnvironmentsDocument = new TypedDocumentString(`
    query ProjectEnvironments($projectId: ULID!) {
  projectEnvironmentList(projectId: $projectId) {
    ...EnvironmentSummaryFields
  }
}
    fragment EnvironmentPackageFields on EnvironmentPackageSpec {
  manager
  packages
}
fragment EnvironmentVariableFields on EnvironmentVariablePreview {
  key
  preview
  status
}
fragment EnvironmentSummaryFields on EnvironmentSummary {
  allowedHosts
  canDelete
  canEdit
  createdAt
  currentRevisionId
  description
  envVars {
    ...EnvironmentVariableFields
  }
  forkOrigin {
    environmentId
    name
    ownerName
  }
  id
  isBuiltIn
  isDefault
  name
  networkPolicy
  packages {
    ...EnvironmentPackageFields
  }
  setupScript
  updatedAt
  usedByAgentCount
  projectId
}`) as unknown as TypedDocumentString<ProjectEnvironmentsQuery, ProjectEnvironmentsQueryVariables>;
export const EnvironmentDetailDocument = new TypedDocumentString(`
    query EnvironmentDetail($projectId: ULID!, $environmentId: ULID!) {
  environment(projectId: $projectId, environmentId: $environmentId) {
    ...EnvironmentDetailFields
  }
}
    fragment EnvironmentPackageFields on EnvironmentPackageSpec {
  manager
  packages
}
fragment EnvironmentVariableFields on EnvironmentVariablePreview {
  key
  preview
  status
}
fragment EnvironmentDetailFields on EnvironmentDetail {
  allowedHosts
  canDelete
  canEdit
  createdAt
  currentRevisionId
  description
  envVars {
    ...EnvironmentVariableFields
  }
  forkOrigin {
    environmentId
    name
    ownerName
  }
  id
  isBuiltIn
  isDefault
  name
  networkPolicy
  packages {
    ...EnvironmentPackageFields
  }
  setupScript
  updatedAt
  usedByAgentCount
  projectId
}`) as unknown as TypedDocumentString<EnvironmentDetailQuery, EnvironmentDetailQueryVariables>;
export const CreateEnvironmentDocument = new TypedDocumentString(`
    mutation CreateEnvironment($input: CreateEnvironmentInput!) {
  createEnvironment(input: $input) {
    ...EnvironmentSummaryFields
  }
}
    fragment EnvironmentPackageFields on EnvironmentPackageSpec {
  manager
  packages
}
fragment EnvironmentVariableFields on EnvironmentVariablePreview {
  key
  preview
  status
}
fragment EnvironmentSummaryFields on EnvironmentSummary {
  allowedHosts
  canDelete
  canEdit
  createdAt
  currentRevisionId
  description
  envVars {
    ...EnvironmentVariableFields
  }
  forkOrigin {
    environmentId
    name
    ownerName
  }
  id
  isBuiltIn
  isDefault
  name
  networkPolicy
  packages {
    ...EnvironmentPackageFields
  }
  setupScript
  updatedAt
  usedByAgentCount
  projectId
}`) as unknown as TypedDocumentString<CreateEnvironmentMutation, CreateEnvironmentMutationVariables>;
export const UpdateEnvironmentDocument = new TypedDocumentString(`
    mutation UpdateEnvironment($input: UpdateEnvironmentInput!) {
  updateEnvironment(input: $input) {
    ...EnvironmentDetailFields
  }
}
    fragment EnvironmentPackageFields on EnvironmentPackageSpec {
  manager
  packages
}
fragment EnvironmentVariableFields on EnvironmentVariablePreview {
  key
  preview
  status
}
fragment EnvironmentDetailFields on EnvironmentDetail {
  allowedHosts
  canDelete
  canEdit
  createdAt
  currentRevisionId
  description
  envVars {
    ...EnvironmentVariableFields
  }
  forkOrigin {
    environmentId
    name
    ownerName
  }
  id
  isBuiltIn
  isDefault
  name
  networkPolicy
  packages {
    ...EnvironmentPackageFields
  }
  setupScript
  updatedAt
  usedByAgentCount
  projectId
}`) as unknown as TypedDocumentString<UpdateEnvironmentMutation, UpdateEnvironmentMutationVariables>;
export const DeleteEnvironmentDocument = new TypedDocumentString(`
    mutation DeleteEnvironment($input: DeleteEnvironmentInput!) {
  deleteEnvironment(input: $input) {
    ok
  }
}
    `) as unknown as TypedDocumentString<DeleteEnvironmentMutation, DeleteEnvironmentMutationVariables>;
export const SetProjectDefaultEnvironmentDocument = new TypedDocumentString(`
    mutation SetProjectDefaultEnvironment($input: SetProjectDefaultEnvironmentInput!) {
  setProjectDefaultEnvironment(input: $input) {
    ...EnvironmentSummaryFields
  }
}
    fragment EnvironmentPackageFields on EnvironmentPackageSpec {
  manager
  packages
}
fragment EnvironmentVariableFields on EnvironmentVariablePreview {
  key
  preview
  status
}
fragment EnvironmentSummaryFields on EnvironmentSummary {
  allowedHosts
  canDelete
  canEdit
  createdAt
  currentRevisionId
  description
  envVars {
    ...EnvironmentVariableFields
  }
  forkOrigin {
    environmentId
    name
    ownerName
  }
  id
  isBuiltIn
  isDefault
  name
  networkPolicy
  packages {
    ...EnvironmentPackageFields
  }
  setupScript
  updatedAt
  usedByAgentCount
  projectId
}`) as unknown as TypedDocumentString<SetProjectDefaultEnvironmentMutation, SetProjectDefaultEnvironmentMutationVariables>;
export const FileListDocument = new TypedDocumentString(`
    query FileList($input: FileListInput!) {
  fileList(input: $input) {
    files {
      createdAt
      createdBy
      etag
      expiresAt
      id
      mimeType
      name
      path
      sessionKind
      sourcePath
      size
      scope {
        id
        kind
      }
      status
      updatedAt
      version
    }
  }
}
    `) as unknown as TypedDocumentString<FileListQuery, FileListQueryVariables>;
export const McpRegistryDocument = new TypedDocumentString(`
    query McpRegistry($projectId: ULID!) {
  mcpRegistry(projectId: $projectId) {
    projectId
    servers {
      ...McpServerFields
    }
  }
}
    fragment McpCredentialFields on McpCredentialSummary {
  authType
  createdAt
  expiresAt
  id
  scope
  scopeValues
  status
  subjectLabel
  updatedAt
}
fragment McpServerFields on McpServerWithCredential {
  authType
  authorizationState
  createdAt
  credentialScope
  credentialStatus
  description
  enabled
  hasCredential
  iconUrl
  id
  name
  ownerId
  ownerName
  projectId
  source
  updatedAt
  url
  credential {
    ...McpCredentialFields
  }
}`) as unknown as TypedDocumentString<McpRegistryQuery, McpRegistryQueryVariables>;
export const CreateProjectMcpServerDocument = new TypedDocumentString(`
    mutation CreateProjectMcpServer($input: CreateProjectMcpServerInput!) {
  createProjectMcpServer(input: $input) {
    ...McpServerFields
  }
}
    fragment McpCredentialFields on McpCredentialSummary {
  authType
  createdAt
  expiresAt
  id
  scope
  scopeValues
  status
  subjectLabel
  updatedAt
}
fragment McpServerFields on McpServerWithCredential {
  authType
  authorizationState
  createdAt
  credentialScope
  credentialStatus
  description
  enabled
  hasCredential
  iconUrl
  id
  name
  ownerId
  ownerName
  projectId
  source
  updatedAt
  url
  credential {
    ...McpCredentialFields
  }
}`) as unknown as TypedDocumentString<CreateProjectMcpServerMutation, CreateProjectMcpServerMutationVariables>;
export const ConnectMcpBearerDocument = new TypedDocumentString(`
    mutation ConnectMcpBearer($input: ConnectMcpBearerInput!) {
  connectMcpBearer(input: $input) {
    ...McpServerFields
  }
}
    fragment McpCredentialFields on McpCredentialSummary {
  authType
  createdAt
  expiresAt
  id
  scope
  scopeValues
  status
  subjectLabel
  updatedAt
}
fragment McpServerFields on McpServerWithCredential {
  authType
  authorizationState
  createdAt
  credentialScope
  credentialStatus
  description
  enabled
  hasCredential
  iconUrl
  id
  name
  ownerId
  ownerName
  projectId
  source
  updatedAt
  url
  credential {
    ...McpCredentialFields
  }
}`) as unknown as TypedDocumentString<ConnectMcpBearerMutation, ConnectMcpBearerMutationVariables>;
export const RevokeMcpCredentialDocument = new TypedDocumentString(`
    mutation RevokeMcpCredential($projectId: ULID!, $serverId: ULID!) {
  revokeMcpCredential(projectId: $projectId, serverId: $serverId) {
    ...McpServerFields
  }
}
    fragment McpCredentialFields on McpCredentialSummary {
  authType
  createdAt
  expiresAt
  id
  scope
  scopeValues
  status
  subjectLabel
  updatedAt
}
fragment McpServerFields on McpServerWithCredential {
  authType
  authorizationState
  createdAt
  credentialScope
  credentialStatus
  description
  enabled
  hasCredential
  iconUrl
  id
  name
  ownerId
  ownerName
  projectId
  source
  updatedAt
  url
  credential {
    ...McpCredentialFields
  }
}`) as unknown as TypedDocumentString<RevokeMcpCredentialMutation, RevokeMcpCredentialMutationVariables>;
export const SetMcpServerEnabledDocument = new TypedDocumentString(`
    mutation SetMcpServerEnabled($projectId: ULID!, $serverId: ULID!, $enabled: Boolean!) {
  setMcpServerEnabled(
    projectId: $projectId
    serverId: $serverId
    enabled: $enabled
  ) {
    ...McpServerFields
  }
}
    fragment McpCredentialFields on McpCredentialSummary {
  authType
  createdAt
  expiresAt
  id
  scope
  scopeValues
  status
  subjectLabel
  updatedAt
}
fragment McpServerFields on McpServerWithCredential {
  authType
  authorizationState
  createdAt
  credentialScope
  credentialStatus
  description
  enabled
  hasCredential
  iconUrl
  id
  name
  ownerId
  ownerName
  projectId
  source
  updatedAt
  url
  credential {
    ...McpCredentialFields
  }
}`) as unknown as TypedDocumentString<SetMcpServerEnabledMutation, SetMcpServerEnabledMutationVariables>;
export const UpdateProjectMcpServerDocument = new TypedDocumentString(`
    mutation UpdateProjectMcpServer($input: UpdateProjectMcpServerInput!) {
  updateProjectMcpServer(input: $input) {
    ...McpServerFields
  }
}
    fragment McpCredentialFields on McpCredentialSummary {
  authType
  createdAt
  expiresAt
  id
  scope
  scopeValues
  status
  subjectLabel
  updatedAt
}
fragment McpServerFields on McpServerWithCredential {
  authType
  authorizationState
  createdAt
  credentialScope
  credentialStatus
  description
  enabled
  hasCredential
  iconUrl
  id
  name
  ownerId
  ownerName
  projectId
  source
  updatedAt
  url
  credential {
    ...McpCredentialFields
  }
}`) as unknown as TypedDocumentString<UpdateProjectMcpServerMutation, UpdateProjectMcpServerMutationVariables>;
export const DeleteMcpServerDocument = new TypedDocumentString(`
    mutation DeleteMcpServer($projectId: ULID!, $serverId: ULID!) {
  deleteMcpServer(projectId: $projectId, serverId: $serverId) {
    ok
  }
}
    `) as unknown as TypedDocumentString<DeleteMcpServerMutation, DeleteMcpServerMutationVariables>;
export const StartMcpOAuthDocument = new TypedDocumentString(`
    mutation StartMcpOAuth($input: StartMcpOAuthInput!) {
  startMcpOAuth(input: $input) {
    authorizationUrl
    flowId
  }
}
    `) as unknown as TypedDocumentString<StartMcpOAuthMutation, StartMcpOAuthMutationVariables>;
export const McpOAuthFlowStatusDocument = new TypedDocumentString(`
    query McpOAuthFlowStatus($flowId: ULID!) {
  mcpOAuthFlowStatus(flowId: $flowId) {
    authorizationState
    errorMessage
    flowId
    serverId
    status
    subjectLabel
  }
}
    `) as unknown as TypedDocumentString<McpOAuthFlowStatusQuery, McpOAuthFlowStatusQueryVariables>;
export const OnboardingBootstrapDocument = new TypedDocumentString(`
    mutation OnboardingBootstrap($input: BootstrapOnboardingInput!) {
  onboardingBootstrap(input: $input) {
    completed
    organization {
      createdAt
      id
      name
    }
  }
}
    `) as unknown as TypedDocumentString<OnboardingBootstrapMutation, OnboardingBootstrapMutationVariables>;
export const RenameOrganizationDocument = new TypedDocumentString(`
    mutation RenameOrganization($input: RenameOrganizationInput!) {
  renameOrganization(input: $input) {
    createdAt
    id
    name
  }
}
    `) as unknown as TypedDocumentString<RenameOrganizationMutation, RenameOrganizationMutationVariables>;
export const ProjectListDocument = new TypedDocumentString(`
    query ProjectList($organizationId: ULID!) {
  projectList(organizationId: $organizationId) {
    ...ProjectFields
  }
}
    fragment ProjectFields on Project {
  createdAt
  defaultEnvironmentId
  id
  name
  ownerAccountId
}`) as unknown as TypedDocumentString<ProjectListQuery, ProjectListQueryVariables>;
export const CreateProjectDocument = new TypedDocumentString(`
    mutation CreateProject($input: CreateProjectInput!) {
  createProject(input: $input) {
    ...ProjectFields
  }
}
    fragment ProjectFields on Project {
  createdAt
  defaultEnvironmentId
  id
  name
  ownerAccountId
}`) as unknown as TypedDocumentString<CreateProjectMutation, CreateProjectMutationVariables>;
export const RenameProjectDocument = new TypedDocumentString(`
    mutation RenameProject($input: RenameProjectInput!) {
  renameProject(input: $input) {
    ...ProjectFields
  }
}
    fragment ProjectFields on Project {
  createdAt
  defaultEnvironmentId
  id
  name
  ownerAccountId
}`) as unknown as TypedDocumentString<RenameProjectMutation, RenameProjectMutationVariables>;
export const AgentSessionDiagnosticsDocument = new TypedDocumentString(`
    query AgentSessionDiagnostics($projectId: ULID!, $sessionId: ULID!) {
  agentSessionDiagnostics(projectId: $projectId, sessionId: $sessionId) {
    execution {
      binding {
        deploymentVersionId
        deploymentVersionNumber
        model
        provider
        runtimeId
        sessionId
      }
      skills {
        skillId
        skillName
      }
      tools {
        credentialMode
        serverId
      }
    }
    generatedAt
    nativeRuntimeRef {
      kind
      runtimeId
      status
      valuePreview
    }
    session {
      deploymentVersionId
      deploymentVersionNumber
      id
      lastRun {
        deploymentVersionId
        deploymentVersionNumber
        id
        model
        provider
        status
        traceId
      }
      model
      provider
      runtimeId
      status
      title
    }
  }
}
    `) as unknown as TypedDocumentString<AgentSessionDiagnosticsQuery, AgentSessionDiagnosticsQueryVariables>;
export const CreateAgentSessionDocument = new TypedDocumentString(`
    mutation CreateAgentSession($input: CreateAgentSessionInput!) {
  createAgentSession(input: $input) {
    ...SessionFields
  }
}
    fragment SessionFields on Session {
  agentId
  archivedAt
  createdAt
  deploymentVersionId
  deploymentVersionNumber
  id
  lastMessageAt
  lastRun {
    completedAt
    createdAt
    deploymentVersionId
    deploymentVersionNumber
    error {
      code
      details
      message
      retryable
    }
    id
    model
    provider
    startedAt
    status
    traceId
    trigger
    updatedAt
  }
  model
  provider
  projectId
  runtimeId
  status
  title
  type
  updatedAt
}`) as unknown as TypedDocumentString<CreateAgentSessionMutation, CreateAgentSessionMutationVariables>;
export const AgentSessionListDocument = new TypedDocumentString(`
    query AgentSessionList($agentId: ULID!, $archived: Boolean, $projectId: ULID!, $sessionId: ULID, $type: SessionType) {
  agentSessionList(
    agentId: $agentId
    archived: $archived
    projectId: $projectId
    sessionId: $sessionId
    type: $type
  ) {
    nodes {
      ...SessionFields
    }
  }
}
    fragment SessionFields on Session {
  agentId
  archivedAt
  createdAt
  deploymentVersionId
  deploymentVersionNumber
  id
  lastMessageAt
  lastRun {
    completedAt
    createdAt
    deploymentVersionId
    deploymentVersionNumber
    error {
      code
      details
      message
      retryable
    }
    id
    model
    provider
    startedAt
    status
    traceId
    trigger
    updatedAt
  }
  model
  provider
  projectId
  runtimeId
  status
  title
  type
  updatedAt
}`) as unknown as TypedDocumentString<AgentSessionListQuery, AgentSessionListQueryVariables>;
export const ThreadSessionMessagesDocument = new TypedDocumentString(`
    query ThreadSessionMessages($projectId: ULID!, $sessionId: ULID!) {
  threadSessionMessages(projectId: $projectId, sessionId: $sessionId) {
    content
    createdAt
    createdBy
    id
    plan {
      content
      priority
      status
    }
    role
    segments {
      argsText
      kind
      output
      path
      text
      tool
      toolCallId
    }
  }
}
    `) as unknown as TypedDocumentString<ThreadSessionMessagesQuery, ThreadSessionMessagesQueryVariables>;
export const SendAgentSessionEventsDocument = new TypedDocumentString(`
    mutation SendAgentSessionEvents($projectId: ULID!, $sessionId: ULID!, $events: [AgentSessionEventInput!]!) {
  sendAgentSessionEvents(
    projectId: $projectId
    sessionId: $sessionId
    events: $events
  ) {
    acceptedAt
    warnings {
      code
      message
    }
  }
}
    `) as unknown as TypedDocumentString<SendAgentSessionEventsMutation, SendAgentSessionEventsMutationVariables>;
export const PrewarmAgentSessionDocument = new TypedDocumentString(`
    mutation PrewarmAgentSession($projectId: ULID!, $sessionId: ULID!) {
  prewarmAgentSession(projectId: $projectId, sessionId: $sessionId) {
    scheduledAt
    sessionId
  }
}
    `) as unknown as TypedDocumentString<PrewarmAgentSessionMutation, PrewarmAgentSessionMutationVariables>;
export const ThreadAgentSessionListDocument = new TypedDocumentString(`
    query ThreadAgentSessionList($projectId: ULID!, $archived: Boolean, $beforeCursor: String, $type: SessionType) {
  threadAgentSessionList(
    projectId: $projectId
    archived: $archived
    beforeCursor: $beforeCursor
    type: $type
  ) {
    nodes {
      capabilities {
        action
        reason
        status
      }
      session {
        ...SessionFields
      }
    }
    pageInfo {
      endCursor
      hasMore
    }
  }
}
    fragment SessionFields on Session {
  agentId
  archivedAt
  createdAt
  deploymentVersionId
  deploymentVersionNumber
  id
  lastMessageAt
  lastRun {
    completedAt
    createdAt
    deploymentVersionId
    deploymentVersionNumber
    error {
      code
      details
      message
      retryable
    }
    id
    model
    provider
    startedAt
    status
    traceId
    trigger
    updatedAt
  }
  model
  provider
  projectId
  runtimeId
  status
  title
  type
  updatedAt
}`) as unknown as TypedDocumentString<ThreadAgentSessionListQuery, ThreadAgentSessionListQueryVariables>;
export const ArchiveSessionDocument = new TypedDocumentString(`
    mutation ArchiveSession($projectId: ULID!, $sessionId: ULID!) {
  archiveAgentSession(projectId: $projectId, sessionId: $sessionId) {
    ok
  }
}
    `) as unknown as TypedDocumentString<ArchiveSessionMutation, ArchiveSessionMutationVariables>;
export const RestoreSessionDocument = new TypedDocumentString(`
    mutation RestoreSession($projectId: ULID!, $sessionId: ULID!) {
  unarchiveAgentSession(projectId: $projectId, sessionId: $sessionId) {
    ok
  }
}
    `) as unknown as TypedDocumentString<RestoreSessionMutation, RestoreSessionMutationVariables>;
export const DeleteAgentSessionDocument = new TypedDocumentString(`
    mutation DeleteAgentSession($projectId: ULID!, $sessionId: ULID!) {
  deleteAgentSession(projectId: $projectId, sessionId: $sessionId) {
    ok
  }
}
    `) as unknown as TypedDocumentString<DeleteAgentSessionMutation, DeleteAgentSessionMutationVariables>;
export const AddSessionResourceDocument = new TypedDocumentString(`
    mutation AddSessionResource($input: AddSessionResourceInput!) {
  addSessionResource(input: $input) {
    contentType
    expectedSize
    expiresAt
    fileId
    partSize
    path
    status
    strategy
  }
}
    `) as unknown as TypedDocumentString<AddSessionResourceMutation, AddSessionResourceMutationVariables>;
export const RestartSessionDriverDocument = new TypedDocumentString(`
    mutation RestartSessionDriver($projectId: ULID!, $sessionId: ULID!) {
  restartSessionDriver(projectId: $projectId, sessionId: $sessionId) {
    ok
    sessionId
  }
}
    `) as unknown as TypedDocumentString<RestartSessionDriverMutation, RestartSessionDriverMutationVariables>;
export const RecreateSessionSandboxDocument = new TypedDocumentString(`
    mutation RecreateSessionSandbox($projectId: ULID!, $sessionId: ULID!) {
  recreateSessionSandbox(projectId: $projectId, sessionId: $sessionId) {
    ok
    sessionId
  }
}
    `) as unknown as TypedDocumentString<RecreateSessionSandboxMutation, RecreateSessionSandboxMutationVariables>;
export const SessionProcessEventsDocument = new TypedDocumentString(`
    query SessionProcessEvents($limit: Int!, $projectId: ULID!, $sessionId: ULID!) {
  threadSessionProcessEvents(
    limit: $limit
    projectId: $projectId
    sessionId: $sessionId
  ) {
    content
    durationMs
    id
    occurredAt
    status
    tokens
    type
  }
}
    `) as unknown as TypedDocumentString<SessionProcessEventsQuery, SessionProcessEventsQueryVariables>;
export const SkillDetailDocument = new TypedDocumentString(`
    query SkillDetail($projectId: ULID!, $skillId: ULID!) {
  skillDetail(projectId: $projectId, skillId: $skillId) {
    ...SkillDetailFields
  }
}
    fragment SkillDetailFields on SkillDetail {
  author
  createdAt
  description
  fileCount
  forkOrigin {
    name
    ownerName
    skillId
  }
  id
  name
  ownerId
  ownerName
  projectId
  snapshotId
  updatedAt
  currentSnapshot {
    archiveFormat
    author
    blobKey
    blobSha256
    blobSize
    compression
    createdAt
    description
    id
    name
    skillMarkdownPath
    uncompressedSize
    version
  }
  entries {
    entryKind
    isExecutable
    mimeType
    path
    sha256
    size
  }
}`) as unknown as TypedDocumentString<SkillDetailQuery, SkillDetailQueryVariables>;
export const ProjectSkillsDocument = new TypedDocumentString(`
    query ProjectSkills($projectId: ULID!) {
  projectSkillList(projectId: $projectId) {
    ...SkillSummaryFields
  }
}
    fragment SkillSummaryFields on SkillSummary {
  author
  createdAt
  description
  fileCount
  forkOrigin {
    name
    ownerName
    skillId
  }
  id
  name
  ownerId
  ownerName
  projectId
  snapshotId
  updatedAt
}`) as unknown as TypedDocumentString<ProjectSkillsQuery, ProjectSkillsQueryVariables>;
export const CreateSkillForkDocument = new TypedDocumentString(`
    mutation CreateSkillFork($input: CreateSkillForkInput!) {
  createSkillFork(input: $input) {
    ...SkillSummaryFields
  }
}
    fragment SkillSummaryFields on SkillSummary {
  author
  createdAt
  description
  fileCount
  forkOrigin {
    name
    ownerName
    skillId
  }
  id
  name
  ownerId
  ownerName
  projectId
  snapshotId
  updatedAt
}`) as unknown as TypedDocumentString<CreateSkillForkMutation, CreateSkillForkMutationVariables>;
export const DeleteOwnedSkillDocument = new TypedDocumentString(`
    mutation DeleteOwnedSkill($projectId: ULID!, $skillId: ULID!) {
  deleteOwnedSkill(projectId: $projectId, skillId: $skillId) {
    ok
  }
}
    `) as unknown as TypedDocumentString<DeleteOwnedSkillMutation, DeleteOwnedSkillMutationVariables>;
export const ViewerDocument = new TypedDocumentString(`
    query Viewer {
  viewer {
    account {
      email
      id
      imageUrl
      name
    }
    activeOrganization {
      createdAt
      id
      name
    }
    organizations {
      createdAt
      id
      name
    }
  }
}
    `) as unknown as TypedDocumentString<ViewerQuery, ViewerQueryVariables>;
export const UpdateProfileDocument = new TypedDocumentString(`
    mutation UpdateProfile($input: UpdateAccountProfileInput!) {
  updateProfile(input: $input) {
    imageUrl
    name
  }
}
    `) as unknown as TypedDocumentString<UpdateProfileMutation, UpdateProfileMutationVariables>;
export const VendorCredentialListDocument = new TypedDocumentString(`
    query VendorCredentialList($projectId: ULID!) {
  vendorCredentialList(projectId: $projectId) {
    ...VendorCredentialFields
  }
}
    fragment VendorCredentialFields on VendorCredential {
  apiBase
  id
  isDefault
  maskedApiKey
  modelProtocol
  models
  name
  projectId
  vendorId
}`) as unknown as TypedDocumentString<VendorCredentialListQuery, VendorCredentialListQueryVariables>;
export const CreateVendorCredentialDocument = new TypedDocumentString(`
    mutation CreateVendorCredential($input: CreateVendorCredentialInput!) {
  createVendorCredential(input: $input) {
    ...VendorCredentialFields
  }
}
    fragment VendorCredentialFields on VendorCredential {
  apiBase
  id
  isDefault
  maskedApiKey
  modelProtocol
  models
  name
  projectId
  vendorId
}`) as unknown as TypedDocumentString<CreateVendorCredentialMutation, CreateVendorCredentialMutationVariables>;
export const UpdateVendorCredentialDocument = new TypedDocumentString(`
    mutation UpdateVendorCredential($input: UpdateVendorCredentialInput!) {
  updateVendorCredential(input: $input) {
    ...VendorCredentialFields
  }
}
    fragment VendorCredentialFields on VendorCredential {
  apiBase
  id
  isDefault
  maskedApiKey
  modelProtocol
  models
  name
  projectId
  vendorId
}`) as unknown as TypedDocumentString<UpdateVendorCredentialMutation, UpdateVendorCredentialMutationVariables>;
export const DeleteVendorCredentialDocument = new TypedDocumentString(`
    mutation DeleteVendorCredential($input: DeleteVendorCredentialInput!) {
  deleteVendorCredential(input: $input) {
    ok
  }
}
    `) as unknown as TypedDocumentString<DeleteVendorCredentialMutation, DeleteVendorCredentialMutationVariables>;
export const SetDefaultVendorCredentialDocument = new TypedDocumentString(`
    mutation SetDefaultVendorCredential($input: SetDefaultVendorCredentialInput!) {
  setDefaultVendorCredential(input: $input) {
    ...VendorCredentialFields
  }
}
    fragment VendorCredentialFields on VendorCredential {
  apiBase
  id
  isDefault
  maskedApiKey
  modelProtocol
  models
  name
  projectId
  vendorId
}`) as unknown as TypedDocumentString<SetDefaultVendorCredentialMutation, SetDefaultVendorCredentialMutationVariables>;
export const AvailableAgentModelsDocument = new TypedDocumentString(`
    query AvailableAgentModels($projectId: ULID!, $runtimeId: String!, $currentModelId: String, $currentVendorId: String) {
  availableAgentModels(
    projectId: $projectId
    runtimeId: $runtimeId
    currentModelId: $currentModelId
    currentVendorId: $currentVendorId
  ) {
    available
    displayName
    modelId
    modelProtocol
    reason
    source
    statusDetail
    statusLabel
    vendorId
    vendorLabel
  }
}
    `) as unknown as TypedDocumentString<AvailableAgentModelsQuery, AvailableAgentModelsQueryVariables>;
export const TestVendorCredentialDocument = new TypedDocumentString(`
    mutation TestVendorCredential($input: TestVendorCredentialInput!) {
  testVendorCredential(input: $input) {
    errorCode
    latencyMs
    ok
  }
}
    `) as unknown as TypedDocumentString<TestVendorCredentialMutation, TestVendorCredentialMutationVariables>;
