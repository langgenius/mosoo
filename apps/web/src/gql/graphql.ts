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
  appId: PlatformId;
  file: AddSessionResourceFileInput;
  sessionId: PlatformId;
};

export type AgentBuilderAgentTypeDecision =
  | 'decided'
  | 'skipped';

export type AgentBuilderComponentDecision =
  | 'bound'
  | 'created'
  | 'skipped';

export type AgentBuilderComponentDecisionsInput = {
  agentType?: AgentBuilderAgentTypeDecision | null | undefined;
  environment?: AgentBuilderComponentDecision | null | undefined;
};

export type AgentBuilderControlPlaneActionStatus =
  | 'applied'
  | 'needs_secure_ui'
  | 'noop';

export type AgentBuilderCreateEnvironmentPayloadInput = {
  description?: string | null | undefined;
  name: string;
};

export type AgentBuilderCreateRemoteMcpServerPayloadInput = {
  authType: McpAuthType;
  description?: string | null | undefined;
  name: string;
  url: string;
};

export type AgentBuilderExecutableActionToolId =
  | 'apply_agent_config'
  | 'create_agent'
  | 'create_environment'
  | 'create_remote_mcp_server'
  | 'open_preview'
  | 'reset_preview_session';

export type AgentBuilderMessageRole =
  | 'assistant'
  | 'system'
  | 'tool'
  | 'user';

export type AgentBuilderMetadataInput = {
  componentDecisions: AgentBuilderComponentDecisionsInput;
};

export type AgentBuilderSecureUiActionKind =
  | 'connect_mcp_credential'
  | 'create_environment'
  | 'create_remote_mcp_server';

export type AgentBuilderThreadStatus =
  | 'active'
  | 'archived';

export type AgentChannelBindingStatus =
  | 'active'
  | 'error';

