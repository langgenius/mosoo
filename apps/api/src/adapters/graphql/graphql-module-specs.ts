import type { GraphQLModule } from "./graphql-module.ts";
import { agentBuilderSchema } from "./schema/agent-builder-schema.ts";
import { agentSchema } from "./schema/agent-schema.ts";
import { channelSchema } from "./schema/channel-schema.ts";
import { commonSchema } from "./schema/common-schema.ts";
import { costSchema } from "./schema/cost-schema.ts";
import { environmentSchema } from "./schema/environment-schema.ts";
import { mcpSchema } from "./schema/mcp-schema.ts";
import { organizationSchema } from "./schema/organization-schema.ts";
import { sessionSchema } from "./schema/session-schema.ts";
import { skillSchema } from "./schema/skill-schema.ts";
import { spaceSchema } from "./schema/space-schema.ts";
import { userSchema } from "./schema/user-schema.ts";
import { vendorCredentialSchema } from "./schema/vendor-credential-schema.ts";

type GraphQLModuleSpec = Pick<GraphQLModule, "mutationFields" | "queryFields" | "typeDefs">;

export const commonGraphQLSpec = {
  queryFields: ["appInfo: AppInfo!"],
  typeDefs: commonSchema,
} satisfies GraphQLModuleSpec;

export const channelGraphQLSpec = {
  mutationFields: [
    "createDiscordAgentChannelBinding(input: CreateDiscordAgentChannelBindingInput!): AgentChannelBinding!",
    "createLarkAgentChannelBinding(input: CreateLarkAgentChannelBindingInput!): AgentChannelBinding!",
    "createSlackAgentChannelBinding(input: CreateSlackAgentChannelBindingInput!): AgentChannelBinding!",
    "createTelegramAgentChannelBinding(input: CreateTelegramAgentChannelBindingInput!): AgentChannelBinding!",
    "pollLarkAgentChannelRegistration(input: PollLarkAgentChannelRegistrationInput!): LarkAgentChannelRegistration!",
    "pollWeChatAgentChannelPairing(input: PollWeChatAgentChannelPairingInput!): WeChatAgentChannelPairing!",
    "startLarkAgentChannelRegistration(input: StartLarkAgentChannelRegistrationInput!): LarkAgentChannelRegistration!",
    "startWeChatAgentChannelPairing(input: StartWeChatAgentChannelPairingInput!): WeChatAgentChannelPairing!",
    "deleteAgentChannelBinding(input: DeleteAgentChannelBindingInput!): OperationResult!",
  ],
  queryFields: ["agentChannelBindingList(agentId: ULID!): [AgentChannelBinding!]!"],
  typeDefs: channelSchema,
} satisfies GraphQLModuleSpec;

export const costGraphQLSpec = {
  queryFields: [
    "agentCostCard(agentId: ULID!, range: CostRange!, runPurposes: [CostRunPurpose!]): AgentCostCard!",
    "memberCostCard(organizationId: ULID!, memberId: ULID!, range: CostRange!): MemberCostCard!",
    "organizationCostCard(organizationId: ULID!, range: CostRange!, runPurposes: [CostRunPurpose!]): OrganizationCostCard!",
    "ownerCostCard(organizationId: ULID!, ownerUserId: ULID!, range: CostRange!): CostAttributionCard!",
  ],
  typeDefs: costSchema,
} satisfies GraphQLModuleSpec;

export const agentGraphQLSpec = {
  mutationFields: [
    "addAgentCollaborator(input: AddAgentCollaboratorInput!): OperationResult!",
    "createAgentFork(input: CreateAgentForkInput!): AgentPackageImportResult!",
    "createAgent(input: CreateAgentInput!): Agent!",
    "deleteAgent(input: DeleteAgentInput!): OperationResult!",
    "importAgentPackage(input: ImportAgentPackageInput!): AgentPackageImportResult!",
    "publishAgent(input: PublishAgentInput!): Agent!",
    "recreateSandbox(input: RuntimeStateOperationInput!): RuntimeStateOperationResult!",
    "removeAgentCollaborator(input: RemoveAgentCollaboratorInput!): OperationResult!",
    "resetAgentState(input: RuntimeStateOperationInput!): RuntimeStateOperationResult!",
    "restartDriver(input: RuntimeStateOperationInput!): RuntimeStateOperationResult!",
    "unpublishAgent(agentId: ULID!): Agent!",
    "updateAgentCollaborator(input: UpdateAgentCollaboratorInput!): OperationResult!",
    "updateAgentConfig(input: UpdateAgentConfigInput!): Agent!",
    "updateAgentPackageSharing(input: UpdateAgentPackageSharingInput!): Agent!",
  ],
  queryFields: [
    "accessibleAgentList(organizationId: ULID!): [AgentSummary!]!",
    "agent(agentId: ULID!): AgentDetail!",
    "agentCollaboratorList(agentId: ULID!): [AgentCollaborator!]!",
    "agentEditorState(agentId: ULID!): AgentEditorState!",
    "agentManifest(agentId: ULID!): AgentManifestExport!",
    "exportAgentPackage(agentId: ULID!): AgentPackageExport!",
  ],
  typeDefs: agentSchema,
} satisfies GraphQLModuleSpec;

