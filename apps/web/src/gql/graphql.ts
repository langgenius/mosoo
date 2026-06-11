/* eslint-disable */
/** Internal type. DO NOT USE DIRECTLY. */
type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
/** Internal type. DO NOT USE DIRECTLY. */
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
import type { JsonObject, PrimitiveRecord } from '@mosoo/contracts';
import type { PlatformId } from '@mosoo/id';
import type { DocumentTypeDecoration } from '@graphql-typed-document-node/core';
export type AcceptOrganizationInvitationInput = {
  invitationId: PlatformId;
};

export type AddAgentCollaboratorInput = {
  agentId: PlatformId;
  principal: string;
  role: AgentCollaboratorRole;
};

export type AddCollaboratorInput = {
  email: string;
  role: SpaceRole;
  spaceId: PlatformId;
};

export type AddOrganizationCollaboratorInput = {
  spaceId: PlatformId;
};

export type AddSessionResourceFileInput = {
  contentType: string;
  name: string;
  size: number;
};

export type AddSessionResourceInput = {
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

export type AgentCollaboratorRole =
  | 'admin'
  | 'user';

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
  | 'admin'
  | 'none'
  | 'owner'
  | 'user';

export type AgentVisibility =
  | 'organization'
  | 'private';

export type AuthMethod =
  | 'email_otp'
  | 'google_oauth';

export type AuthSecurityLevel =
  | 'basic'
  | 'strong'
  | 'verified_email';

export type BootstrapOnboardingInput = {
  action: string;
  name?: string | null | undefined;
  organizationId?: PlatformId | null | undefined;
};

export type CancelOrganizationInvitationInput = {
  invitationId: PlatformId;
};

export type ChannelProvider =
  | 'discord'
  | 'lark'
  | 'slack'
  | 'telegram'
  | 'wechat';

export type ConnectMcpBearerInput = {
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
};

export type CreateAgentInput = {
  description?: string | null | undefined;
  kind: AgentKind;
  model: string;
  name: string;
  organizationId: PlatformId;
  prompt: string;
  provider: string;
  runtimeId: string;
  skillIds: Array<PlatformId>;
};

export type CreateAgentSessionInput = {
  agentId: PlatformId;
  type?: SessionType | null | undefined;
  waitForRuntimeReady?: boolean | null | undefined;
};

export type CreateDiscordAgentChannelBindingInput = {
  agentId: PlatformId;
  applicationId: string;
  botToken: string;
  relaySecret: string;
};

export type CreateEnvironmentForkInput = {
  environmentId: PlatformId;
};

export type CreateEnvironmentInput = {
  allowMcpServers: boolean;
  allowPackageManagers: boolean;
  allowedHosts: Array<string>;
  description?: string | null | undefined;
  envVars: Array<EnvironmentVariableInput>;
  name: string;
  networkPolicy: EnvironmentNetworkPolicy;
  organizationId: PlatformId;
  packages: Array<EnvironmentPackageSpecInput>;
  setupScript: string;
};

export type CreateLarkAgentChannelBindingInput = {
  agentId: PlatformId;
  appId: string;
  appSecret: string;
  connectionMode: LarkConnectionMode;
  domain: LarkDomain;
  encryptKey?: string | null | undefined;
  verificationToken?: string | null | undefined;
};

export type CreateOrganizationInput = {
  name?: string | null | undefined;
};

export type CreateOrganizationMcpServerInput = {
  authType: McpAuthType;
  credentialScope: McpCredentialScope;
  description?: string | null | undefined;
  iconUrl?: string | null | undefined;
  name: string;
  oauthClientId?: string | null | undefined;
  oauthClientSecret?: string | null | undefined;
  organizationId: PlatformId;
  sharedBearerToken?: string | null | undefined;
  url: string;
};

export type CreatePersonalMcpServerInput = {
  authType: McpAuthType;
  description?: string | null | undefined;
  iconUrl?: string | null | undefined;
  name: string;
  oauthClientId?: string | null | undefined;
  oauthClientSecret?: string | null | undefined;
  organizationId: PlatformId;
  url: string;
};

export type CreateSkillForkInput = {
  skillId: PlatformId;
};

export type CreateSlackAgentChannelBindingInput = {
  agentId: PlatformId;
  appLevelToken?: string | null | undefined;
  botToken: string;
  signingSecret: string;
  threadRepliesRequireMention?: boolean | null | undefined;
};

export type CreateSpaceDirectoryInput = {
  name: string;
  path?: string | null | undefined;
  spaceId: PlatformId;
};

export type CreateSpaceInput = {
  name: string;
  organizationId: PlatformId;
  visibility?: SpaceVisibility | null | undefined;
};

export type CreateTelegramAgentChannelBindingInput = {
  agentId: PlatformId;
  botToken: string;
  webhookSecret: string;
};

export type CreateVendorCredentialInput = {
  apiBase?: string | null | undefined;
  apiKey: string;
  isDefault?: boolean | null | undefined;
  isPreferred?: boolean | null | undefined;
  models?: Array<string> | null | undefined;
  name: string;
  organizationId: PlatformId;
  scope?: VendorCredentialScope | null | undefined;
  vendorId: string;
};

export type CreatorMembershipStatus =
  | 'active'
  | 'disabled'
  | 'removed';

export type DeleteAgentChannelBindingInput = {
  bindingId: PlatformId;
};

export type DeleteAgentInput = {
  agentId: PlatformId;
};

export type DeleteEnvironmentInput = {
  environmentId: PlatformId;
};

export type DeleteSpaceEntryInput = {
  key: string;
  spaceId: PlatformId;
};

export type DeleteVendorCredentialInput = {
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

export type EnvironmentShareTargetKind =
  | 'organization'
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
  createEnvironmentPayload?: AgentBuilderCreateEnvironmentPayloadInput | null | undefined;
  createRemoteMcpServerPayload?: AgentBuilderCreateRemoteMcpServerPayloadInput | null | undefined;
  draftYaml?: string | null | undefined;
  toolId: AgentBuilderExecutableActionToolId;
};

export type FileOwnerKind =
  | 'account'
  | 'organization'
  | 'session'
  | 'space';

export type FilePurpose =
  | 'agent_asset'
  | 'agent_package'
  | 'organization_avatar'
  | 'organization_draft'
  | 'session_attachment'
  | 'space_file';

export type FileScopeKind =
  | 'agent_package'
  | 'organization_avatar'
  | 'organization_draft'
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
  fileId: PlatformId;
  organizationId: PlatformId;
};