export type AgentEnvironmentConfigInput = {
  boundSpaceIds: Array<PlatformId>;
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
  | 'channel'
  | 'environment'
  | 'mcp_server'
  | 'model'
  | 'provider'
  | 'runtime'
  | 'skill'
  | 'space';

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

export type ChannelProvider =
  | 'discord'
  | 'lark'
  | 'slack'
  | 'telegram'
  | 'wechat';

export type ConnectMcpBearerInput = {
  appId: PlatformId;
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
  appId: PlatformId;
  kind?: AgentKind | null | undefined;
};

export type CreateAgentInput = {
  appId: PlatformId;
  description?: string | null | undefined;
  kind: AgentKind;
  model: string;
  name: string;
  prompt: string;
  provider: string;
  runtimeId: string;
  skillIds: Array<PlatformId>;
};

export type CreateAgentSessionInput = {
  agentId: PlatformId;
  appId: PlatformId;
  type?: SessionType | null | undefined;
  waitForRuntimeReady?: boolean | null | undefined;
};

export type CreateAppMcpServerInput = {
  appId: PlatformId;
  authType: McpAuthType;
  description?: string | null | undefined;
  iconUrl?: string | null | undefined;
  name: string;
  oauthClientId?: string | null | undefined;
  oauthClientSecret?: string | null | undefined;
  url: string;
};

export type CreateDiscordAgentChannelBindingInput = {
  agentId: PlatformId;
  appId: PlatformId;
  applicationId: string;
  botToken: string;
  relaySecret: string;
};

export type CreateEnvironmentForkInput = {
  appId: PlatformId;
  environmentId: PlatformId;
};

export type CreateEnvironmentInput = {
  allowMcpServers: boolean;
  allowPackageManagers: boolean;
  allowedHosts: Array<string>;
  appId: PlatformId;
  description?: string | null | undefined;
  envVars: Array<EnvironmentVariableInput>;
  name: string;
  networkPolicy: EnvironmentNetworkPolicy;
  packages: Array<EnvironmentPackageSpecInput>;
  setupScript: string;
};

export type CreateLarkAgentChannelBindingInput = {
  agentId: PlatformId;
  appId: PlatformId;
  appSecret: string;
  connectionMode: LarkConnectionMode;
  domain: LarkDomain;
  encryptKey?: string | null | undefined;
  larkAppId: string;
  verificationToken?: string | null | undefined;
};

export type CreateSkillForkInput = {
  appId: PlatformId;
  skillId: PlatformId;
};

export type CreateSlackAgentChannelBindingInput = {
  agentId: PlatformId;
  appId: PlatformId;
  appLevelToken?: string | null | undefined;
  botToken: string;
  signingSecret: string;
  threadRepliesRequireMention?: boolean | null | undefined;
};

export type CreateSpaceDirectoryInput = {
  appId: PlatformId;
  name: string;
  path?: string | null | undefined;
  spaceId: PlatformId;
};

export type CreateSpaceInput = {
  appId: PlatformId;
  name: string;
};

export type CreateTelegramAgentChannelBindingInput = {
  agentId: PlatformId;
  appId: PlatformId;
  botToken: string;
  webhookSecret: string;
};

export type CreateVendorCredentialInput = {
  apiBase?: string | null | undefined;
  apiKey: string;
  appId: PlatformId;
  models?: Array<string> | null | undefined;
  name: string;
  vendorId: string;
};

export type DeleteAgentChannelBindingInput = {
  appId: PlatformId;
  bindingId: PlatformId;
};

export type DeleteAgentInput = {
  agentId: PlatformId;
  appId: PlatformId;
};

export type DeleteEnvironmentInput = {
  appId: PlatformId;
  environmentId: PlatformId;
};

export type DeleteSpaceEntryInput = {
  appId: PlatformId;
  key: string;
  spaceId: PlatformId;
};

export type DeleteVendorCredentialInput = {
  appId: PlatformId;
  id: PlatformId;
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
  | 'owner'
  | 'user';

export type EnvironmentVariableInput = {
  key: string;
  value?: string | null | undefined;
};

export type EnvironmentVariableStatus =
  | 'configured'
  | 'pending';

export type ExecuteAgentBuilderControlPlaneActionInput = {
  agentId: PlatformId;
  appId: PlatformId;
  createEnvironmentPayload?: AgentBuilderCreateEnvironmentPayloadInput | null | undefined;
  createRemoteMcpServerPayload?: AgentBuilderCreateRemoteMcpServerPayloadInput | null | undefined;
  draftYaml?: string | null | undefined;
  toolId: AgentBuilderExecutableActionToolId;
};

export type FileOwnerKind =
  | 'account'
  | 'app'
  | 'session'
  | 'space';

export type FilePurpose =
  | 'agent_asset'
  | 'agent_package'
  | 'app_draft'
  | 'session_attachment'
  | 'space_file';

export type FileScopeKind =
  | 'agent_package'
  | 'app_draft'
  | 'session'
  | 'space';

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
  appId: PlatformId;
  fileId: PlatformId;
};

export type LarkAppRegistrationStatus =
  | 'access_denied'
  | 'confirmed'
  | 'expired'
  | 'failed'
  | 'qr_pending'
  | 'slow_down';

export type LarkConnectionMode =
  | 'webhook'
  | 'websocket';

export type LarkDomain =
  | 'feishu'
  | 'lark';

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

export type PollLarkAgentChannelRegistrationInput = {
  agentId: PlatformId;
  appId: PlatformId;
  deviceCode: string;
  domain: LarkDomain;
};

export type PollWeChatAgentChannelPairingInput = {
  agentId: PlatformId;
  appId: PlatformId;
  qrToken: string;
};

export type PublishAgentInput = {
  agentId: PlatformId;
  appId: PlatformId;
};

export type RemoveSessionResourceInput = {
  appId: PlatformId;
  resourceId: PlatformId;
  sessionId: PlatformId;
};

export type RenameSessionInput = {
  appId: PlatformId;
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
  appId: PlatformId;
  applyActionKind?: string | null | undefined;
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
  | 'api_channel'
  | 'preview'
  | 'ui';

export type SetAppDefaultEnvironmentInput = {
  appId: PlatformId;
  environmentId: PlatformId;
};

export type SetSystemAgentModelInput = {
  modelId: string;
  vendor: string;
};

export type SkillSnapshotEntryKind =
  | 'directory'
  | 'file';

export type SkillSourceKind =
  | 'official'
  | 'user';

export type SpaceFileLockHolderType =
  | 'agent'
  | 'user';

export type SpaceRole =
  | 'admin'
  | 'edit'
  | 'read';

export type StartLarkAgentChannelRegistrationInput = {
  agentId: PlatformId;
  appId: PlatformId;
  domain: LarkDomain;
};

export type StartMcpOAuthInput = {
  appId: PlatformId;
  returnUrl?: string | null | undefined;
  serverId: PlatformId;
};

export type StartWeChatAgentChannelPairingInput = {
  agentId: PlatformId;
  appId: PlatformId;
};

export type TestVendorCredentialInput = {
  apiBase?: string | null | undefined;
  apiKey: string;
  appId: PlatformId;
  modelId?: string | null | undefined;
  vendorId: string;
};

export type UpdateAccountProfileInput = {
  imageUrl?: string | null | undefined;
  name: string;
};

export type UpdateAgentConfigInput = {
  agentId: PlatformId;
  appId: PlatformId;
  builder: AgentBuilderMetadataInput;
  description?: string | null | undefined;
  environment: AgentEnvironmentConfigInput;
  kind: AgentKind;
  mcpServerIds: Array<PlatformId>;
  model: string;
  name: string;
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
  appId: PlatformId;
  description?: string | null | undefined;
  envVars: Array<EnvironmentVariableInput>;
  environmentId: PlatformId;
  name: string;
  networkPolicy: EnvironmentNetworkPolicy;
  packages: Array<EnvironmentPackageSpecInput>;
  setupScript: string;
};

export type UpdateVendorCredentialInput = {
  apiBase?: string | null | undefined;
  apiKey?: string | null | undefined;
  appId: PlatformId;
  id: PlatformId;
  models?: Array<string> | null | undefined;
  name?: string | null | undefined;
};

export type WeChatQrPairingStatus =
  | 'confirmed'
  | 'expired'
  | 'failed'
  | 'idle'
  | 'qr_pending'
  | 'scanned';

export type EnsureAgentBuilderThreadMutationVariables = Exact<{
  agentId: PlatformId;
}>;


export type EnsureAgentBuilderThreadMutation = { ensureAgentBuilderThread: { agentId: PlatformId, createdAt: string, creatorAccountId: PlatformId, id: PlatformId, lastTurnAt: string | null, organizationId: PlatformId, status: AgentBuilderThreadStatus, title: string | null, updatedAt: string } };

export type ExecuteAgentBuilderControlPlaneActionMutationVariables = Exact<{
  input: ExecuteAgentBuilderControlPlaneActionInput;
}>;


export type ExecuteAgentBuilderControlPlaneActionMutation = { executeAgentBuilderControlPlaneAction: { message: string, sessionId: PlatformId | null, status: AgentBuilderControlPlaneActionStatus, toolId: AgentBuilderExecutableActionToolId, createdEnvironment: { id: PlatformId, name: string } | null, createdMcpServer: { authType: McpAuthType, id: PlatformId, name: string, url: string } | null, secureUi: { kind: AgentBuilderSecureUiActionKind, mcpServerId: PlatformId | null } | null } };

export type AgentBuilderMessagesQueryVariables = Exact<{
  agentId: PlatformId;
  beforeSeq?: number | null | undefined;
  limit?: number | null | undefined;
}>;


export type AgentBuilderMessagesQuery = { agentBuilderMessages: Array<{ cardsJson: string | null, contentText: string, createdAt: string, createdByAccountId: PlatformId | null, id: PlatformId, inputKind: string | null, plannerRunId: PlatformId | null, role: AgentBuilderMessageRole, seq: number, threadId: PlatformId }> };

export type AgentChannelBindingFieldsFragment = { activityLastTriggeredAt: string | null, activitySessionCount7d: number, agentId: PlatformId, createdAt: string, displayMetadata: PrimitiveRecord, externalBotId: string, externalTenantId: string, id: PlatformId, lastErrorCode: string | null, provider: ChannelProvider, status: AgentChannelBindingStatus, updatedAt: string };

export type AgentChannelBindingsQueryVariables = Exact<{
  appId: PlatformId;
  agentId: PlatformId;
}>;


export type AgentChannelBindingsQuery = { agentChannelBindingList: Array<{ activityLastTriggeredAt: string | null, activitySessionCount7d: number, agentId: PlatformId, createdAt: string, displayMetadata: PrimitiveRecord, externalBotId: string, externalTenantId: string, id: PlatformId, lastErrorCode: string | null, provider: ChannelProvider, status: AgentChannelBindingStatus, updatedAt: string }> };

export type CreateSlackAgentChannelBindingMutationVariables = Exact<{
  input: CreateSlackAgentChannelBindingInput;
}>;


export type CreateSlackAgentChannelBindingMutation = { createSlackAgentChannelBinding: { activityLastTriggeredAt: string | null, activitySessionCount7d: number, agentId: PlatformId, createdAt: string, displayMetadata: PrimitiveRecord, externalBotId: string, externalTenantId: string, id: PlatformId, lastErrorCode: string | null, provider: ChannelProvider, status: AgentChannelBindingStatus, updatedAt: string } };

export type CreateLarkAgentChannelBindingMutationVariables = Exact<{
  input: CreateLarkAgentChannelBindingInput;
}>;


export type CreateLarkAgentChannelBindingMutation = { createLarkAgentChannelBinding: { activityLastTriggeredAt: string | null, activitySessionCount7d: number, agentId: PlatformId, createdAt: string, displayMetadata: PrimitiveRecord, externalBotId: string, externalTenantId: string, id: PlatformId, lastErrorCode: string | null, provider: ChannelProvider, status: AgentChannelBindingStatus, updatedAt: string } };

export type LarkAgentChannelRegistrationFieldsFragment = { appId: string | null, appSecret: string | null, deviceCode: string | null, domain: LarkDomain, expireIn: number | null, interval: number | null, lastErrorCode: string | null, openId: string | null, qrUrl: string | null, status: LarkAppRegistrationStatus, userCode: string | null };

export type StartLarkAgentChannelRegistrationMutationVariables = Exact<{
  input: StartLarkAgentChannelRegistrationInput;
}>;


export type StartLarkAgentChannelRegistrationMutation = { startLarkAgentChannelRegistration: { appId: string | null, appSecret: string | null, deviceCode: string | null, domain: LarkDomain, expireIn: number | null, interval: number | null, lastErrorCode: string | null, openId: string | null, qrUrl: string | null, status: LarkAppRegistrationStatus, userCode: string | null } };

export type PollLarkAgentChannelRegistrationMutationVariables = Exact<{
  input: PollLarkAgentChannelRegistrationInput;
}>;


export type PollLarkAgentChannelRegistrationMutation = { pollLarkAgentChannelRegistration: { appId: string | null, appSecret: string | null, deviceCode: string | null, domain: LarkDomain, expireIn: number | null, interval: number | null, lastErrorCode: string | null, openId: string | null, qrUrl: string | null, status: LarkAppRegistrationStatus, userCode: string | null } };

export type CreateTelegramAgentChannelBindingMutationVariables = Exact<{
  input: CreateTelegramAgentChannelBindingInput;
}>;


export type CreateTelegramAgentChannelBindingMutation = { createTelegramAgentChannelBinding: { activityLastTriggeredAt: string | null, activitySessionCount7d: number, agentId: PlatformId, createdAt: string, displayMetadata: PrimitiveRecord, externalBotId: string, externalTenantId: string, id: PlatformId, lastErrorCode: string | null, provider: ChannelProvider, status: AgentChannelBindingStatus, updatedAt: string } };

export type CreateDiscordAgentChannelBindingMutationVariables = Exact<{
  input: CreateDiscordAgentChannelBindingInput;
}>;


export type CreateDiscordAgentChannelBindingMutation = { createDiscordAgentChannelBinding: { activityLastTriggeredAt: string | null, activitySessionCount7d: number, agentId: PlatformId, createdAt: string, displayMetadata: PrimitiveRecord, externalBotId: string, externalTenantId: string, id: PlatformId, lastErrorCode: string | null, provider: ChannelProvider, status: AgentChannelBindingStatus, updatedAt: string } };

export type WeChatAgentChannelPairingFieldsFragment = { lastErrorCode: string | null, qrCodeImageSrc: string | null, qrToken: string | null, status: WeChatQrPairingStatus, binding: { activityLastTriggeredAt: string | null, activitySessionCount7d: number, agentId: PlatformId, createdAt: string, displayMetadata: PrimitiveRecord, externalBotId: string, externalTenantId: string, id: PlatformId, lastErrorCode: string | null, provider: ChannelProvider, status: AgentChannelBindingStatus, updatedAt: string } | null };

export type StartWeChatAgentChannelPairingMutationVariables = Exact<{
  input: StartWeChatAgentChannelPairingInput;
}>;


export type StartWeChatAgentChannelPairingMutation = { startWeChatAgentChannelPairing: { lastErrorCode: string | null, qrCodeImageSrc: string | null, qrToken: string | null, status: WeChatQrPairingStatus, binding: { activityLastTriggeredAt: string | null, activitySessionCount7d: number, agentId: PlatformId, createdAt: string, displayMetadata: PrimitiveRecord, externalBotId: string, externalTenantId: string, id: PlatformId, lastErrorCode: string | null, provider: ChannelProvider, status: AgentChannelBindingStatus, updatedAt: string } | null } };

export type PollWeChatAgentChannelPairingMutationVariables = Exact<{
  input: PollWeChatAgentChannelPairingInput;
}>;


export type PollWeChatAgentChannelPairingMutation = { pollWeChatAgentChannelPairing: { lastErrorCode: string | null, qrCodeImageSrc: string | null, qrToken: string | null, status: WeChatQrPairingStatus, binding: { activityLastTriggeredAt: string | null, activitySessionCount7d: number, agentId: PlatformId, createdAt: string, displayMetadata: PrimitiveRecord, externalBotId: string, externalTenantId: string, id: PlatformId, lastErrorCode: string | null, provider: ChannelProvider, status: AgentChannelBindingStatus, updatedAt: string } | null } };

export type DeleteAgentChannelBindingMutationVariables = Exact<{
  input: DeleteAgentChannelBindingInput;
}>;


export type DeleteAgentChannelBindingMutation = { deleteAgentChannelBinding: { ok: boolean } };

export type AgentFieldsFragment = { createdAt: string, description: string | null, id: PlatformId, kind: AgentKind, model: string, name: string, appId: PlatformId, prompt: string, provider: string, runtimeId: string, status: AgentStatus, updatedAt: string, visibility: AgentVisibility, organizationId: PlatformId, liveVersion: { agentId: PlatformId, createdAt: string, createdByAccountId: PlatformId, environmentId: PlatformId | null, id: PlatformId, isLive: boolean, kind: AgentKind, model: string, provider: string, runtimeId: string, summary: string, versionNumber: number } | null, skills: Array<{ ownerName: string | null, skillId: PlatformId, skillName: string, state: AgentSkillState }> };

export type AgentToolSummaryFieldsFragment = { enabled: boolean, iconUrl: string | null, name: string, serverId: PlatformId };

export type AgentDeploymentVersionFieldsFragment = { agentId: PlatformId, createdAt: string, createdByAccountId: PlatformId, environmentId: PlatformId | null, id: PlatformId, isLive: boolean, kind: AgentKind, model: string, provider: string, runtimeId: string, summary: string, versionNumber: number };

export type AgentOwnerFieldsFragment = { id: PlatformId, imageUrl: string | null, name: string | null };

export type CreateAgentMutationVariables = Exact<{
  input: CreateAgentInput;
}>;


export type CreateAgentMutation = { createAgent: { createdAt: string, description: string | null, id: PlatformId, kind: AgentKind, model: string, name: string, appId: PlatformId, prompt: string, provider: string, runtimeId: string, status: AgentStatus, updatedAt: string, visibility: AgentVisibility, organizationId: PlatformId, liveVersion: { agentId: PlatformId, createdAt: string, createdByAccountId: PlatformId, environmentId: PlatformId | null, id: PlatformId, isLive: boolean, kind: AgentKind, model: string, provider: string, runtimeId: string, summary: string, versionNumber: number } | null, skills: Array<{ ownerName: string | null, skillId: PlatformId, skillName: string, state: AgentSkillState }> } };

export type DeleteAgentMutationVariables = Exact<{
  input: DeleteAgentInput;
}>;


export type DeleteAgentMutation = { deleteAgent: { ok: boolean } };

export type AccessibleAgentsQueryVariables = Exact<{
  appId: PlatformId;
}>;


export type AccessibleAgentsQuery = { accessibleAgentList: Array<{ createdAt: string, description: string | null, id: PlatformId, kind: AgentKind, name: string, appId: PlatformId, runtimeId: string, status: AgentStatus, updatedAt: string, viewerRole: AgentViewerRole, visibility: AgentVisibility, organizationId: PlatformId, owner: { id: PlatformId, imageUrl: string | null, name: string | null }, tools: Array<{ enabled: boolean, iconUrl: string | null, name: string, serverId: PlatformId }> }> };

export type AgentQueryVariables = Exact<{
  agentId: PlatformId;
  appId: PlatformId;
}>;


export type AgentQuery = { agent: { createdAt: string, description: string | null, id: PlatformId, kind: AgentKind, model: string, name: string, appId: PlatformId, prompt: string, provider: string, runtimeId: string, status: AgentStatus, updatedAt: string, viewerRole: AgentViewerRole, visibility: AgentVisibility, organizationId: PlatformId, liveVersion: { agentId: PlatformId, createdAt: string, createdByAccountId: PlatformId, environmentId: PlatformId | null, id: PlatformId, isLive: boolean, kind: AgentKind, model: string, provider: string, runtimeId: string, summary: string, versionNumber: number } | null, owner: { id: PlatformId, imageUrl: string | null, name: string | null }, skills: Array<{ ownerName: string | null, skillId: PlatformId, skillName: string, state: AgentSkillState }>, tools: Array<{ enabled: boolean, iconUrl: string | null, name: string, serverId: PlatformId }>, versions: Array<{ agentId: PlatformId, createdAt: string, createdByAccountId: PlatformId, environmentId: PlatformId | null, id: PlatformId, isLive: boolean, kind: AgentKind, model: string, provider: string, runtimeId: string, summary: string, versionNumber: number }> } };

export type AgentEditorStateQueryVariables = Exact<{
  agentId: PlatformId;
  appId: PlatformId;
}>;


export type AgentEditorStateQuery = { agentEditorState: { id: PlatformId, providerOptions: JsonObject, builder: { componentDecisions: { agentType: AgentBuilderAgentTypeDecision | null, environment: AgentBuilderComponentDecision | null } }, environment: { boundSpaceIds: Array<PlatformId>, environmentId: PlatformId | null }, packageResolution: { recordedAt: string, source: AgentPackageResolutionSource, report: { issues: Array<{ actionLabel: string | null, code: string, message: string, required: boolean, severity: AgentResolutionSeverity, status: AgentResolutionStatus, targetLabel: string | null, targetType: AgentResolutionTargetType }>, summary: { boundMcpServerCount: number, boundSkillCount: number, boundSpaceCount: number, copiedAssetCount: number, createdMcpServerCount: number, reusedMcpServerCount: number } } } | null, mcpBindings: Array<{ authType: McpAuthType, authorizationState: McpAuthorizationState, createdAt: string, credentialMode: AgentMcpCredentialMode, credentialScope: McpCredentialScope, credentialStatus: McpCredentialStatus, credentialSubject: string | null, enabled: boolean, hasCredential: boolean, iconUrl: string | null, id: PlatformId, name: string, serverId: PlatformId, source: McpServerSource, updatedAt: string, url: string }>, readiness: { checkedAt: string, ready: boolean, issues: Array<{ code: string, message: string, severity: AgentReadinessSeverity }> } } };

export type UpdateAgentConfigMutationVariables = Exact<{
  input: UpdateAgentConfigInput;
}>;


export type UpdateAgentConfigMutation = { updateAgentConfig: { createdAt: string, description: string | null, id: PlatformId, kind: AgentKind, model: string, name: string, appId: PlatformId, prompt: string, provider: string, runtimeId: string, status: AgentStatus, updatedAt: string, visibility: AgentVisibility, organizationId: PlatformId, liveVersion: { agentId: PlatformId, createdAt: string, createdByAccountId: PlatformId, environmentId: PlatformId | null, id: PlatformId, isLive: boolean, kind: AgentKind, model: string, provider: string, runtimeId: string, summary: string, versionNumber: number } | null, skills: Array<{ ownerName: string | null, skillId: PlatformId, skillName: string, state: AgentSkillState }> } };

export type AgentManifestQueryVariables = Exact<{
  agentId: PlatformId;
  appId: PlatformId;
}>;


export type AgentManifestQuery = { agentManifest: { agentId: PlatformId, json: string, yaml: string } };

export type ExportAgentPackageQueryVariables = Exact<{
  agentId: PlatformId;
  appId: PlatformId;
}>;


export type ExportAgentPackageQuery = { exportAgentPackage: { agentId: PlatformId, contentType: string, fileId: PlatformId, fileName: string, manifestYaml: string, size: number } };

export type ImportAgentPackageMutationVariables = Exact<{
  input: ImportAgentPackageInput;
}>;


export type ImportAgentPackageMutation = { importAgentPackage: { agent: { createdAt: string, description: string | null, id: PlatformId, kind: AgentKind, model: string, name: string, appId: PlatformId, prompt: string, provider: string, runtimeId: string, status: AgentStatus, updatedAt: string, visibility: AgentVisibility, organizationId: PlatformId, liveVersion: { agentId: PlatformId, createdAt: string, createdByAccountId: PlatformId, environmentId: PlatformId | null, id: PlatformId, isLive: boolean, kind: AgentKind, model: string, provider: string, runtimeId: string, summary: string, versionNumber: number } | null, skills: Array<{ ownerName: string | null, skillId: PlatformId, skillName: string, state: AgentSkillState }> }, resolution: { issues: Array<{ actionLabel: string | null, code: string, message: string, required: boolean, severity: AgentResolutionSeverity, status: AgentResolutionStatus, targetLabel: string | null, targetType: AgentResolutionTargetType }>, summary: { boundMcpServerCount: number, boundSkillCount: number, boundSpaceCount: number, copiedAssetCount: number, createdMcpServerCount: number, reusedMcpServerCount: number } } } };

export type CreateAgentForkMutationVariables = Exact<{
  input: CreateAgentForkInput;
}>;


export type CreateAgentForkMutation = { createAgentFork: { agent: { createdAt: string, description: string | null, id: PlatformId, kind: AgentKind, model: string, name: string, appId: PlatformId, prompt: string, provider: string, runtimeId: string, status: AgentStatus, updatedAt: string, visibility: AgentVisibility, organizationId: PlatformId, liveVersion: { agentId: PlatformId, createdAt: string, createdByAccountId: PlatformId, environmentId: PlatformId | null, id: PlatformId, isLive: boolean, kind: AgentKind, model: string, provider: string, runtimeId: string, summary: string, versionNumber: number } | null, skills: Array<{ ownerName: string | null, skillId: PlatformId, skillName: string, state: AgentSkillState }> }, resolution: { issues: Array<{ actionLabel: string | null, code: string, message: string, required: boolean, severity: AgentResolutionSeverity, status: AgentResolutionStatus, targetLabel: string | null, targetType: AgentResolutionTargetType }>, summary: { boundMcpServerCount: number, boundSkillCount: number, boundSpaceCount: number, copiedAssetCount: number, createdMcpServerCount: number, reusedMcpServerCount: number } } } };

export type PublishAgentMutationVariables = Exact<{
  input: PublishAgentInput;
}>;


export type PublishAgentMutation = { publishAgent: { createdAt: string, description: string | null, id: PlatformId, kind: AgentKind, model: string, name: string, appId: PlatformId, prompt: string, provider: string, runtimeId: string, status: AgentStatus, updatedAt: string, visibility: AgentVisibility, organizationId: PlatformId, liveVersion: { agentId: PlatformId, createdAt: string, createdByAccountId: PlatformId, environmentId: PlatformId | null, id: PlatformId, isLive: boolean, kind: AgentKind, model: string, provider: string, runtimeId: string, summary: string, versionNumber: number } | null, skills: Array<{ ownerName: string | null, skillId: PlatformId, skillName: string, state: AgentSkillState }> } };

export type UnpublishAgentMutationVariables = Exact<{
  agentId: PlatformId;
  appId: PlatformId;
}>;


export type UnpublishAgentMutation = { unpublishAgent: { createdAt: string, description: string | null, id: PlatformId, kind: AgentKind, model: string, name: string, appId: PlatformId, prompt: string, provider: string, runtimeId: string, status: AgentStatus, updatedAt: string, visibility: AgentVisibility, organizationId: PlatformId, liveVersion: { agentId: PlatformId, createdAt: string, createdByAccountId: PlatformId, environmentId: PlatformId | null, id: PlatformId, isLive: boolean, kind: AgentKind, model: string, provider: string, runtimeId: string, summary: string, versionNumber: number } | null, skills: Array<{ ownerName: string | null, skillId: PlatformId, skillName: string, state: AgentSkillState }> } };

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

export type AppListQueryVariables = Exact<{
  organizationId: PlatformId;
}>;


export type AppListQuery = { appList: Array<{ createdAt: string, defaultEnvironmentId: PlatformId | null, id: PlatformId, name: string, organizationId: PlatformId, ownerAccountId: PlatformId, slug: string }> };

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

export type AppCostCardQueryVariables = Exact<{
  appId: PlatformId;
  range: CostRange;
  runPurposes?: Array<CostRunPurpose> | null | undefined;
}>;


export type AppCostCardQuery = { appCostCard: { appId: PlatformId, appName: string, agents: Array<{ activeUsers: number, agentId: PlatformId, agentName: string, cacheCreationTokens: number, cacheReadTokens: number, debugCostUsd: number, evalCostUsd: number, inputTokens: number, outputTokens: number, ownerEmail: string | null, ownerId: PlatformId, ownerName: string, previousCostUsd: number | null, previewCostUsd: number, productionCostUsd: number, requestCount: number, scheduledCostUsd: number, totalCostUsd: number, unpricedRequestCount: number }>, daily: Array<{ activeUsers: number, cacheCreationTokens: number, cacheReadTokens: number, date: string, inputTokens: number, outputTokens: number, requestCount: number, totalCostUsd: number, unpricedRequestCount: number }>, models: Array<{ activeUsers: number, cacheCreationTokens: number, cacheReadTokens: number, cacheReadUsdPerMillion: number | null, cacheWriteUsdPerMillion: number | null, inputTokens: number, inputUsdPerMillion: number | null, model: string, outputTokens: number, outputUsdPerMillion: number | null, provider: string, requestCount: number, totalCostUsd: number, unpricedRequestCount: number, vendor: string }>, previousTotals: { activeUsers: number, cacheCreationTokens: number, cacheReadTokens: number, inputTokens: number, outputTokens: number, requestCount: number, totalCostUsd: number, unpricedRequestCount: number }, recentSessions: Array<{ actorEmail: string | null, actorName: string, cacheCreationTokens: number, cacheReadTokens: number, createdAt: string, inputTokens: number, model: string, outputTokens: number, provider: string, runPurpose: string, sessionId: PlatformId | null, sessionRunId: PlatformId | null, totalCostUsd: number }>, totals: { activeUsers: number, cacheCreationTokens: number, cacheReadTokens: number, inputTokens: number, outputTokens: number, requestCount: number, totalCostUsd: number, unpricedRequestCount: number } } };

export type AgentCostCardQueryVariables = Exact<{
  appId: PlatformId;
  agentId: PlatformId;
  range: CostRange;
  runPurposes?: Array<CostRunPurpose> | null | undefined;
}>;


export type AgentCostCardQuery = { agentCostCard: { agentId: PlatformId, agentName: string, ownerId: PlatformId, ownerName: string, agents: Array<{ activeUsers: number, agentId: PlatformId, agentName: string, cacheCreationTokens: number, cacheReadTokens: number, debugCostUsd: number, evalCostUsd: number, inputTokens: number, outputTokens: number, ownerEmail: string | null, ownerId: PlatformId, ownerName: string, previousCostUsd: number | null, previewCostUsd: number, productionCostUsd: number, requestCount: number, scheduledCostUsd: number, totalCostUsd: number, unpricedRequestCount: number }>, daily: Array<{ activeUsers: number, cacheCreationTokens: number, cacheReadTokens: number, date: string, inputTokens: number, outputTokens: number, requestCount: number, totalCostUsd: number, unpricedRequestCount: number }>, models: Array<{ activeUsers: number, cacheCreationTokens: number, cacheReadTokens: number, cacheReadUsdPerMillion: number | null, cacheWriteUsdPerMillion: number | null, inputTokens: number, inputUsdPerMillion: number | null, model: string, outputTokens: number, outputUsdPerMillion: number | null, provider: string, requestCount: number, totalCostUsd: number, unpricedRequestCount: number, vendor: string }>, recentSessions: Array<{ actorEmail: string | null, actorName: string, cacheCreationTokens: number, cacheReadTokens: number, createdAt: string, inputTokens: number, model: string, outputTokens: number, provider: string, runPurpose: string, sessionId: PlatformId | null, sessionRunId: PlatformId | null, totalCostUsd: number }>, totals: { activeUsers: number, cacheCreationTokens: number, cacheReadTokens: number, inputTokens: number, outputTokens: number, requestCount: number, totalCostUsd: number, unpricedRequestCount: number } } };

export type OrganizationBillingCostCardQueryVariables = Exact<{
  organizationId: PlatformId;
  range: CostRange;
  runPurposes?: Array<CostRunPurpose> | null | undefined;
}>;


export type OrganizationBillingCostCardQuery = { organizationBillingCostCard: { daily: Array<{ activeUsers: number, cacheCreationTokens: number, cacheReadTokens: number, date: string, inputTokens: number, outputTokens: number, requestCount: number, totalCostUsd: number, unpricedRequestCount: number }>, models: Array<{ activeUsers: number, cacheCreationTokens: number, cacheReadTokens: number, cacheReadUsdPerMillion: number | null, cacheWriteUsdPerMillion: number | null, inputTokens: number, inputUsdPerMillion: number | null, model: string, outputTokens: number, outputUsdPerMillion: number | null, provider: string, requestCount: number, totalCostUsd: number, unpricedRequestCount: number, vendor: string }>, previousTotals: { activeUsers: number, cacheCreationTokens: number, cacheReadTokens: number, inputTokens: number, outputTokens: number, requestCount: number, totalCostUsd: number, unpricedRequestCount: number }, totals: { activeUsers: number, cacheCreationTokens: number, cacheReadTokens: number, inputTokens: number, outputTokens: number, requestCount: number, totalCostUsd: number, unpricedRequestCount: number } } };

export type EnvironmentPackageFieldsFragment = { manager: EnvironmentPackageManager, packages: Array<string> };

export type EnvironmentVariableFieldsFragment = { key: string, preview: string, status: EnvironmentVariableStatus };

export type EnvironmentOwnerFieldsFragment = { id: PlatformId | null, imageUrl: string | null, name: string | null };

export type EnvironmentSummaryFieldsFragment = { allowMcpServers: boolean, allowPackageManagers: boolean, allowedHosts: Array<string>, canDelete: boolean, canEdit: boolean, createdAt: string, currentRevisionId: PlatformId, description: string, id: PlatformId, isBuiltIn: boolean, isDefault: boolean, isEditable: boolean, name: string, networkPolicy: EnvironmentNetworkPolicy, role: EnvironmentRegistryRole, setupScript: string, updatedAt: string, usedByAgentCount: number, appId: PlatformId, envVars: Array<{ key: string, preview: string, status: EnvironmentVariableStatus }>, forkOrigin: { environmentId: PlatformId, name: string, ownerName: string } | null, owner: { id: PlatformId | null, imageUrl: string | null, name: string | null }, packages: Array<{ manager: EnvironmentPackageManager, packages: Array<string> }> };

export type EnvironmentDetailFieldsFragment = { allowMcpServers: boolean, allowPackageManagers: boolean, allowedHosts: Array<string>, canDelete: boolean, canEdit: boolean, createdAt: string, currentRevisionId: PlatformId, description: string, id: PlatformId, isBuiltIn: boolean, isDefault: boolean, isEditable: boolean, name: string, networkPolicy: EnvironmentNetworkPolicy, role: EnvironmentRegistryRole, setupScript: string, updatedAt: string, usedByAgentCount: number, appId: PlatformId, envVars: Array<{ key: string, preview: string, status: EnvironmentVariableStatus }>, forkOrigin: { environmentId: PlatformId, name: string, ownerName: string } | null, owner: { id: PlatformId | null, imageUrl: string | null, name: string | null }, packages: Array<{ manager: EnvironmentPackageManager, packages: Array<string> }> };

export type AppEnvironmentsQueryVariables = Exact<{
  appId: PlatformId;
}>;


export type AppEnvironmentsQuery = { appEnvironmentList: Array<{ allowMcpServers: boolean, allowPackageManagers: boolean, allowedHosts: Array<string>, canDelete: boolean, canEdit: boolean, createdAt: string, currentRevisionId: PlatformId, description: string, id: PlatformId, isBuiltIn: boolean, isDefault: boolean, isEditable: boolean, name: string, networkPolicy: EnvironmentNetworkPolicy, role: EnvironmentRegistryRole, setupScript: string, updatedAt: string, usedByAgentCount: number, appId: PlatformId, envVars: Array<{ key: string, preview: string, status: EnvironmentVariableStatus }>, forkOrigin: { environmentId: PlatformId, name: string, ownerName: string } | null, owner: { id: PlatformId | null, imageUrl: string | null, name: string | null }, packages: Array<{ manager: EnvironmentPackageManager, packages: Array<string> }> }> };

export type EnvironmentDetailQueryVariables = Exact<{
  appId: PlatformId;
  environmentId: PlatformId;
}>;


export type EnvironmentDetailQuery = { environment: { allowMcpServers: boolean, allowPackageManagers: boolean, allowedHosts: Array<string>, canDelete: boolean, canEdit: boolean, createdAt: string, currentRevisionId: PlatformId, description: string, id: PlatformId, isBuiltIn: boolean, isDefault: boolean, isEditable: boolean, name: string, networkPolicy: EnvironmentNetworkPolicy, role: EnvironmentRegistryRole, setupScript: string, updatedAt: string, usedByAgentCount: number, appId: PlatformId, envVars: Array<{ key: string, preview: string, status: EnvironmentVariableStatus }>, forkOrigin: { environmentId: PlatformId, name: string, ownerName: string } | null, owner: { id: PlatformId | null, imageUrl: string | null, name: string | null }, packages: Array<{ manager: EnvironmentPackageManager, packages: Array<string> }> } };

export type CreateEnvironmentMutationVariables = Exact<{
  input: CreateEnvironmentInput;
}>;


export type CreateEnvironmentMutation = { createEnvironment: { allowMcpServers: boolean, allowPackageManagers: boolean, allowedHosts: Array<string>, canDelete: boolean, canEdit: boolean, createdAt: string, currentRevisionId: PlatformId, description: string, id: PlatformId, isBuiltIn: boolean, isDefault: boolean, isEditable: boolean, name: string, networkPolicy: EnvironmentNetworkPolicy, role: EnvironmentRegistryRole, setupScript: string, updatedAt: string, usedByAgentCount: number, appId: PlatformId, envVars: Array<{ key: string, preview: string, status: EnvironmentVariableStatus }>, forkOrigin: { environmentId: PlatformId, name: string, ownerName: string } | null, owner: { id: PlatformId | null, imageUrl: string | null, name: string | null }, packages: Array<{ manager: EnvironmentPackageManager, packages: Array<string> }> } };

export type UpdateEnvironmentMutationVariables = Exact<{
  input: UpdateEnvironmentInput;
}>;


export type UpdateEnvironmentMutation = { updateEnvironment: { allowMcpServers: boolean, allowPackageManagers: boolean, allowedHosts: Array<string>, canDelete: boolean, canEdit: boolean, createdAt: string, currentRevisionId: PlatformId, description: string, id: PlatformId, isBuiltIn: boolean, isDefault: boolean, isEditable: boolean, name: string, networkPolicy: EnvironmentNetworkPolicy, role: EnvironmentRegistryRole, setupScript: string, updatedAt: string, usedByAgentCount: number, appId: PlatformId, envVars: Array<{ key: string, preview: string, status: EnvironmentVariableStatus }>, forkOrigin: { environmentId: PlatformId, name: string, ownerName: string } | null, owner: { id: PlatformId | null, imageUrl: string | null, name: string | null }, packages: Array<{ manager: EnvironmentPackageManager, packages: Array<string> }> } };

export type CreateEnvironmentForkMutationVariables = Exact<{
  input: CreateEnvironmentForkInput;
}>;


export type CreateEnvironmentForkMutation = { createEnvironmentFork: { allowMcpServers: boolean, allowPackageManagers: boolean, allowedHosts: Array<string>, canDelete: boolean, canEdit: boolean, createdAt: string, currentRevisionId: PlatformId, description: string, id: PlatformId, isBuiltIn: boolean, isDefault: boolean, isEditable: boolean, name: string, networkPolicy: EnvironmentNetworkPolicy, role: EnvironmentRegistryRole, setupScript: string, updatedAt: string, usedByAgentCount: number, appId: PlatformId, envVars: Array<{ key: string, preview: string, status: EnvironmentVariableStatus }>, forkOrigin: { environmentId: PlatformId, name: string, ownerName: string } | null, owner: { id: PlatformId | null, imageUrl: string | null, name: string | null }, packages: Array<{ manager: EnvironmentPackageManager, packages: Array<string> }> } };

export type DeleteEnvironmentMutationVariables = Exact<{
  input: DeleteEnvironmentInput;
}>;


export type DeleteEnvironmentMutation = { deleteEnvironment: { ok: boolean } };

export type SetAppDefaultEnvironmentMutationVariables = Exact<{
  input: SetAppDefaultEnvironmentInput;
}>;


export type SetAppDefaultEnvironmentMutation = { setAppDefaultEnvironment: { allowMcpServers: boolean, allowPackageManagers: boolean, allowedHosts: Array<string>, canDelete: boolean, canEdit: boolean, createdAt: string, currentRevisionId: PlatformId, description: string, id: PlatformId, isBuiltIn: boolean, isDefault: boolean, isEditable: boolean, name: string, networkPolicy: EnvironmentNetworkPolicy, role: EnvironmentRegistryRole, setupScript: string, updatedAt: string, usedByAgentCount: number, appId: PlatformId, envVars: Array<{ key: string, preview: string, status: EnvironmentVariableStatus }>, forkOrigin: { environmentId: PlatformId, name: string, ownerName: string } | null, owner: { id: PlatformId | null, imageUrl: string | null, name: string | null }, packages: Array<{ manager: EnvironmentPackageManager, packages: Array<string> }> } };

export type McpCredentialFieldsFragment = { authType: McpAuthType, createdAt: string, expiresAt: string | null, id: PlatformId, scope: McpCredentialRecordScope, scopeValues: Array<string>, status: McpCredentialStatus, subjectLabel: string | null, updatedAt: string };

export type McpServerFieldsFragment = { authType: McpAuthType, authorizationState: McpAuthorizationState, createdAt: string, credentialScope: McpCredentialScope, credentialStatus: McpCredentialStatus, description: string | null, enabled: boolean, hasCredential: boolean, iconUrl: string | null, id: PlatformId, name: string, ownerId: PlatformId, ownerName: string, appId: PlatformId, source: McpServerSource, updatedAt: string, url: string, credential: { authType: McpAuthType, createdAt: string, expiresAt: string | null, id: PlatformId, scope: McpCredentialRecordScope, scopeValues: Array<string>, status: McpCredentialStatus, subjectLabel: string | null, updatedAt: string } | null };

export type McpRegistryQueryVariables = Exact<{
  appId: PlatformId;
}>;


export type McpRegistryQuery = { mcpRegistry: { currentUserEmail: string, currentUserId: PlatformId, currentUserName: string, appId: PlatformId, servers: Array<{ authType: McpAuthType, authorizationState: McpAuthorizationState, createdAt: string, credentialScope: McpCredentialScope, credentialStatus: McpCredentialStatus, description: string | null, enabled: boolean, hasCredential: boolean, iconUrl: string | null, id: PlatformId, name: string, ownerId: PlatformId, ownerName: string, appId: PlatformId, source: McpServerSource, updatedAt: string, url: string, credential: { authType: McpAuthType, createdAt: string, expiresAt: string | null, id: PlatformId, scope: McpCredentialRecordScope, scopeValues: Array<string>, status: McpCredentialStatus, subjectLabel: string | null, updatedAt: string } | null }> } };

export type CreateAppMcpServerMutationVariables = Exact<{
  input: CreateAppMcpServerInput;
}>;


export type CreateAppMcpServerMutation = { createAppMcpServer: { authType: McpAuthType, authorizationState: McpAuthorizationState, createdAt: string, credentialScope: McpCredentialScope, credentialStatus: McpCredentialStatus, description: string | null, enabled: boolean, hasCredential: boolean, iconUrl: string | null, id: PlatformId, name: string, ownerId: PlatformId, ownerName: string, appId: PlatformId, source: McpServerSource, updatedAt: string, url: string, credential: { authType: McpAuthType, createdAt: string, expiresAt: string | null, id: PlatformId, scope: McpCredentialRecordScope, scopeValues: Array<string>, status: McpCredentialStatus, subjectLabel: string | null, updatedAt: string } | null } };

export type ConnectMcpBearerMutationVariables = Exact<{
  input: ConnectMcpBearerInput;
}>;


export type ConnectMcpBearerMutation = { connectMcpBearer: { authType: McpAuthType, authorizationState: McpAuthorizationState, createdAt: string, credentialScope: McpCredentialScope, credentialStatus: McpCredentialStatus, description: string | null, enabled: boolean, hasCredential: boolean, iconUrl: string | null, id: PlatformId, name: string, ownerId: PlatformId, ownerName: string, appId: PlatformId, source: McpServerSource, updatedAt: string, url: string, credential: { authType: McpAuthType, createdAt: string, expiresAt: string | null, id: PlatformId, scope: McpCredentialRecordScope, scopeValues: Array<string>, status: McpCredentialStatus, subjectLabel: string | null, updatedAt: string } | null } };

export type RevokeMcpCredentialMutationVariables = Exact<{
  appId: PlatformId;
  serverId: PlatformId;
}>;


export type RevokeMcpCredentialMutation = { revokeMcpCredential: { authType: McpAuthType, authorizationState: McpAuthorizationState, createdAt: string, credentialScope: McpCredentialScope, credentialStatus: McpCredentialStatus, description: string | null, enabled: boolean, hasCredential: boolean, iconUrl: string | null, id: PlatformId, name: string, ownerId: PlatformId, ownerName: string, appId: PlatformId, source: McpServerSource, updatedAt: string, url: string, credential: { authType: McpAuthType, createdAt: string, expiresAt: string | null, id: PlatformId, scope: McpCredentialRecordScope, scopeValues: Array<string>, status: McpCredentialStatus, subjectLabel: string | null, updatedAt: string } | null } };

export type SetMcpServerEnabledMutationVariables = Exact<{
  appId: PlatformId;
  serverId: PlatformId;
  enabled: boolean;
}>;


export type SetMcpServerEnabledMutation = { setMcpServerEnabled: { authType: McpAuthType, authorizationState: McpAuthorizationState, createdAt: string, credentialScope: McpCredentialScope, credentialStatus: McpCredentialStatus, description: string | null, enabled: boolean, hasCredential: boolean, iconUrl: string | null, id: PlatformId, name: string, ownerId: PlatformId, ownerName: string, appId: PlatformId, source: McpServerSource, updatedAt: string, url: string, credential: { authType: McpAuthType, createdAt: string, expiresAt: string | null, id: PlatformId, scope: McpCredentialRecordScope, scopeValues: Array<string>, status: McpCredentialStatus, subjectLabel: string | null, updatedAt: string } | null } };

export type DeleteMcpServerMutationVariables = Exact<{
  appId: PlatformId;
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


export type OnboardingBootstrapMutation = { onboardingBootstrap: { completed: boolean, organization: { avatarUrl: string | null, createdAt: string, id: PlatformId, name: string, slug: string } | null } };

export type ThreadAgentSessionRetrieveQueryVariables = Exact<{
  appId: PlatformId;
  sessionId: PlatformId;
}>;


export type ThreadAgentSessionRetrieveQuery = { threadAgentSessionRetrieve: { capabilities: Array<{ action: AgentSessionActionCapabilityName, reason: string | null, status: AgentSessionActionCapabilityStatus }>, recoverability: { reason: string | null, status: AgentSessionRecoverabilityStatus }, session: { agentId: PlatformId, archivedAt: string | null, createdAt: string, deploymentVersionId: PlatformId | null, deploymentVersionNumber: number | null, id: PlatformId, kind: AgentKind, lastMessageAt: string | null, model: string, organizationId: PlatformId, provider: string, appId: PlatformId, runtimeId: string, status: SessionStatus, title: string | null, updatedAt: string, lastRun: { completedAt: string | null, createdAt: string, deploymentVersionId: PlatformId | null, deploymentVersionNumber: number | null, id: PlatformId, model: string | null, provider: string | null, startedAt: string | null, status: RunStatus, traceId: string, trigger: SessionRunTrigger, updatedAt: string, error: { code: string, details: PrimitiveRecord, message: string, retryable: boolean } | null } | null } } };

export type AgentSessionDiagnosticsQueryVariables = Exact<{
  appId: PlatformId;
  sessionId: PlatformId;
}>;


export type AgentSessionDiagnosticsQuery = { agentSessionDiagnostics: { generatedAt: string, pendingPermissionCount: number, execution: { binding: { deploymentVersionId: PlatformId | null, deploymentVersionNumber: number | null, kind: AgentKind, model: string, provider: string, runtimeId: string, sessionId: PlatformId }, skills: Array<{ skillId: PlatformId, skillName: string }>, spaces: Array<{ spaceId: PlatformId }>, tools: Array<{ credentialMode: string, serverId: PlatformId }> } | null, nativeRuntimeRef: { kind: string | null, runtimeId: string | null, status: string, valuePreview: string | null }, session: { deploymentVersionId: PlatformId | null, deploymentVersionNumber: number | null, id: PlatformId, kind: AgentKind, model: string, provider: string, runtimeId: string, status: SessionStatus, title: string | null, lastRun: { deploymentVersionId: PlatformId | null, deploymentVersionNumber: number | null, id: PlatformId, model: string | null, provider: string | null, status: RunStatus, traceId: string } | null } } };

export type CreateAgentSessionMutationVariables = Exact<{
  input: CreateAgentSessionInput;
}>;


export type CreateAgentSessionMutation = { createAgentSession: { agentId: PlatformId, archivedAt: string | null, createdAt: string, deploymentVersionId: PlatformId | null, deploymentVersionNumber: number | null, id: PlatformId, kind: AgentKind, lastMessageAt: string | null, model: string, provider: string, appId: PlatformId, runtimeId: string, status: SessionStatus, title: string | null, type: SessionType, updatedAt: string, organizationId: PlatformId, lastRun: { completedAt: string | null, createdAt: string, deploymentVersionId: PlatformId | null, deploymentVersionNumber: number | null, id: PlatformId, model: string | null, provider: string | null, startedAt: string | null, status: RunStatus, traceId: string, trigger: SessionRunTrigger, updatedAt: string, error: { code: string, details: PrimitiveRecord, message: string, retryable: boolean } | null } | null } };

export type AgentSessionListQueryVariables = Exact<{
  agentId: PlatformId;
  archived?: boolean | null | undefined;
  participantOnly?: boolean | null | undefined;
  appId: PlatformId;
  type?: SessionType | null | undefined;
}>;


export type AgentSessionListQuery = { agentSessionList: { nodes: Array<{ agentId: PlatformId, archivedAt: string | null, createdAt: string, deploymentVersionId: PlatformId | null, deploymentVersionNumber: number | null, id: PlatformId, kind: AgentKind, lastMessageAt: string | null, model: string, provider: string, appId: PlatformId, runtimeId: string, status: SessionStatus, title: string | null, type: SessionType, updatedAt: string, organizationId: PlatformId, lastRun: { completedAt: string | null, createdAt: string, deploymentVersionId: PlatformId | null, deploymentVersionNumber: number | null, id: PlatformId, model: string | null, provider: string | null, startedAt: string | null, status: RunStatus, traceId: string, trigger: SessionRunTrigger, updatedAt: string, error: { code: string, details: PrimitiveRecord, message: string, retryable: boolean } | null } | null }> } };

export type AgentSessionProcessEventsQueryVariables = Exact<{
  limit: number;
  appId: PlatformId;
  sessionId: PlatformId;
}>;


export type AgentSessionProcessEventsQuery = { sessionProcessEvents: Array<{ content: string, durationMs: number | null, id: PlatformId, occurredAt: string, status: SessionProcessEventStatus, tokens: number | null, type: SessionProcessEventType }> };

export type ThreadSessionMessagesQueryVariables = Exact<{
  appId: PlatformId;
  sessionId: PlatformId;
}>;


export type ThreadSessionMessagesQuery = { threadSessionMessages: Array<{ content: string, createdAt: string, createdBy: PlatformId, id: PlatformId, role: SessionMessageRole, plan: Array<{ content: string, priority: SessionMessagePlanPriority, status: SessionMessagePlanStatus }>, segments: Array<{ argsText: string | null, kind: SessionMessageSegmentKind, output: string | null, path: string | null, text: string | null, tool: string | null, toolCallId: string | null }> }> };

export type SendAgentSessionEventsMutationVariables = Exact<{
  appId: PlatformId;
  sessionId: PlatformId;
  events: Array<AgentSessionEventInput>;
}>;


export type SendAgentSessionEventsMutation = { sendAgentSessionEvents: { acceptedAt: string, warnings: Array<{ code: string, message: string }> } };

export type PrewarmAgentSessionMutationVariables = Exact<{
  appId: PlatformId;
  sessionId: PlatformId;
}>;


export type PrewarmAgentSessionMutation = { prewarmAgentSession: { scheduledAt: string, sessionId: PlatformId } };

export type SessionsQueryVariables = Exact<{
  appId: PlatformId;
  archived?: boolean | null | undefined;
  type?: SessionType | null | undefined;
}>;


export type SessionsQuery = { sessionList: { nodes: Array<{ agentId: PlatformId, archivedAt: string | null, createdAt: string, deploymentVersionId: PlatformId | null, deploymentVersionNumber: number | null, id: PlatformId, kind: AgentKind, lastMessageAt: string | null, model: string, provider: string, appId: PlatformId, runtimeId: string, status: SessionStatus, title: string | null, type: SessionType, updatedAt: string, organizationId: PlatformId, lastRun: { completedAt: string | null, createdAt: string, deploymentVersionId: PlatformId | null, deploymentVersionNumber: number | null, id: PlatformId, model: string | null, provider: string | null, startedAt: string | null, status: RunStatus, traceId: string, trigger: SessionRunTrigger, updatedAt: string, error: { code: string, details: PrimitiveRecord, message: string, retryable: boolean } | null } | null }> } };

export type ThreadAgentSessionListQueryVariables = Exact<{
  appId: PlatformId;
  archived?: boolean | null | undefined;
  type?: SessionType | null | undefined;
}>;


export type ThreadAgentSessionListQuery = { threadAgentSessionList: { nodes: Array<{ capabilities: Array<{ action: AgentSessionActionCapabilityName, reason: string | null, status: AgentSessionActionCapabilityStatus }>, session: { agentId: PlatformId, archivedAt: string | null, createdAt: string, deploymentVersionId: PlatformId | null, deploymentVersionNumber: number | null, id: PlatformId, kind: AgentKind, lastMessageAt: string | null, model: string, provider: string, appId: PlatformId, runtimeId: string, status: SessionStatus, title: string | null, type: SessionType, updatedAt: string, organizationId: PlatformId, lastRun: { completedAt: string | null, createdAt: string, deploymentVersionId: PlatformId | null, deploymentVersionNumber: number | null, id: PlatformId, model: string | null, provider: string | null, startedAt: string | null, status: RunStatus, traceId: string, trigger: SessionRunTrigger, updatedAt: string, error: { code: string, details: PrimitiveRecord, message: string, retryable: boolean } | null } | null } }> } };

export type AutoTitleSessionMutationVariables = Exact<{
  input: RenameSessionInput;
}>;


export type AutoTitleSessionMutation = { autoTitleSession: { id: PlatformId } };

export type ArchiveSessionMutationVariables = Exact<{
  appId: PlatformId;
  sessionId: PlatformId;
}>;


export type ArchiveSessionMutation = { archiveAgentSession: { ok: boolean } };

export type RestoreSessionMutationVariables = Exact<{
  appId: PlatformId;
  sessionId: PlatformId;
}>;


export type RestoreSessionMutation = { unarchiveAgentSession: { ok: boolean } };

export type DeleteAgentSessionMutationVariables = Exact<{
  appId: PlatformId;
  sessionId: PlatformId;
}>;


export type DeleteAgentSessionMutation = { deleteAgentSession: { ok: boolean } };

export type AddSessionResourceMutationVariables = Exact<{
  input: AddSessionResourceInput;
}>;


export type AddSessionResourceMutation = { addSessionResource: { contentType: string, expectedSize: number, expiresAt: string, fileId: PlatformId, partSize: number | null, path: string, purpose: FilePurpose, status: FileUploadStatus, strategy: FileUploadStrategy, owner: { id: PlatformId, kind: FileOwnerKind }, scope: { id: PlatformId, kind: FileScopeKind } } };

export type ListSessionResourcesQueryVariables = Exact<{
  appId: PlatformId;
  sessionId: PlatformId;
}>;


export type ListSessionResourcesQuery = { listSessionResources: Array<{ createdAt: string, id: PlatformId, mimeType: string | null, name: string, path: string, size: number }> };

export type RemoveSessionResourceMutationVariables = Exact<{
  input: RemoveSessionResourceInput;
}>;


export type RemoveSessionResourceMutation = { removeSessionResource: { ok: boolean } };

export type SessionProcessEventsQueryVariables = Exact<{
  limit: number;
  appId: PlatformId;
  sessionId: PlatformId;
}>;


export type SessionProcessEventsQuery = { threadSessionProcessEvents: Array<{ content: string, durationMs: number | null, id: PlatformId, occurredAt: string, status: SessionProcessEventStatus, tokens: number | null, type: SessionProcessEventType }> };

export type SkillSummaryFieldsFragment = { author: string, createdAt: string, description: string, id: PlatformId, name: string, ownerId: PlatformId, ownerName: string, appId: PlatformId, snapshotId: PlatformId, sourceKind: SkillSourceKind, updatedAt: string, forkOrigin: { name: string, ownerName: string, skillId: PlatformId } | null };

export type SkillDetailFieldsFragment = { author: string, createdAt: string, description: string, id: PlatformId, name: string, ownerId: PlatformId, ownerName: string, appId: PlatformId, snapshotId: PlatformId, sourceKind: SkillSourceKind, updatedAt: string, forkOrigin: { name: string, ownerName: string, skillId: PlatformId } | null, currentSnapshot: { archiveFormat: string, author: string, blobKey: string, blobSha256: string, blobSize: number, compression: string, createdAt: string, description: string, id: PlatformId, name: string, skillMarkdownPath: string, uncompressedSize: number, version: string | null }, entries: Array<{ entryKind: SkillSnapshotEntryKind, isExecutable: boolean, mimeType: string | null, path: string, sha256: string | null, size: number }> };

export type SkillDetailQueryVariables = Exact<{
  appId: PlatformId;
  skillId: PlatformId;
}>;


export type SkillDetailQuery = { skillDetail: { author: string, createdAt: string, description: string, id: PlatformId, name: string, ownerId: PlatformId, ownerName: string, appId: PlatformId, snapshotId: PlatformId, sourceKind: SkillSourceKind, updatedAt: string, forkOrigin: { name: string, ownerName: string, skillId: PlatformId } | null, currentSnapshot: { archiveFormat: string, author: string, blobKey: string, blobSha256: string, blobSize: number, compression: string, createdAt: string, description: string, id: PlatformId, name: string, skillMarkdownPath: string, uncompressedSize: number, version: string | null }, entries: Array<{ entryKind: SkillSnapshotEntryKind, isExecutable: boolean, mimeType: string | null, path: string, sha256: string | null, size: number }> } };

export type AppSkillsQueryVariables = Exact<{
  appId: PlatformId;
}>;


export type AppSkillsQuery = { appSkillList: Array<{ author: string, createdAt: string, description: string, id: PlatformId, name: string, ownerId: PlatformId, ownerName: string, appId: PlatformId, snapshotId: PlatformId, sourceKind: SkillSourceKind, updatedAt: string, forkOrigin: { name: string, ownerName: string, skillId: PlatformId } | null }> };

export type CreateSkillForkMutationVariables = Exact<{
  input: CreateSkillForkInput;
}>;


export type CreateSkillForkMutation = { createSkillFork: { author: string, createdAt: string, description: string, id: PlatformId, name: string, ownerId: PlatformId, ownerName: string, appId: PlatformId, snapshotId: PlatformId, sourceKind: SkillSourceKind, updatedAt: string, forkOrigin: { name: string, ownerName: string, skillId: PlatformId } | null } };

export type DeleteOwnedSkillMutationVariables = Exact<{
  appId: PlatformId;
  skillId: PlatformId;
}>;


export type DeleteOwnedSkillMutation = { deleteOwnedSkill: { ok: boolean } };

export type CreateSpaceMutationVariables = Exact<{
  input: CreateSpaceInput;
}>;


export type CreateSpaceMutation = { createSpace: { createdAt: string, id: PlatformId, name: string, ownerId: PlatformId, appId: PlatformId, role: SpaceRole, storagePrefix: string, canDelete: boolean, viewerAssetRole: SpaceRole } };

export type DeleteSpaceMutationVariables = Exact<{
  appId: PlatformId;
  spaceId: PlatformId;
}>;


export type DeleteSpaceMutation = { deleteSpace: { ok: boolean } };

export type SpaceFilesQueryVariables = Exact<{
  appId: PlatformId;
  spaceId: PlatformId;
  path?: string | null | undefined;
}>;


export type SpaceFilesQuery = { spaceFiles: { directories: Array<{ key: string }>, files: Array<{ etag: string | null, id: PlatformId, key: string, mimeType: string | null, size: number, uploadedAt: string, version: number, lock: { expiresAt: number, path: string, holder: { displayName: string | null, id: PlatformId, type: SpaceFileLockHolderType } } | null }> } };

export type CreateSpaceDirectoryMutationVariables = Exact<{
  input: CreateSpaceDirectoryInput;
}>;


export type CreateSpaceDirectoryMutation = { createSpaceDirectory: { key: string } };

export type DeleteSpaceEntryMutationVariables = Exact<{
  input: DeleteSpaceEntryInput;
}>;


export type DeleteSpaceEntryMutation = { deleteSpaceEntry: { ok: boolean } };

export type SpacesQueryVariables = Exact<{
  appId: PlatformId;
}>;


export type SpacesQuery = { spaceList: Array<{ createdAt: string, id: PlatformId, name: string, ownerId: PlatformId, appId: PlatformId, role: SpaceRole, storagePrefix: string, canDelete: boolean, viewerAssetRole: SpaceRole }> };

export type ViewerQueryVariables = Exact<{ [key: string]: never; }>;


export type ViewerQuery = { viewer: { account: { email: string, id: PlatformId, imageUrl: string | null, name: string, systemAgentModel: { modelId: string, vendor: string } | null } | null, activeOrganization: { avatarUrl: string | null, createdAt: string, id: PlatformId, name: string, slug: string } | null, auth: { currentSecurityLevel: AuthSecurityLevel, methods: Array<AuthMethod> }, organizations: Array<{ avatarUrl: string | null, createdAt: string, id: PlatformId, name: string, slug: string }> } };

export type UpdateProfileMutationVariables = Exact<{
  input: UpdateAccountProfileInput;
}>;


export type UpdateProfileMutation = { updateProfile: { imageUrl: string | null, name: string } };

export type SetSystemAgentModelMutationVariables = Exact<{
  input: SetSystemAgentModelInput;
}>;


export type SetSystemAgentModelMutation = { setSystemAgentModel: { id: PlatformId, systemAgentModel: { modelId: string, vendor: string } | null } };

export type VendorCredentialListQueryVariables = Exact<{
  appId: PlatformId;
}>;


export type VendorCredentialListQuery = { vendorCredentialList: Array<{ apiBase: string | null, id: PlatformId, maskedApiKey: string, models: Array<string> | null, name: string, appId: PlatformId, vendorId: string }> };

export type CreateVendorCredentialMutationVariables = Exact<{
  input: CreateVendorCredentialInput;
}>;


export type CreateVendorCredentialMutation = { createVendorCredential: { apiBase: string | null, id: PlatformId, maskedApiKey: string, models: Array<string> | null, name: string, appId: PlatformId, vendorId: string } };

export type UpdateVendorCredentialMutationVariables = Exact<{
  input: UpdateVendorCredentialInput;
}>;


export type UpdateVendorCredentialMutation = { updateVendorCredential: { apiBase: string | null, id: PlatformId, maskedApiKey: string, models: Array<string> | null, name: string, appId: PlatformId, vendorId: string } };

export type DeleteVendorCredentialMutationVariables = Exact<{
  input: DeleteVendorCredentialInput;
}>;


export type DeleteVendorCredentialMutation = { deleteVendorCredential: { ok: boolean } };

export type AvailableAgentModelsQueryVariables = Exact<{
  appId: PlatformId;
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
export const LarkAgentChannelRegistrationFieldsFragmentDoc = new TypedDocumentString(`
    fragment LarkAgentChannelRegistrationFields on LarkAgentChannelRegistration {
  appId
  appSecret
  deviceCode
  domain
  expireIn
  interval
  lastErrorCode
  openId
  qrUrl
  status
  userCode
}
    `, {"fragmentName":"LarkAgentChannelRegistrationFields"}) as unknown as TypedDocumentString<LarkAgentChannelRegistrationFieldsFragment, unknown>;
export const AgentChannelBindingFieldsFragmentDoc = new TypedDocumentString(`
    fragment AgentChannelBindingFields on AgentChannelBinding {
  activityLastTriggeredAt
  activitySessionCount7d
  agentId
  createdAt
  displayMetadata
  externalBotId
  externalTenantId
  id
  lastErrorCode
  provider
  status
  updatedAt
}
    `, {"fragmentName":"AgentChannelBindingFields"}) as unknown as TypedDocumentString<AgentChannelBindingFieldsFragment, unknown>;
export const WeChatAgentChannelPairingFieldsFragmentDoc = new TypedDocumentString(`
    fragment WeChatAgentChannelPairingFields on WeChatAgentChannelPairing {
  binding {
    ...AgentChannelBindingFields
  }
  lastErrorCode
  qrCodeImageSrc
  qrToken
  status
}
    fragment AgentChannelBindingFields on AgentChannelBinding {
  activityLastTriggeredAt
  activitySessionCount7d
  agentId
  createdAt
  displayMetadata
  externalBotId
  externalTenantId
  id
  lastErrorCode
  provider
  status
  updatedAt
}`, {"fragmentName":"WeChatAgentChannelPairingFields"}) as unknown as TypedDocumentString<WeChatAgentChannelPairingFieldsFragment, unknown>;
export const AgentDeploymentVersionFieldsFragmentDoc = new TypedDocumentString(`
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
export const AgentFieldsFragmentDoc = new TypedDocumentString(`
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
  appId
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
  organizationId
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
export const CostAgentFieldsFragmentDoc = new TypedDocumentString(`
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
export const CostAttributionFieldsFragmentDoc = new TypedDocumentString(`
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
export const EnvironmentVariableFieldsFragmentDoc = new TypedDocumentString(`
    fragment EnvironmentVariableFields on EnvironmentVariablePreview {
  key
  preview
  status
}
    `, {"fragmentName":"EnvironmentVariableFields"}) as unknown as TypedDocumentString<EnvironmentVariableFieldsFragment, unknown>;
export const EnvironmentOwnerFieldsFragmentDoc = new TypedDocumentString(`
    fragment EnvironmentOwnerFields on EnvironmentOwnerSummary {
  id
  imageUrl
  name
}
    `, {"fragmentName":"EnvironmentOwnerFields"}) as unknown as TypedDocumentString<EnvironmentOwnerFieldsFragment, unknown>;
export const EnvironmentPackageFieldsFragmentDoc = new TypedDocumentString(`
    fragment EnvironmentPackageFields on EnvironmentPackageSpec {
  manager
  packages
}
    `, {"fragmentName":"EnvironmentPackageFields"}) as unknown as TypedDocumentString<EnvironmentPackageFieldsFragment, unknown>;
export const EnvironmentSummaryFieldsFragmentDoc = new TypedDocumentString(`
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
  appId
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
export const EnvironmentDetailFieldsFragmentDoc = new TypedDocumentString(`
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
  appId
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
  appId
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
export const SkillSummaryFieldsFragmentDoc = new TypedDocumentString(`
    fragment SkillSummaryFields on SkillSummary {
  author
  createdAt
  description
  forkOrigin {
    name
    ownerName
    skillId
  }
  id
  name
  ownerId
  ownerName
  appId
  snapshotId
  sourceKind
  updatedAt
}
    `, {"fragmentName":"SkillSummaryFields"}) as unknown as TypedDocumentString<SkillSummaryFieldsFragment, unknown>;
export const SkillDetailFieldsFragmentDoc = new TypedDocumentString(`
    fragment SkillDetailFields on SkillDetail {
  author
  createdAt
  description
  forkOrigin {
    name
    ownerName
    skillId
  }
  id
  name
  ownerId
  ownerName
  appId
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
export const EnsureAgentBuilderThreadDocument = new TypedDocumentString(`
    mutation EnsureAgentBuilderThread($agentId: ULID!) {
  ensureAgentBuilderThread(agentId: $agentId) {
    agentId
    createdAt
    creatorAccountId
    id
    lastTurnAt
    organizationId
    status
    title
    updatedAt
  }
}
    `) as unknown as TypedDocumentString<EnsureAgentBuilderThreadMutation, EnsureAgentBuilderThreadMutationVariables>;
export const ExecuteAgentBuilderControlPlaneActionDocument = new TypedDocumentString(`
    mutation ExecuteAgentBuilderControlPlaneAction($input: ExecuteAgentBuilderControlPlaneActionInput!) {
  executeAgentBuilderControlPlaneAction(input: $input) {
    createdEnvironment {
      id
      name
    }
    createdMcpServer {
      authType
      id
      name
      url
    }
    message
    secureUi {
      kind
      mcpServerId
    }
    sessionId
    status
    toolId
  }
}
    `) as unknown as TypedDocumentString<ExecuteAgentBuilderControlPlaneActionMutation, ExecuteAgentBuilderControlPlaneActionMutationVariables>;
export const AgentBuilderMessagesDocument = new TypedDocumentString(`
    query AgentBuilderMessages($agentId: ULID!, $beforeSeq: Int, $limit: Int) {
  agentBuilderMessages(agentId: $agentId, beforeSeq: $beforeSeq, limit: $limit) {
    cardsJson
    contentText
    createdAt
    createdByAccountId
    id
    inputKind
    plannerRunId
    role
    seq
    threadId
  }
}
    `) as unknown as TypedDocumentString<AgentBuilderMessagesQuery, AgentBuilderMessagesQueryVariables>;
export const AgentChannelBindingsDocument = new TypedDocumentString(`
    query AgentChannelBindings($appId: ULID!, $agentId: ULID!) {
  agentChannelBindingList(appId: $appId, agentId: $agentId) {
    ...AgentChannelBindingFields
  }
}
    fragment AgentChannelBindingFields on AgentChannelBinding {
  activityLastTriggeredAt
  activitySessionCount7d
  agentId
  createdAt
  displayMetadata
  externalBotId
  externalTenantId
  id
  lastErrorCode
  provider
  status
  updatedAt
}`) as unknown as TypedDocumentString<AgentChannelBindingsQuery, AgentChannelBindingsQueryVariables>;
export const CreateSlackAgentChannelBindingDocument = new TypedDocumentString(`
    mutation CreateSlackAgentChannelBinding($input: CreateSlackAgentChannelBindingInput!) {
  createSlackAgentChannelBinding(input: $input) {
    ...AgentChannelBindingFields
  }
}
    fragment AgentChannelBindingFields on AgentChannelBinding {
  activityLastTriggeredAt
  activitySessionCount7d
  agentId
  createdAt
  displayMetadata
  externalBotId
  externalTenantId
  id
  lastErrorCode
  provider
  status
  updatedAt
}`) as unknown as TypedDocumentString<CreateSlackAgentChannelBindingMutation, CreateSlackAgentChannelBindingMutationVariables>;
export const CreateLarkAgentChannelBindingDocument = new TypedDocumentString(`
    mutation CreateLarkAgentChannelBinding($input: CreateLarkAgentChannelBindingInput!) {
  createLarkAgentChannelBinding(input: $input) {
    ...AgentChannelBindingFields
  }
}
    fragment AgentChannelBindingFields on AgentChannelBinding {
  activityLastTriggeredAt
  activitySessionCount7d
  agentId
  createdAt
  displayMetadata
  externalBotId
  externalTenantId
  id
  lastErrorCode
  provider
  status
  updatedAt
}`) as unknown as TypedDocumentString<CreateLarkAgentChannelBindingMutation, CreateLarkAgentChannelBindingMutationVariables>;
export const StartLarkAgentChannelRegistrationDocument = new TypedDocumentString(`
    mutation StartLarkAgentChannelRegistration($input: StartLarkAgentChannelRegistrationInput!) {
  startLarkAgentChannelRegistration(input: $input) {
    ...LarkAgentChannelRegistrationFields
  }
}
    fragment LarkAgentChannelRegistrationFields on LarkAgentChannelRegistration {
  appId
  appSecret
  deviceCode
  domain
  expireIn
  interval
  lastErrorCode
  openId
  qrUrl
  status
  userCode
}`) as unknown as TypedDocumentString<StartLarkAgentChannelRegistrationMutation, StartLarkAgentChannelRegistrationMutationVariables>;
export const PollLarkAgentChannelRegistrationDocument = new TypedDocumentString(`
    mutation PollLarkAgentChannelRegistration($input: PollLarkAgentChannelRegistrationInput!) {
  pollLarkAgentChannelRegistration(input: $input) {
    ...LarkAgentChannelRegistrationFields
  }
}
    fragment LarkAgentChannelRegistrationFields on LarkAgentChannelRegistration {
  appId
  appSecret
  deviceCode
  domain
  expireIn
  interval
  lastErrorCode
  openId
  qrUrl
  status
  userCode
}`) as unknown as TypedDocumentString<PollLarkAgentChannelRegistrationMutation, PollLarkAgentChannelRegistrationMutationVariables>;
export const CreateTelegramAgentChannelBindingDocument = new TypedDocumentString(`
    mutation CreateTelegramAgentChannelBinding($input: CreateTelegramAgentChannelBindingInput!) {
  createTelegramAgentChannelBinding(input: $input) {
    ...AgentChannelBindingFields
  }
}
    fragment AgentChannelBindingFields on AgentChannelBinding {
  activityLastTriggeredAt
  activitySessionCount7d
  agentId
  createdAt
  displayMetadata
  externalBotId
  externalTenantId
  id
  lastErrorCode
  provider
  status
  updatedAt
}`) as unknown as TypedDocumentString<CreateTelegramAgentChannelBindingMutation, CreateTelegramAgentChannelBindingMutationVariables>;
export const CreateDiscordAgentChannelBindingDocument = new TypedDocumentString(`
    mutation CreateDiscordAgentChannelBinding($input: CreateDiscordAgentChannelBindingInput!) {
  createDiscordAgentChannelBinding(input: $input) {
    ...AgentChannelBindingFields
  }
}
    fragment AgentChannelBindingFields on AgentChannelBinding {
  activityLastTriggeredAt
  activitySessionCount7d
  agentId
  createdAt
  displayMetadata
  externalBotId
  externalTenantId
  id
  lastErrorCode
  provider
  status
  updatedAt
}`) as unknown as TypedDocumentString<CreateDiscordAgentChannelBindingMutation, CreateDiscordAgentChannelBindingMutationVariables>;
export const StartWeChatAgentChannelPairingDocument = new TypedDocumentString(`
    mutation StartWeChatAgentChannelPairing($input: StartWeChatAgentChannelPairingInput!) {
  startWeChatAgentChannelPairing(input: $input) {
    ...WeChatAgentChannelPairingFields
  }
}
    fragment AgentChannelBindingFields on AgentChannelBinding {
  activityLastTriggeredAt
  activitySessionCount7d
  agentId
  createdAt
  displayMetadata
  externalBotId
  externalTenantId
  id
  lastErrorCode
  provider
  status
  updatedAt
}
fragment WeChatAgentChannelPairingFields on WeChatAgentChannelPairing {
  binding {
    ...AgentChannelBindingFields
  }
  lastErrorCode
  qrCodeImageSrc
  qrToken
  status
}`) as unknown as TypedDocumentString<StartWeChatAgentChannelPairingMutation, StartWeChatAgentChannelPairingMutationVariables>;
export const PollWeChatAgentChannelPairingDocument = new TypedDocumentString(`
    mutation PollWeChatAgentChannelPairing($input: PollWeChatAgentChannelPairingInput!) {
  pollWeChatAgentChannelPairing(input: $input) {
    ...WeChatAgentChannelPairingFields
  }
}
    fragment AgentChannelBindingFields on AgentChannelBinding {
  activityLastTriggeredAt
  activitySessionCount7d
  agentId
  createdAt
  displayMetadata
  externalBotId
  externalTenantId
  id
  lastErrorCode
  provider
  status
  updatedAt
}
fragment WeChatAgentChannelPairingFields on WeChatAgentChannelPairing {
  binding {
    ...AgentChannelBindingFields
  }
  lastErrorCode
  qrCodeImageSrc
  qrToken
  status
}`) as unknown as TypedDocumentString<PollWeChatAgentChannelPairingMutation, PollWeChatAgentChannelPairingMutationVariables>;
export const DeleteAgentChannelBindingDocument = new TypedDocumentString(`
    mutation DeleteAgentChannelBinding($input: DeleteAgentChannelBindingInput!) {
  deleteAgentChannelBinding(input: $input) {
    ok
  }
}
    `) as unknown as TypedDocumentString<DeleteAgentChannelBindingMutation, DeleteAgentChannelBindingMutationVariables>;
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
  kind
  liveVersion {
    ...AgentDeploymentVersionFields
  }
  model
  name
  appId
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
  organizationId
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
export const DeleteAgentDocument = new TypedDocumentString(`
    mutation DeleteAgent($input: DeleteAgentInput!) {
  deleteAgent(input: $input) {
    ok
  }
}
    `) as unknown as TypedDocumentString<DeleteAgentMutation, DeleteAgentMutationVariables>;
export const AccessibleAgentsDocument = new TypedDocumentString(`
    query AccessibleAgents($appId: ULID!) {
  accessibleAgentList(appId: $appId) {
    createdAt
    description
    id
    kind
    name
    appId
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
    organizationId
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
    query Agent($agentId: ULID!, $appId: ULID!) {
  agent(agentId: $agentId, appId: $appId) {
    createdAt
    description
    id
    kind
    liveVersion {
      ...AgentDeploymentVersionFields
    }
    model
    name
    appId
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
    organizationId
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
export const AgentEditorStateDocument = new TypedDocumentString(`
    query AgentEditorState($agentId: ULID!, $appId: ULID!) {
  agentEditorState(agentId: $agentId, appId: $appId) {
    id
    builder {
      componentDecisions {
        agentType
        environment
      }
    }
    environment {
      boundSpaceIds
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
          boundSpaceCount
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
  kind
  liveVersion {
    ...AgentDeploymentVersionFields
  }
  model
  name
  appId
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
  organizationId
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
export const AgentManifestDocument = new TypedDocumentString(`
    query AgentManifest($agentId: ULID!, $appId: ULID!) {
  agentManifest(agentId: $agentId, appId: $appId) {
    agentId
    json
    yaml
  }
}
    `) as unknown as TypedDocumentString<AgentManifestQuery, AgentManifestQueryVariables>;
export const ExportAgentPackageDocument = new TypedDocumentString(`
    query ExportAgentPackage($agentId: ULID!, $appId: ULID!) {
  exportAgentPackage(agentId: $agentId, appId: $appId) {
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
        boundSpaceCount
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
  appId
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
  organizationId
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
        boundSpaceCount
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
  appId
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
  organizationId
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
  kind
  liveVersion {
    ...AgentDeploymentVersionFields
  }
  model
  name
  appId
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
  organizationId
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
export const UnpublishAgentDocument = new TypedDocumentString(`
    mutation UnpublishAgent($agentId: ULID!, $appId: ULID!) {
  unpublishAgent(agentId: $agentId, appId: $appId) {
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
  appId
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
  organizationId
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
export const RestartDriverDocument = new TypedDocumentString(`
    mutation RestartDriver($input: RuntimeStateOperationInput!) {
  restartDriver(input: $input) {
    affectedSessionCount
    agentId
    ok
    operation
  }
}
    `) as unknown as TypedDocumentString<RestartDriverMutation, RestartDriverMutationVariables>;
export const RecreateSandboxDocument = new TypedDocumentString(`
    mutation RecreateSandbox($input: RuntimeStateOperationInput!) {
  recreateSandbox(input: $input) {
    affectedSessionCount
    agentId
    ok
    operation
  }
}
    `) as unknown as TypedDocumentString<RecreateSandboxMutation, RecreateSandboxMutationVariables>;
export const ResetAgentStateDocument = new TypedDocumentString(`
    mutation ResetAgentState($input: RuntimeStateOperationInput!) {
  resetAgentState(input: $input) {
    affectedSessionCount
    agentId
    ok
    operation
  }
}
    `) as unknown as TypedDocumentString<ResetAgentStateMutation, ResetAgentStateMutationVariables>;
export const AppListDocument = new TypedDocumentString(`
    query AppList($organizationId: ULID!) {
  appList(organizationId: $organizationId) {
    createdAt
    defaultEnvironmentId
    id
    name
    organizationId
    ownerAccountId
    slug
  }
}
    `) as unknown as TypedDocumentString<AppListQuery, AppListQueryVariables>;
export const AppCostCardDocument = new TypedDocumentString(`
    query AppCostCard($appId: ULID!, $range: CostRange!, $runPurposes: [CostRunPurpose!]) {
  appCostCard(appId: $appId, range: $range, runPurposes: $runPurposes) {
    appId
    appName
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
}`) as unknown as TypedDocumentString<AppCostCardQuery, AppCostCardQueryVariables>;
export const AgentCostCardDocument = new TypedDocumentString(`
    query AgentCostCard($appId: ULID!, $agentId: ULID!, $range: CostRange!, $runPurposes: [CostRunPurpose!]) {
  agentCostCard(
    appId: $appId
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
export const OrganizationBillingCostCardDocument = new TypedDocumentString(`
    query OrganizationBillingCostCard($organizationId: ULID!, $range: CostRange!, $runPurposes: [CostRunPurpose!]) {
  organizationBillingCostCard(
    organizationId: $organizationId
    range: $range
    runPurposes: $runPurposes
  ) {
    daily {
      ...CostDailyFields
    }
    models {
      ...CostModelFields
    }
    previousTotals {
      ...CostTotalsFields
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
}`) as unknown as TypedDocumentString<OrganizationBillingCostCardQuery, OrganizationBillingCostCardQueryVariables>;
export const AppEnvironmentsDocument = new TypedDocumentString(`
    query AppEnvironments($appId: ULID!) {
  appEnvironmentList(appId: $appId) {
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
  appId
}`) as unknown as TypedDocumentString<AppEnvironmentsQuery, AppEnvironmentsQueryVariables>;
export const EnvironmentDetailDocument = new TypedDocumentString(`
    query EnvironmentDetail($appId: ULID!, $environmentId: ULID!) {
  environment(appId: $appId, environmentId: $environmentId) {
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
  appId
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
  appId
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
  appId
}`) as unknown as TypedDocumentString<UpdateEnvironmentMutation, UpdateEnvironmentMutationVariables>;
export const CreateEnvironmentForkDocument = new TypedDocumentString(`
    mutation CreateEnvironmentFork($input: CreateEnvironmentForkInput!) {
  createEnvironmentFork(input: $input) {
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
  appId
}`) as unknown as TypedDocumentString<CreateEnvironmentForkMutation, CreateEnvironmentForkMutationVariables>;
export const DeleteEnvironmentDocument = new TypedDocumentString(`
    mutation DeleteEnvironment($input: DeleteEnvironmentInput!) {
  deleteEnvironment(input: $input) {
    ok
  }
}
    `) as unknown as TypedDocumentString<DeleteEnvironmentMutation, DeleteEnvironmentMutationVariables>;
export const SetAppDefaultEnvironmentDocument = new TypedDocumentString(`
    mutation SetAppDefaultEnvironment($input: SetAppDefaultEnvironmentInput!) {
  setAppDefaultEnvironment(input: $input) {
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
  appId
}`) as unknown as TypedDocumentString<SetAppDefaultEnvironmentMutation, SetAppDefaultEnvironmentMutationVariables>;
export const McpRegistryDocument = new TypedDocumentString(`
    query McpRegistry($appId: ULID!) {
  mcpRegistry(appId: $appId) {
    currentUserEmail
    currentUserId
    currentUserName
    appId
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
  appId
  source
  updatedAt
  url
  credential {
    ...McpCredentialFields
  }
}`) as unknown as TypedDocumentString<McpRegistryQuery, McpRegistryQueryVariables>;
export const CreateAppMcpServerDocument = new TypedDocumentString(`
    mutation CreateAppMcpServer($input: CreateAppMcpServerInput!) {
  createAppMcpServer(input: $input) {
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
  appId
  source
  updatedAt
  url
  credential {
    ...McpCredentialFields
  }
}`) as unknown as TypedDocumentString<CreateAppMcpServerMutation, CreateAppMcpServerMutationVariables>;
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
  appId
  source
  updatedAt
  url
  credential {
    ...McpCredentialFields
  }
}`) as unknown as TypedDocumentString<ConnectMcpBearerMutation, ConnectMcpBearerMutationVariables>;
export const RevokeMcpCredentialDocument = new TypedDocumentString(`
    mutation RevokeMcpCredential($appId: ULID!, $serverId: ULID!) {
  revokeMcpCredential(appId: $appId, serverId: $serverId) {
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
  appId
  source
  updatedAt
  url
  credential {
    ...McpCredentialFields
  }
}`) as unknown as TypedDocumentString<RevokeMcpCredentialMutation, RevokeMcpCredentialMutationVariables>;
export const SetMcpServerEnabledDocument = new TypedDocumentString(`
    mutation SetMcpServerEnabled($appId: ULID!, $serverId: ULID!, $enabled: Boolean!) {
  setMcpServerEnabled(appId: $appId, serverId: $serverId, enabled: $enabled) {
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
  appId
  source
  updatedAt
  url
  credential {
    ...McpCredentialFields
  }
}`) as unknown as TypedDocumentString<SetMcpServerEnabledMutation, SetMcpServerEnabledMutationVariables>;
export const DeleteMcpServerDocument = new TypedDocumentString(`
    mutation DeleteMcpServer($appId: ULID!, $serverId: ULID!) {
  deleteMcpServer(appId: $appId, serverId: $serverId) {
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
      avatarUrl
      createdAt
      id
      name
      slug
    }
  }
}
    `) as unknown as TypedDocumentString<OnboardingBootstrapMutation, OnboardingBootstrapMutationVariables>;
export const ThreadAgentSessionRetrieveDocument = new TypedDocumentString(`
    query ThreadAgentSessionRetrieve($appId: ULID!, $sessionId: ULID!) {
  threadAgentSessionRetrieve(appId: $appId, sessionId: $sessionId) {
    capabilities {
      action
      reason
      status
    }
    recoverability {
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
      organizationId
      provider
      appId
      runtimeId
      status
      title
      updatedAt
    }
  }
}
    `) as unknown as TypedDocumentString<ThreadAgentSessionRetrieveQuery, ThreadAgentSessionRetrieveQueryVariables>;
export const AgentSessionDiagnosticsDocument = new TypedDocumentString(`
    query AgentSessionDiagnostics($appId: ULID!, $sessionId: ULID!) {
  agentSessionDiagnostics(appId: $appId, sessionId: $sessionId) {
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
      spaces {
        spaceId
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
export const CreateAgentSessionDocument = new TypedDocumentString(`
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
    appId
    runtimeId
    status
    title
    type
    updatedAt
    organizationId
  }
}
    `) as unknown as TypedDocumentString<CreateAgentSessionMutation, CreateAgentSessionMutationVariables>;
export const AgentSessionListDocument = new TypedDocumentString(`
    query AgentSessionList($agentId: ULID!, $archived: Boolean, $participantOnly: Boolean, $appId: ULID!, $type: SessionType) {
  agentSessionList(
    agentId: $agentId
    archived: $archived
    participantOnly: $participantOnly
    appId: $appId
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
      appId
      runtimeId
      status
      title
      type
      updatedAt
      organizationId
    }
  }
}
    `) as unknown as TypedDocumentString<AgentSessionListQuery, AgentSessionListQueryVariables>;
export const AgentSessionProcessEventsDocument = new TypedDocumentString(`
    query AgentSessionProcessEvents($limit: Int!, $appId: ULID!, $sessionId: ULID!) {
  sessionProcessEvents(limit: $limit, appId: $appId, sessionId: $sessionId) {
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
export const ThreadSessionMessagesDocument = new TypedDocumentString(`
    query ThreadSessionMessages($appId: ULID!, $sessionId: ULID!) {
  threadSessionMessages(appId: $appId, sessionId: $sessionId) {
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
    mutation SendAgentSessionEvents($appId: ULID!, $sessionId: ULID!, $events: [AgentSessionEventInput!]!) {
  sendAgentSessionEvents(appId: $appId, sessionId: $sessionId, events: $events) {
    acceptedAt
    warnings {
      code
      message
    }
  }
}
    `) as unknown as TypedDocumentString<SendAgentSessionEventsMutation, SendAgentSessionEventsMutationVariables>;
export const PrewarmAgentSessionDocument = new TypedDocumentString(`
    mutation PrewarmAgentSession($appId: ULID!, $sessionId: ULID!) {
  prewarmAgentSession(appId: $appId, sessionId: $sessionId) {
    scheduledAt
    sessionId
  }
}
    `) as unknown as TypedDocumentString<PrewarmAgentSessionMutation, PrewarmAgentSessionMutationVariables>;
export const SessionsDocument = new TypedDocumentString(`
    query Sessions($appId: ULID!, $archived: Boolean, $type: SessionType) {
  sessionList(appId: $appId, archived: $archived, type: $type) {
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
      appId
      runtimeId
      status
      title
      type
      updatedAt
      organizationId
    }
  }
}
    `) as unknown as TypedDocumentString<SessionsQuery, SessionsQueryVariables>;
export const ThreadAgentSessionListDocument = new TypedDocumentString(`
    query ThreadAgentSessionList($appId: ULID!, $archived: Boolean, $type: SessionType) {
  threadAgentSessionList(appId: $appId, archived: $archived, type: $type) {
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
        appId
        runtimeId
        status
        title
        type
        updatedAt
        organizationId
      }
    }
  }
}
    `) as unknown as TypedDocumentString<ThreadAgentSessionListQuery, ThreadAgentSessionListQueryVariables>;
export const AutoTitleSessionDocument = new TypedDocumentString(`
    mutation AutoTitleSession($input: RenameSessionInput!) {
  autoTitleSession(input: $input) {
    id
  }
}
    `) as unknown as TypedDocumentString<AutoTitleSessionMutation, AutoTitleSessionMutationVariables>;
export const ArchiveSessionDocument = new TypedDocumentString(`
    mutation ArchiveSession($appId: ULID!, $sessionId: ULID!) {
  archiveAgentSession(appId: $appId, sessionId: $sessionId) {
    ok
  }
}
    `) as unknown as TypedDocumentString<ArchiveSessionMutation, ArchiveSessionMutationVariables>;
export const RestoreSessionDocument = new TypedDocumentString(`
    mutation RestoreSession($appId: ULID!, $sessionId: ULID!) {
  unarchiveAgentSession(appId: $appId, sessionId: $sessionId) {
    ok
  }
}
    `) as unknown as TypedDocumentString<RestoreSessionMutation, RestoreSessionMutationVariables>;
export const DeleteAgentSessionDocument = new TypedDocumentString(`
    mutation DeleteAgentSession($appId: ULID!, $sessionId: ULID!) {
  deleteAgentSession(appId: $appId, sessionId: $sessionId) {
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
    owner {
      id
      kind
    }
    partSize
    path
    purpose
    scope {
      id
      kind
    }
    status
    strategy
  }
}
    `) as unknown as TypedDocumentString<AddSessionResourceMutation, AddSessionResourceMutationVariables>;
export const ListSessionResourcesDocument = new TypedDocumentString(`
    query ListSessionResources($appId: ULID!, $sessionId: ULID!) {
  listSessionResources(appId: $appId, sessionId: $sessionId) {
    createdAt
    id
    mimeType
    name
    path
    size
  }
}
    `) as unknown as TypedDocumentString<ListSessionResourcesQuery, ListSessionResourcesQueryVariables>;
export const RemoveSessionResourceDocument = new TypedDocumentString(`
    mutation RemoveSessionResource($input: RemoveSessionResourceInput!) {
  removeSessionResource(input: $input) {
    ok
  }
}
    `) as unknown as TypedDocumentString<RemoveSessionResourceMutation, RemoveSessionResourceMutationVariables>;
export const SessionProcessEventsDocument = new TypedDocumentString(`
    query SessionProcessEvents($limit: Int!, $appId: ULID!, $sessionId: ULID!) {
  threadSessionProcessEvents(limit: $limit, appId: $appId, sessionId: $sessionId) {
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
    query SkillDetail($appId: ULID!, $skillId: ULID!) {
  skillDetail(appId: $appId, skillId: $skillId) {
    ...SkillDetailFields
  }
}
    fragment SkillDetailFields on SkillDetail {
  author
  createdAt
  description
  forkOrigin {
    name
    ownerName
    skillId
  }
  id
  name
  ownerId
  ownerName
  appId
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
export const AppSkillsDocument = new TypedDocumentString(`
    query AppSkills($appId: ULID!) {
  appSkillList(appId: $appId) {
    ...SkillSummaryFields
  }
}
    fragment SkillSummaryFields on SkillSummary {
  author
  createdAt
  description
  forkOrigin {
    name
    ownerName
    skillId
  }
  id
  name
  ownerId
  ownerName
  appId
  snapshotId
  sourceKind
  updatedAt
}`) as unknown as TypedDocumentString<AppSkillsQuery, AppSkillsQueryVariables>;
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
  forkOrigin {
    name
    ownerName
    skillId
  }
  id
  name
  ownerId
  ownerName
  appId
  snapshotId
  sourceKind
  updatedAt
}`) as unknown as TypedDocumentString<CreateSkillForkMutation, CreateSkillForkMutationVariables>;
export const DeleteOwnedSkillDocument = new TypedDocumentString(`
    mutation DeleteOwnedSkill($appId: ULID!, $skillId: ULID!) {
  deleteOwnedSkill(appId: $appId, skillId: $skillId) {
    ok
  }
}
    `) as unknown as TypedDocumentString<DeleteOwnedSkillMutation, DeleteOwnedSkillMutationVariables>;
export const CreateSpaceDocument = new TypedDocumentString(`
    mutation CreateSpace($input: CreateSpaceInput!) {
  createSpace(input: $input) {
    createdAt
    id
    name
    ownerId
    appId
    role
    storagePrefix
    canDelete
    viewerAssetRole
  }
}
    `) as unknown as TypedDocumentString<CreateSpaceMutation, CreateSpaceMutationVariables>;
export const DeleteSpaceDocument = new TypedDocumentString(`
    mutation DeleteSpace($appId: ULID!, $spaceId: ULID!) {
  deleteSpace(appId: $appId, spaceId: $spaceId) {
    ok
  }
}
    `) as unknown as TypedDocumentString<DeleteSpaceMutation, DeleteSpaceMutationVariables>;
export const SpaceFilesDocument = new TypedDocumentString(`
    query SpaceFiles($appId: ULID!, $spaceId: ULID!, $path: String) {
  spaceFiles(appId: $appId, spaceId: $spaceId, path: $path) {
    directories {
      key
    }
    files {
      etag
      id
      key
      lock {
        expiresAt
        holder {
          displayName
          id
          type
        }
        path
      }
      mimeType
      size
      uploadedAt
      version
    }
  }
}
    `) as unknown as TypedDocumentString<SpaceFilesQuery, SpaceFilesQueryVariables>;
export const CreateSpaceDirectoryDocument = new TypedDocumentString(`
    mutation CreateSpaceDirectory($input: CreateSpaceDirectoryInput!) {
  createSpaceDirectory(input: $input) {
    key
  }
}
    `) as unknown as TypedDocumentString<CreateSpaceDirectoryMutation, CreateSpaceDirectoryMutationVariables>;
export const DeleteSpaceEntryDocument = new TypedDocumentString(`
    mutation DeleteSpaceEntry($input: DeleteSpaceEntryInput!) {
  deleteSpaceEntry(input: $input) {
    ok
  }
}
    `) as unknown as TypedDocumentString<DeleteSpaceEntryMutation, DeleteSpaceEntryMutationVariables>;
export const SpacesDocument = new TypedDocumentString(`
    query Spaces($appId: ULID!) {
  spaceList(appId: $appId) {
    createdAt
    id
    name
    ownerId
    appId
    role
    storagePrefix
    canDelete
    viewerAssetRole
  }
}
    `) as unknown as TypedDocumentString<SpacesQuery, SpacesQueryVariables>;
export const ViewerDocument = new TypedDocumentString(`
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
      slug
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
      slug
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
export const SetSystemAgentModelDocument = new TypedDocumentString(`
    mutation SetSystemAgentModel($input: SetSystemAgentModelInput!) {
  setSystemAgentModel(input: $input) {
    id
    systemAgentModel {
      modelId
      vendor
    }
  }
}
    `) as unknown as TypedDocumentString<SetSystemAgentModelMutation, SetSystemAgentModelMutationVariables>;
export const VendorCredentialListDocument = new TypedDocumentString(`
    query VendorCredentialList($appId: ULID!) {
  vendorCredentialList(appId: $appId) {
    apiBase
    id
    maskedApiKey
    models
    name
    appId
    vendorId
  }
}
    `) as unknown as TypedDocumentString<VendorCredentialListQuery, VendorCredentialListQueryVariables>;
export const CreateVendorCredentialDocument = new TypedDocumentString(`
    mutation CreateVendorCredential($input: CreateVendorCredentialInput!) {
  createVendorCredential(input: $input) {
    apiBase
    id
    maskedApiKey
    models
    name
    appId
    vendorId
  }
}
    `) as unknown as TypedDocumentString<CreateVendorCredentialMutation, CreateVendorCredentialMutationVariables>;
export const UpdateVendorCredentialDocument = new TypedDocumentString(`
    mutation UpdateVendorCredential($input: UpdateVendorCredentialInput!) {
  updateVendorCredential(input: $input) {
    apiBase
    id
    maskedApiKey
    models
    name
    appId
    vendorId
  }
}
    `) as unknown as TypedDocumentString<UpdateVendorCredentialMutation, UpdateVendorCredentialMutationVariables>;
export const DeleteVendorCredentialDocument = new TypedDocumentString(`
    mutation DeleteVendorCredential($input: DeleteVendorCredentialInput!) {
  deleteVendorCredential(input: $input) {
    ok
  }
}
    `) as unknown as TypedDocumentString<DeleteVendorCredentialMutation, DeleteVendorCredentialMutationVariables>;
export const AvailableAgentModelsDocument = new TypedDocumentString(`
    query AvailableAgentModels($appId: ULID!, $runtimeId: String!, $currentModelId: String, $currentVendorId: String) {
  availableAgentModels(
    appId: $appId
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
export const TestVendorCredentialDocument = new TypedDocumentString(`
    mutation TestVendorCredential($input: TestVendorCredentialInput!) {
  testVendorCredential(input: $input) {
    errorCode
    latencyMs
    ok
  }
}
    `) as unknown as TypedDocumentString<TestVendorCredentialMutation, TestVendorCredentialMutationVariables>;