export const agentBuilderGraphQLSpec = {
  mutationFields: [
    "ensureAgentBuilderThread(agentId: ULID!): AgentBuilderThread!",
    "executeAgentBuilderControlPlaneAction(input: ExecuteAgentBuilderControlPlaneActionInput!): AgentBuilderControlPlaneActionResult!",
  ],
  queryFields: [
    "agentBuilderMessages(agentId: ULID!, beforeSeq: Int, limit: Int): [AgentBuilderMessage!]!",
  ],
  typeDefs: agentBuilderSchema,
} satisfies GraphQLModuleSpec;

export const environmentGraphQLSpec = {
  mutationFields: [
    "createEnvironment(input: CreateEnvironmentInput!): EnvironmentSummary!",
    "createEnvironmentFork(input: CreateEnvironmentForkInput!): EnvironmentSummary!",
    "deleteEnvironment(input: DeleteEnvironmentInput!): OperationResult!",
    "setEnvironmentVariableValue(input: SetEnvironmentVariableValueInput!): EnvironmentDetail!",
    "setOrganizationDefaultEnvironment(input: SetOrganizationDefaultEnvironmentInput!): EnvironmentSummary!",
    "shareEnvironmentWithOrganization(input: ShareEnvironmentWithOrganizationInput!): EnvironmentShareTarget!",
    "shareEnvironmentWithUser(input: ShareEnvironmentWithUserInput!): EnvironmentShareTarget!",
    "unshareEnvironmentTarget(input: UnshareEnvironmentTargetInput!): OperationResult!",
    "updateEnvironment(input: UpdateEnvironmentInput!): EnvironmentDetail!",
  ],
  queryFields: [
    "environment(environmentId: ULID!): EnvironmentDetail!",
    "organizationEnvironmentList(organizationId: ULID!): [EnvironmentSummary!]!",
  ],
  typeDefs: environmentSchema,
} satisfies GraphQLModuleSpec;

export const mcpGraphQLSpec = {
  mutationFields: [
    "clearOrganizationSharedCredential(serverId: ULID!): McpServerWithCredential!",
    "connectMcpBearer(input: ConnectMcpBearerInput!): McpServerWithCredential!",
    "createPersonalMcpServer(input: CreatePersonalMcpServerInput!): McpServerWithCredential!",
    "createOrganizationMcpServer(input: CreateOrganizationMcpServerInput!): McpServerWithCredential!",
    "deleteMcpServer(serverId: ULID!): OperationResult!",
    "revokeMcpUserCredential(serverId: ULID!): McpServerWithCredential!",
    "setMcpServerEnabled(serverId: ULID!, enabled: Boolean!): McpServerWithCredential!",
    "setOrganizationSharedBearer(input: SetOrganizationSharedMcpBearerInput!): McpServerWithCredential!",
    "startMcpOAuth(input: StartMcpOAuthInput!): StartMcpOAuthPayload!",
  ],
  queryFields: [
    "mcpOAuthFlowStatus(flowId: ULID!): McpOAuthFlowState!",
    "mcpRegistry(organizationId: ULID!): McpRegistry!",
  ],
  typeDefs: mcpSchema,
} satisfies GraphQLModuleSpec;

export const onboardingGraphQLSpec = {
  mutationFields: ["onboardingBootstrap(input: BootstrapOnboardingInput!): OnboardingStatus!"],
  queryFields: ["onboardingDiscovery: OnboardingDiscovery!"],
} satisfies GraphQLModuleSpec;