export type InviteOrganizationMemberInput = {
  email: string;
  organizationId: PlatformId;
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
  | 'organization_shared'
  | 'user';

export type McpCredentialScope =
  | 'organization_shared'
  | 'user';

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
  | 'organization_shared'
  | 'personal';

export type ModelCatalogSource =
  | 'custom'
  | 'preset';

export type OrganizationAccessRequestDecision =
  | 'approve'
  | 'reject';

export type OrganizationAccessRequestStatus =
  | 'approved'
  | 'cancelled'
  | 'pending'
  | 'rejected';

export type OrganizationInvitationStatus =
  | 'accepted'
  | 'cancelled'
  | 'expired'
  | 'pending'
  | 'rejected';

export type OrganizationJoinPolicy =
  | 'auto'
  | 'invite_only';

export type OrganizationMemberRole =
  | 'admin'
  | 'member'
  | 'owner';

export type OrganizationMemberStatus =
  | 'active'
  | 'disabled';

export type PollLarkAgentChannelRegistrationInput = {
  agentId: PlatformId;
  deviceCode: string;
  domain: LarkDomain;
};

export type PollWeChatAgentChannelPairingInput = {
  agentId: PlatformId;
  qrToken: string;
};

export type PublishAgentInput = {
  agentId: PlatformId;
  /**
   * Omit on re-publish to inherit the agent's current visibility. Required only
   * on the very first publish.
   */
  visibility?: AgentVisibility | null | undefined;
};

export type RemoveAgentCollaboratorInput = {
  agentId: PlatformId;
  principal: string;
};

export type RemoveCollaboratorInput = {
  principal: string;
  spaceId: PlatformId;
};

export type RemoveOrganizationMemberInput = {
  accountId: PlatformId;
  organizationId: PlatformId;
};

export type RemoveSessionResourceInput = {
  resourceId: PlatformId;
  sessionId: PlatformId;
};

export type RenameSessionInput = {
  sessionId: PlatformId;
  title: string;
};

export type RequestOrganizationAccessInput = {
  organizationId: PlatformId;
};

export type RequestOrganizationInvitationInput = {
  email: string;
  organizationId: PlatformId;
};

export type ReviewOrganizationAccessRequestInput = {
  decision: OrganizationAccessRequestDecision;
  requestId: PlatformId;
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

export type SetActiveOrganizationInput = {
  organizationId: PlatformId;
};

export type SetOrganizationDefaultEnvironmentInput = {
  environmentId: PlatformId;
  organizationId: PlatformId;
};

export type SetOrganizationSharedMcpBearerInput = {
  serverId: PlatformId;
  subjectLabel?: string | null | undefined;
  token: string;
};

export type SetSystemAgentModelInput = {
  modelId: string;
  vendor: string;
};

export type ShareEnvironmentWithOrganizationInput = {
  environmentId: PlatformId;
};

export type ShareEnvironmentWithUserInput = {
  email: string;
  environmentId: PlatformId;
};

export type ShareSkillWithOrganizationInput = {
  skillId: PlatformId;
};

export type ShareSkillWithUserInput = {
  email: string;
  skillId: PlatformId;
};

export type SkillRegistryRole =
  | 'owner'
  | 'user';

export type SkillShareTargetKind =
  | 'organization'
  | 'user';

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

export type SpaceVisibility =
  | 'private'
  | 'shared';

export type StartLarkAgentChannelRegistrationInput = {
  agentId: PlatformId;
  domain: LarkDomain;
};

export type StartMcpOAuthInput = {
  returnUrl?: string | null | undefined;
  serverId: PlatformId;
};

export type StartWeChatAgentChannelPairingInput = {
  agentId: PlatformId;
};

export type TestVendorCredentialInput = {
  apiBase?: string | null | undefined;
  apiKey: string;
  modelId?: string | null | undefined;
  organizationId: PlatformId;
  scope?: VendorCredentialScope | null | undefined;
  vendorId: string;
};

export type UnshareEnvironmentTargetInput = {
  environmentId: PlatformId;
  targetId: PlatformId;
  targetKind: EnvironmentShareTargetKind;
};

export type UnshareSkillTargetInput = {
  skillId: PlatformId;
  targetId: PlatformId;
  targetKind: SkillShareTargetKind;
};

export type UpdateAccountProfileInput = {
  imageUrl?: string | null | undefined;
  name: string;
};

export type UpdateAgentCollaboratorInput = {
  agentId: PlatformId;
  principal: string;
  role: AgentCollaboratorRole;
};

export type UpdateAgentConfigInput = {
  agentId: PlatformId;
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

export type UpdateAgentPackageSharingInput = {
  agentId: PlatformId;
  packageSharingEnabled: boolean;
};

export type UpdateCollaboratorInput = {
  role: SpaceRole;
  spaceId: PlatformId;
  userId: PlatformId;
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
  setupScript: string;
};

export type UpdateOrganizationJoinPolicyInput = {
  joinPolicy: OrganizationJoinPolicy;
  organizationId: PlatformId;
};

export type UpdateOrganizationMemberRoleInput = {
  accountId: PlatformId;
  organizationId: PlatformId;
  role: OrganizationMemberRole;
};

export type UpdateOrganizationPrimaryDomainInput = {
  domain?: string | null | undefined;
  organizationId: PlatformId;
};

export type UpdateOrganizationProfileInput = {
  avatarUrl?: string | null | undefined;
  name?: string | null | undefined;
  organizationId: PlatformId;
};

export type UpdateSessionThreadUiStateInput = {
  pinned?: boolean | null | undefined;
  readAt?: string | null | undefined;
  sessionId: PlatformId;
};

export type UpdateVendorCredentialInput = {
  apiBase?: string | null | undefined;
  apiKey?: string | null | undefined;
  id: PlatformId;
  isDefault?: boolean | null | undefined;
  isPreferred?: boolean | null | undefined;
  models?: Array<string> | null | undefined;
  name?: string | null | undefined;
};

export type VendorCredentialScope =
  | 'company'
  | 'personal';

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

export type AddAgentCollaboratorMutationVariables = Exact<{
  input: AddAgentCollaboratorInput;
}>;


export type AddAgentCollaboratorMutation = { addAgentCollaborator: { ok: boolean } };

export type RemoveAgentCollaboratorMutationVariables = Exact<{
  input: RemoveAgentCollaboratorInput;
}>;


export type RemoveAgentCollaboratorMutation = { removeAgentCollaborator: { ok: boolean } };

export type UpdateAgentCollaboratorMutationVariables = Exact<{
  input: UpdateAgentCollaboratorInput;
}>;


export type UpdateAgentCollaboratorMutation = { updateAgentCollaborator: { ok: boolean } };

export type AgentFieldsFragment = { createdAt: string, description: string | null, id: PlatformId, kind: AgentKind, model: string, name: string, packageSharingEnabled: boolean, prompt: string, provider: string, runtimeId: string, status: AgentStatus, updatedAt: string, visibility: AgentVisibility, organizationId: PlatformId, liveVersion: { agentId: PlatformId, createdAt: string, createdByAccountId: PlatformId, environmentId: PlatformId | null, id: PlatformId, isLive: boolean, kind: AgentKind, model: string, provider: string, runtimeId: string, summary: string, versionNumber: number } | null, skills: Array<{ ownerName: string | null, skillId: PlatformId, skillName: string, state: AgentSkillState }> };

export type AgentToolSummaryFieldsFragment = { enabled: boolean, iconUrl: string | null, name: string, serverId: PlatformId };

export type AgentDeploymentVersionFieldsFragment = { agentId: PlatformId, createdAt: string, createdByAccountId: PlatformId, environmentId: PlatformId | null, id: PlatformId, isLive: boolean, kind: AgentKind, model: string, provider: string, runtimeId: string, summary: string, versionNumber: number };

export type AgentOwnerFieldsFragment = { id: PlatformId, imageUrl: string | null, name: string | null };

export type CreateAgentMutationVariables = Exact<{
  input: CreateAgentInput;
}>;


export type CreateAgentMutation = { createAgent: { createdAt: string, description: string | null, id: PlatformId, kind: AgentKind, model: string, name: string, packageSharingEnabled: boolean, prompt: string, provider: string, runtimeId: string, status: AgentStatus, updatedAt: string, visibility: AgentVisibility, organizationId: PlatformId, liveVersion: { agentId: PlatformId, createdAt: string, createdByAccountId: PlatformId, environmentId: PlatformId | null, id: PlatformId, isLive: boolean, kind: AgentKind, model: string, provider: string, runtimeId: string, summary: string, versionNumber: number } | null, skills: Array<{ ownerName: string | null, skillId: PlatformId, skillName: string, state: AgentSkillState }> } };

export type DeleteAgentMutationVariables = Exact<{
  input: DeleteAgentInput;
}>;


export type DeleteAgentMutation = { deleteAgent: { ok: boolean } };

export type AccessibleAgentsQueryVariables = Exact<{
  organizationId: PlatformId;
}>;


export type AccessibleAgentsQuery = { accessibleAgentList: Array<{ createdAt: string, description: string | null, id: PlatformId, kind: AgentKind, name: string, runtimeId: string, status: AgentStatus, updatedAt: string, viewerRole: AgentViewerRole, visibility: AgentVisibility, organizationId: PlatformId, owner: { id: PlatformId, imageUrl: string | null, name: string | null }, tools: Array<{ enabled: boolean, iconUrl: string | null, name: string, serverId: PlatformId }> }> };

export type AgentQueryVariables = Exact<{
  agentId: PlatformId;
}>;


export type AgentQuery = { agent: { createdAt: string, description: string | null, id: PlatformId, kind: AgentKind, model: string, name: string, packageSharingEnabled: boolean, prompt: string, provider: string, runtimeId: string, status: AgentStatus, updatedAt: string, viewerRole: AgentViewerRole, visibility: AgentVisibility, organizationId: PlatformId, liveVersion: { agentId: PlatformId, createdAt: string, createdByAccountId: PlatformId, environmentId: PlatformId | null, id: PlatformId, isLive: boolean, kind: AgentKind, model: string, provider: string, runtimeId: string, summary: string, versionNumber: number } | null, owner: { id: PlatformId, imageUrl: string | null, name: string | null }, skills: Array<{ ownerName: string | null, skillId: PlatformId, skillName: string, state: AgentSkillState }>, tools: Array<{ enabled: boolean, iconUrl: string | null, name: string, serverId: PlatformId }>, versions: Array<{ agentId: PlatformId, createdAt: string, createdByAccountId: PlatformId, environmentId: PlatformId | null, id: PlatformId, isLive: boolean, kind: AgentKind, model: string, provider: string, runtimeId: string, summary: string, versionNumber: number }> } };

export type AgentEditorStateQueryVariables = Exact<{
  agentId: PlatformId;
}>;


export type AgentEditorStateQuery = { agentEditorState: { id: PlatformId, providerOptions: JsonObject, builder: { componentDecisions: { agentType: AgentBuilderAgentTypeDecision | null, environment: AgentBuilderComponentDecision | null } }, environment: { boundSpaceIds: Array<PlatformId>, environmentId: PlatformId | null }, packageResolution: { recordedAt: string, source: AgentPackageResolutionSource, report: { issues: Array<{ actionLabel: string | null, code: string, message: string, required: boolean, severity: AgentResolutionSeverity, status: AgentResolutionStatus, targetLabel: string | null, targetType: AgentResolutionTargetType }>, summary: { boundMcpServerCount: number, boundSkillCount: number, boundSpaceCount: number, copiedAssetCount: number, createdMcpServerCount: number, reusedMcpServerCount: number } } } | null, collaborators: Array<{ principal: string, role: AgentCollaboratorRole, name: string | null, email: string | null, imageUrl: string | null }>, mcpBindings: Array<{ authType: McpAuthType, authorizationState: McpAuthorizationState, createdAt: string, credentialMode: AgentMcpCredentialMode, credentialScope: McpCredentialScope, credentialStatus: McpCredentialStatus, credentialSubject: string | null, enabled: boolean, hasSharedCredential: boolean, iconUrl: string | null, id: PlatformId, name: string, serverId: PlatformId, source: McpServerSource, updatedAt: string, url: string }>, readiness: { checkedAt: string, ready: boolean, issues: Array<{ code: string, message: string, severity: AgentReadinessSeverity }> } } };

export type UpdateAgentConfigMutationVariables = Exact<{
  input: UpdateAgentConfigInput;
}>;


export type UpdateAgentConfigMutation = { updateAgentConfig: { createdAt: string, description: string | null, id: PlatformId, kind: AgentKind, model: string, name: string, packageSharingEnabled: boolean, prompt: string, provider: string, runtimeId: string, status: AgentStatus, updatedAt: string, visibility: AgentVisibility, organizationId: PlatformId, liveVersion: { agentId: PlatformId, createdAt: string, createdByAccountId: PlatformId, environmentId: PlatformId | null, id: PlatformId, isLive: boolean, kind: AgentKind, model: string, provider: string, runtimeId: string, summary: string, versionNumber: number } | null, skills: Array<{ ownerName: string | null, skillId: PlatformId, skillName: string, state: AgentSkillState }> } };

export type AgentManifestQueryVariables = Exact<{
  agentId: PlatformId;
}>;


export type AgentManifestQuery = { agentManifest: { agentId: PlatformId, json: string, yaml: string } };

export type ExportAgentPackageQueryVariables = Exact<{
  agentId: PlatformId;
}>;


export type ExportAgentPackageQuery = { exportAgentPackage: { agentId: PlatformId, contentType: string, fileId: PlatformId, fileName: string, manifestYaml: string, size: number } };

export type UpdateAgentPackageSharingMutationVariables = Exact<{
  input: UpdateAgentPackageSharingInput;
}>;


export type UpdateAgentPackageSharingMutation = { updateAgentPackageSharing: { createdAt: string, description: string | null, id: PlatformId, kind: AgentKind, model: string, name: string, packageSharingEnabled: boolean, prompt: string, provider: string, runtimeId: string, status: AgentStatus, updatedAt: string, visibility: AgentVisibility, organizationId: PlatformId, liveVersion: { agentId: PlatformId, createdAt: string, createdByAccountId: PlatformId, environmentId: PlatformId | null, id: PlatformId, isLive: boolean, kind: AgentKind, model: string, provider: string, runtimeId: string, summary: string, versionNumber: number } | null, skills: Array<{ ownerName: string | null, skillId: PlatformId, skillName: string, state: AgentSkillState }> } };

export type ImportAgentPackageMutationVariables = Exact<{
  input: ImportAgentPackageInput;
}>;


export type ImportAgentPackageMutation = { importAgentPackage: { agent: { createdAt: string, description: string | null, id: PlatformId, kind: AgentKind, model: string, name: string, packageSharingEnabled: boolean, prompt: string, provider: string, runtimeId: string, status: AgentStatus, updatedAt: string, visibility: AgentVisibility, organizationId: PlatformId, liveVersion: { agentId: PlatformId, createdAt: string, createdByAccountId: PlatformId, environmentId: PlatformId | null, id: PlatformId, isLive: boolean, kind: AgentKind, model: string, provider: string, runtimeId: string, summary: string, versionNumber: number } | null, skills: Array<{ ownerName: string | null, skillId: PlatformId, skillName: string, state: AgentSkillState }> }, resolution: { issues: Array<{ actionLabel: string | null, code: string, message: string, required: boolean, severity: AgentResolutionSeverity, status: AgentResolutionStatus, targetLabel: string | null, targetType: AgentResolutionTargetType }>, summary: { boundMcpServerCount: number, boundSkillCount: number, boundSpaceCount: number, copiedAssetCount: number, createdMcpServerCount: number, reusedMcpServerCount: number } } } };

export type CreateAgentForkMutationVariables = Exact<{
  input: CreateAgentForkInput;
}>;


export type CreateAgentForkMutation = { createAgentFork: { agent: { createdAt: string, description: string | null, id: PlatformId, kind: AgentKind, model: string, name: string, packageSharingEnabled: boolean, prompt: string, provider: string, runtimeId: string, status: AgentStatus, updatedAt: string, visibility: AgentVisibility, organizationId: PlatformId, liveVersion: { agentId: PlatformId, createdAt: string, createdByAccountId: PlatformId, environmentId: PlatformId | null, id: PlatformId, isLive: boolean, kind: AgentKind, model: string, provider: string, runtimeId: string, summary: string, versionNumber: number } | null, skills: Array<{ ownerName: string | null, skillId: PlatformId, skillName: string, state: AgentSkillState }> }, resolution: { issues: Array<{ actionLabel: string | null, code: string, message: string, required: boolean, severity: AgentResolutionSeverity, status: AgentResolutionStatus, targetLabel: string | null, targetType: AgentResolutionTargetType }>, summary: { boundMcpServerCount: number, boundSkillCount: number, boundSpaceCount: number, copiedAssetCount: number, createdMcpServerCount: number, reusedMcpServerCount: number } } } };

export type PublishAgentMutationVariables = Exact<{
  input: PublishAgentInput;
}>;


export type PublishAgentMutation = { publishAgent: { createdAt: string, description: string | null, id: PlatformId, kind: AgentKind, model: string, name: string, packageSharingEnabled: boolean, prompt: string, provider: string, runtimeId: string, status: AgentStatus, updatedAt: string, visibility: AgentVisibility, organizationId: PlatformId, liveVersion: { agentId: PlatformId, createdAt: string, createdByAccountId: PlatformId, environmentId: PlatformId | null, id: PlatformId, isLive: boolean, kind: AgentKind, model: string, provider: string, runtimeId: string, summary: string, versionNumber: number } | null, skills: Array<{ ownerName: string | null, skillId: PlatformId, skillName: string, state: AgentSkillState }> } };

export type UnpublishAgentMutationVariables = Exact<{
  agentId: PlatformId;
}>;


export type UnpublishAgentMutation = { unpublishAgent: { createdAt: string, description: string | null, id: PlatformId, kind: AgentKind, model: string, name: string, packageSharingEnabled: boolean, prompt: string, provider: string, runtimeId: string, status: AgentStatus, updatedAt: string, visibility: AgentVisibility, organizationId: PlatformId, liveVersion: { agentId: PlatformId, createdAt: string, createdByAccountId: PlatformId, environmentId: PlatformId | null, id: PlatformId, isLive: boolean, kind: AgentKind, model: string, provider: string, runtimeId: string, summary: string, versionNumber: number } | null, skills: Array<{ ownerName: string | null, skillId: PlatformId, skillName: string, state: AgentSkillState }> } };

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

type CostTotalsFields_CostUserRow_Fragment = { activeUsers: number, cacheCreationTokens: number, cacheReadTokens: number, inputTokens: number, outputTokens: number, requestCount: number, totalCostUsd: number, unpricedRequestCount: number };

export type CostTotalsFieldsFragment =
  | CostTotalsFields_CostAgentRow_Fragment
  | CostTotalsFields_CostDailyPoint_Fragment
  | CostTotalsFields_CostModelRow_Fragment
  | CostTotalsFields_CostTotals_Fragment
  | CostTotalsFields_CostUserRow_Fragment
;

export type CostDailyFieldsFragment = { activeUsers: number, cacheCreationTokens: number, cacheReadTokens: number, date: string, inputTokens: number, outputTokens: number, requestCount: number, totalCostUsd: number, unpricedRequestCount: number };

export type CostAgentFieldsFragment = { activeUsers: number, agentId: PlatformId, agentName: string, cacheCreationTokens: number, cacheReadTokens: number, debugCostUsd: number, evalCostUsd: number, inputTokens: number, outputTokens: number, ownerEmail: string | null, ownerId: PlatformId, ownerName: string, previousCostUsd: number | null, previewCostUsd: number, productionCostUsd: number, requestCount: number, scheduledCostUsd: number, totalCostUsd: number, unpricedRequestCount: number };

export type CostModelFieldsFragment = { activeUsers: number, cacheCreationTokens: number, cacheReadTokens: number, cacheReadUsdPerMillion: number | null, cacheWriteUsdPerMillion: number | null, inputTokens: number, inputUsdPerMillion: number | null, model: string, outputTokens: number, outputUsdPerMillion: number | null, provider: string, requestCount: number, totalCostUsd: number, unpricedRequestCount: number, vendor: string };

export type CostRecentSessionFieldsFragment = { actorEmail: string | null, actorName: string, actorUserId: PlatformId, cacheCreationTokens: number, cacheReadTokens: number, createdAt: string, inputTokens: number, model: string, outputTokens: number, provider: string, runPurpose: string, sessionId: PlatformId | null, sessionRunId: PlatformId | null, totalCostUsd: number };

export type CostAttributionFieldsFragment = { agents: Array<{ activeUsers: number, agentId: PlatformId, agentName: string, cacheCreationTokens: number, cacheReadTokens: number, debugCostUsd: number, evalCostUsd: number, inputTokens: number, outputTokens: number, ownerEmail: string | null, ownerId: PlatformId, ownerName: string, previousCostUsd: number | null, previewCostUsd: number, productionCostUsd: number, requestCount: number, scheduledCostUsd: number, totalCostUsd: number, unpricedRequestCount: number }>, daily: Array<{ activeUsers: number, cacheCreationTokens: number, cacheReadTokens: number, date: string, inputTokens: number, outputTokens: number, requestCount: number, totalCostUsd: number, unpricedRequestCount: number }>, models: Array<{ activeUsers: number, cacheCreationTokens: number, cacheReadTokens: number, cacheReadUsdPerMillion: number | null, cacheWriteUsdPerMillion: number | null, inputTokens: number, inputUsdPerMillion: number | null, model: string, outputTokens: number, outputUsdPerMillion: number | null, provider: string, requestCount: number, totalCostUsd: number, unpricedRequestCount: number, vendor: string }>, recentSessions: Array<{ actorEmail: string | null, actorName: string, actorUserId: PlatformId, cacheCreationTokens: number, cacheReadTokens: number, createdAt: string, inputTokens: number, model: string, outputTokens: number, provider: string, runPurpose: string, sessionId: PlatformId | null, sessionRunId: PlatformId | null, totalCostUsd: number }>, totals: { activeUsers: number, cacheCreationTokens: number, cacheReadTokens: number, inputTokens: number, outputTokens: number, requestCount: number, totalCostUsd: number, unpricedRequestCount: number } };

export type OrganizationCostCardQueryVariables = Exact<{
  organizationId: PlatformId;
  range: CostRange;
  runPurposes?: Array<CostRunPurpose> | null | undefined;
}>;


export type OrganizationCostCardQuery = { organizationCostCard: { agents: Array<{ activeUsers: number, agentId: PlatformId, agentName: string, cacheCreationTokens: number, cacheReadTokens: number, debugCostUsd: number, evalCostUsd: number, inputTokens: number, outputTokens: number, ownerEmail: string | null, ownerId: PlatformId, ownerName: string, previousCostUsd: number | null, previewCostUsd: number, productionCostUsd: number, requestCount: number, scheduledCostUsd: number, totalCostUsd: number, unpricedRequestCount: number }>, daily: Array<{ activeUsers: number, cacheCreationTokens: number, cacheReadTokens: number, date: string, inputTokens: number, outputTokens: number, requestCount: number, totalCostUsd: number, unpricedRequestCount: number }>, models: Array<{ activeUsers: number, cacheCreationTokens: number, cacheReadTokens: number, cacheReadUsdPerMillion: number | null, cacheWriteUsdPerMillion: number | null, inputTokens: number, inputUsdPerMillion: number | null, model: string, outputTokens: number, outputUsdPerMillion: number | null, provider: string, requestCount: number, totalCostUsd: number, unpricedRequestCount: number, vendor: string }>, ownerUsers: Array<{ activeUsers: number, agentCount: number, cacheCreationTokens: number, cacheReadTokens: number, inputTokens: number, outputTokens: number, previousCostUsd: number | null, requestCount: number, topAgentId: PlatformId | null, topAgentName: string | null, totalCostUsd: number, unpricedRequestCount: number, userEmail: string | null, userId: PlatformId, userName: string }>, previousTotals: { activeUsers: number, cacheCreationTokens: number, cacheReadTokens: number, inputTokens: number, outputTokens: number, requestCount: number, totalCostUsd: number, unpricedRequestCount: number }, recentSessions: Array<{ actorEmail: string | null, actorName: string, actorUserId: PlatformId, cacheCreationTokens: number, cacheReadTokens: number, createdAt: string, inputTokens: number, model: string, outputTokens: number, provider: string, runPurpose: string, sessionId: PlatformId | null, sessionRunId: PlatformId | null, totalCostUsd: number }>, totals: { activeUsers: number, cacheCreationTokens: number, cacheReadTokens: number, inputTokens: number, outputTokens: number, requestCount: number, totalCostUsd: number, unpricedRequestCount: number }, users: Array<{ activeUsers: number, agentCount: number, cacheCreationTokens: number, cacheReadTokens: number, inputTokens: number, outputTokens: number, previousCostUsd: number | null, requestCount: number, topAgentId: PlatformId | null, topAgentName: string | null, totalCostUsd: number, unpricedRequestCount: number, userEmail: string | null, userId: PlatformId, userName: string }> } };

export type AgentCostCardQueryVariables = Exact<{
  agentId: PlatformId;
  range: CostRange;
  runPurposes?: Array<CostRunPurpose> | null | undefined;
}>;


export type AgentCostCardQuery = { agentCostCard: { agentId: PlatformId, agentName: string, ownerId: PlatformId, ownerName: string, agents: Array<{ activeUsers: number, agentId: PlatformId, agentName: string, cacheCreationTokens: number, cacheReadTokens: number, debugCostUsd: number, evalCostUsd: number, inputTokens: number, outputTokens: number, ownerEmail: string | null, ownerId: PlatformId, ownerName: string, previousCostUsd: number | null, previewCostUsd: number, productionCostUsd: number, requestCount: number, scheduledCostUsd: number, totalCostUsd: number, unpricedRequestCount: number }>, daily: Array<{ activeUsers: number, cacheCreationTokens: number, cacheReadTokens: number, date: string, inputTokens: number, outputTokens: number, requestCount: number, totalCostUsd: number, unpricedRequestCount: number }>, models: Array<{ activeUsers: number, cacheCreationTokens: number, cacheReadTokens: number, cacheReadUsdPerMillion: number | null, cacheWriteUsdPerMillion: number | null, inputTokens: number, inputUsdPerMillion: number | null, model: string, outputTokens: number, outputUsdPerMillion: number | null, provider: string, requestCount: number, totalCostUsd: number, unpricedRequestCount: number, vendor: string }>, recentSessions: Array<{ actorEmail: string | null, actorName: string, actorUserId: PlatformId, cacheCreationTokens: number, cacheReadTokens: number, createdAt: string, inputTokens: number, model: string, outputTokens: number, provider: string, runPurpose: string, sessionId: PlatformId | null, sessionRunId: PlatformId | null, totalCostUsd: number }>, totals: { activeUsers: number, cacheCreationTokens: number, cacheReadTokens: number, inputTokens: number, outputTokens: number, requestCount: number, totalCostUsd: number, unpricedRequestCount: number }, users: Array<{ activeUsers: number, agentCount: number, cacheCreationTokens: number, cacheReadTokens: number, inputTokens: number, outputTokens: number, previousCostUsd: number | null, requestCount: number, topAgentId: PlatformId | null, topAgentName: string | null, totalCostUsd: number, unpricedRequestCount: number, userEmail: string | null, userId: PlatformId, userName: string }> } };

export type MemberCostCardQueryVariables = Exact<{
  organizationId: PlatformId;
  memberId: PlatformId;
  range: CostRange;
}>;


export type MemberCostCardQuery = { memberCostCard: { owned: { agents: Array<{ activeUsers: number, agentId: PlatformId, agentName: string, cacheCreationTokens: number, cacheReadTokens: number, debugCostUsd: number, evalCostUsd: number, inputTokens: number, outputTokens: number, ownerEmail: string | null, ownerId: PlatformId, ownerName: string, previousCostUsd: number | null, previewCostUsd: number, productionCostUsd: number, requestCount: number, scheduledCostUsd: number, totalCostUsd: number, unpricedRequestCount: number }>, daily: Array<{ activeUsers: number, cacheCreationTokens: number, cacheReadTokens: number, date: string, inputTokens: number, outputTokens: number, requestCount: number, totalCostUsd: number, unpricedRequestCount: number }>, models: Array<{ activeUsers: number, cacheCreationTokens: number, cacheReadTokens: number, cacheReadUsdPerMillion: number | null, cacheWriteUsdPerMillion: number | null, inputTokens: number, inputUsdPerMillion: number | null, model: string, outputTokens: number, outputUsdPerMillion: number | null, provider: string, requestCount: number, totalCostUsd: number, unpricedRequestCount: number, vendor: string }>, recentSessions: Array<{ actorEmail: string | null, actorName: string, actorUserId: PlatformId, cacheCreationTokens: number, cacheReadTokens: number, createdAt: string, inputTokens: number, model: string, outputTokens: number, provider: string, runPurpose: string, sessionId: PlatformId | null, sessionRunId: PlatformId | null, totalCostUsd: number }>, totals: { activeUsers: number, cacheCreationTokens: number, cacheReadTokens: number, inputTokens: number, outputTokens: number, requestCount: number, totalCostUsd: number, unpricedRequestCount: number } }, used: { agents: Array<{ activeUsers: number, agentId: PlatformId, agentName: string, cacheCreationTokens: number, cacheReadTokens: number, debugCostUsd: number, evalCostUsd: number, inputTokens: number, outputTokens: number, ownerEmail: string | null, ownerId: PlatformId, ownerName: string, previousCostUsd: number | null, previewCostUsd: number, productionCostUsd: number, requestCount: number, scheduledCostUsd: number, totalCostUsd: number, unpricedRequestCount: number }>, daily: Array<{ activeUsers: number, cacheCreationTokens: number, cacheReadTokens: number, date: string, inputTokens: number, outputTokens: number, requestCount: number, totalCostUsd: number, unpricedRequestCount: number }>, models: Array<{ activeUsers: number, cacheCreationTokens: number, cacheReadTokens: number, cacheReadUsdPerMillion: number | null, cacheWriteUsdPerMillion: number | null, inputTokens: number, inputUsdPerMillion: number | null, model: string, outputTokens: number, outputUsdPerMillion: number | null, provider: string, requestCount: number, totalCostUsd: number, unpricedRequestCount: number, vendor: string }>, recentSessions: Array<{ actorEmail: string | null, actorName: string, actorUserId: PlatformId, cacheCreationTokens: number, cacheReadTokens: number, createdAt: string, inputTokens: number, model: string, outputTokens: number, provider: string, runPurpose: string, sessionId: PlatformId | null, sessionRunId: PlatformId | null, totalCostUsd: number }>, totals: { activeUsers: number, cacheCreationTokens: number, cacheReadTokens: number, inputTokens: number, outputTokens: number, requestCount: number, totalCostUsd: number, unpricedRequestCount: number } } } };

export type EnvironmentPackageFieldsFragment = { manager: EnvironmentPackageManager, packages: Array<string> };

export type EnvironmentVariableFieldsFragment = { key: string, preview: string, status: EnvironmentVariableStatus };

export type EnvironmentOwnerFieldsFragment = { id: PlatformId | null, imageUrl: string | null, name: string | null };

export type EnvironmentSummaryFieldsFragment = { allowMcpServers: boolean, allowPackageManagers: boolean, allowedHosts: Array<string>, canDelete: boolean, canEdit: boolean, createdAt: string, currentRevisionId: PlatformId, description: string, id: PlatformId, isBuiltIn: boolean, isDefault: boolean, isEditable: boolean, name: string, networkPolicy: EnvironmentNetworkPolicy, role: EnvironmentRegistryRole, setupScript: string, updatedAt: string, usedByAgentCount: number, organizationId: PlatformId, envVars: Array<{ key: string, preview: string, status: EnvironmentVariableStatus }>, forkOrigin: { environmentId: PlatformId, name: string, ownerName: string } | null, owner: { id: PlatformId | null, imageUrl: string | null, name: string | null }, packages: Array<{ manager: EnvironmentPackageManager, packages: Array<string> }> };

export type EnvironmentShareTargetFieldsFragment = { createdAt: string, email: string | null, id: PlatformId, kind: EnvironmentShareTargetKind, name: string | null };

export type EnvironmentDetailFieldsFragment = { allowMcpServers: boolean, allowPackageManagers: boolean, allowedHosts: Array<string>, canDelete: boolean, canEdit: boolean, createdAt: string, currentRevisionId: PlatformId, description: string, id: PlatformId, isBuiltIn: boolean, isDefault: boolean, isEditable: boolean, name: string, networkPolicy: EnvironmentNetworkPolicy, role: EnvironmentRegistryRole, setupScript: string, updatedAt: string, usedByAgentCount: number, organizationId: PlatformId, envVars: Array<{ key: string, preview: string, status: EnvironmentVariableStatus }>, forkOrigin: { environmentId: PlatformId, name: string, ownerName: string } | null, owner: { id: PlatformId | null, imageUrl: string | null, name: string | null }, packages: Array<{ manager: EnvironmentPackageManager, packages: Array<string> }>, shareTargets: Array<{ createdAt: string, email: string | null, id: PlatformId, kind: EnvironmentShareTargetKind, name: string | null }> };

export type OrganizationEnvironmentsQueryVariables = Exact<{
  organizationId: PlatformId;
}>;


export type OrganizationEnvironmentsQuery = { organizationEnvironmentList: Array<{ allowMcpServers: boolean, allowPackageManagers: boolean, allowedHosts: Array<string>, canDelete: boolean, canEdit: boolean, createdAt: string, currentRevisionId: PlatformId, description: string, id: PlatformId, isBuiltIn: boolean, isDefault: boolean, isEditable: boolean, name: string, networkPolicy: EnvironmentNetworkPolicy, role: EnvironmentRegistryRole, setupScript: string, updatedAt: string, usedByAgentCount: number, organizationId: PlatformId, envVars: Array<{ key: string, preview: string, status: EnvironmentVariableStatus }>, forkOrigin: { environmentId: PlatformId, name: string, ownerName: string } | null, owner: { id: PlatformId | null, imageUrl: string | null, name: string | null }, packages: Array<{ manager: EnvironmentPackageManager, packages: Array<string> }> }> };

export type EnvironmentDetailQueryVariables = Exact<{
  environmentId: PlatformId;
}>;


export type EnvironmentDetailQuery = { environment: { allowMcpServers: boolean, allowPackageManagers: boolean, allowedHosts: Array<string>, canDelete: boolean, canEdit: boolean, createdAt: string, currentRevisionId: PlatformId, description: string, id: PlatformId, isBuiltIn: boolean, isDefault: boolean, isEditable: boolean, name: string, networkPolicy: EnvironmentNetworkPolicy, role: EnvironmentRegistryRole, setupScript: string, updatedAt: string, usedByAgentCount: number, organizationId: PlatformId, envVars: Array<{ key: string, preview: string, status: EnvironmentVariableStatus }>, forkOrigin: { environmentId: PlatformId, name: string, ownerName: string } | null, owner: { id: PlatformId | null, imageUrl: string | null, name: string | null }, packages: Array<{ manager: EnvironmentPackageManager, packages: Array<string> }>, shareTargets: Array<{ createdAt: string, email: string | null, id: PlatformId, kind: EnvironmentShareTargetKind, name: string | null }> } };

export type CreateEnvironmentMutationVariables = Exact<{
  input: CreateEnvironmentInput;
}>;


export type CreateEnvironmentMutation = { createEnvironment: { allowMcpServers: boolean, allowPackageManagers: boolean, allowedHosts: Array<string>, canDelete: boolean, canEdit: boolean, createdAt: string, currentRevisionId: PlatformId, description: string, id: PlatformId, isBuiltIn: boolean, isDefault: boolean, isEditable: boolean, name: string, networkPolicy: EnvironmentNetworkPolicy, role: EnvironmentRegistryRole, setupScript: string, updatedAt: string, usedByAgentCount: number, organizationId: PlatformId, envVars: Array<{ key: string, preview: string, status: EnvironmentVariableStatus }>, forkOrigin: { environmentId: PlatformId, name: string, ownerName: string } | null, owner: { id: PlatformId | null, imageUrl: string | null, name: string | null }, packages: Array<{ manager: EnvironmentPackageManager, packages: Array<string> }> } };

export type UpdateEnvironmentMutationVariables = Exact<{
  input: UpdateEnvironmentInput;
}>;


export type UpdateEnvironmentMutation = { updateEnvironment: { allowMcpServers: boolean, allowPackageManagers: boolean, allowedHosts: Array<string>, canDelete: boolean, canEdit: boolean, createdAt: string, currentRevisionId: PlatformId, description: string, id: PlatformId, isBuiltIn: boolean, isDefault: boolean, isEditable: boolean, name: string, networkPolicy: EnvironmentNetworkPolicy, role: EnvironmentRegistryRole, setupScript: string, updatedAt: string, usedByAgentCount: number, organizationId: PlatformId, envVars: Array<{ key: string, preview: string, status: EnvironmentVariableStatus }>, forkOrigin: { environmentId: PlatformId, name: string, ownerName: string } | null, owner: { id: PlatformId | null, imageUrl: string | null, name: string | null }, packages: Array<{ manager: EnvironmentPackageManager, packages: Array<string> }>, shareTargets: Array<{ createdAt: string, email: string | null, id: PlatformId, kind: EnvironmentShareTargetKind, name: string | null }> } };

export type CreateEnvironmentForkMutationVariables = Exact<{
  input: CreateEnvironmentForkInput;
}>;


export type CreateEnvironmentForkMutation = { createEnvironmentFork: { allowMcpServers: boolean, allowPackageManagers: boolean, allowedHosts: Array<string>, canDelete: boolean, canEdit: boolean, createdAt: string, currentRevisionId: PlatformId, description: string, id: PlatformId, isBuiltIn: boolean, isDefault: boolean, isEditable: boolean, name: string, networkPolicy: EnvironmentNetworkPolicy, role: EnvironmentRegistryRole, setupScript: string, updatedAt: string, usedByAgentCount: number, organizationId: PlatformId, envVars: Array<{ key: string, preview: string, status: EnvironmentVariableStatus }>, forkOrigin: { environmentId: PlatformId, name: string, ownerName: string } | null, owner: { id: PlatformId | null, imageUrl: string | null, name: string | null }, packages: Array<{ manager: EnvironmentPackageManager, packages: Array<string> }> } };

export type DeleteEnvironmentMutationVariables = Exact<{
  input: DeleteEnvironmentInput;
}>;


export type DeleteEnvironmentMutation = { deleteEnvironment: { ok: boolean } };

export type SetOrganizationDefaultEnvironmentMutationVariables = Exact<{
  input: SetOrganizationDefaultEnvironmentInput;
}>;


export type SetOrganizationDefaultEnvironmentMutation = { setOrganizationDefaultEnvironment: { allowMcpServers: boolean, allowPackageManagers: boolean, allowedHosts: Array<string>, canDelete: boolean, canEdit: boolean, createdAt: string, currentRevisionId: PlatformId, description: string, id: PlatformId, isBuiltIn: boolean, isDefault: boolean, isEditable: boolean, name: string, networkPolicy: EnvironmentNetworkPolicy, role: EnvironmentRegistryRole, setupScript: string, updatedAt: string, usedByAgentCount: number, organizationId: PlatformId, envVars: Array<{ key: string, preview: string, status: EnvironmentVariableStatus }>, forkOrigin: { environmentId: PlatformId, name: string, ownerName: string } | null, owner: { id: PlatformId | null, imageUrl: string | null, name: string | null }, packages: Array<{ manager: EnvironmentPackageManager, packages: Array<string> }> } };

export type ShareEnvironmentWithUserMutationVariables = Exact<{
  input: ShareEnvironmentWithUserInput;
}>;


export type ShareEnvironmentWithUserMutation = { shareEnvironmentWithUser: { createdAt: string, email: string | null, id: PlatformId, kind: EnvironmentShareTargetKind, name: string | null } };

export type ShareEnvironmentWithOrganizationMutationVariables = Exact<{
  input: ShareEnvironmentWithOrganizationInput;
}>;


export type ShareEnvironmentWithOrganizationMutation = { shareEnvironmentWithOrganization: { createdAt: string, email: string | null, id: PlatformId, kind: EnvironmentShareTargetKind, name: string | null } };

export type UnshareEnvironmentTargetMutationVariables = Exact<{
  input: UnshareEnvironmentTargetInput;
}>;


export type UnshareEnvironmentTargetMutation = { unshareEnvironmentTarget: { ok: boolean } };

export type McpCredentialFieldsFragment = { authType: McpAuthType, createdAt: string, expiresAt: string | null, id: PlatformId, scope: McpCredentialRecordScope, scopeValues: Array<string>, status: McpCredentialStatus, subjectLabel: string | null, updatedAt: string };

export type McpServerFieldsFragment = { authType: McpAuthType, authorizationState: McpAuthorizationState, createdAt: string, credentialScope: McpCredentialScope, credentialStatus: McpCredentialStatus, description: string | null, enabled: boolean, hasSharedCredential: boolean, iconUrl: string | null, id: PlatformId, name: string, ownerId: PlatformId, ownerName: string, source: McpServerSource, updatedAt: string, url: string, organizationId: PlatformId, credential: { authType: McpAuthType, createdAt: string, expiresAt: string | null, id: PlatformId, scope: McpCredentialRecordScope, scopeValues: Array<string>, status: McpCredentialStatus, subjectLabel: string | null, updatedAt: string } | null };

export type McpRegistryQueryVariables = Exact<{
  organizationId: PlatformId;
}>;


export type McpRegistryQuery = { mcpRegistry: { currentUserEmail: string, currentUserId: PlatformId, currentUserName: string, isAdmin: boolean, organizationId: PlatformId, personal: Array<{ authType: McpAuthType, authorizationState: McpAuthorizationState, createdAt: string, credentialScope: McpCredentialScope, credentialStatus: McpCredentialStatus, description: string | null, enabled: boolean, hasSharedCredential: boolean, iconUrl: string | null, id: PlatformId, name: string, ownerId: PlatformId, ownerName: string, source: McpServerSource, updatedAt: string, url: string, organizationId: PlatformId, credential: { authType: McpAuthType, createdAt: string, expiresAt: string | null, id: PlatformId, scope: McpCredentialRecordScope, scopeValues: Array<string>, status: McpCredentialStatus, subjectLabel: string | null, updatedAt: string } | null }>, organizationShared: Array<{ authType: McpAuthType, authorizationState: McpAuthorizationState, createdAt: string, credentialScope: McpCredentialScope, credentialStatus: McpCredentialStatus, description: string | null, enabled: boolean, hasSharedCredential: boolean, iconUrl: string | null, id: PlatformId, name: string, ownerId: PlatformId, ownerName: string, source: McpServerSource, updatedAt: string, url: string, organizationId: PlatformId, credential: { authType: McpAuthType, createdAt: string, expiresAt: string | null, id: PlatformId, scope: McpCredentialRecordScope, scopeValues: Array<string>, status: McpCredentialStatus, subjectLabel: string | null, updatedAt: string } | null }> } };

export type CreatePersonalMcpServerMutationVariables = Exact<{
  input: CreatePersonalMcpServerInput;
}>;


export type CreatePersonalMcpServerMutation = { createPersonalMcpServer: { authType: McpAuthType, authorizationState: McpAuthorizationState, createdAt: string, credentialScope: McpCredentialScope, credentialStatus: McpCredentialStatus, description: string | null, enabled: boolean, hasSharedCredential: boolean, iconUrl: string | null, id: PlatformId, name: string, ownerId: PlatformId, ownerName: string, source: McpServerSource, updatedAt: string, url: string, organizationId: PlatformId, credential: { authType: McpAuthType, createdAt: string, expiresAt: string | null, id: PlatformId, scope: McpCredentialRecordScope, scopeValues: Array<string>, status: McpCredentialStatus, subjectLabel: string | null, updatedAt: string } | null } };

export type CreateOrganizationMcpServerMutationVariables = Exact<{
  input: CreateOrganizationMcpServerInput;
}>;


export type CreateOrganizationMcpServerMutation = { createOrganizationMcpServer: { authType: McpAuthType, authorizationState: McpAuthorizationState, createdAt: string, credentialScope: McpCredentialScope, credentialStatus: McpCredentialStatus, description: string | null, enabled: boolean, hasSharedCredential: boolean, iconUrl: string | null, id: PlatformId, name: string, ownerId: PlatformId, ownerName: string, source: McpServerSource, updatedAt: string, url: string, organizationId: PlatformId, credential: { authType: McpAuthType, createdAt: string, expiresAt: string | null, id: PlatformId, scope: McpCredentialRecordScope, scopeValues: Array<string>, status: McpCredentialStatus, subjectLabel: string | null, updatedAt: string } | null } };

export type ConnectMcpBearerMutationVariables = Exact<{
  input: ConnectMcpBearerInput;
}>;


export type ConnectMcpBearerMutation = { connectMcpBearer: { authType: McpAuthType, authorizationState: McpAuthorizationState, createdAt: string, credentialScope: McpCredentialScope, credentialStatus: McpCredentialStatus, description: string | null, enabled: boolean, hasSharedCredential: boolean, iconUrl: string | null, id: PlatformId, name: string, ownerId: PlatformId, ownerName: string, source: McpServerSource, updatedAt: string, url: string, organizationId: PlatformId, credential: { authType: McpAuthType, createdAt: string, expiresAt: string | null, id: PlatformId, scope: McpCredentialRecordScope, scopeValues: Array<string>, status: McpCredentialStatus, subjectLabel: string | null, updatedAt: string } | null } };

export type SetOrganizationSharedBearerMutationVariables = Exact<{
  input: SetOrganizationSharedMcpBearerInput;
}>;


export type SetOrganizationSharedBearerMutation = { setOrganizationSharedBearer: { authType: McpAuthType, authorizationState: McpAuthorizationState, createdAt: string, credentialScope: McpCredentialScope, credentialStatus: McpCredentialStatus, description: string | null, enabled: boolean, hasSharedCredential: boolean, iconUrl: string | null, id: PlatformId, name: string, ownerId: PlatformId, ownerName: string, source: McpServerSource, updatedAt: string, url: string, organizationId: PlatformId, credential: { authType: McpAuthType, createdAt: string, expiresAt: string | null, id: PlatformId, scope: McpCredentialRecordScope, scopeValues: Array<string>, status: McpCredentialStatus, subjectLabel: string | null, updatedAt: string } | null } };

export type ClearOrganizationSharedCredentialMutationVariables = Exact<{
  serverId: PlatformId;
}>;


export type ClearOrganizationSharedCredentialMutation = { clearOrganizationSharedCredential: { authType: McpAuthType, authorizationState: McpAuthorizationState, createdAt: string, credentialScope: McpCredentialScope, credentialStatus: McpCredentialStatus, description: string | null, enabled: boolean, hasSharedCredential: boolean, iconUrl: string | null, id: PlatformId, name: string, ownerId: PlatformId, ownerName: string, source: McpServerSource, updatedAt: string, url: string, organizationId: PlatformId, credential: { authType: McpAuthType, createdAt: string, expiresAt: string | null, id: PlatformId, scope: McpCredentialRecordScope, scopeValues: Array<string>, status: McpCredentialStatus, subjectLabel: string | null, updatedAt: string } | null } };

export type RevokeMcpUserCredentialMutationVariables = Exact<{
  serverId: PlatformId;
}>;


export type RevokeMcpUserCredentialMutation = { revokeMcpUserCredential: { authType: McpAuthType, authorizationState: McpAuthorizationState, createdAt: string, credentialScope: McpCredentialScope, credentialStatus: McpCredentialStatus, description: string | null, enabled: boolean, hasSharedCredential: boolean, iconUrl: string | null, id: PlatformId, name: string, ownerId: PlatformId, ownerName: string, source: McpServerSource, updatedAt: string, url: string, organizationId: PlatformId, credential: { authType: McpAuthType, createdAt: string, expiresAt: string | null, id: PlatformId, scope: McpCredentialRecordScope, scopeValues: Array<string>, status: McpCredentialStatus, subjectLabel: string | null, updatedAt: string } | null } };

export type SetMcpServerEnabledMutationVariables = Exact<{
  serverId: PlatformId;
  enabled: boolean;
}>;


export type SetMcpServerEnabledMutation = { setMcpServerEnabled: { authType: McpAuthType, authorizationState: McpAuthorizationState, createdAt: string, credentialScope: McpCredentialScope, credentialStatus: McpCredentialStatus, description: string | null, enabled: boolean, hasSharedCredential: boolean, iconUrl: string | null, id: PlatformId, name: string, ownerId: PlatformId, ownerName: string, source: McpServerSource, updatedAt: string, url: string, organizationId: PlatformId, credential: { authType: McpAuthType, createdAt: string, expiresAt: string | null, id: PlatformId, scope: McpCredentialRecordScope, scopeValues: Array<string>, status: McpCredentialStatus, subjectLabel: string | null, updatedAt: string } | null } };

export type DeleteMcpServerMutationVariables = Exact<{
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

export type OnboardingDiscoveryQueryVariables = Exact<{ [key: string]: never; }>;


export type OnboardingDiscoveryQuery = { onboardingDiscovery: { domain: string, isPublicEmail: boolean, orgs: Array<{ creator: string, id: PlatformId, joinPolicy: OrganizationJoinPolicy, memberCount: number, name: string }> } };

export type OnboardingBootstrapMutationVariables = Exact<{
  input: BootstrapOnboardingInput;
}>;


export type OnboardingBootstrapMutation = { onboardingBootstrap: { completed: boolean, organization: { avatarUrl: string | null, createdAt: string, id: PlatformId, joinPolicy: OrganizationJoinPolicy, name: string, primaryDomain: string | null, slug: string, viewerRole: OrganizationMemberRole | null } | null } };

export type OrganizationAccessRequestsQueryVariables = Exact<{
  organizationId: PlatformId;
}>;


export type OrganizationAccessRequestsQuery = { organizationAccessRequestList: Array<{ createdAt: string, id: PlatformId, organizationId: PlatformId, organizationName: string, referrerAccountId: PlatformId | null, referrerName: string | null, requestedByAccountId: PlatformId, requesterEmail: string, requesterName: string, reviewedAt: string | null, reviewedBy: PlatformId | null, reviewedByName: string | null, status: OrganizationAccessRequestStatus, updatedAt: string }> };

export type OrganizationJoinTargetQueryVariables = Exact<{
  organizationId: PlatformId;
}>;


export type OrganizationJoinTargetQuery = { organizationJoinTarget: { organizationId: PlatformId, organizationName: string, viewerIsAuthenticated: boolean, viewerIsMember: boolean, pendingInvitation: { createdAt: string, email: string, expiresAt: string | null, id: PlatformId, invitedBy: PlatformId, invitedByName: string | null, organizationId: PlatformId, organizationName: string, status: OrganizationInvitationStatus, updatedAt: string, accountId: PlatformId | null } | null, pendingRequest: { createdAt: string, id: PlatformId, organizationId: PlatformId, organizationName: string, referrerAccountId: PlatformId | null, referrerName: string | null, requestedByAccountId: PlatformId, requesterEmail: string, requesterName: string, reviewedAt: string | null, reviewedBy: PlatformId | null, reviewedByName: string | null, status: OrganizationAccessRequestStatus, updatedAt: string } | null, organization: { avatarUrl: string | null, createdAt: string, id: PlatformId, joinPolicy: OrganizationJoinPolicy, name: string, primaryDomain: string | null, slug: string, viewerRole: OrganizationMemberRole | null } } };

export type RequestOrganizationAccessMutationVariables = Exact<{
  input: RequestOrganizationAccessInput;
}>;


export type RequestOrganizationAccessMutation = { requestOrganizationAccess: { createdAt: string, id: PlatformId, organizationId: PlatformId, organizationName: string, referrerAccountId: PlatformId | null, referrerName: string | null, requestedByAccountId: PlatformId, requesterEmail: string, requesterName: string, reviewedAt: string | null, reviewedBy: PlatformId | null, reviewedByName: string | null, status: OrganizationAccessRequestStatus, updatedAt: string } };

export type RequestOrganizationInvitationMutationVariables = Exact<{
  input: RequestOrganizationInvitationInput;
}>;


export type RequestOrganizationInvitationMutation = { requestOrganizationInvitation: { createdAt: string, id: PlatformId, organizationId: PlatformId, organizationName: string, referrerAccountId: PlatformId | null, referrerName: string | null, requestedByAccountId: PlatformId, requesterEmail: string, requesterName: string, reviewedAt: string | null, reviewedBy: PlatformId | null, reviewedByName: string | null, status: OrganizationAccessRequestStatus, updatedAt: string } };

export type ReviewOrganizationAccessRequestMutationVariables = Exact<{
  input: ReviewOrganizationAccessRequestInput;
}>;


export type ReviewOrganizationAccessRequestMutation = { reviewOrganizationAccessRequest: { createdAt: string, id: PlatformId, organizationId: PlatformId, organizationName: string, referrerAccountId: PlatformId | null, referrerName: string | null, requestedByAccountId: PlatformId, requesterEmail: string, requesterName: string, reviewedAt: string | null, reviewedBy: PlatformId | null, reviewedByName: string | null, status: OrganizationAccessRequestStatus, updatedAt: string } };

export type UpdateOrganizationJoinPolicyMutationVariables = Exact<{
  input: UpdateOrganizationJoinPolicyInput;
}>;


export type UpdateOrganizationJoinPolicyMutation = { updateOrganizationJoinPolicy: { joinPolicy: OrganizationJoinPolicy } };

export type CreateOrganizationMutationVariables = Exact<{
  input: CreateOrganizationInput;
}>;


export type CreateOrganizationMutation = { createOrganization: { avatarUrl: string | null, createdAt: string, id: PlatformId, joinPolicy: OrganizationJoinPolicy, name: string, primaryDomain: string | null, slug: string, viewerRole: OrganizationMemberRole | null } };

export type SetActiveOrganizationMutationVariables = Exact<{
  input: SetActiveOrganizationInput;
}>;


export type SetActiveOrganizationMutation = { setActiveOrganization: { avatarUrl: string | null, createdAt: string, id: PlatformId, joinPolicy: OrganizationJoinPolicy, name: string, primaryDomain: string | null, slug: string, viewerRole: OrganizationMemberRole | null } };

export type UpdateOrganizationPrimaryDomainMutationVariables = Exact<{
  input: UpdateOrganizationPrimaryDomainInput;
}>;


export type UpdateOrganizationPrimaryDomainMutation = { updateOrganizationPrimaryDomain: { avatarUrl: string | null, createdAt: string, id: PlatformId, joinPolicy: OrganizationJoinPolicy, name: string, primaryDomain: string | null, slug: string, viewerRole: OrganizationMemberRole | null } };

export type UpdateOrganizationProfileMutationVariables = Exact<{
  input: UpdateOrganizationProfileInput;
}>;


export type UpdateOrganizationProfileMutation = { updateOrganizationProfile: { avatarUrl: string | null, createdAt: string, id: PlatformId, joinPolicy: OrganizationJoinPolicy, name: string, primaryDomain: string | null, slug: string, viewerRole: OrganizationMemberRole | null } };

export type OrganizationInvitationsQueryVariables = Exact<{
  organizationId: PlatformId;
}>;


export type OrganizationInvitationsQuery = { organizationInvitationList: Array<{ createdAt: string, email: string, expiresAt: string | null, id: PlatformId, invitedBy: PlatformId, invitedByName: string | null, organizationId: PlatformId, organizationName: string, status: OrganizationInvitationStatus, updatedAt: string, accountId: PlatformId | null }> };

export type PendingOrganizationInvitationsQueryVariables = Exact<{ [key: string]: never; }>;


export type PendingOrganizationInvitationsQuery = { pendingOrganizationInvitationList: Array<{ createdAt: string, email: string, expiresAt: string | null, id: PlatformId, invitedBy: PlatformId, invitedByName: string | null, organizationId: PlatformId, organizationName: string, status: OrganizationInvitationStatus, updatedAt: string, accountId: PlatformId | null }> };

export type InviteOrganizationMemberMutationVariables = Exact<{
  input: InviteOrganizationMemberInput;
}>;


export type InviteOrganizationMemberMutation = { inviteOrganizationMember: { createdAt: string, email: string, expiresAt: string | null, id: PlatformId, invitedBy: PlatformId, invitedByName: string | null, organizationId: PlatformId, organizationName: string, status: OrganizationInvitationStatus, updatedAt: string, accountId: PlatformId | null } };

export type AcceptOrganizationInvitationMutationVariables = Exact<{
  input: AcceptOrganizationInvitationInput;
}>;


export type AcceptOrganizationInvitationMutation = { acceptOrganizationInvitation: { avatarUrl: string | null, createdAt: string, id: PlatformId, joinPolicy: OrganizationJoinPolicy, name: string, primaryDomain: string | null, slug: string, viewerRole: OrganizationMemberRole | null } };

export type CancelOrganizationInvitationMutationVariables = Exact<{
  input: CancelOrganizationInvitationInput;
}>;


export type CancelOrganizationInvitationMutation = { cancelOrganizationInvitation: { createdAt: string, email: string, expiresAt: string | null, id: PlatformId, invitedBy: PlatformId, invitedByName: string | null, organizationId: PlatformId, organizationName: string, status: OrganizationInvitationStatus, updatedAt: string, accountId: PlatformId | null } };

export type OrganizationMembersQueryVariables = Exact<{
  organizationId: PlatformId;
}>;


export type OrganizationMembersQuery = { organizationMemberList: Array<{ accountId: PlatformId, email: string, imageUrl: string | null, joinedAt: string, name: string, role: OrganizationMemberRole, status: OrganizationMemberStatus, disabledAt: string | null, disabledByAccountId: PlatformId | null }> };

export type UpdateOrganizationMemberRoleMutationVariables = Exact<{
  input: UpdateOrganizationMemberRoleInput;
}>;


export type UpdateOrganizationMemberRoleMutation = { updateOrganizationMemberRole: { accountId: PlatformId } };

export type RemoveOrganizationMemberMutationVariables = Exact<{
  input: RemoveOrganizationMemberInput;
}>;


export type RemoveOrganizationMemberMutation = { removeOrganizationMember: { ok: boolean } };

export type ThreadAgentSessionRetrieveQueryVariables = Exact<{
  sessionId: PlatformId;
}>;


export type ThreadAgentSessionRetrieveQuery = { threadAgentSessionRetrieve: { capabilities: Array<{ action: AgentSessionActionCapabilityName, reason: string | null, status: AgentSessionActionCapabilityStatus }>, recoverability: { reason: string | null, status: AgentSessionRecoverabilityStatus }, session: { agentId: PlatformId, archivedAt: string | null, createdAt: string, deploymentVersionId: PlatformId | null, deploymentVersionNumber: number | null, id: PlatformId, kind: AgentKind, lastMessageAt: string | null, model: string, organizationId: PlatformId, provider: string, runtimeId: string, status: SessionStatus, title: string | null, updatedAt: string, lastRun: { completedAt: string | null, createdAt: string, deploymentVersionId: PlatformId | null, deploymentVersionNumber: number | null, id: PlatformId, model: string | null, provider: string | null, startedAt: string | null, status: RunStatus, traceId: string, trigger: SessionRunTrigger, updatedAt: string, error: { code: string, details: PrimitiveRecord, message: string, retryable: boolean } | null } | null } } };

export type AgentSessionDiagnosticsQueryVariables = Exact<{
  sessionId: PlatformId;
}>;


export type AgentSessionDiagnosticsQuery = { agentSessionDiagnostics: { generatedAt: string, pendingPermissionCount: number, execution: { binding: { deploymentVersionId: PlatformId | null, deploymentVersionNumber: number | null, kind: AgentKind, model: string, provider: string, runtimeId: string, sessionId: PlatformId }, skills: Array<{ skillId: PlatformId, skillName: string }>, spaces: Array<{ spaceId: PlatformId }>, tools: Array<{ credentialMode: string, serverId: PlatformId }> } | null, nativeRuntimeRef: { kind: string | null, runtimeId: string | null, status: string, valuePreview: string | null }, session: { deploymentVersionId: PlatformId | null, deploymentVersionNumber: number | null, id: PlatformId, kind: AgentKind, model: string, provider: string, runtimeId: string, status: SessionStatus, title: string | null, lastRun: { deploymentVersionId: PlatformId | null, deploymentVersionNumber: number | null, id: PlatformId, model: string | null, provider: string | null, status: RunStatus, traceId: string } | null } } };

export type CreateAgentSessionMutationVariables = Exact<{
  input: CreateAgentSessionInput;
}>;


export type CreateAgentSessionMutation = { createAgentSession: { agentId: PlatformId, archivedAt: string | null, createdAt: string, deploymentVersionId: PlatformId | null, deploymentVersionNumber: number | null, id: PlatformId, kind: AgentKind, lastMessageAt: string | null, model: string, provider: string, runtimeId: string, status: SessionStatus, title: string | null, type: SessionType, updatedAt: string, organizationId: PlatformId, lastRun: { completedAt: string | null, createdAt: string, deploymentVersionId: PlatformId | null, deploymentVersionNumber: number | null, id: PlatformId, model: string | null, provider: string | null, startedAt: string | null, status: RunStatus, traceId: string, trigger: SessionRunTrigger, updatedAt: string, error: { code: string, details: PrimitiveRecord, message: string, retryable: boolean } | null } | null } };

export type AgentSessionListQueryVariables = Exact<{
  agentId: PlatformId;
  archived?: boolean | null | undefined;
  participantOnly?: boolean | null | undefined;
  type?: SessionType | null | undefined;
}>;


export type AgentSessionListQuery = { agentSessionList: { nodes: Array<{ agentId: PlatformId, archivedAt: string | null, createdAt: string, deploymentVersionId: PlatformId | null, deploymentVersionNumber: number | null, id: PlatformId, kind: AgentKind, lastMessageAt: string | null, model: string, provider: string, runtimeId: string, status: SessionStatus, title: string | null, type: SessionType, updatedAt: string, organizationId: PlatformId, lastRun: { completedAt: string | null, createdAt: string, deploymentVersionId: PlatformId | null, deploymentVersionNumber: number | null, id: PlatformId, model: string | null, provider: string | null, startedAt: string | null, status: RunStatus, traceId: string, trigger: SessionRunTrigger, updatedAt: string, error: { code: string, details: PrimitiveRecord, message: string, retryable: boolean } | null } | null }> } };

export type AgentSessionProcessEventsQueryVariables = Exact<{
  limit: number;
  sessionId: PlatformId;
}>;


export type AgentSessionProcessEventsQuery = { sessionProcessEvents: Array<{ content: string, durationMs: number | null, id: PlatformId, occurredAt: string, status: SessionProcessEventStatus, tokens: number | null, type: SessionProcessEventType }> };

export type ThreadSessionMessagesQueryVariables = Exact<{
  sessionId: PlatformId;
}>;


export type ThreadSessionMessagesQuery = { threadSessionMessages: Array<{ content: string, createdAt: string, createdBy: PlatformId, id: PlatformId, role: SessionMessageRole, plan: Array<{ content: string, priority: SessionMessagePlanPriority, status: SessionMessagePlanStatus }>, segments: Array<{ argsText: string | null, kind: SessionMessageSegmentKind, output: string | null, path: string | null, text: string | null, tool: string | null, toolCallId: string | null }> }> };

export type SendAgentSessionEventsMutationVariables = Exact<{
  sessionId: PlatformId;
  events: Array<AgentSessionEventInput>;
}>;


export type SendAgentSessionEventsMutation = { sendAgentSessionEvents: { acceptedAt: string, warnings: Array<{ code: string, message: string }> } };

export type PrewarmAgentSessionMutationVariables = Exact<{
  sessionId: PlatformId;
}>;


export type PrewarmAgentSessionMutation = { prewarmAgentSession: { scheduledAt: string, sessionId: PlatformId } };

export type SessionsQueryVariables = Exact<{
  organizationId: PlatformId;
  archived?: boolean | null | undefined;
  type?: SessionType | null | undefined;
}>;


export type SessionsQuery = { sessionList: { nodes: Array<{ agentId: PlatformId, archivedAt: string | null, createdAt: string, deploymentVersionId: PlatformId | null, deploymentVersionNumber: number | null, id: PlatformId, kind: AgentKind, lastMessageAt: string | null, model: string, provider: string, runtimeId: string, status: SessionStatus, title: string | null, type: SessionType, updatedAt: string, organizationId: PlatformId, lastRun: { completedAt: string | null, createdAt: string, deploymentVersionId: PlatformId | null, deploymentVersionNumber: number | null, id: PlatformId, model: string | null, provider: string | null, startedAt: string | null, status: RunStatus, traceId: string, trigger: SessionRunTrigger, updatedAt: string, error: { code: string, details: PrimitiveRecord, message: string, retryable: boolean } | null } | null }> } };

export type ThreadAgentSessionListQueryVariables = Exact<{
  organizationId: PlatformId;
  archived?: boolean | null | undefined;
  type?: SessionType | null | undefined;
}>;


export type ThreadAgentSessionListQuery = { threadAgentSessionList: { nodes: Array<{ capabilities: Array<{ action: AgentSessionActionCapabilityName, reason: string | null, status: AgentSessionActionCapabilityStatus }>, session: { agentId: PlatformId, archivedAt: string | null, createdAt: string, deploymentVersionId: PlatformId | null, deploymentVersionNumber: number | null, id: PlatformId, kind: AgentKind, lastMessageAt: string | null, model: string, provider: string, runtimeId: string, status: SessionStatus, title: string | null, type: SessionType, updatedAt: string, organizationId: PlatformId, lastRun: { completedAt: string | null, createdAt: string, deploymentVersionId: PlatformId | null, deploymentVersionNumber: number | null, id: PlatformId, model: string | null, provider: string | null, startedAt: string | null, status: RunStatus, traceId: string, trigger: SessionRunTrigger, updatedAt: string, error: { code: string, details: PrimitiveRecord, message: string, retryable: boolean } | null } | null } }> } };

export type AutoTitleSessionMutationVariables = Exact<{
  input: RenameSessionInput;
}>;


export type AutoTitleSessionMutation = { autoTitleSession: { id: PlatformId } };

export type ArchiveSessionMutationVariables = Exact<{
  sessionId: PlatformId;
}>;


export type ArchiveSessionMutation = { archiveAgentSession: { ok: boolean } };

export type RestoreSessionMutationVariables = Exact<{
  sessionId: PlatformId;
}>;


export type RestoreSessionMutation = { unarchiveAgentSession: { ok: boolean } };

export type DeleteAgentSessionMutationVariables = Exact<{
  sessionId: PlatformId;
}>;


export type DeleteAgentSessionMutation = { deleteAgentSession: { ok: boolean } };

export type AddSessionResourceMutationVariables = Exact<{
  input: AddSessionResourceInput;
}>;


export type AddSessionResourceMutation = { addSessionResource: { contentType: string, expectedSize: number, expiresAt: string, fileId: PlatformId, partSize: number | null, path: string, purpose: FilePurpose, status: FileUploadStatus, strategy: FileUploadStrategy, owner: { id: PlatformId, kind: FileOwnerKind }, scope: { id: PlatformId, kind: FileScopeKind } } };

export type ListSessionResourcesQueryVariables = Exact<{
  sessionId: PlatformId;
}>;


export type ListSessionResourcesQuery = { listSessionResources: Array<{ createdAt: string, id: PlatformId, mimeType: string | null, name: string, path: string, size: number }> };

export type RemoveSessionResourceMutationVariables = Exact<{
  input: RemoveSessionResourceInput;
}>;


export type RemoveSessionResourceMutation = { removeSessionResource: { ok: boolean } };

export type SessionThreadUiStateListQueryVariables = Exact<{
  organizationId: PlatformId;
}>;


export type SessionThreadUiStateListQuery = { sessionThreadUiStateList: Array<{ pinned: boolean, readAt: string | null, sessionId: PlatformId, updatedAt: string }> };

export type UpdateSessionThreadUiStateMutationVariables = Exact<{
  input: UpdateSessionThreadUiStateInput;
}>;


export type UpdateSessionThreadUiStateMutation = { updateSessionThreadUiState: { pinned: boolean, readAt: string | null, sessionId: PlatformId, updatedAt: string } };

export type SessionProcessEventsQueryVariables = Exact<{
  limit: number;
  sessionId: PlatformId;
}>;


export type SessionProcessEventsQuery = { threadSessionProcessEvents: Array<{ content: string, durationMs: number | null, id: PlatformId, occurredAt: string, status: SessionProcessEventStatus, tokens: number | null, type: SessionProcessEventType }> };

export type SkillSummaryFieldsFragment = { author: string, autoEnabled: boolean, createdAt: string, description: string, id: PlatformId, name: string, ownerId: PlatformId, ownerName: string, role: SkillRegistryRole, snapshotId: PlatformId, sourceKind: SkillSourceKind, updatedAt: string, organizationId: PlatformId, forkOrigin: { name: string, ownerName: string, skillId: PlatformId } | null };

export type SkillShareTargetFieldsFragment = { createdAt: string, email: string | null, id: PlatformId, kind: SkillShareTargetKind, name: string | null };

export type SkillDetailFieldsFragment = { author: string, autoEnabled: boolean, createdAt: string, description: string, id: PlatformId, name: string, ownerId: PlatformId, ownerName: string, role: SkillRegistryRole, snapshotId: PlatformId, sourceKind: SkillSourceKind, updatedAt: string, organizationId: PlatformId, forkOrigin: { name: string, ownerName: string, skillId: PlatformId } | null, currentSnapshot: { archiveFormat: string, author: string, blobKey: string, blobSha256: string, blobSize: number, compression: string, createdAt: string, description: string, id: PlatformId, name: string, skillMarkdownPath: string, uncompressedSize: number, version: string | null }, entries: Array<{ entryKind: SkillSnapshotEntryKind, isExecutable: boolean, mimeType: string | null, path: string, sha256: string | null, size: number }>, shareTargets: Array<{ createdAt: string, email: string | null, id: PlatformId, kind: SkillShareTargetKind, name: string | null }> };

export type SkillDetailQueryVariables = Exact<{
  skillId: PlatformId;
}>;


export type SkillDetailQuery = { skillDetail: { author: string, autoEnabled: boolean, createdAt: string, description: string, id: PlatformId, name: string, ownerId: PlatformId, ownerName: string, role: SkillRegistryRole, snapshotId: PlatformId, sourceKind: SkillSourceKind, updatedAt: string, organizationId: PlatformId, forkOrigin: { name: string, ownerName: string, skillId: PlatformId } | null, currentSnapshot: { archiveFormat: string, author: string, blobKey: string, blobSha256: string, blobSize: number, compression: string, createdAt: string, description: string, id: PlatformId, name: string, skillMarkdownPath: string, uncompressedSize: number, version: string | null }, entries: Array<{ entryKind: SkillSnapshotEntryKind, isExecutable: boolean, mimeType: string | null, path: string, sha256: string | null, size: number }>, shareTargets: Array<{ createdAt: string, email: string | null, id: PlatformId, kind: SkillShareTargetKind, name: string | null }> } };

export type OrganizationSkillsQueryVariables = Exact<{
  organizationId: PlatformId;
}>;


export type OrganizationSkillsQuery = { organizationSkillList: Array<{ author: string, autoEnabled: boolean, createdAt: string, description: string, id: PlatformId, name: string, ownerId: PlatformId, ownerName: string, role: SkillRegistryRole, snapshotId: PlatformId, sourceKind: SkillSourceKind, updatedAt: string, organizationId: PlatformId, forkOrigin: { name: string, ownerName: string, skillId: PlatformId } | null }> };

export type CreateSkillForkMutationVariables = Exact<{
  input: CreateSkillForkInput;
}>;


export type CreateSkillForkMutation = { createSkillFork: { author: string, autoEnabled: boolean, createdAt: string, description: string, id: PlatformId, name: string, ownerId: PlatformId, ownerName: string, role: SkillRegistryRole, snapshotId: PlatformId, sourceKind: SkillSourceKind, updatedAt: string, organizationId: PlatformId, forkOrigin: { name: string, ownerName: string, skillId: PlatformId } | null } };

export type DeleteOwnedSkillMutationVariables = Exact<{
  skillId: PlatformId;
}>;


export type DeleteOwnedSkillMutation = { deleteOwnedSkill: { ok: boolean } };

export type ShareSkillWithUserMutationVariables = Exact<{
  input: ShareSkillWithUserInput;
}>;


export type ShareSkillWithUserMutation = { shareSkillWithUser: { createdAt: string, email: string | null, id: PlatformId, kind: SkillShareTargetKind, name: string | null } };

export type ShareSkillWithOrganizationMutationVariables = Exact<{
  input: ShareSkillWithOrganizationInput;
}>;


export type ShareSkillWithOrganizationMutation = { shareSkillWithOrganization: { createdAt: string, email: string | null, id: PlatformId, kind: SkillShareTargetKind, name: string | null } };

export type UnshareSkillTargetMutationVariables = Exact<{
  input: UnshareSkillTargetInput;
}>;


export type UnshareSkillTargetMutation = { unshareSkillTarget: { ok: boolean } };

export type SpaceCollaboratorsQueryVariables = Exact<{
  spaceId: PlatformId;
}>;


export type SpaceCollaboratorsQuery = { spaceCollaboratorList: Array<{ assignedBy: PlatformId | null, createdAt: string, email: string | null, imageUrl: string | null, name: string | null, principal: string, role: SpaceRole }> };

export type AddCollaboratorMutationVariables = Exact<{
  input: AddCollaboratorInput;
}>;


export type AddCollaboratorMutation = { addCollaborator: { principal: string } };

export type AddOrganizationCollaboratorMutationVariables = Exact<{
  input: AddOrganizationCollaboratorInput;
}>;


export type AddOrganizationCollaboratorMutation = { addOrganizationCollaborator: { principal: string } };

export type UpdateCollaboratorMutationVariables = Exact<{
  input: UpdateCollaboratorInput;
}>;


export type UpdateCollaboratorMutation = { updateCollaborator: { principal: string } };

export type RemoveCollaboratorMutationVariables = Exact<{
  input: RemoveCollaboratorInput;
}>;


export type RemoveCollaboratorMutation = { removeCollaborator: { ok: boolean } };

export type CreateSpaceMutationVariables = Exact<{
  input: CreateSpaceInput;
}>;


export type CreateSpaceMutation = { createSpace: { createdAt: string, id: PlatformId, isSharedWithViewer: boolean, name: string, ownerId: PlatformId, role: SpaceRole, storagePrefix: string, canDelete: boolean, canUpdateAcl: boolean, creatorMembershipStatus: CreatorMembershipStatus, viewerAssetRole: SpaceRole, visibility: SpaceVisibility } };

export type DeleteSpaceMutationVariables = Exact<{
  spaceId: PlatformId;
}>;


export type DeleteSpaceMutation = { deleteSpace: { ok: boolean } };

export type SpaceFilesQueryVariables = Exact<{
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
  organizationId: PlatformId;
}>;


export type SpacesQuery = { spaceList: Array<{ createdAt: string, id: PlatformId, isSharedWithViewer: boolean, name: string, ownerId: PlatformId, role: SpaceRole, storagePrefix: string, canDelete: boolean, canUpdateAcl: boolean, creatorMembershipStatus: CreatorMembershipStatus, viewerAssetRole: SpaceRole, visibility: SpaceVisibility }> };

export type ViewerQueryVariables = Exact<{ [key: string]: never; }>;


export type ViewerQuery = { viewer: { account: { email: string, id: PlatformId, imageUrl: string | null, name: string, systemAgentModel: { modelId: string, vendor: string } | null } | null, activeOrganization: { avatarUrl: string | null, createdAt: string, id: PlatformId, joinPolicy: OrganizationJoinPolicy, name: string, primaryDomain: string | null, slug: string, viewerRole: OrganizationMemberRole | null } | null, auth: { currentSecurityLevel: AuthSecurityLevel, methods: Array<AuthMethod> }, memberships: Array<{ joinedAt: string, role: OrganizationMemberRole, organization: { avatarUrl: string | null, createdAt: string, id: PlatformId, joinPolicy: OrganizationJoinPolicy, name: string, primaryDomain: string | null, slug: string, viewerRole: OrganizationMemberRole | null } }> } };

export type UpdateProfileMutationVariables = Exact<{
  input: UpdateAccountProfileInput;
}>;


export type UpdateProfileMutation = { updateProfile: { imageUrl: string | null, name: string } };

export type SetSystemAgentModelMutationVariables = Exact<{
  input: SetSystemAgentModelInput;
}>;


export type SetSystemAgentModelMutation = { setSystemAgentModel: { id: PlatformId, systemAgentModel: { modelId: string, vendor: string } | null } };

export type VendorCredentialListQueryVariables = Exact<{
  organizationId: PlatformId;
}>;


export type VendorCredentialListQuery = { vendorCredentialList: Array<{ apiBase: string | null, id: PlatformId, isDefault: boolean, isPreferred: boolean, maskedApiKey: string, models: Array<string> | null, name: string, ownerUserId: PlatformId | null, scope: VendorCredentialScope, vendorId: string, organizationId: PlatformId }> };

export type CreateVendorCredentialMutationVariables = Exact<{
  input: CreateVendorCredentialInput;
}>;


export type CreateVendorCredentialMutation = { createVendorCredential: { apiBase: string | null, id: PlatformId, isDefault: boolean, isPreferred: boolean, maskedApiKey: string, models: Array<string> | null, name: string, ownerUserId: PlatformId | null, scope: VendorCredentialScope, vendorId: string, organizationId: PlatformId } };

export type UpdateVendorCredentialMutationVariables = Exact<{
  input: UpdateVendorCredentialInput;
}>;


export type UpdateVendorCredentialMutation = { updateVendorCredential: { apiBase: string | null, id: PlatformId, isDefault: boolean, isPreferred: boolean, maskedApiKey: string, models: Array<string> | null, name: string, ownerUserId: PlatformId | null, scope: VendorCredentialScope, vendorId: string, organizationId: PlatformId } };

export type DeleteVendorCredentialMutationVariables = Exact<{
  input: DeleteVendorCredentialInput;
}>;


export type DeleteVendorCredentialMutation = { deleteVendorCredential: { ok: boolean } };

export type AvailableAgentModelsQueryVariables = Exact<{
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
  packageSharingEnabled
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
  actorUserId
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
  actorUserId
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
  organizationId
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
export const EnvironmentShareTargetFieldsFragmentDoc = new TypedDocumentString(`
    fragment EnvironmentShareTargetFields on EnvironmentShareTarget {
  createdAt
  email
  id
  kind
  name
}
    `, {"fragmentName":"EnvironmentShareTargetFields"}) as unknown as TypedDocumentString<EnvironmentShareTargetFieldsFragment, unknown>;
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
  shareTargets {
    ...EnvironmentShareTargetFields
  }
  updatedAt
  usedByAgentCount
  organizationId
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
fragment EnvironmentShareTargetFields on EnvironmentShareTarget {
  createdAt
  email
  id
  kind
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
  hasSharedCredential
  iconUrl
  id
  name
  ownerId
  ownerName
  source
  updatedAt
  url
  organizationId
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
  autoEnabled
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
  role
  snapshotId
  sourceKind
  updatedAt
  organizationId
}
    `, {"fragmentName":"SkillSummaryFields"}) as unknown as TypedDocumentString<SkillSummaryFieldsFragment, unknown>;
export const SkillShareTargetFieldsFragmentDoc = new TypedDocumentString(`
    fragment SkillShareTargetFields on SkillShareTarget {
  createdAt
  email
  id
  kind
  name
}
    `, {"fragmentName":"SkillShareTargetFields"}) as unknown as TypedDocumentString<SkillShareTargetFieldsFragment, unknown>;
export const SkillDetailFieldsFragmentDoc = new TypedDocumentString(`
    fragment SkillDetailFields on SkillDetail {
  author
  autoEnabled
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
  role
  snapshotId
  sourceKind
  updatedAt
  organizationId
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
  shareTargets {
    ...SkillShareTargetFields
  }
}
    fragment SkillShareTargetFields on SkillShareTarget {
  createdAt
  email
  id
  kind
  name
}`, {"fragmentName":"SkillDetailFields"}) as unknown as TypedDocumentString<SkillDetailFieldsFragment, unknown>;
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
    query AgentChannelBindings($agentId: ULID!) {
  agentChannelBindingList(agentId: $agentId) {
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
export const AddAgentCollaboratorDocument = new TypedDocumentString(`
    mutation AddAgentCollaborator($input: AddAgentCollaboratorInput!) {
  addAgentCollaborator(input: $input) {
    ok
  }
}
    `) as unknown as TypedDocumentString<AddAgentCollaboratorMutation, AddAgentCollaboratorMutationVariables>;
export const RemoveAgentCollaboratorDocument = new TypedDocumentString(`
    mutation RemoveAgentCollaborator($input: RemoveAgentCollaboratorInput!) {
  removeAgentCollaborator(input: $input) {
    ok
  }
}
    `) as unknown as TypedDocumentString<RemoveAgentCollaboratorMutation, RemoveAgentCollaboratorMutationVariables>;
export const UpdateAgentCollaboratorDocument = new TypedDocumentString(`
    mutation UpdateAgentCollaborator($input: UpdateAgentCollaboratorInput!) {
  updateAgentCollaborator(input: $input) {
    ok
  }
}
    `) as unknown as TypedDocumentString<UpdateAgentCollaboratorMutation, UpdateAgentCollaboratorMutationVariables>;
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
  packageSharingEnabled
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
    query AccessibleAgents($organizationId: ULID!) {
  accessibleAgentList(organizationId: $organizationId) {
    createdAt
    description
    id
    kind
    name
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
    query Agent($agentId: ULID!) {
  agent(agentId: $agentId) {
    createdAt
    description
    id
    kind
    liveVersion {
      ...AgentDeploymentVersionFields
    }
    model
    name
    owner {
      ...AgentOwnerFields
    }
    packageSharingEnabled
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
    query AgentEditorState($agentId: ULID!) {
  agentEditorState(agentId: $agentId) {
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
    collaborators {
      principal
      role
      name
      email
      imageUrl
    }
    mcpBindings {
      authType
      authorizationState
      createdAt
      credentialMode
      credentialScope
      credentialStatus
      credentialSubject
      enabled
      hasSharedCredential
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
  packageSharingEnabled
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
    query AgentManifest($agentId: ULID!) {
  agentManifest(agentId: $agentId) {
    agentId
    json
    yaml
  }
}
    `) as unknown as TypedDocumentString<AgentManifestQuery, AgentManifestQueryVariables>;
export const ExportAgentPackageDocument = new TypedDocumentString(`
    query ExportAgentPackage($agentId: ULID!) {
  exportAgentPackage(agentId: $agentId) {
    agentId
    contentType
    fileId
    fileName
    manifestYaml
    size
  }
}
    `) as unknown as TypedDocumentString<ExportAgentPackageQuery, ExportAgentPackageQueryVariables>;
export const UpdateAgentPackageSharingDocument = new TypedDocumentString(`
    mutation UpdateAgentPackageSharing($input: UpdateAgentPackageSharingInput!) {
  updateAgentPackageSharing(input: $input) {
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
  packageSharingEnabled
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
}`) as unknown as TypedDocumentString<UpdateAgentPackageSharingMutation, UpdateAgentPackageSharingMutationVariables>;
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
  packageSharingEnabled
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
  packageSharingEnabled
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
  packageSharingEnabled
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
    mutation UnpublishAgent($agentId: ULID!) {
  unpublishAgent(agentId: $agentId) {
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
  packageSharingEnabled
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
export const OrganizationCostCardDocument = new TypedDocumentString(`
    query OrganizationCostCard($organizationId: ULID!, $range: CostRange!, $runPurposes: [CostRunPurpose!]) {
  organizationCostCard(
    organizationId: $organizationId
    range: $range
    runPurposes: $runPurposes
  ) {
    agents {
      ...CostAgentFields
    }
    daily {
      ...CostDailyFields
    }
    models {
      ...CostModelFields
    }
    ownerUsers {
      activeUsers
      agentCount
      cacheCreationTokens
      cacheReadTokens
      inputTokens
      outputTokens
      previousCostUsd
      requestCount
      topAgentId
      topAgentName
      totalCostUsd
      unpricedRequestCount
      userEmail
      userId
      userName
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
    users {
      activeUsers
      agentCount
      cacheCreationTokens
      cacheReadTokens
      inputTokens
      outputTokens
      previousCostUsd
      requestCount
      topAgentId
      topAgentName
      totalCostUsd
      unpricedRequestCount
      userEmail
      userId
      userName
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
  actorUserId
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
}`) as unknown as TypedDocumentString<OrganizationCostCardQuery, OrganizationCostCardQueryVariables>;
export const AgentCostCardDocument = new TypedDocumentString(`
    query AgentCostCard($agentId: ULID!, $range: CostRange!, $runPurposes: [CostRunPurpose!]) {
  agentCostCard(agentId: $agentId, range: $range, runPurposes: $runPurposes) {
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
    users {
      activeUsers
      agentCount
      cacheCreationTokens
      cacheReadTokens
      inputTokens
      outputTokens
      previousCostUsd
      requestCount
      topAgentId
      topAgentName
      totalCostUsd
      unpricedRequestCount
      userEmail
      userId
      userName
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
  actorUserId
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
export const MemberCostCardDocument = new TypedDocumentString(`
    query MemberCostCard($organizationId: ULID!, $memberId: ULID!, $range: CostRange!) {
  memberCostCard(
    organizationId: $organizationId
    memberId: $memberId
    range: $range
  ) {
    owned {
      ...CostAttributionFields
    }
    used {
      ...CostAttributionFields
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
  actorUserId
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
}`) as unknown as TypedDocumentString<MemberCostCardQuery, MemberCostCardQueryVariables>;
export const OrganizationEnvironmentsDocument = new TypedDocumentString(`
    query OrganizationEnvironments($organizationId: ULID!) {
  organizationEnvironmentList(organizationId: $organizationId) {
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
  organizationId
}`) as unknown as TypedDocumentString<OrganizationEnvironmentsQuery, OrganizationEnvironmentsQueryVariables>;
export const EnvironmentDetailDocument = new TypedDocumentString(`
    query EnvironmentDetail($environmentId: ULID!) {
  environment(environmentId: $environmentId) {
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
fragment EnvironmentShareTargetFields on EnvironmentShareTarget {
  createdAt
  email
  id
  kind
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
  shareTargets {
    ...EnvironmentShareTargetFields
  }
  updatedAt
  usedByAgentCount
  organizationId
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
  organizationId
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
fragment EnvironmentShareTargetFields on EnvironmentShareTarget {
  createdAt
  email
  id
  kind
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
  shareTargets {
    ...EnvironmentShareTargetFields
  }
  updatedAt
  usedByAgentCount
  organizationId
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
  organizationId
}`) as unknown as TypedDocumentString<CreateEnvironmentForkMutation, CreateEnvironmentForkMutationVariables>;
export const DeleteEnvironmentDocument = new TypedDocumentString(`
    mutation DeleteEnvironment($input: DeleteEnvironmentInput!) {
  deleteEnvironment(input: $input) {
    ok
  }
}
    `) as unknown as TypedDocumentString<DeleteEnvironmentMutation, DeleteEnvironmentMutationVariables>;
export const SetOrganizationDefaultEnvironmentDocument = new TypedDocumentString(`
    mutation SetOrganizationDefaultEnvironment($input: SetOrganizationDefaultEnvironmentInput!) {
  setOrganizationDefaultEnvironment(input: $input) {
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
  organizationId
}`) as unknown as TypedDocumentString<SetOrganizationDefaultEnvironmentMutation, SetOrganizationDefaultEnvironmentMutationVariables>;
export const ShareEnvironmentWithUserDocument = new TypedDocumentString(`
    mutation ShareEnvironmentWithUser($input: ShareEnvironmentWithUserInput!) {
  shareEnvironmentWithUser(input: $input) {
    ...EnvironmentShareTargetFields
  }
}
    fragment EnvironmentShareTargetFields on EnvironmentShareTarget {
  createdAt
  email
  id
  kind
  name
}`) as unknown as TypedDocumentString<ShareEnvironmentWithUserMutation, ShareEnvironmentWithUserMutationVariables>;
export const ShareEnvironmentWithOrganizationDocument = new TypedDocumentString(`
    mutation ShareEnvironmentWithOrganization($input: ShareEnvironmentWithOrganizationInput!) {
  shareEnvironmentWithOrganization(input: $input) {
    ...EnvironmentShareTargetFields
  }
}
    fragment EnvironmentShareTargetFields on EnvironmentShareTarget {
  createdAt
  email
  id
  kind
  name
}`) as unknown as TypedDocumentString<ShareEnvironmentWithOrganizationMutation, ShareEnvironmentWithOrganizationMutationVariables>;
export const UnshareEnvironmentTargetDocument = new TypedDocumentString(`
    mutation UnshareEnvironmentTarget($input: UnshareEnvironmentTargetInput!) {
  unshareEnvironmentTarget(input: $input) {
    ok
  }
}
    `) as unknown as TypedDocumentString<UnshareEnvironmentTargetMutation, UnshareEnvironmentTargetMutationVariables>;
export const McpRegistryDocument = new TypedDocumentString(`
    query McpRegistry($organizationId: ULID!) {
  mcpRegistry(organizationId: $organizationId) {
    currentUserEmail
    currentUserId
    currentUserName
    isAdmin
    personal {
      ...McpServerFields
    }
    organizationId
    organizationShared {
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
  hasSharedCredential
  iconUrl
  id
  name
  ownerId
  ownerName
  source
  updatedAt
  url
  organizationId
  credential {
    ...McpCredentialFields
  }
}`) as unknown as TypedDocumentString<McpRegistryQuery, McpRegistryQueryVariables>;
export const CreatePersonalMcpServerDocument = new TypedDocumentString(`
    mutation CreatePersonalMcpServer($input: CreatePersonalMcpServerInput!) {
  createPersonalMcpServer(input: $input) {
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
  hasSharedCredential
  iconUrl
  id
  name
  ownerId
  ownerName
  source
  updatedAt
  url
  organizationId
  credential {
    ...McpCredentialFields
  }
}`) as unknown as TypedDocumentString<CreatePersonalMcpServerMutation, CreatePersonalMcpServerMutationVariables>;
export const CreateOrganizationMcpServerDocument = new TypedDocumentString(`
    mutation CreateOrganizationMcpServer($input: CreateOrganizationMcpServerInput!) {
  createOrganizationMcpServer(input: $input) {
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
  hasSharedCredential
  iconUrl
  id
  name
  ownerId
  ownerName
  source
  updatedAt
  url
  organizationId
  credential {
    ...McpCredentialFields
  }
}`) as unknown as TypedDocumentString<CreateOrganizationMcpServerMutation, CreateOrganizationMcpServerMutationVariables>;
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
  hasSharedCredential
  iconUrl
  id
  name
  ownerId
  ownerName
  source
  updatedAt
  url
  organizationId
  credential {
    ...McpCredentialFields
  }
}`) as unknown as TypedDocumentString<ConnectMcpBearerMutation, ConnectMcpBearerMutationVariables>;
export const SetOrganizationSharedBearerDocument = new TypedDocumentString(`
    mutation SetOrganizationSharedBearer($input: SetOrganizationSharedMcpBearerInput!) {
  setOrganizationSharedBearer(input: $input) {
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
  hasSharedCredential
  iconUrl
  id
  name
  ownerId
  ownerName
  source
  updatedAt
  url
  organizationId
  credential {
    ...McpCredentialFields
  }
}`) as unknown as TypedDocumentString<SetOrganizationSharedBearerMutation, SetOrganizationSharedBearerMutationVariables>;
export const ClearOrganizationSharedCredentialDocument = new TypedDocumentString(`
    mutation ClearOrganizationSharedCredential($serverId: ULID!) {
  clearOrganizationSharedCredential(serverId: $serverId) {
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
  hasSharedCredential
  iconUrl
  id
  name
  ownerId
  ownerName
  source
  updatedAt
  url
  organizationId
  credential {
    ...McpCredentialFields
  }
}`) as unknown as TypedDocumentString<ClearOrganizationSharedCredentialMutation, ClearOrganizationSharedCredentialMutationVariables>;
export const RevokeMcpUserCredentialDocument = new TypedDocumentString(`
    mutation RevokeMcpUserCredential($serverId: ULID!) {
  revokeMcpUserCredential(serverId: $serverId) {
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
  hasSharedCredential
  iconUrl
  id
  name
  ownerId
  ownerName
  source
  updatedAt
  url
  organizationId
  credential {
    ...McpCredentialFields
  }
}`) as unknown as TypedDocumentString<RevokeMcpUserCredentialMutation, RevokeMcpUserCredentialMutationVariables>;
export const SetMcpServerEnabledDocument = new TypedDocumentString(`
    mutation SetMcpServerEnabled($serverId: ULID!, $enabled: Boolean!) {
  setMcpServerEnabled(serverId: $serverId, enabled: $enabled) {
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
  hasSharedCredential
  iconUrl
  id
  name
  ownerId
  ownerName
  source
  updatedAt
  url
  organizationId
  credential {
    ...McpCredentialFields
  }
}`) as unknown as TypedDocumentString<SetMcpServerEnabledMutation, SetMcpServerEnabledMutationVariables>;
export const DeleteMcpServerDocument = new TypedDocumentString(`
    mutation DeleteMcpServer($serverId: ULID!) {
  deleteMcpServer(serverId: $serverId) {
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
export const OnboardingDiscoveryDocument = new TypedDocumentString(`
    query OnboardingDiscovery {
  onboardingDiscovery {
    domain
    isPublicEmail
    orgs {
      creator
      id
      joinPolicy
      memberCount
      name
    }
  }
}
    `) as unknown as TypedDocumentString<OnboardingDiscoveryQuery, OnboardingDiscoveryQueryVariables>;
export const OnboardingBootstrapDocument = new TypedDocumentString(`
    mutation OnboardingBootstrap($input: BootstrapOnboardingInput!) {
  onboardingBootstrap(input: $input) {
    completed
    organization {
      avatarUrl
      createdAt
      id
      joinPolicy
      name
      primaryDomain
      slug
      viewerRole
    }
  }
}
    `) as unknown as TypedDocumentString<OnboardingBootstrapMutation, OnboardingBootstrapMutationVariables>;
export const OrganizationAccessRequestsDocument = new TypedDocumentString(`
    query OrganizationAccessRequests($organizationId: ULID!) {
  organizationAccessRequestList(organizationId: $organizationId) {
    createdAt
    id
    organizationId
    organizationName
    referrerAccountId
    referrerName
    requestedByAccountId
    requesterEmail
    requesterName
    reviewedAt
    reviewedBy
    reviewedByName
    status
    updatedAt
  }
}
    `) as unknown as TypedDocumentString<OrganizationAccessRequestsQuery, OrganizationAccessRequestsQueryVariables>;
export const OrganizationJoinTargetDocument = new TypedDocumentString(`
    query OrganizationJoinTarget($organizationId: ULID!) {
  organizationJoinTarget(organizationId: $organizationId) {
    organizationId
    organizationName
    viewerIsAuthenticated
    viewerIsMember
    pendingInvitation {
      createdAt
      email
      expiresAt
      id
      invitedBy
      invitedByName
      organizationId
      organizationName
      status
      updatedAt
      accountId
    }
    pendingRequest {
      createdAt
      id
      organizationId
      organizationName
      referrerAccountId
      referrerName
      requestedByAccountId
      requesterEmail
      requesterName
      reviewedAt
      reviewedBy
      reviewedByName
      status
      updatedAt
    }
    organization {
      avatarUrl
      createdAt
      id
      joinPolicy
      name
      primaryDomain
      slug
      viewerRole
    }
  }
}
    `) as unknown as TypedDocumentString<OrganizationJoinTargetQuery, OrganizationJoinTargetQueryVariables>;
export const RequestOrganizationAccessDocument = new TypedDocumentString(`
    mutation RequestOrganizationAccess($input: RequestOrganizationAccessInput!) {
  requestOrganizationAccess(input: $input) {
    createdAt
    id
    organizationId
    organizationName
    referrerAccountId
    referrerName
    requestedByAccountId
    requesterEmail
    requesterName
    reviewedAt
    reviewedBy
    reviewedByName
    status
    updatedAt
  }
}
    `) as unknown as TypedDocumentString<RequestOrganizationAccessMutation, RequestOrganizationAccessMutationVariables>;
export const RequestOrganizationInvitationDocument = new TypedDocumentString(`
    mutation RequestOrganizationInvitation($input: RequestOrganizationInvitationInput!) {
  requestOrganizationInvitation(input: $input) {
    createdAt
    id
    organizationId
    organizationName
    referrerAccountId
    referrerName
    requestedByAccountId
    requesterEmail
    requesterName
    reviewedAt
    reviewedBy
    reviewedByName
    status
    updatedAt
  }
}
    `) as unknown as TypedDocumentString<RequestOrganizationInvitationMutation, RequestOrganizationInvitationMutationVariables>;
export const ReviewOrganizationAccessRequestDocument = new TypedDocumentString(`
    mutation ReviewOrganizationAccessRequest($input: ReviewOrganizationAccessRequestInput!) {
  reviewOrganizationAccessRequest(input: $input) {
    createdAt
    id
    organizationId
    organizationName
    referrerAccountId
    referrerName
    requestedByAccountId
    requesterEmail
    requesterName
    reviewedAt
    reviewedBy
    reviewedByName
    status
    updatedAt
  }
}
    `) as unknown as TypedDocumentString<ReviewOrganizationAccessRequestMutation, ReviewOrganizationAccessRequestMutationVariables>;
export const UpdateOrganizationJoinPolicyDocument = new TypedDocumentString(`
    mutation UpdateOrganizationJoinPolicy($input: UpdateOrganizationJoinPolicyInput!) {
  updateOrganizationJoinPolicy(input: $input) {
    joinPolicy
  }
}
    `) as unknown as TypedDocumentString<UpdateOrganizationJoinPolicyMutation, UpdateOrganizationJoinPolicyMutationVariables>;
export const CreateOrganizationDocument = new TypedDocumentString(`
    mutation CreateOrganization($input: CreateOrganizationInput!) {
  createOrganization(input: $input) {
    avatarUrl
    createdAt
    id
    joinPolicy
    name
    primaryDomain
    slug
    viewerRole
  }
}
    `) as unknown as TypedDocumentString<CreateOrganizationMutation, CreateOrganizationMutationVariables>;
export const SetActiveOrganizationDocument = new TypedDocumentString(`
    mutation SetActiveOrganization($input: SetActiveOrganizationInput!) {
  setActiveOrganization(input: $input) {
    avatarUrl
    createdAt
    id
    joinPolicy
    name
    primaryDomain
    slug
    viewerRole
  }
}
    `) as unknown as TypedDocumentString<SetActiveOrganizationMutation, SetActiveOrganizationMutationVariables>;
export const UpdateOrganizationPrimaryDomainDocument = new TypedDocumentString(`
    mutation UpdateOrganizationPrimaryDomain($input: UpdateOrganizationPrimaryDomainInput!) {
  updateOrganizationPrimaryDomain(input: $input) {
    avatarUrl
    createdAt
    id
    joinPolicy
    name
    primaryDomain
    slug
    viewerRole
  }
}
    `) as unknown as TypedDocumentString<UpdateOrganizationPrimaryDomainMutation, UpdateOrganizationPrimaryDomainMutationVariables>;
export const UpdateOrganizationProfileDocument = new TypedDocumentString(`
    mutation UpdateOrganizationProfile($input: UpdateOrganizationProfileInput!) {
  updateOrganizationProfile(input: $input) {
    avatarUrl
    createdAt
    id
    joinPolicy
    name
    primaryDomain
    slug
    viewerRole
  }
}
    `) as unknown as TypedDocumentString<UpdateOrganizationProfileMutation, UpdateOrganizationProfileMutationVariables>;
export const OrganizationInvitationsDocument = new TypedDocumentString(`
    query OrganizationInvitations($organizationId: ULID!) {
  organizationInvitationList(organizationId: $organizationId) {
    createdAt
    email
    expiresAt
    id
    invitedBy
    invitedByName
    organizationId
    organizationName
    status
    updatedAt
    accountId
  }
}
    `) as unknown as TypedDocumentString<OrganizationInvitationsQuery, OrganizationInvitationsQueryVariables>;
export const PendingOrganizationInvitationsDocument = new TypedDocumentString(`
    query PendingOrganizationInvitations {
  pendingOrganizationInvitationList {
    createdAt
    email
    expiresAt
    id
    invitedBy
    invitedByName
    organizationId
    organizationName
    status
    updatedAt
    accountId
  }
}
    `) as unknown as TypedDocumentString<PendingOrganizationInvitationsQuery, PendingOrganizationInvitationsQueryVariables>;
export const InviteOrganizationMemberDocument = new TypedDocumentString(`
    mutation InviteOrganizationMember($input: InviteOrganizationMemberInput!) {
  inviteOrganizationMember(input: $input) {
    createdAt
    email
    expiresAt
    id
    invitedBy
    invitedByName
    organizationId
    organizationName
    status
    updatedAt
    accountId
  }
}
    `) as unknown as TypedDocumentString<InviteOrganizationMemberMutation, InviteOrganizationMemberMutationVariables>;
export const AcceptOrganizationInvitationDocument = new TypedDocumentString(`
    mutation AcceptOrganizationInvitation($input: AcceptOrganizationInvitationInput!) {
  acceptOrganizationInvitation(input: $input) {
    avatarUrl
    createdAt
    id
    joinPolicy
    name
    primaryDomain
    slug
    viewerRole
  }
}
    `) as unknown as TypedDocumentString<AcceptOrganizationInvitationMutation, AcceptOrganizationInvitationMutationVariables>;
export const CancelOrganizationInvitationDocument = new TypedDocumentString(`
    mutation CancelOrganizationInvitation($input: CancelOrganizationInvitationInput!) {
  cancelOrganizationInvitation(input: $input) {
    createdAt
    email
    expiresAt
    id
    invitedBy
    invitedByName
    organizationId
    organizationName
    status
    updatedAt
    accountId
  }
}
    `) as unknown as TypedDocumentString<CancelOrganizationInvitationMutation, CancelOrganizationInvitationMutationVariables>;
export const OrganizationMembersDocument = new TypedDocumentString(`
    query OrganizationMembers($organizationId: ULID!) {
  organizationMemberList(organizationId: $organizationId) {
    accountId
    email
    imageUrl
    joinedAt
    name
    role
    status
    disabledAt
    disabledByAccountId
  }
}
    `) as unknown as TypedDocumentString<OrganizationMembersQuery, OrganizationMembersQueryVariables>;
export const UpdateOrganizationMemberRoleDocument = new TypedDocumentString(`
    mutation UpdateOrganizationMemberRole($input: UpdateOrganizationMemberRoleInput!) {
  updateOrganizationMemberRole(input: $input) {
    accountId
  }
}
    `) as unknown as TypedDocumentString<UpdateOrganizationMemberRoleMutation, UpdateOrganizationMemberRoleMutationVariables>;
export const RemoveOrganizationMemberDocument = new TypedDocumentString(`
    mutation RemoveOrganizationMember($input: RemoveOrganizationMemberInput!) {
  removeOrganizationMember(input: $input) {
    ok
  }
}
    `) as unknown as TypedDocumentString<RemoveOrganizationMemberMutation, RemoveOrganizationMemberMutationVariables>;
export const ThreadAgentSessionRetrieveDocument = new TypedDocumentString(`
    query ThreadAgentSessionRetrieve($sessionId: ULID!) {
  threadAgentSessionRetrieve(sessionId: $sessionId) {
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
      runtimeId
      status
      title
      updatedAt
    }
  }
}
    `) as unknown as TypedDocumentString<ThreadAgentSessionRetrieveQuery, ThreadAgentSessionRetrieveQueryVariables>;
export const AgentSessionDiagnosticsDocument = new TypedDocumentString(`
    query AgentSessionDiagnostics($sessionId: ULID!) {
  agentSessionDiagnostics(sessionId: $sessionId) {
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
    query AgentSessionList($agentId: ULID!, $archived: Boolean, $participantOnly: Boolean, $type: SessionType) {
  agentSessionList(
    agentId: $agentId
    archived: $archived
    participantOnly: $participantOnly
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
    query AgentSessionProcessEvents($limit: Int!, $sessionId: ULID!) {
  sessionProcessEvents(limit: $limit, sessionId: $sessionId) {
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
    query ThreadSessionMessages($sessionId: ULID!) {
  threadSessionMessages(sessionId: $sessionId) {
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
    mutation SendAgentSessionEvents($sessionId: ULID!, $events: [AgentSessionEventInput!]!) {
  sendAgentSessionEvents(sessionId: $sessionId, events: $events) {
    acceptedAt
    warnings {
      code
      message
    }
  }
}
    `) as unknown as TypedDocumentString<SendAgentSessionEventsMutation, SendAgentSessionEventsMutationVariables>;
export const PrewarmAgentSessionDocument = new TypedDocumentString(`
    mutation PrewarmAgentSession($sessionId: ULID!) {
  prewarmAgentSession(sessionId: $sessionId) {
    scheduledAt
    sessionId
  }
}
    `) as unknown as TypedDocumentString<PrewarmAgentSessionMutation, PrewarmAgentSessionMutationVariables>;
export const SessionsDocument = new TypedDocumentString(`
    query Sessions($organizationId: ULID!, $archived: Boolean, $type: SessionType) {
  sessionList(organizationId: $organizationId, archived: $archived, type: $type) {
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
    query ThreadAgentSessionList($organizationId: ULID!, $archived: Boolean, $type: SessionType) {
  threadAgentSessionList(
    organizationId: $organizationId
    archived: $archived
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
    mutation ArchiveSession($sessionId: ULID!) {
  archiveAgentSession(sessionId: $sessionId) {
    ok
  }
}
    `) as unknown as TypedDocumentString<ArchiveSessionMutation, ArchiveSessionMutationVariables>;
export const RestoreSessionDocument = new TypedDocumentString(`
    mutation RestoreSession($sessionId: ULID!) {
  unarchiveAgentSession(sessionId: $sessionId) {
    ok
  }
}
    `) as unknown as TypedDocumentString<RestoreSessionMutation, RestoreSessionMutationVariables>;
export const DeleteAgentSessionDocument = new TypedDocumentString(`
    mutation DeleteAgentSession($sessionId: ULID!) {
  deleteAgentSession(sessionId: $sessionId) {
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
    query ListSessionResources($sessionId: ULID!) {
  listSessionResources(sessionId: $sessionId) {
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
export const SessionThreadUiStateListDocument = new TypedDocumentString(`
    query SessionThreadUiStateList($organizationId: ULID!) {
  sessionThreadUiStateList(organizationId: $organizationId) {
    pinned
    readAt
    sessionId
    updatedAt
  }
}
    `) as unknown as TypedDocumentString<SessionThreadUiStateListQuery, SessionThreadUiStateListQueryVariables>;
export const UpdateSessionThreadUiStateDocument = new TypedDocumentString(`
    mutation UpdateSessionThreadUiState($input: UpdateSessionThreadUiStateInput!) {
  updateSessionThreadUiState(input: $input) {
    pinned
    readAt
    sessionId
    updatedAt
  }
}
    `) as unknown as TypedDocumentString<UpdateSessionThreadUiStateMutation, UpdateSessionThreadUiStateMutationVariables>;
export const SessionProcessEventsDocument = new TypedDocumentString(`
    query SessionProcessEvents($limit: Int!, $sessionId: ULID!) {
  threadSessionProcessEvents(limit: $limit, sessionId: $sessionId) {
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
    query SkillDetail($skillId: ULID!) {
  skillDetail(skillId: $skillId) {
    ...SkillDetailFields
  }
}
    fragment SkillShareTargetFields on SkillShareTarget {
  createdAt
  email
  id
  kind
  name
}
fragment SkillDetailFields on SkillDetail {
  author
  autoEnabled
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
  role
  snapshotId
  sourceKind
  updatedAt
  organizationId
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
  shareTargets {
    ...SkillShareTargetFields
  }
}`) as unknown as TypedDocumentString<SkillDetailQuery, SkillDetailQueryVariables>;
export const OrganizationSkillsDocument = new TypedDocumentString(`
    query OrganizationSkills($organizationId: ULID!) {
  organizationSkillList(organizationId: $organizationId) {
    ...SkillSummaryFields
  }
}
    fragment SkillSummaryFields on SkillSummary {
  author
  autoEnabled
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
  role
  snapshotId
  sourceKind
  updatedAt
  organizationId
}`) as unknown as TypedDocumentString<OrganizationSkillsQuery, OrganizationSkillsQueryVariables>;
export const CreateSkillForkDocument = new TypedDocumentString(`
    mutation CreateSkillFork($input: CreateSkillForkInput!) {
  createSkillFork(input: $input) {
    ...SkillSummaryFields
  }
}
    fragment SkillSummaryFields on SkillSummary {
  author
  autoEnabled
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
  role
  snapshotId
  sourceKind
  updatedAt
  organizationId
}`) as unknown as TypedDocumentString<CreateSkillForkMutation, CreateSkillForkMutationVariables>;
export const DeleteOwnedSkillDocument = new TypedDocumentString(`
    mutation DeleteOwnedSkill($skillId: ULID!) {
  deleteOwnedSkill(skillId: $skillId) {
    ok
  }
}
    `) as unknown as TypedDocumentString<DeleteOwnedSkillMutation, DeleteOwnedSkillMutationVariables>;
export const ShareSkillWithUserDocument = new TypedDocumentString(`
    mutation ShareSkillWithUser($input: ShareSkillWithUserInput!) {
  shareSkillWithUser(input: $input) {
    ...SkillShareTargetFields
  }
}
    fragment SkillShareTargetFields on SkillShareTarget {
  createdAt
  email
  id
  kind
  name
}`) as unknown as TypedDocumentString<ShareSkillWithUserMutation, ShareSkillWithUserMutationVariables>;
export const ShareSkillWithOrganizationDocument = new TypedDocumentString(`
    mutation ShareSkillWithOrganization($input: ShareSkillWithOrganizationInput!) {
  shareSkillWithOrganization(input: $input) {
    ...SkillShareTargetFields
  }
}
    fragment SkillShareTargetFields on SkillShareTarget {
  createdAt
  email
  id
  kind
  name
}`) as unknown as TypedDocumentString<ShareSkillWithOrganizationMutation, ShareSkillWithOrganizationMutationVariables>;
export const UnshareSkillTargetDocument = new TypedDocumentString(`
    mutation UnshareSkillTarget($input: UnshareSkillTargetInput!) {
  unshareSkillTarget(input: $input) {
    ok
  }
}
    `) as unknown as TypedDocumentString<UnshareSkillTargetMutation, UnshareSkillTargetMutationVariables>;
export const SpaceCollaboratorsDocument = new TypedDocumentString(`
    query SpaceCollaborators($spaceId: ULID!) {
  spaceCollaboratorList(spaceId: $spaceId) {
    assignedBy
    createdAt
    email
    imageUrl
    name
    principal
    role
  }
}
    `) as unknown as TypedDocumentString<SpaceCollaboratorsQuery, SpaceCollaboratorsQueryVariables>;
export const AddCollaboratorDocument = new TypedDocumentString(`
    mutation AddCollaborator($input: AddCollaboratorInput!) {
  addCollaborator(input: $input) {
    principal
  }
}
    `) as unknown as TypedDocumentString<AddCollaboratorMutation, AddCollaboratorMutationVariables>;
export const AddOrganizationCollaboratorDocument = new TypedDocumentString(`
    mutation AddOrganizationCollaborator($input: AddOrganizationCollaboratorInput!) {
  addOrganizationCollaborator(input: $input) {
    principal
  }
}
    `) as unknown as TypedDocumentString<AddOrganizationCollaboratorMutation, AddOrganizationCollaboratorMutationVariables>;
export const UpdateCollaboratorDocument = new TypedDocumentString(`
    mutation UpdateCollaborator($input: UpdateCollaboratorInput!) {
  updateCollaborator(input: $input) {
    principal
  }
}
    `) as unknown as TypedDocumentString<UpdateCollaboratorMutation, UpdateCollaboratorMutationVariables>;
export const RemoveCollaboratorDocument = new TypedDocumentString(`
    mutation RemoveCollaborator($input: RemoveCollaboratorInput!) {
  removeCollaborator(input: $input) {
    ok
  }
}
    `) as unknown as TypedDocumentString<RemoveCollaboratorMutation, RemoveCollaboratorMutationVariables>;
export const CreateSpaceDocument = new TypedDocumentString(`
    mutation CreateSpace($input: CreateSpaceInput!) {
  createSpace(input: $input) {
    createdAt
    id
    isSharedWithViewer
    name
    ownerId
    role
    storagePrefix
    canDelete
    canUpdateAcl
    creatorMembershipStatus
    viewerAssetRole
    visibility
  }
}
    `) as unknown as TypedDocumentString<CreateSpaceMutation, CreateSpaceMutationVariables>;
export const DeleteSpaceDocument = new TypedDocumentString(`
    mutation DeleteSpace($spaceId: ULID!) {
  deleteSpace(spaceId: $spaceId) {
    ok
  }
}
    `) as unknown as TypedDocumentString<DeleteSpaceMutation, DeleteSpaceMutationVariables>;
export const SpaceFilesDocument = new TypedDocumentString(`
    query SpaceFiles($spaceId: ULID!, $path: String) {
  spaceFiles(spaceId: $spaceId, path: $path) {
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
    query Spaces($organizationId: ULID!) {
  spaceList(organizationId: $organizationId) {
    createdAt
    id
    isSharedWithViewer
    name
    ownerId
    role
    storagePrefix
    canDelete
    canUpdateAcl
    creatorMembershipStatus
    viewerAssetRole
    visibility
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
      joinPolicy
      name
      primaryDomain
      slug
      viewerRole
    }
    auth {
      currentSecurityLevel
      methods
    }
    memberships {
      joinedAt
      role
      organization {
        avatarUrl
        createdAt
        id
        joinPolicy
        name
        primaryDomain
        slug
        viewerRole
      }
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
    query VendorCredentialList($organizationId: ULID!) {
  vendorCredentialList(organizationId: $organizationId) {
    apiBase
    id
    isDefault
    isPreferred
    maskedApiKey
    models
    name
    ownerUserId
    scope
    vendorId
    organizationId
  }
}
    `) as unknown as TypedDocumentString<VendorCredentialListQuery, VendorCredentialListQueryVariables>;
export const CreateVendorCredentialDocument = new TypedDocumentString(`
    mutation CreateVendorCredential($input: CreateVendorCredentialInput!) {
  createVendorCredential(input: $input) {
    apiBase
    id
    isDefault
    isPreferred
    maskedApiKey
    models
    name
    ownerUserId
    scope
    vendorId
    organizationId
  }
}
    `) as unknown as TypedDocumentString<CreateVendorCredentialMutation, CreateVendorCredentialMutationVariables>;
export const UpdateVendorCredentialDocument = new TypedDocumentString(`
    mutation UpdateVendorCredential($input: UpdateVendorCredentialInput!) {
  updateVendorCredential(input: $input) {
    apiBase
    id
    isDefault
    isPreferred
    maskedApiKey
    models
    name
    ownerUserId
    scope
    vendorId
    organizationId
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
    query AvailableAgentModels($runtimeId: String!, $currentModelId: String, $currentVendorId: String) {
  availableAgentModels(
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
