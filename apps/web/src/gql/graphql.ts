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
  | 'list_session_resources'
  | 'permission_decision'
  | 'remove_session_resource'
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

export type AgentSessionRecoverabilityStatus =
  | 'not_recoverable'
  | 'read_only'
  | 'resumable';

export type AgentSkillState =
  | 'active'
  | 'tombstone';

export type AgentStatus =
  | 'draft'
  | 'published';

export type AgentViewerRole =
  | 'none'
  | 'owner';

export type AgentVisibility =
  | 'private';

export type AuthMethod =
  | 'email_otp'
  | 'google_oauth';

export type AuthSecurityLevel =
  | 'basic'
  | 'strong'
  | 'verified_email';

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
  | 'eval'
  | 'preview'
  | 'production'
  | 'scheduled';

export type CreateAgentForkInput = {
  agentId: PlatformId;
  kind?: AgentKind | null | undefined;
  projectId: PlatformId;
};

export type CreateAgentInput = {
  description?: string | null | undefined;
  kind: AgentKind;
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
  waitForRuntimeReady?: boolean | null | undefined;
};

export type CreateEnvironmentInput = {
  allowMcpServers: boolean;
  allowPackageManagers: boolean;
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

export type EnvironmentRegistryRole =
  | 'owner';

export type EnvironmentVariableInput = {
  key: string;
  value?: string | null | undefined;
};

export type EnvironmentVariableStatus =
  | 'configured'
  | 'pending';

export type FileListInput = {
  projectId: PlatformId;
  scopeId?: PlatformId | null | undefined;
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

export type RenameSessionInput = {
  projectId: PlatformId;
  sessionId: PlatformId;
  title: string;
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

export type RuntimeStateOperation =
  | 'recreateSandbox'
  | 'resetAgentState'
  | 'restartDriver';

export type RuntimeStateOperationInput = {
  affectedFields?: Array<string> | null | undefined;
  agentId: PlatformId;
  applyActionKind?: string | null | undefined;
  projectId: PlatformId;
  targetVersion?: RuntimeStateTargetVersionInput | null | undefined;
};

export type RuntimeStateTargetVersionInput = {
  id: PlatformId;
  versionNumber: number;
};

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

export type SkillSourceKind =
  | 'official'
  | 'user';

export type StartMcpOAuthInput = {
  projectId: PlatformId;
  returnUrl?: string | null | undefined;
  serverId: PlatformId;
};

export type TestVendorCredentialInput = {
  apiBase?: string | null | undefined;
  apiKey: string;
  modelId?: string | null | undefined;
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
  kind: AgentKind;
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
  allowMcpServers: boolean;
  allowPackageManagers: boolean;
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
  models?: Array<string> | null | undefined;
  name?: string | null | undefined;
  projectId: PlatformId;
};

export type AgentFieldsFragment = { createdAt: string, description: string | null, id: PlatformId, kind: AgentKind, model: string, name: string, projectId: PlatformId, prompt: string, provider: string, runtimeId: string, status: AgentStatus, updatedAt: string, visibility: AgentVisibility, liveVersion: { agentId: PlatformId, createdAt: string, createdByAccountId: PlatformId, environmentId: PlatformId | null, id: PlatformId, isLive: boolean, kind: AgentKind, model: string, provider: string, runtimeId: string, summary: string, versionNumber: number } | null, skills: Array<{ ownerName: string | null, skillId: PlatformId, skillName: string, state: AgentSkillState }> };

export type AgentToolSummaryFieldsFragment = { enabled: boolean, iconUrl: string | null, name: string, serverId: PlatformId };

export type AgentDeploymentVersionFieldsFragment = { agentId: PlatformId, createdAt: string, createdByAccountId: PlatformId, environmentId: PlatformId | null, id: PlatformId, isLive: boolean, kind: AgentKind, model: string, provider: string, runtimeId: string, summary: string, versionNumber: number };

export type AgentOwnerFieldsFragment = { id: PlatformId, imageUrl: string | null, name: string | null };

export type CreateAgentMutationVariables = Exact<{
  input: CreateAgentInput;
}>;


export type CreateAgentMutation = { createAgent: { createdAt: string, description: string | null, id: PlatformId, kind: AgentKind, model: string, name: string, projectId: PlatformId, prompt: string, provider: string, runtimeId: string, status: AgentStatus, updatedAt: string, visibility: AgentVisibility, liveVersion: { agentId: PlatformId, createdAt: string, createdByAccountId: PlatformId, environmentId: PlatformId | null, id: PlatformId, isLive: boolean, kind: AgentKind, model: string, provider: string, runtimeId: string, summary: string, versionNumber: number } | null, skills: Array<{ ownerName: string | null, skillId: PlatformId, skillName: string, state: AgentSkillState }> } };

export type DeleteAgentMutationVariables = Exact<{
  input: DeleteAgentInput;
}>;


export type DeleteAgentMutation = { deleteAgent: { ok: boolean } };

export type AccessibleAgentsQueryVariables = Exact<{
  projectId: PlatformId;
}>;


export type AccessibleAgentsQuery = { accessibleAgentList: Array<{ createdAt: string, description: string | null, id: PlatformId, kind: AgentKind, name: string, projectId: PlatformId, runtimeId: string, status: AgentStatus, updatedAt: string, viewerRole: AgentViewerRole, visibility: AgentVisibility, owner: { id: PlatformId, imageUrl: string | null, name: string | null }, tools: Array<{ enabled: boolean, iconUrl: string | null, name: string, serverId: PlatformId }> }> };

export type AgentQueryVariables = Exact<{
  agentId: PlatformId;
  projectId: PlatformId;
}>;


export type AgentQuery = { agent: { createdAt: string, description: string | null, id: PlatformId, kind: AgentKind, model: string, name: string, projectId: PlatformId, prompt: string, provider: string, runtimeId: string, status: AgentStatus, updatedAt: string, viewerRole: AgentViewerRole, visibility: AgentVisibility, liveVersion: { agentId: PlatformId, createdAt: string, createdByAccountId: PlatformId, environmentId: PlatformId | null, id: PlatformId, isLive: boolean, kind: AgentKind, model: string, provider: string, runtimeId: string, summary: string, versionNumber: number } | null, owner: { id: PlatformId, imageUrl: string | null, name: string | null }, skills: Array<{ ownerName: string | null, skillId: PlatformId, skillName: string, state: AgentSkillState }>, tools: Array<{ enabled: boolean, iconUrl: string | null, name: string, serverId: PlatformId }>, versions: Array<{ agentId: PlatformId, createdAt: string, createdByAccountId: PlatformId, environmentId: PlatformId | null, id: PlatformId, isLive: boolean, kind: AgentKind, model: string, provider: string, runtimeId: string, summary: string, versionNumber: number }> } };

export type AgentEditorStateQueryVariables = Exact<{
  agentId: PlatformId;
  projectId: PlatformId;
}>;


export type AgentEditorStateQuery = { agentEditorState: { id: PlatformId, providerOptions: JsonObject, builtInTools: Array<{ enabled: boolean, name: AgentBuiltInToolName }>, environment: { environmentId: PlatformId | null }, packageResolution: { recordedAt: string, source: AgentPackageResolutionSource, report: { issues: Array<{ actionLabel: string | null, code: string, message: string, required: boolean, severity: AgentResolutionSeverity, status: AgentResolutionStatus, targetLabel: string | null, targetType: AgentResolutionTargetType }>, summary: { boundMcpServerCount: number, boundSkillCount: number, copiedAssetCount: number, createdMcpServerCount: number, reusedMcpServerCount: number } } } | null, mcpBindings: Array<{ authType: McpAuthType, authorizationState: McpAuthorizationState, createdAt: string, credentialMode: AgentMcpCredentialMode, credentialScope: McpCredentialScope, credentialStatus: McpCredentialStatus, credentialSubject: string | null, enabled: boolean, hasCredential: boolean, iconUrl: string | null, id: PlatformId, name: string, serverId: PlatformId, source: McpServerSource, updatedAt: string, url: string }>, readiness: { checkedAt: string, ready: boolean, issues: Array<{ code: string, message: string, severity: AgentReadinessSeverity }> } } };

export type UpdateAgentConfigMutationVariables = Exact<{
  input: UpdateAgentConfigInput;
}>;


export type UpdateAgentConfigMutation = { updateAgentConfig: { createdAt: string, description: string | null, id: PlatformId, kind: AgentKind, model: string, name: string, projectId: PlatformId, prompt: string, provider: string, runtimeId: string, status: AgentStatus, updatedAt: string, visibility: AgentVisibility, liveVersion: { agentId: PlatformId, createdAt: string, createdByAccountId: PlatformId, environmentId: PlatformId | null, id: PlatformId, isLive: boolean, kind: AgentKind, model: string, provider: string, runtimeId: string, summary: string, versionNumber: number } | null, skills: Array<{ ownerName: string | null, skillId: PlatformId, skillName: string, state: AgentSkillState }> } };

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


export type ImportAgentPackageMutation = { importAgentPackage: { agent: { createdAt: string, description: string | null, id: PlatformId, kind: AgentKind, model: string, name: string, projectId: PlatformId, prompt: string, provider: string, runtimeId: string, status: AgentStatus, updatedAt: string, visibility: AgentVisibility, liveVersion: { agentId: PlatformId, createdAt: string, createdByAccountId: PlatformId, environmentId: PlatformId | null, id: PlatformId, isLive: boolean, kind: AgentKind, model: string, provider: string, runtimeId: string, summary: string, versionNumber: number } | null, skills: Array<{ ownerName: string | null, skillId: PlatformId, skillName: string, state: AgentSkillState }> }, resolution: { issues: Array<{ actionLabel: string | null, code: string, message: string, required: boolean, severity: AgentResolutionSeverity, status: AgentResolutionStatus, targetLabel: string | null, targetType: AgentResolutionTargetType }>, summary: { boundMcpServerCount: number, boundSkillCount: number, copiedAssetCount: number, createdMcpServerCount: number, reusedMcpServerCount: number } } } };

export type CreateAgentForkMutationVariables = Exact<{
  input: CreateAgentForkInput;
}>;


export type CreateAgentForkMutation = { createAgentFork: { agent: { createdAt: string, description: string | null, id: PlatformId, kind: AgentKind, model: string, name: string, projectId: PlatformId, prompt: string, provider: string, runtimeId: string, status: AgentStatus, updatedAt: string, visibility: AgentVisibility, liveVersion: { agentId: PlatformId, createdAt: string, createdByAccountId: PlatformId, environmentId: PlatformId | null, id: PlatformId, isLive: boolean, kind: AgentKind, model: string, provider: string, runtimeId: string, summary: string, versionNumber: number } | null, skills: Array<{ ownerName: string | null, skillId: PlatformId, skillName: string, state: AgentSkillState }> }, resolution: { issues: Array<{ actionLabel: string | null, code: string, message: string, required: boolean, severity: AgentResolutionSeverity, status: AgentResolutionStatus, targetLabel: string | null, targetType: AgentResolutionTargetType }>, summary: { boundMcpServerCount: number, boundSkillCount: number, copiedAssetCount: number, createdMcpServerCount: number, reusedMcpServerCount: number } } } };

export type PublishAgentMutationVariables = Exact<{
  input: PublishAgentInput;
}>;


export type PublishAgentMutation = { publishAgent: { createdAt: string, description: string | null, id: PlatformId, kind: AgentKind, model: string, name: string, projectId: PlatformId, prompt: string, provider: string, runtimeId: string, status: AgentStatus, updatedAt: string, visibility: AgentVisibility, liveVersion: { agentId: PlatformId, createdAt: string, createdByAccountId: PlatformId, environmentId: PlatformId | null, id: PlatformId, isLive: boolean, kind: AgentKind, model: string, provider: string, runtimeId: string, summary: string, versionNumber: number } | null, skills: Array<{ ownerName: string | null, skillId: PlatformId, skillName: string, state: AgentSkillState }> } };

export type UnpublishAgentMutationVariables = Exact<{
  agentId: PlatformId;
  projectId: PlatformId;
}>;


export type UnpublishAgentMutation = { unpublishAgent: { createdAt: string, description: string | null, id: PlatformId, kind: AgentKind, model: string, name: string, projectId: PlatformId, prompt: string, provider: string, runtimeId: string, status: AgentStatus, updatedAt: string, visibility: AgentVisibility, liveVersion: { agentId: PlatformId, createdAt: string, createdByAccountId: PlatformId, environmentId: PlatformId | null, id: PlatformId, isLive: boolean, kind: AgentKind, model: string, provider: string, runtimeId: string, summary: string, versionNumber: number } | null, skills: Array<{ ownerName: string | null, skillId: PlatformId, skillName: string, state: AgentSkillState }> } };

export type RestartDriverMutationVariables = Exact<{
  input: RuntimeStateOperationInput;
}>;


export type RestartDriverMutation = { restartDriver: { affectedSessionCount: number, agentId: PlatformId, ok: boolean, operation: RuntimeStateOperation } };

export type RecreateSandboxMutationVariables = Exact<{
  input: RuntimeStateOperationInput;
}>;


export type RecreateSandboxMutation = { recreateSandbox: { affectedSessionCount: number, agentId: PlatformId, ok: boolean, operation: RuntimeStateOperation } };

export type ResetAgentStateMutationVariables = Exact<{
  input: RuntimeStateOperationInput;
}>;


export type ResetAgentStateMutation = { resetAgentState: { affectedSessionCount: number, agentId: PlatformId, ok: boolean, operation: RuntimeStateOperation } };

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

export type CostAgentFieldsFragment = { activeUsers: number, agentId: PlatformId, agentName: string, cacheCreationTokens: number, cacheReadTokens: number, debugCostUsd: number, evalCostUsd: number, inputTokens: number, outputTokens: number, ownerEmail: string | null, ownerId: PlatformId, ownerName: string, previousCostUsd: number | null, previewCostUsd: number, productionCostUsd: number, requestCount: number, scheduledCostUsd: number, totalCostUsd: number, unpricedRequestCount: number };

export type CostModelFieldsFragment = { activeUsers: number, cacheCreationTokens: number, cacheReadTokens: number, cacheReadUsdPerMillion: number | null, cacheWriteUsdPerMillion: number | null, inputTokens: number, inputUsdPerMillion: number | null, model: string, outputTokens: number, outputUsdPerMillion: number | null, provider: string, requestCount: number, totalCostUsd: number, unpricedRequestCount: number, vendor: string };

export type CostRecentSessionFieldsFragment = { actorEmail: string | null, actorName: string, cacheCreationTokens: number, cacheReadTokens: number, createdAt: string, inputTokens: number, model: string, outputTokens: number, provider: string, runPurpose: string, sessionId: PlatformId | null, sessionRunId: PlatformId | null, totalCostUsd: number };

export type CostAttributionFieldsFragment = { agents: Array<{ activeUsers: number, agentId: PlatformId, agentName: string, cacheCreationTokens: number, cacheReadTokens: number, debugCostUsd: number, evalCostUsd: number, inputTokens: number, outputTokens: number, ownerEmail: string | null, ownerId: PlatformId, ownerName: string, previousCostUsd: number | null, previewCostUsd: number, productionCostUsd: number, requestCount: number, scheduledCostUsd: number, totalCostUsd: number, unpricedRequestCount: number }>, daily: Array<{ activeUsers: number, cacheCreationTokens: number, cacheReadTokens: number, date: string, inputTokens: number, outputTokens: number, requestCount: number, totalCostUsd: number, unpricedRequestCount: number }>, models: Array<{ activeUsers: number, cacheCreationTokens: number, cacheReadTokens: number, cacheReadUsdPerMillion: number | null, cacheWriteUsdPerMillion: number | null, inputTokens: number, inputUsdPerMillion: number | null, model: string, outputTokens: number, outputUsdPerMillion: number | null, provider: string, requestCount: number, totalCostUsd: number, unpricedRequestCount: number, vendor: string }>, recentSessions: Array<{ actorEmail: string | null, actorName: string, cacheCreationTokens: number, cacheReadTokens: number, createdAt: string, inputTokens: number, model: string, outputTokens: number, provider: string, runPurpose: string, sessionId: PlatformId | null, sessionRunId: PlatformId | null, totalCostUsd: number }>, totals: { activeUsers: number, cacheCreationTokens: number, cacheReadTokens: number, inputTokens: number, outputTokens: number, requestCount: number, totalCostUsd: number, unpricedRequestCount: number } };

export type ProjectCostCardQueryVariables = Exact<{
  projectId: PlatformId;
  range: CostRange;
  runPurposes?: Array<CostRunPurpose> | null | undefined;
}>;


export type ProjectCostCardQuery = { projectCostCard: { projectId: PlatformId, projectName: string, agents: Array<{ activeUsers: number, agentId: PlatformId, agentName: string, cacheCreationTokens: number, cacheReadTokens: number, debugCostUsd: number, evalCostUsd: number, inputTokens: number, outputTokens: number, ownerEmail: string | null, ownerId: PlatformId, ownerName: string, previousCostUsd: number | null, previewCostUsd: number, productionCostUsd: number, requestCount: number, scheduledCostUsd: number, totalCostUsd: number, unpricedRequestCount: number }>, daily: Array<{ activeUsers: number, cacheCreationTokens: number, cacheReadTokens: number, date: string, inputTokens: number, outputTokens: number, requestCount: number, totalCostUsd: number, unpricedRequestCount: number }>, models: Array<{ activeUsers: number, cacheCreationTokens: number, cacheReadTokens: number, cacheReadUsdPerMillion: number | null, cacheWriteUsdPerMillion: number | null, inputTokens: number, inputUsdPerMillion: number | null, model: string, outputTokens: number, outputUsdPerMillion: number | null, provider: string, requestCount: number, totalCostUsd: number, unpricedRequestCount: number, vendor: string }>, previousTotals: { activeUsers: number, cacheCreationTokens: number, cacheReadTokens: number, inputTokens: number, outputTokens: number, requestCount: number, totalCostUsd: number, unpricedRequestCount: number }, recentSessions: Array<{ actorEmail: string | null, actorName: string, cacheCreationTokens: number, cacheReadTokens: number, createdAt: string, inputTokens: number, model: string, outputTokens: number, provider: string, runPurpose: string, sessionId: PlatformId | null, sessionRunId: PlatformId | null, totalCostUsd: number }>, totals: { activeUsers: number, cacheCreationTokens: number, cacheReadTokens: number, inputTokens: number, outputTokens: number, requestCount: number, totalCostUsd: number, unpricedRequestCount: number } } };

export type AgentCostCardQueryVariables = Exact<{
  projectId: PlatformId;
  agentId: PlatformId;
  range: CostRange;
  runPurposes?: Array<CostRunPurpose> | null | undefined;
}>;


export type AgentCostCardQuery = { agentCostCard: { agentId: PlatformId, agentName: string, ownerId: PlatformId, ownerName: string, agents: Array<{ activeUsers: number, agentId: PlatformId, agentName: string, cacheCreationTokens: number, cacheReadTokens: number, debugCostUsd: number, evalCostUsd: number, inputTokens: number, outputTokens: number, ownerEmail: string | null, ownerId: PlatformId, ownerName: string, previousCostUsd: number | null, previewCostUsd: number, productionCostUsd: number, requestCount: number, scheduledCostUsd: number, totalCostUsd: number, unpricedRequestCount: number }>, daily: Array<{ activeUsers: number, cacheCreationTokens: number, cacheReadTokens: number, date: string, inputTokens: number, outputTokens: number, requestCount: number, totalCostUsd: number, unpricedRequestCount: number }>, models: Array<{ activeUsers: number, cacheCreationTokens: number, cacheReadTokens: number, cacheReadUsdPerMillion: number | null, cacheWriteUsdPerMillion: number | null, inputTokens: number, inputUsdPerMillion: number | null, model: string, outputTokens: number, outputUsdPerMillion: number | null, provider: string, requestCount: number, totalCostUsd: number, unpricedRequestCount: number, vendor: string }>, recentSessions: Array<{ actorEmail: string | null, actorName: string, cacheCreationTokens: number, cacheReadTokens: number, createdAt: string, inputTokens: number, model: string, outputTokens: number, provider: string, runPurpose: string, sessionId: PlatformId | null, sessionRunId: PlatformId | null, totalCostUsd: number }>, totals: { activeUsers: number, cacheCreationTokens: number, cacheReadTokens: number, inputTokens: number, outputTokens: number, requestCount: number, totalCostUsd: number, unpricedRequestCount: number } } };

export type EnvironmentPackageFieldsFragment = { manager: EnvironmentPackageManager, packages: Array<string> };

export type EnvironmentVariableFieldsFragment = { key: string, preview: string, status: EnvironmentVariableStatus };

export type EnvironmentOwnerFieldsFragment = { id: PlatformId | null, imageUrl: string | null, name: string | null };

export type EnvironmentSummaryFieldsFragment = { allowMcpServers: boolean, allowPackageManagers: boolean, allowedHosts: Array<string>, canDelete: boolean, canEdit: boolean, createdAt: string, currentRevisionId: PlatformId, description: string, id: PlatformId, isBuiltIn: boolean, isDefault: boolean, isEditable: boolean, name: string, networkPolicy: EnvironmentNetworkPolicy, role: EnvironmentRegistryRole, setupScript: string, updatedAt: string, usedByAgentCount: number, projectId: PlatformId, envVars: Array<{ key: string, preview: string, status: EnvironmentVariableStatus }>, forkOrigin: { environmentId: PlatformId, name: string, ownerName: string } | null, owner: { id: PlatformId | null, imageUrl: string | null, name: string | null }, packages: Array<{ manager: EnvironmentPackageManager, packages: Array<string> }> };

export type EnvironmentDetailFieldsFragment = { allowMcpServers: boolean, allowPackageManagers: boolean, allowedHosts: Array<string>, canDelete: boolean, canEdit: boolean, createdAt: string, currentRevisionId: PlatformId, description: string, id: PlatformId, isBuiltIn: boolean, isDefault: boolean, isEditable: boolean, name: string, networkPolicy: EnvironmentNetworkPolicy, role: EnvironmentRegistryRole, setupScript: string, updatedAt: string, usedByAgentCount: number, projectId: PlatformId, envVars: Array<{ key: string, preview: string, status: EnvironmentVariableStatus }>, forkOrigin: { environmentId: PlatformId, name: string, ownerName: string } | null, owner: { id: PlatformId | null, imageUrl: string | null, name: string | null }, packages: Array<{ manager: EnvironmentPackageManager, packages: Array<string> }> };

export type ProjectEnvironmentsQueryVariables = Exact<{
  projectId: PlatformId;
}>;


export type ProjectEnvironmentsQuery = { projectEnvironmentList: Array<{ allowMcpServers: boolean, allowPackageManagers: boolean, allowedHosts: Array<string>, canDelete: boolean, canEdit: boolean, createdAt: string, currentRevisionId: PlatformId, description: string, id: PlatformId, isBuiltIn: boolean, isDefault: boolean, isEditable: boolean, name: string, networkPolicy: EnvironmentNetworkPolicy, role: EnvironmentRegistryRole, setupScript: string, updatedAt: string, usedByAgentCount: number, projectId: PlatformId, envVars: Array<{ key: string, preview: string, status: EnvironmentVariableStatus }>, forkOrigin: { environmentId: PlatformId, name: string, ownerName: string } | null, owner: { id: PlatformId | null, imageUrl: string | null, name: string | null }, packages: Array<{ manager: EnvironmentPackageManager, packages: Array<string> }> }> };

export type EnvironmentDetailQueryVariables = Exact<{
  projectId: PlatformId;
  environmentId: PlatformId;
}>;


export type EnvironmentDetailQuery = { environment: { allowMcpServers: boolean, allowPackageManagers: boolean, allowedHosts: Array<string>, canDelete: boolean, canEdit: boolean, createdAt: string, currentRevisionId: PlatformId, description: string, id: PlatformId, isBuiltIn: boolean, isDefault: boolean, isEditable: boolean, name: string, networkPolicy: EnvironmentNetworkPolicy, role: EnvironmentRegistryRole, setupScript: string, updatedAt: string, usedByAgentCount: number, projectId: PlatformId, envVars: Array<{ key: string, preview: string, status: EnvironmentVariableStatus }>, forkOrigin: { environmentId: PlatformId, name: string, ownerName: string } | null, owner: { id: PlatformId | null, imageUrl: string | null, name: string | null }, packages: Array<{ manager: EnvironmentPackageManager, packages: Array<string> }> } };

export type CreateEnvironmentMutationVariables = Exact<{
  input: CreateEnvironmentInput;
}>;


export type CreateEnvironmentMutation = { createEnvironment: { allowMcpServers: boolean, allowPackageManagers: boolean, allowedHosts: Array<string>, canDelete: boolean, canEdit: boolean, createdAt: string, currentRevisionId: PlatformId, description: string, id: PlatformId, isBuiltIn: boolean, isDefault: boolean, isEditable: boolean, name: string, networkPolicy: EnvironmentNetworkPolicy, role: EnvironmentRegistryRole, setupScript: string, updatedAt: string, usedByAgentCount: number, projectId: PlatformId, envVars: Array<{ key: string, preview: string, status: EnvironmentVariableStatus }>, forkOrigin: { environmentId: PlatformId, name: string, ownerName: string } | null, owner: { id: PlatformId | null, imageUrl: string | null, name: string | null }, packages: Array<{ manager: EnvironmentPackageManager, packages: Array<string> }> } };

export type UpdateEnvironmentMutationVariables = Exact<{
  input: UpdateEnvironmentInput;
}>;


export type UpdateEnvironmentMutation = { updateEnvironment: { allowMcpServers: boolean, allowPackageManagers: boolean, allowedHosts: Array<string>, canDelete: boolean, canEdit: boolean, createdAt: string, currentRevisionId: PlatformId, description: string, id: PlatformId, isBuiltIn: boolean, isDefault: boolean, isEditable: boolean, name: string, networkPolicy: EnvironmentNetworkPolicy, role: EnvironmentRegistryRole, setupScript: string, updatedAt: string, usedByAgentCount: number, projectId: PlatformId, envVars: Array<{ key: string, preview: string, status: EnvironmentVariableStatus }>, forkOrigin: { environmentId: PlatformId, name: string, ownerName: string } | null, owner: { id: PlatformId | null, imageUrl: string | null, name: string | null }, packages: Array<{ manager: EnvironmentPackageManager, packages: Array<string> }> } };

export type DeleteEnvironmentMutationVariables = Exact<{
  input: DeleteEnvironmentInput;
}>;


export type DeleteEnvironmentMutation = { deleteEnvironment: { ok: boolean } };

export type SetProjectDefaultEnvironmentMutationVariables = Exact<{
  input: SetProjectDefaultEnvironmentInput;
}>;


export type SetProjectDefaultEnvironmentMutation = { setProjectDefaultEnvironment: { allowMcpServers: boolean, allowPackageManagers: boolean, allowedHosts: Array<string>, canDelete: boolean, canEdit: boolean, createdAt: string, currentRevisionId: PlatformId, description: string, id: PlatformId, isBuiltIn: boolean, isDefault: boolean, isEditable: boolean, name: string, networkPolicy: EnvironmentNetworkPolicy, role: EnvironmentRegistryRole, setupScript: string, updatedAt: string, usedByAgentCount: number, projectId: PlatformId, envVars: Array<{ key: string, preview: string, status: EnvironmentVariableStatus }>, forkOrigin: { environmentId: PlatformId, name: string, ownerName: string } | null, owner: { id: PlatformId | null, imageUrl: string | null, name: string | null }, packages: Array<{ manager: EnvironmentPackageManager, packages: Array<string> }> } };

export type FileListQueryVariables = Exact<{
  input: FileListInput;
}>;


export type FileListQuery = { fileList: { files: Array<{ createdAt: string, createdBy: PlatformId, etag: string | null, expiresAt: string | null, id: PlatformId, mimeType: string | null, name: string, path: string, sessionKind: FileSessionKind | null, sourcePath: string | null, size: number, status: string, updatedAt: string, version: number, scope: { id: PlatformId | null, kind: FileScopeKind } }> } };

export type McpCredentialFieldsFragment = { authType: McpAuthType, createdAt: string, expiresAt: string | null, id: PlatformId, scope: McpCredentialRecordScope, scopeValues: Array<string>, status: McpCredentialStatus, subjectLabel: string | null, updatedAt: string };

export type McpServerFieldsFragment = { authType: McpAuthType, authorizationState: McpAuthorizationState, createdAt: string, credentialScope: McpCredentialScope, credentialStatus: McpCredentialStatus, description: string | null, enabled: boolean, hasCredential: boolean, iconUrl: string | null, id: PlatformId, name: string, ownerId: PlatformId, ownerName: string, projectId: PlatformId, source: McpServerSource, updatedAt: string, url: string, credential: { authType: McpAuthType, createdAt: string, expiresAt: string | null, id: PlatformId, scope: McpCredentialRecordScope, scopeValues: Array<string>, status: McpCredentialStatus, subjectLabel: string | null, updatedAt: string } | null };

export type McpRegistryQueryVariables = Exact<{
  projectId: PlatformId;
}>;


export type McpRegistryQuery = { mcpRegistry: { currentUserEmail: string, currentUserId: PlatformId, currentUserName: string, projectId: PlatformId, servers: Array<{ authType: McpAuthType, authorizationState: McpAuthorizationState, createdAt: string, credentialScope: McpCredentialScope, credentialStatus: McpCredentialStatus, description: string | null, enabled: boolean, hasCredential: boolean, iconUrl: string | null, id: PlatformId, name: string, ownerId: PlatformId, ownerName: string, projectId: PlatformId, source: McpServerSource, updatedAt: string, url: string, credential: { authType: McpAuthType, createdAt: string, expiresAt: string | null, id: PlatformId, scope: McpCredentialRecordScope, scopeValues: Array<string>, status: McpCredentialStatus, subjectLabel: string | null, updatedAt: string } | null }> } };

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


export type OnboardingBootstrapMutation = { onboardingBootstrap: { completed: boolean, organization: { avatarUrl: string | null, createdAt: string, id: PlatformId, name: string } | null } };

export type RenameOrganizationMutationVariables = Exact<{
  input: RenameOrganizationInput;
}>;


export type RenameOrganizationMutation = { renameOrganization: { avatarUrl: string | null, createdAt: string, id: PlatformId, name: string } };

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

export type ThreadAgentSessionRetrieveQueryVariables = Exact<{
  projectId: PlatformId;
  sessionId: PlatformId;
}>;


export type ThreadAgentSessionRetrieveQuery = { threadAgentSessionRetrieve: { capabilities: Array<{ action: AgentSessionActionCapabilityName, reason: string | null, status: AgentSessionActionCapabilityStatus }>, recoverability: { reason: string | null, status: AgentSessionRecoverabilityStatus }, taskSnapshot: { runId: PlatformId, tasks: Array<{ taskId: string, taskType: string | null, title: string | null }> } | null, session: { agentId: PlatformId, archivedAt: string | null, createdAt: string, deploymentVersionId: PlatformId | null, deploymentVersionNumber: number | null, id: PlatformId, kind: AgentKind, lastMessageAt: string | null, model: string, provider: string, projectId: PlatformId, runtimeId: string, status: SessionStatus, title: string | null, updatedAt: string, lastRun: { completedAt: string | null, createdAt: string, deploymentVersionId: PlatformId | null, deploymentVersionNumber: number | null, id: PlatformId, model: string | null, provider: string | null, startedAt: string | null, status: RunStatus, traceId: string, trigger: SessionRunTrigger, updatedAt: string, error: { code: string, details: PrimitiveRecord, message: string, retryable: boolean } | null } | null } } };

export type AgentSessionDiagnosticsQueryVariables = Exact<{
  projectId: PlatformId;
  sessionId: PlatformId;
}>;


export type AgentSessionDiagnosticsQuery = { agentSessionDiagnostics: { generatedAt: string, pendingPermissionCount: number, execution: { binding: { deploymentVersionId: PlatformId | null, deploymentVersionNumber: number | null, kind: AgentKind, model: string, provider: string, runtimeId: string, sessionId: PlatformId }, skills: Array<{ skillId: PlatformId, skillName: string }>, tools: Array<{ credentialMode: string, serverId: PlatformId }> } | null, nativeRuntimeRef: { kind: string | null, runtimeId: string | null, status: string, valuePreview: string | null }, session: { deploymentVersionId: PlatformId | null, deploymentVersionNumber: number | null, id: PlatformId, kind: AgentKind, model: string, provider: string, runtimeId: string, status: SessionStatus, title: string | null, lastRun: { deploymentVersionId: PlatformId | null, deploymentVersionNumber: number | null, id: PlatformId, model: string | null, provider: string | null, status: RunStatus, traceId: string } | null } } };

export type CreateAgentSessionMutationVariables = Exact<{
  input: CreateAgentSessionInput;
}>;


export type CreateAgentSessionMutation = { createAgentSession: { agentId: PlatformId, archivedAt: string | null, createdAt: string, deploymentVersionId: PlatformId | null, deploymentVersionNumber: number | null, id: PlatformId, kind: AgentKind, lastMessageAt: string | null, model: string, provider: string, projectId: PlatformId, runtimeId: string, status: SessionStatus, title: string | null, type: SessionType, updatedAt: string, lastRun: { completedAt: string | null, createdAt: string, deploymentVersionId: PlatformId | null, deploymentVersionNumber: number | null, id: PlatformId, model: string | null, provider: string | null, startedAt: string | null, status: RunStatus, traceId: string, trigger: SessionRunTrigger, updatedAt: string, error: { code: string, details: PrimitiveRecord, message: string, retryable: boolean } | null } | null } };

export type AgentSessionListQueryVariables = Exact<{
  agentId: PlatformId;
  archived?: boolean | null | undefined;
  participantOnly?: boolean | null | undefined;
  projectId: PlatformId;
  type?: SessionType | null | undefined;
}>;


export type AgentSessionListQuery = { agentSessionList: { nodes: Array<{ agentId: PlatformId, archivedAt: string | null, createdAt: string, deploymentVersionId: PlatformId | null, deploymentVersionNumber: number | null, id: PlatformId, kind: AgentKind, lastMessageAt: string | null, model: string, provider: string, projectId: PlatformId, runtimeId: string, status: SessionStatus, title: string | null, type: SessionType, updatedAt: string, lastRun: { completedAt: string | null, createdAt: string, deploymentVersionId: PlatformId | null, deploymentVersionNumber: number | null, id: PlatformId, model: string | null, provider: string | null, startedAt: string | null, status: RunStatus, traceId: string, trigger: SessionRunTrigger, updatedAt: string, error: { code: string, details: PrimitiveRecord, message: string, retryable: boolean } | null } | null }> } };

export type AgentSessionProcessEventsQueryVariables = Exact<{
  limit: number;
  projectId: PlatformId;
  sessionId: PlatformId;
}>;


export type AgentSessionProcessEventsQuery = { sessionProcessEvents: Array<{ content: string, durationMs: number | null, id: PlatformId, occurredAt: string, status: SessionProcessEventStatus, tokens: number | null, type: SessionProcessEventType }> };

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


export type ThreadAgentSessionListQuery = { threadAgentSessionList: { nodes: Array<{ capabilities: Array<{ action: AgentSessionActionCapabilityName, reason: string | null, status: AgentSessionActionCapabilityStatus }>, session: { agentId: PlatformId, archivedAt: string | null, createdAt: string, deploymentVersionId: PlatformId | null, deploymentVersionNumber: number | null, id: PlatformId, kind: AgentKind, lastMessageAt: string | null, model: string, provider: string, projectId: PlatformId, runtimeId: string, status: SessionStatus, title: string | null, type: SessionType, updatedAt: string, lastRun: { completedAt: string | null, createdAt: string, deploymentVersionId: PlatformId | null, deploymentVersionNumber: number | null, id: PlatformId, model: string | null, provider: string | null, startedAt: string | null, status: RunStatus, traceId: string, trigger: SessionRunTrigger, updatedAt: string, error: { code: string, details: PrimitiveRecord, message: string, retryable: boolean } | null } | null } }>, pageInfo: { endCursor: string | null, hasMore: boolean } } };

export type AutoTitleSessionMutationVariables = Exact<{
  input: RenameSessionInput;
}>;


export type AutoTitleSessionMutation = { autoTitleSession: { id: PlatformId } };

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

export type SessionProcessEventsQueryVariables = Exact<{
  limit: number;
  projectId: PlatformId;
  sessionId: PlatformId;
}>;


export type SessionProcessEventsQuery = { threadSessionProcessEvents: Array<{ content: string, durationMs: number | null, id: PlatformId, occurredAt: string, status: SessionProcessEventStatus, tokens: number | null, type: SessionProcessEventType }> };

export type SkillSummaryFieldsFragment = { author: string, createdAt: string, description: string, fileCount: number, id: PlatformId, name: string, ownerId: PlatformId, ownerName: string, projectId: PlatformId, snapshotId: PlatformId, sourceKind: SkillSourceKind, updatedAt: string, forkOrigin: { name: string, ownerName: string, skillId: PlatformId } | null };

export type SkillDetailFieldsFragment = { author: string, createdAt: string, description: string, fileCount: number, id: PlatformId, name: string, ownerId: PlatformId, ownerName: string, projectId: PlatformId, snapshotId: PlatformId, sourceKind: SkillSourceKind, updatedAt: string, forkOrigin: { name: string, ownerName: string, skillId: PlatformId } | null, currentSnapshot: { archiveFormat: string, author: string, blobKey: string, blobSha256: string, blobSize: number, compression: string, createdAt: string, description: string, id: PlatformId, name: string, skillMarkdownPath: string, uncompressedSize: number, version: string | null }, entries: Array<{ entryKind: SkillSnapshotEntryKind, isExecutable: boolean, mimeType: string | null, path: string, sha256: string | null, size: number }> };

export type SkillDetailQueryVariables = Exact<{
  projectId: PlatformId;
  skillId: PlatformId;
}>;


export type SkillDetailQuery = { skillDetail: { author: string, createdAt: string, description: string, fileCount: number, id: PlatformId, name: string, ownerId: PlatformId, ownerName: string, projectId: PlatformId, snapshotId: PlatformId, sourceKind: SkillSourceKind, updatedAt: string, forkOrigin: { name: string, ownerName: string, skillId: PlatformId } | null, currentSnapshot: { archiveFormat: string, author: string, blobKey: string, blobSha256: string, blobSize: number, compression: string, createdAt: string, description: string, id: PlatformId, name: string, skillMarkdownPath: string, uncompressedSize: number, version: string | null }, entries: Array<{ entryKind: SkillSnapshotEntryKind, isExecutable: boolean, mimeType: string | null, path: string, sha256: string | null, size: number }> } };

export type ProjectSkillsQueryVariables = Exact<{
  projectId: PlatformId;
}>;


export type ProjectSkillsQuery = { projectSkillList: Array<{ author: string, createdAt: string, description: string, fileCount: number, id: PlatformId, name: string, ownerId: PlatformId, ownerName: string, projectId: PlatformId, snapshotId: PlatformId, sourceKind: SkillSourceKind, updatedAt: string, forkOrigin: { name: string, ownerName: string, skillId: PlatformId } | null }> };

export type CreateSkillForkMutationVariables = Exact<{
  input: CreateSkillForkInput;
}>;


export type CreateSkillForkMutation = { createSkillFork: { author: string, createdAt: string, description: string, fileCount: number, id: PlatformId, name: string, ownerId: PlatformId, ownerName: string, projectId: PlatformId, snapshotId: PlatformId, sourceKind: SkillSourceKind, updatedAt: string, forkOrigin: { name: string, ownerName: string, skillId: PlatformId } | null } };

export type DeleteOwnedSkillMutationVariables = Exact<{
  projectId: PlatformId;
  skillId: PlatformId;
}>;


export type DeleteOwnedSkillMutation = { deleteOwnedSkill: { ok: boolean } };

export type ViewerQueryVariables = Exact<{ [key: string]: never; }>;


export type ViewerQuery = { viewer: { account: { email: string, id: PlatformId, imageUrl: string | null, name: string, systemAgentModel: { modelId: string, vendor: string } | null } | null, activeOrganization: { avatarUrl: string | null, createdAt: string, id: PlatformId, name: string } | null, auth: { currentSecurityLevel: AuthSecurityLevel, methods: Array<AuthMethod> }, organizations: Array<{ avatarUrl: string | null, createdAt: string, id: PlatformId, name: string }> } };

export type UpdateProfileMutationVariables = Exact<{
  input: UpdateAccountProfileInput;
}>;


export type UpdateProfileMutation = { updateProfile: { imageUrl: string | null, name: string } };

export type VendorCredentialListQueryVariables = Exact<{
  projectId: PlatformId;
}>;


export type VendorCredentialListQuery = { vendorCredentialList: Array<{ apiBase: string | null, id: PlatformId, isDefault: boolean, maskedApiKey: string, models: Array<string> | null, name: string, projectId: PlatformId, vendorId: string }> };

export type CreateVendorCredentialMutationVariables = Exact<{
  input: CreateVendorCredentialInput;
}>;


export type CreateVendorCredentialMutation = { createVendorCredential: { apiBase: string | null, id: PlatformId, isDefault: boolean, maskedApiKey: string, models: Array<string> | null, name: string, projectId: PlatformId, vendorId: string } };

export type UpdateVendorCredentialMutationVariables = Exact<{
  input: UpdateVendorCredentialInput;
}>;


export type UpdateVendorCredentialMutation = { updateVendorCredential: { apiBase: string | null, id: PlatformId, isDefault: boolean, maskedApiKey: string, models: Array<string> | null, name: string, projectId: PlatformId, vendorId: string } };

export type DeleteVendorCredentialMutationVariables = Exact<{
  input: DeleteVendorCredentialInput;
}>;


export type DeleteVendorCredentialMutation = { deleteVendorCredential: { ok: boolean } };

export type SetDefaultVendorCredentialMutationVariables = Exact<{
  input: SetDefaultVendorCredentialInput;
}>;


export type SetDefaultVendorCredentialMutation = { setDefaultVendorCredential: { apiBase: string | null, id: PlatformId, isDefault: boolean, maskedApiKey: string, models: Array<string> | null, name: string, projectId: PlatformId, vendorId: string } };

export type AvailableAgentModelsQueryVariables = Exact<{
  projectId: PlatformId;
  runtimeId: string;
  currentModelId?: string | null | undefined;
  currentVendorId?: string | null | undefined;
}>;


export type AvailableAgentModelsQuery = { availableAgentModels: Array<{ available: boolean, displayName: string, modelId: string, reason: string | null, source: ModelCatalogSource, statusDetail: string | null, statusLabel: string, vendorId: string, vendorLabel: string }> };

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
export const AgentDeploymentVersionFieldsFragmentDoc = /*#__PURE__*/ new TypedDocumentString(`
    fragment AgentDeploymentVersionFields on AgentDeploymentVersion {
  agentId
  createdAt
  createdByAccountId
  environmentId
  id
  isLive
  kind
  model
  provider
  runtimeId
  summary
  versionNumber
}
    `, {"fragmentName":"AgentDeploymentVersionFields"}) as unknown as TypedDocumentString<AgentDeploymentVersionFieldsFragment, unknown>;
export const AgentFieldsFragmentDoc = /*#__PURE__*/ new TypedDocumentString(`
    fragment AgentFields on Agent {
  createdAt
  description
  id
  kind
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
  kind
  model
  provider
  runtimeId
  summary
  versionNumber
}`, {"fragmentName":"AgentFields"}) as unknown as TypedDocumentString<AgentFieldsFragment, unknown>;
export const AgentToolSummaryFieldsFragmentDoc = /*#__PURE__*/ new TypedDocumentString(`
    fragment AgentToolSummaryFields on AgentToolSummary {
  enabled
  iconUrl
  name
  serverId
}
    `, {"fragmentName":"AgentToolSummaryFields"}) as unknown as TypedDocumentString<AgentToolSummaryFieldsFragment, unknown>;
export const AgentOwnerFieldsFragmentDoc = /*#__PURE__*/ new TypedDocumentString(`
    fragment AgentOwnerFields on AgentOwnerSummary {
  id
  imageUrl
  name
}
    `, {"fragmentName":"AgentOwnerFields"}) as unknown as TypedDocumentString<AgentOwnerFieldsFragment, unknown>;
export const CostAgentFieldsFragmentDoc = /*#__PURE__*/ new TypedDocumentString(`
    fragment CostAgentFields on CostAgentRow {
  activeUsers
  agentId
  agentName
  cacheCreationTokens
  cacheReadTokens
  debugCostUsd
  evalCostUsd
  inputTokens
  outputTokens
  ownerEmail
  ownerId
  ownerName
  previousCostUsd
  previewCostUsd
  productionCostUsd
  requestCount
  scheduledCostUsd
  totalCostUsd
  unpricedRequestCount
}
    `, {"fragmentName":"CostAgentFields"}) as unknown as TypedDocumentString<CostAgentFieldsFragment, unknown>;
export const CostDailyFieldsFragmentDoc = /*#__PURE__*/ new TypedDocumentString(`
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
export const CostModelFieldsFragmentDoc = /*#__PURE__*/ new TypedDocumentString(`
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
export const CostRecentSessionFieldsFragmentDoc = /*#__PURE__*/ new TypedDocumentString(`
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
export const CostTotalsFieldsFragmentDoc = /*#__PURE__*/ new TypedDocumentString(`
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
export const CostAttributionFieldsFragmentDoc = /*#__PURE__*/ new TypedDocumentString(`
    fragment CostAttributionFields on CostAttributionCard {
  agents {
    ...CostAgentFields
  }
  daily {
    ...CostDailyFields
  }
  models {
    ...CostModelFields
  }
  recentSessions {
    ...CostRecentSessionFields
  }
  totals {
    ...CostTotalsFields
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
  evalCostUsd
  inputTokens
  outputTokens
  ownerEmail
  ownerId
  ownerName
  previousCostUsd
  previewCostUsd
  productionCostUsd
  requestCount
  scheduledCostUsd
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
}`, {"fragmentName":"CostAttributionFields"}) as unknown as TypedDocumentString<CostAttributionFieldsFragment, unknown>;
export const EnvironmentVariableFieldsFragmentDoc = /*#__PURE__*/ new TypedDocumentString(`
    fragment EnvironmentVariableFields on EnvironmentVariablePreview {
  key
  preview
  status
}
    `, {"fragmentName":"EnvironmentVariableFields"}) as unknown as TypedDocumentString<EnvironmentVariableFieldsFragment, unknown>;
export const EnvironmentOwnerFieldsFragmentDoc = /*#__PURE__*/ new TypedDocumentString(`
    fragment EnvironmentOwnerFields on EnvironmentOwnerSummary {
  id
  imageUrl
  name
}
    `, {"fragmentName":"EnvironmentOwnerFields"}) as unknown as TypedDocumentString<EnvironmentOwnerFieldsFragment, unknown>;
export const EnvironmentPackageFieldsFragmentDoc = /*#__PURE__*/ new TypedDocumentString(`
    fragment EnvironmentPackageFields on EnvironmentPackageSpec {
  manager
  packages
}
    `, {"fragmentName":"EnvironmentPackageFields"}) as unknown as TypedDocumentString<EnvironmentPackageFieldsFragment, unknown>;
export const EnvironmentSummaryFieldsFragmentDoc = /*#__PURE__*/ new TypedDocumentString(`
    fragment EnvironmentSummaryFields on EnvironmentSummary {
  allowMcpServers
  allowPackageManagers
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
  isEditable
  name
  networkPolicy
  owner {
    ...EnvironmentOwnerFields
  }
  packages {
    ...EnvironmentPackageFields
  }
  role
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
}
fragment EnvironmentOwnerFields on EnvironmentOwnerSummary {
  id
  imageUrl
  name
}`, {"fragmentName":"EnvironmentSummaryFields"}) as unknown as TypedDocumentString<EnvironmentSummaryFieldsFragment, unknown>;
export const EnvironmentDetailFieldsFragmentDoc = /*#__PURE__*/ new TypedDocumentString(`
    fragment EnvironmentDetailFields on EnvironmentDetail {
  allowMcpServers
  allowPackageManagers
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
  isEditable
  name
  networkPolicy
  owner {
    ...EnvironmentOwnerFields
  }
  packages {
    ...EnvironmentPackageFields
  }
  role
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
}
fragment EnvironmentOwnerFields on EnvironmentOwnerSummary {
  id
  imageUrl
  name
}`, {"fragmentName":"EnvironmentDetailFields"}) as unknown as TypedDocumentString<EnvironmentDetailFieldsFragment, unknown>;
export const McpCredentialFieldsFragmentDoc = /*#__PURE__*/ new TypedDocumentString(`
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
export const McpServerFieldsFragmentDoc = /*#__PURE__*/ new TypedDocumentString(`
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
export const SkillSummaryFieldsFragmentDoc = /*#__PURE__*/ new TypedDocumentString(`
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
  sourceKind
  updatedAt
}
    `, {"fragmentName":"SkillSummaryFields"}) as unknown as TypedDocumentString<SkillSummaryFieldsFragment, unknown>;
export const SkillDetailFieldsFragmentDoc = /*#__PURE__*/ new TypedDocumentString(`
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
  sourceKind
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
export const CreateAgentDocument = /*#__PURE__*/ new TypedDocumentString(`
    mutation CreateAgent($input: CreateAgentInput!) {
  createAgent(input: $input) {
    ...AgentFields
  }
}
    fragment AgentFields on Agent {
  createdAt
  description
  id
  kind
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
  kind
  model
  provider
  runtimeId
  summary
  versionNumber
}`) as unknown as TypedDocumentString<CreateAgentMutation, CreateAgentMutationVariables>;
export const DeleteAgentDocument = /*#__PURE__*/ new TypedDocumentString(`
    mutation DeleteAgent($input: DeleteAgentInput!) {
  deleteAgent(input: $input) {
    ok
  }
}
    `) as unknown as TypedDocumentString<DeleteAgentMutation, DeleteAgentMutationVariables>;
export const AccessibleAgentsDocument = /*#__PURE__*/ new TypedDocumentString(`
    query AccessibleAgents($projectId: ULID!) {
  accessibleAgentList(projectId: $projectId) {
    createdAt
    description
    id
    kind
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
export const AgentDocument = /*#__PURE__*/ new TypedDocumentString(`
    query Agent($agentId: ULID!, $projectId: ULID!) {
  agent(agentId: $agentId, projectId: $projectId) {
    createdAt
    description
    id
    kind
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
  kind
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
export const AgentEditorStateDocument = /*#__PURE__*/ new TypedDocumentString(`
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
export const UpdateAgentConfigDocument = /*#__PURE__*/ new TypedDocumentString(`
    mutation UpdateAgentConfig($input: UpdateAgentConfigInput!) {
  updateAgentConfig(input: $input) {
    ...AgentFields
  }
}
    fragment AgentFields on Agent {
  createdAt
  description
  id
  kind
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
  kind
  model
  provider
  runtimeId
  summary
  versionNumber
}`) as unknown as TypedDocumentString<UpdateAgentConfigMutation, UpdateAgentConfigMutationVariables>;
export const AgentManifestDocument = /*#__PURE__*/ new TypedDocumentString(`
    query AgentManifest($agentId: ULID!, $projectId: ULID!) {
  agentManifest(agentId: $agentId, projectId: $projectId) {
    agentId
    json
    yaml
  }
}
    `) as unknown as TypedDocumentString<AgentManifestQuery, AgentManifestQueryVariables>;
export const ExportAgentPackageDocument = /*#__PURE__*/ new TypedDocumentString(`
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
export const ImportAgentPackageDocument = /*#__PURE__*/ new TypedDocumentString(`
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
  kind
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
  kind
  model
  provider
  runtimeId
  summary
  versionNumber
}`) as unknown as TypedDocumentString<ImportAgentPackageMutation, ImportAgentPackageMutationVariables>;
export const CreateAgentForkDocument = /*#__PURE__*/ new TypedDocumentString(`
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
  kind
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
  kind
  model
  provider
  runtimeId
  summary
  versionNumber
}`) as unknown as TypedDocumentString<CreateAgentForkMutation, CreateAgentForkMutationVariables>;
export const PublishAgentDocument = /*#__PURE__*/ new TypedDocumentString(`
    mutation PublishAgent($input: PublishAgentInput!) {
  publishAgent(input: $input) {
    ...AgentFields
  }
}
    fragment AgentFields on Agent {
  createdAt
  description
  id
  kind
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
  kind
  model
  provider
  runtimeId
  summary
  versionNumber
}`) as unknown as TypedDocumentString<PublishAgentMutation, PublishAgentMutationVariables>;
export const UnpublishAgentDocument = /*#__PURE__*/ new TypedDocumentString(`
    mutation UnpublishAgent($agentId: ULID!, $projectId: ULID!) {
  unpublishAgent(agentId: $agentId, projectId: $projectId) {
    ...AgentFields
  }
}
    fragment AgentFields on Agent {
  createdAt
  description
  id
  kind
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
  kind
  model
  provider
  runtimeId
  summary
  versionNumber
}`) as unknown as TypedDocumentString<UnpublishAgentMutation, UnpublishAgentMutationVariables>;
export const RestartDriverDocument = /*#__PURE__*/ new TypedDocumentString(`
    mutation RestartDriver($input: RuntimeStateOperationInput!) {
  restartDriver(input: $input) {
    affectedSessionCount
    agentId
    ok
    operation
  }
}
    `) as unknown as TypedDocumentString<RestartDriverMutation, RestartDriverMutationVariables>;
export const RecreateSandboxDocument = /*#__PURE__*/ new TypedDocumentString(`
    mutation RecreateSandbox($input: RuntimeStateOperationInput!) {
  recreateSandbox(input: $input) {
    affectedSessionCount
    agentId
    ok
    operation
  }
}
    `) as unknown as TypedDocumentString<RecreateSandboxMutation, RecreateSandboxMutationVariables>;
export const ResetAgentStateDocument = /*#__PURE__*/ new TypedDocumentString(`
    mutation ResetAgentState($input: RuntimeStateOperationInput!) {
  resetAgentState(input: $input) {
    affectedSessionCount
    agentId
    ok
    operation
  }
}
    `) as unknown as TypedDocumentString<ResetAgentStateMutation, ResetAgentStateMutationVariables>;
export const ProjectCostCardDocument = /*#__PURE__*/ new TypedDocumentString(`
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
  evalCostUsd
  inputTokens
  outputTokens
  ownerEmail
  ownerId
  ownerName
  previousCostUsd
  previewCostUsd
  productionCostUsd
  requestCount
  scheduledCostUsd
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
export const AgentCostCardDocument = /*#__PURE__*/ new TypedDocumentString(`
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
  evalCostUsd
  inputTokens
  outputTokens
  ownerEmail
  ownerId
  ownerName
  previousCostUsd
  previewCostUsd
  productionCostUsd
  requestCount
  scheduledCostUsd
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
export const ProjectEnvironmentsDocument = /*#__PURE__*/ new TypedDocumentString(`
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
fragment EnvironmentOwnerFields on EnvironmentOwnerSummary {
  id
  imageUrl
  name
}
fragment EnvironmentSummaryFields on EnvironmentSummary {
  allowMcpServers
  allowPackageManagers
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
  isEditable
  name
  networkPolicy
  owner {
    ...EnvironmentOwnerFields
  }
  packages {
    ...EnvironmentPackageFields
  }
  role
  setupScript
  updatedAt
  usedByAgentCount
  projectId
}`) as unknown as TypedDocumentString<ProjectEnvironmentsQuery, ProjectEnvironmentsQueryVariables>;
export const EnvironmentDetailDocument = /*#__PURE__*/ new TypedDocumentString(`
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
fragment EnvironmentOwnerFields on EnvironmentOwnerSummary {
  id
  imageUrl
  name
}
fragment EnvironmentDetailFields on EnvironmentDetail {
  allowMcpServers
  allowPackageManagers
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
  isEditable
  name
  networkPolicy
  owner {
    ...EnvironmentOwnerFields
  }
  packages {
    ...EnvironmentPackageFields
  }
  role
  setupScript
  updatedAt
  usedByAgentCount
  projectId
}`) as unknown as TypedDocumentString<EnvironmentDetailQuery, EnvironmentDetailQueryVariables>;
export const CreateEnvironmentDocument = /*#__PURE__*/ new TypedDocumentString(`
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
fragment EnvironmentOwnerFields on EnvironmentOwnerSummary {
  id
  imageUrl
  name
}
fragment EnvironmentSummaryFields on EnvironmentSummary {
  allowMcpServers
  allowPackageManagers
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
  isEditable
  name
  networkPolicy
  owner {
    ...EnvironmentOwnerFields
  }
  packages {
    ...EnvironmentPackageFields
  }
  role
  setupScript
  updatedAt
  usedByAgentCount
  projectId
}`) as unknown as TypedDocumentString<CreateEnvironmentMutation, CreateEnvironmentMutationVariables>;
export const UpdateEnvironmentDocument = /*#__PURE__*/ new TypedDocumentString(`
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
fragment EnvironmentOwnerFields on EnvironmentOwnerSummary {
  id
  imageUrl
  name
}
fragment EnvironmentDetailFields on EnvironmentDetail {
  allowMcpServers
  allowPackageManagers
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
  isEditable
  name
  networkPolicy
  owner {
    ...EnvironmentOwnerFields
  }
  packages {
    ...EnvironmentPackageFields
  }
  role
  setupScript
  updatedAt
  usedByAgentCount
  projectId
}`) as unknown as TypedDocumentString<UpdateEnvironmentMutation, UpdateEnvironmentMutationVariables>;
export const DeleteEnvironmentDocument = /*#__PURE__*/ new TypedDocumentString(`
    mutation DeleteEnvironment($input: DeleteEnvironmentInput!) {
  deleteEnvironment(input: $input) {
    ok
  }
}
    `) as unknown as TypedDocumentString<DeleteEnvironmentMutation, DeleteEnvironmentMutationVariables>;
export const SetProjectDefaultEnvironmentDocument = /*#__PURE__*/ new TypedDocumentString(`
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
fragment EnvironmentOwnerFields on EnvironmentOwnerSummary {
  id
  imageUrl
  name
}
fragment EnvironmentSummaryFields on EnvironmentSummary {
  allowMcpServers
  allowPackageManagers
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
  isEditable
  name
  networkPolicy
  owner {
    ...EnvironmentOwnerFields
  }
  packages {
    ...EnvironmentPackageFields
  }
  role
  setupScript
  updatedAt
  usedByAgentCount
  projectId
}`) as unknown as TypedDocumentString<SetProjectDefaultEnvironmentMutation, SetProjectDefaultEnvironmentMutationVariables>;
export const FileListDocument = /*#__PURE__*/ new TypedDocumentString(`
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
export const McpRegistryDocument = /*#__PURE__*/ new TypedDocumentString(`
    query McpRegistry($projectId: ULID!) {
  mcpRegistry(projectId: $projectId) {
    currentUserEmail
    currentUserId
    currentUserName
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
export const CreateProjectMcpServerDocument = /*#__PURE__*/ new TypedDocumentString(`
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
export const ConnectMcpBearerDocument = /*#__PURE__*/ new TypedDocumentString(`
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
export const RevokeMcpCredentialDocument = /*#__PURE__*/ new TypedDocumentString(`
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
export const SetMcpServerEnabledDocument = /*#__PURE__*/ new TypedDocumentString(`
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
export const UpdateProjectMcpServerDocument = /*#__PURE__*/ new TypedDocumentString(`
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
export const DeleteMcpServerDocument = /*#__PURE__*/ new TypedDocumentString(`
    mutation DeleteMcpServer($projectId: ULID!, $serverId: ULID!) {
  deleteMcpServer(projectId: $projectId, serverId: $serverId) {
    ok
  }
}
    `) as unknown as TypedDocumentString<DeleteMcpServerMutation, DeleteMcpServerMutationVariables>;
export const StartMcpOAuthDocument = /*#__PURE__*/ new TypedDocumentString(`
    mutation StartMcpOAuth($input: StartMcpOAuthInput!) {
  startMcpOAuth(input: $input) {
    authorizationUrl
    flowId
  }
}
    `) as unknown as TypedDocumentString<StartMcpOAuthMutation, StartMcpOAuthMutationVariables>;
export const McpOAuthFlowStatusDocument = /*#__PURE__*/ new TypedDocumentString(`
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
export const OnboardingBootstrapDocument = /*#__PURE__*/ new TypedDocumentString(`
    mutation OnboardingBootstrap($input: BootstrapOnboardingInput!) {
  onboardingBootstrap(input: $input) {
    completed
    organization {
      avatarUrl
      createdAt
      id
      name
    }
  }
}
    `) as unknown as TypedDocumentString<OnboardingBootstrapMutation, OnboardingBootstrapMutationVariables>;
export const RenameOrganizationDocument = /*#__PURE__*/ new TypedDocumentString(`
    mutation RenameOrganization($input: RenameOrganizationInput!) {
  renameOrganization(input: $input) {
    avatarUrl
    createdAt
    id
    name
  }
}
    `) as unknown as TypedDocumentString<RenameOrganizationMutation, RenameOrganizationMutationVariables>;
export const ProjectListDocument = /*#__PURE__*/ new TypedDocumentString(`
    query ProjectList($organizationId: ULID!) {
  projectList(organizationId: $organizationId) {
    createdAt
    defaultEnvironmentId
    id
    name
    ownerAccountId
  }
}
    `) as unknown as TypedDocumentString<ProjectListQuery, ProjectListQueryVariables>;
export const CreateProjectDocument = /*#__PURE__*/ new TypedDocumentString(`
    mutation CreateProject($input: CreateProjectInput!) {
  createProject(input: $input) {
    createdAt
    defaultEnvironmentId
    id
    name
    ownerAccountId
  }
}
    `) as unknown as TypedDocumentString<CreateProjectMutation, CreateProjectMutationVariables>;
export const RenameProjectDocument = /*#__PURE__*/ new TypedDocumentString(`
    mutation RenameProject($input: RenameProjectInput!) {
  renameProject(input: $input) {
    createdAt
    defaultEnvironmentId
    id
    name
    ownerAccountId
  }
}
    `) as unknown as TypedDocumentString<RenameProjectMutation, RenameProjectMutationVariables>;
export const ThreadAgentSessionRetrieveDocument = /*#__PURE__*/ new TypedDocumentString(`
    query ThreadAgentSessionRetrieve($projectId: ULID!, $sessionId: ULID!) {
  threadAgentSessionRetrieve(projectId: $projectId, sessionId: $sessionId) {
    capabilities {
      action
      reason
      status
    }
    recoverability {
      reason
      status
    }
    taskSnapshot {
      runId
      tasks {
        taskId
        taskType
        title
      }
    }
    session {
      agentId
      archivedAt
      createdAt
      deploymentVersionId
      deploymentVersionNumber
      id
      kind
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
      updatedAt
    }
  }
}
    `) as unknown as TypedDocumentString<ThreadAgentSessionRetrieveQuery, ThreadAgentSessionRetrieveQueryVariables>;
export const AgentSessionDiagnosticsDocument = /*#__PURE__*/ new TypedDocumentString(`
    query AgentSessionDiagnostics($projectId: ULID!, $sessionId: ULID!) {
  agentSessionDiagnostics(projectId: $projectId, sessionId: $sessionId) {
    execution {
      binding {
        deploymentVersionId
        deploymentVersionNumber
        kind
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
    pendingPermissionCount
    session {
      deploymentVersionId
      deploymentVersionNumber
      id
      kind
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
export const CreateAgentSessionDocument = /*#__PURE__*/ new TypedDocumentString(`
    mutation CreateAgentSession($input: CreateAgentSessionInput!) {
  createAgentSession(input: $input) {
    agentId
    archivedAt
    createdAt
    deploymentVersionId
    deploymentVersionNumber
    id
    kind
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
}
    `) as unknown as TypedDocumentString<CreateAgentSessionMutation, CreateAgentSessionMutationVariables>;
export const AgentSessionListDocument = /*#__PURE__*/ new TypedDocumentString(`
    query AgentSessionList($agentId: ULID!, $archived: Boolean, $participantOnly: Boolean, $projectId: ULID!, $type: SessionType) {
  agentSessionList(
    agentId: $agentId
    archived: $archived
    participantOnly: $participantOnly
    projectId: $projectId
    type: $type
  ) {
    nodes {
      agentId
      archivedAt
      createdAt
      deploymentVersionId
      deploymentVersionNumber
      id
      kind
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
  }
}
    `) as unknown as TypedDocumentString<AgentSessionListQuery, AgentSessionListQueryVariables>;
export const AgentSessionProcessEventsDocument = /*#__PURE__*/ new TypedDocumentString(`
    query AgentSessionProcessEvents($limit: Int!, $projectId: ULID!, $sessionId: ULID!) {
  sessionProcessEvents(
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
    `) as unknown as TypedDocumentString<AgentSessionProcessEventsQuery, AgentSessionProcessEventsQueryVariables>;
export const ThreadSessionMessagesDocument = /*#__PURE__*/ new TypedDocumentString(`
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
export const SendAgentSessionEventsDocument = /*#__PURE__*/ new TypedDocumentString(`
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
export const PrewarmAgentSessionDocument = /*#__PURE__*/ new TypedDocumentString(`
    mutation PrewarmAgentSession($projectId: ULID!, $sessionId: ULID!) {
  prewarmAgentSession(projectId: $projectId, sessionId: $sessionId) {
    scheduledAt
    sessionId
  }
}
    `) as unknown as TypedDocumentString<PrewarmAgentSessionMutation, PrewarmAgentSessionMutationVariables>;
export const ThreadAgentSessionListDocument = /*#__PURE__*/ new TypedDocumentString(`
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
        agentId
        archivedAt
        createdAt
        deploymentVersionId
        deploymentVersionNumber
        id
        kind
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
    }
    pageInfo {
      endCursor
      hasMore
    }
  }
}
    `) as unknown as TypedDocumentString<ThreadAgentSessionListQuery, ThreadAgentSessionListQueryVariables>;
export const AutoTitleSessionDocument = /*#__PURE__*/ new TypedDocumentString(`
    mutation AutoTitleSession($input: RenameSessionInput!) {
  autoTitleSession(input: $input) {
    id
  }
}
    `) as unknown as TypedDocumentString<AutoTitleSessionMutation, AutoTitleSessionMutationVariables>;
export const ArchiveSessionDocument = /*#__PURE__*/ new TypedDocumentString(`
    mutation ArchiveSession($projectId: ULID!, $sessionId: ULID!) {
  archiveAgentSession(projectId: $projectId, sessionId: $sessionId) {
    ok
  }
}
    `) as unknown as TypedDocumentString<ArchiveSessionMutation, ArchiveSessionMutationVariables>;
export const RestoreSessionDocument = /*#__PURE__*/ new TypedDocumentString(`
    mutation RestoreSession($projectId: ULID!, $sessionId: ULID!) {
  unarchiveAgentSession(projectId: $projectId, sessionId: $sessionId) {
    ok
  }
}
    `) as unknown as TypedDocumentString<RestoreSessionMutation, RestoreSessionMutationVariables>;
export const DeleteAgentSessionDocument = /*#__PURE__*/ new TypedDocumentString(`
    mutation DeleteAgentSession($projectId: ULID!, $sessionId: ULID!) {
  deleteAgentSession(projectId: $projectId, sessionId: $sessionId) {
    ok
  }
}
    `) as unknown as TypedDocumentString<DeleteAgentSessionMutation, DeleteAgentSessionMutationVariables>;
export const AddSessionResourceDocument = /*#__PURE__*/ new TypedDocumentString(`
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
export const SessionProcessEventsDocument = /*#__PURE__*/ new TypedDocumentString(`
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
export const SkillDetailDocument = /*#__PURE__*/ new TypedDocumentString(`
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
  sourceKind
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
export const ProjectSkillsDocument = /*#__PURE__*/ new TypedDocumentString(`
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
  sourceKind
  updatedAt
}`) as unknown as TypedDocumentString<ProjectSkillsQuery, ProjectSkillsQueryVariables>;
export const CreateSkillForkDocument = /*#__PURE__*/ new TypedDocumentString(`
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
  sourceKind
  updatedAt
}`) as unknown as TypedDocumentString<CreateSkillForkMutation, CreateSkillForkMutationVariables>;
export const DeleteOwnedSkillDocument = /*#__PURE__*/ new TypedDocumentString(`
    mutation DeleteOwnedSkill($projectId: ULID!, $skillId: ULID!) {
  deleteOwnedSkill(projectId: $projectId, skillId: $skillId) {
    ok
  }
}
    `) as unknown as TypedDocumentString<DeleteOwnedSkillMutation, DeleteOwnedSkillMutationVariables>;
export const ViewerDocument = /*#__PURE__*/ new TypedDocumentString(`
    query Viewer {
  viewer {
    account {
      email
      id
      imageUrl
      name
      systemAgentModel {
        modelId
        vendor
      }
    }
    activeOrganization {
      avatarUrl
      createdAt
      id
      name
    }
    auth {
      currentSecurityLevel
      methods
    }
    organizations {
      avatarUrl
      createdAt
      id
      name
    }
  }
}
    `) as unknown as TypedDocumentString<ViewerQuery, ViewerQueryVariables>;
export const UpdateProfileDocument = /*#__PURE__*/ new TypedDocumentString(`
    mutation UpdateProfile($input: UpdateAccountProfileInput!) {
  updateProfile(input: $input) {
    imageUrl
    name
  }
}
    `) as unknown as TypedDocumentString<UpdateProfileMutation, UpdateProfileMutationVariables>;
export const VendorCredentialListDocument = /*#__PURE__*/ new TypedDocumentString(`
    query VendorCredentialList($projectId: ULID!) {
  vendorCredentialList(projectId: $projectId) {
    apiBase
    id
    isDefault
    maskedApiKey
    models
    name
    projectId
    vendorId
  }
}
    `) as unknown as TypedDocumentString<VendorCredentialListQuery, VendorCredentialListQueryVariables>;
export const CreateVendorCredentialDocument = /*#__PURE__*/ new TypedDocumentString(`
    mutation CreateVendorCredential($input: CreateVendorCredentialInput!) {
  createVendorCredential(input: $input) {
    apiBase
    id
    isDefault
    maskedApiKey
    models
    name
    projectId
    vendorId
  }
}
    `) as unknown as TypedDocumentString<CreateVendorCredentialMutation, CreateVendorCredentialMutationVariables>;
export const UpdateVendorCredentialDocument = /*#__PURE__*/ new TypedDocumentString(`
    mutation UpdateVendorCredential($input: UpdateVendorCredentialInput!) {
  updateVendorCredential(input: $input) {
    apiBase
    id
    isDefault
    maskedApiKey
    models
    name
    projectId
    vendorId
  }
}
    `) as unknown as TypedDocumentString<UpdateVendorCredentialMutation, UpdateVendorCredentialMutationVariables>;
export const DeleteVendorCredentialDocument = /*#__PURE__*/ new TypedDocumentString(`
    mutation DeleteVendorCredential($input: DeleteVendorCredentialInput!) {
  deleteVendorCredential(input: $input) {
    ok
  }
}
    `) as unknown as TypedDocumentString<DeleteVendorCredentialMutation, DeleteVendorCredentialMutationVariables>;
export const SetDefaultVendorCredentialDocument = /*#__PURE__*/ new TypedDocumentString(`
    mutation SetDefaultVendorCredential($input: SetDefaultVendorCredentialInput!) {
  setDefaultVendorCredential(input: $input) {
    apiBase
    id
    isDefault
    maskedApiKey
    models
    name
    projectId
    vendorId
  }
}
    `) as unknown as TypedDocumentString<SetDefaultVendorCredentialMutation, SetDefaultVendorCredentialMutationVariables>;
export const AvailableAgentModelsDocument = /*#__PURE__*/ new TypedDocumentString(`
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
    reason
    source
    statusDetail
    statusLabel
    vendorId
    vendorLabel
  }
}
    `) as unknown as TypedDocumentString<AvailableAgentModelsQuery, AvailableAgentModelsQueryVariables>;
export const TestVendorCredentialDocument = /*#__PURE__*/ new TypedDocumentString(`
    mutation TestVendorCredential($input: TestVendorCredentialInput!) {
  testVendorCredential(input: $input) {
    errorCode
    latencyMs
    ok
  }
}
    `) as unknown as TypedDocumentString<TestVendorCredentialMutation, TestVendorCredentialMutationVariables>;