export const sessionGraphQLSpec = {
  mutationFields: [
    "addSessionResource(input: AddSessionResourceInput!): SessionResourceUpload!",
    "createAgentSession(input: CreateAgentSessionInput!): Session!",
    "prewarmAgentSession(sessionId: ULID!): SessionRuntimePrewarmAck!",
    "sendAgentSessionEvents(sessionId: ULID!, events: [AgentSessionEventInput!]!): AgentSessionEventBatch!",
    "archiveAgentSession(sessionId: ULID!): OperationResult!",
    "autoTitleSession(input: RenameSessionInput!): Session!",
    "deleteAgentSession(sessionId: ULID!): OperationResult!",
    "renameSession(input: RenameSessionInput!): Session!",
    "removeSessionResource(input: RemoveSessionResourceInput!): OperationResult!",
    "unarchiveAgentSession(sessionId: ULID!): OperationResult!",
    "updateSessionThreadUiState(input: UpdateSessionThreadUiStateInput!): SessionThreadUiState!",
  ],
  queryFields: [
    "agentSessionDiagnostics(sessionId: ULID!): AgentSessionDiagnostics!",
    "agentSessionRetrieve(sessionId: ULID!): AgentSessionRetrieve!",
    "session(sessionId: ULID!): Session!",
    "sessionMessages(sessionId: ULID!): [SessionMessage!]!",
    "sessionProcessEvents(limit: Int, sessionId: ULID!): [SessionProcessEvent!]!",
    "sessionThreadUiStateList(organizationId: ULID!): [SessionThreadUiState!]!",
    "threadAgentSessionList(archived: Boolean, beforeCursor: String, limit: Int, organizationId: ULID!, type: SessionType): AgentSessionRetrieveConnection!",
    "threadAgentSessionRetrieve(sessionId: ULID!): AgentSessionRetrieve!",
    "threadSessionMessages(sessionId: ULID!): [SessionMessage!]!",
    "threadSessionProcessEvents(limit: Int, sessionId: ULID!): [SessionProcessEvent!]!",
    "listSessionResources(sessionId: ULID!): [SessionResource!]!",
    "sessionList(archived: Boolean, beforeCursor: String, limit: Int, organizationId: ULID!, type: SessionType): SessionConnection!",
    "agentSessionList(agentId: ULID!, archived: Boolean, beforeCursor: String, limit: Int, participantOnly: Boolean, type: SessionType): SessionConnection!",
  ],
  typeDefs: sessionSchema,
} satisfies GraphQLModuleSpec;

export const skillGraphQLSpec = {
  mutationFields: [
    "createSkillFork(input: CreateSkillForkInput!): SkillSummary!",
    "deleteOwnedSkill(skillId: ULID!): OperationResult!",
    "setSkillAutoEnabled(input: SetSkillAutoEnabledInput!): SkillAutoPreference!",
    "shareSkillWithUser(input: ShareSkillWithUserInput!): SkillShareTarget!",
    "shareSkillWithOrganization(input: ShareSkillWithOrganizationInput!): SkillShareTarget!",
    "unshareSkillTarget(input: UnshareSkillTargetInput!): OperationResult!",
  ],
  queryFields: [
    "skillDetail(skillId: ULID!): SkillDetail!",
    "skillShareTargetList(skillId: ULID!): [SkillShareTarget!]!",
    "organizationSkillList(organizationId: ULID!): [SkillSummary!]!",
  ],
  typeDefs: skillSchema,
} satisfies GraphQLModuleSpec;

export const spaceGraphQLSpec = {
  mutationFields: [
    "addCollaborator(input: AddCollaboratorInput!): Collaborator!",
    "addOrganizationCollaborator(input: AddOrganizationCollaboratorInput!): Collaborator!",
    "createSpace(input: CreateSpaceInput!): SpaceView!",
    "createSpaceDirectory(input: CreateSpaceDirectoryInput!): DirectoryEntry!",
    "deleteSpace(spaceId: ULID!): OperationResult!",
    "deleteSpaceEntry(input: DeleteSpaceEntryInput!): OperationResult!",
    "removeCollaborator(input: RemoveCollaboratorInput!): OperationResult!",
    "updateCollaborator(input: UpdateCollaboratorInput!): Collaborator!",
    "updateSpace(input: UpdateSpaceInput!): Space!",
  ],
  queryFields: [
    "space(spaceId: ULID!): Space!",
    "spaceCollaboratorList(spaceId: ULID!): [Collaborator!]!",
    "spaceFiles(path: String, spaceId: ULID!): SpaceFileListing!",
    "spaceList(organizationId: ULID!): [SpaceView!]!",
  ],
  typeDefs: spaceSchema,
} satisfies GraphQLModuleSpec;

export const userGraphQLSpec = {
  mutationFields: [
    "setSystemAgentModel(input: SetSystemAgentModelInput!): Account!",
    "updateProfile(input: UpdateAccountProfileInput!): Account!",
  ],
  queryFields: ["viewer: Viewer!"],
  typeDefs: userSchema,
} satisfies GraphQLModuleSpec;

export const vendorCredentialGraphQLSpec = {
  mutationFields: [
    "createVendorCredential(input: CreateVendorCredentialInput!): VendorCredential!",
    "deleteVendorCredential(input: DeleteVendorCredentialInput!): OperationResult!",
    "testVendorCredential(input: TestVendorCredentialInput!): TestVendorCredentialResult!",
    "updateVendorCredential(input: UpdateVendorCredentialInput!): VendorCredential!",
  ],
  queryFields: [
    "availableAgentModels(runtimeId: String!, currentModelId: String, currentVendorId: String): [ResolvedModelEntry!]!",
    "vendorCredentialList(organizationId: ULID!): [VendorCredential!]!",
  ],
  typeDefs: vendorCredentialSchema,
} satisfies GraphQLModuleSpec;

export const organizationGraphQLSpec = {
  mutationFields: [
    "acceptOrganizationInvitation(input: AcceptOrganizationInvitationInput!): Organization!",
    "cancelOrganizationInvitation(input: CancelOrganizationInvitationInput!): OrganizationInvitation!",
    "createOrganization(input: CreateOrganizationInput!): Organization!",
    "inviteOrganizationMember(input: InviteOrganizationMemberInput!): OrganizationInvitation!",
    "removeOrganizationMember(input: RemoveOrganizationMemberInput!): OperationResult!",
    "requestOrganizationAccess(input: RequestOrganizationAccessInput!): OrganizationAccessRequest!",
    "requestOrganizationInvitation(input: RequestOrganizationInvitationInput!): OrganizationAccessRequest!",
    "reviewOrganizationAccessRequest(input: ReviewOrganizationAccessRequestInput!): OrganizationAccessRequest!",
    "setActiveOrganization(input: SetActiveOrganizationInput!): Organization!",
    "setOrganizationMemberStatus(input: SetOrganizationMemberStatusInput!): OrganizationMember!",
    "updateOrganizationJoinPolicy(input: UpdateOrganizationJoinPolicyInput!): Organization!",
    "updateOrganizationMemberRole(input: UpdateOrganizationMemberRoleInput!): OrganizationMember!",
    "updateOrganizationPrimaryDomain(input: UpdateOrganizationPrimaryDomainInput!): Organization!",
    "updateOrganizationProfile(input: UpdateOrganizationProfileInput!): Organization!",
  ],
  queryFields: [
    "pendingOrganizationInvitationList: [OrganizationInvitation!]!",
    "organizationAccessRequestList(organizationId: ULID!): [OrganizationAccessRequest!]!",
    "organizationInvitationList(organizationId: ULID!): [OrganizationInvitation!]!",
    "organizationJoinTarget(organizationId: ULID!): OrganizationJoinTarget!",
    "organizationMemberList(organizationId: ULID!): [OrganizationMember!]!",
  ],
  typeDefs: organizationSchema,
} satisfies GraphQLModuleSpec;

export const graphqlModuleSpecs = [
  commonGraphQLSpec,
  agentGraphQLSpec,
  agentBuilderGraphQLSpec,
  channelGraphQLSpec,
  costGraphQLSpec,
  environmentGraphQLSpec,
  mcpGraphQLSpec,
  onboardingGraphQLSpec,
  sessionGraphQLSpec,
  skillGraphQLSpec,
  spaceGraphQLSpec,
  userGraphQLSpec,
  vendorCredentialGraphQLSpec,
  organizationGraphQLSpec,
] satisfies GraphQLModuleSpec[];
