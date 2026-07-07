import type { GraphQLModule } from "./graphql-module.ts";
import { agentSchema } from "./schema/agent-schema.ts";
import { appSchema } from "./schema/app-schema.ts";
import { channelSchema } from "./schema/channel-schema.ts";
import { commonSchema } from "./schema/common-schema.ts";
import { costSchema } from "./schema/cost-schema.ts";
import { environmentSchema } from "./schema/environment-schema.ts";
import { fileSchema } from "./schema/file-schema.ts";
import { mcpSchema } from "./schema/mcp-schema.ts";
import { organizationSchema } from "./schema/organization-schema.ts";
import { sessionSchema } from "./schema/session-schema.ts";
import { skillSchema } from "./schema/skill-schema.ts";
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
  queryFields: ["agentChannelBindingList(appId: ULID!, agentId: ULID!): [AgentChannelBinding!]!"],
  typeDefs: channelSchema,
} satisfies GraphQLModuleSpec;

export const costGraphQLSpec = {
  queryFields: [
    "agentCostCard(appId: ULID!, agentId: ULID!, range: CostRange!, runPurposes: [CostRunPurpose!]): AgentCostCard!",
    "organizationBillingCostCard(organizationId: ULID!, range: CostRange!, runPurposes: [CostRunPurpose!]): OrganizationBillingCostCard!",
    "appCostCard(appId: ULID!, range: CostRange!, runPurposes: [CostRunPurpose!]): AppCostCard!",
  ],
  typeDefs: costSchema,
} satisfies GraphQLModuleSpec;

export const agentGraphQLSpec = {
  mutationFields: [
    "createAgentFork(input: CreateAgentForkInput!): AgentPackageImportResult!",
    "createAgent(input: CreateAgentInput!): Agent!",
    "deleteAgent(input: DeleteAgentInput!): OperationResult!",
    "exportAgentNativeRepo(agentId: ULID!): AgentPackageExport!",
    "importAgentPackage(input: ImportAgentPackageInput!): AgentPackageImportResult!",
    "publishAgent(input: PublishAgentInput!): Agent!",
    "recreateSandbox(input: RuntimeStateOperationInput!): RuntimeStateOperationResult!",
    "resetAgentState(input: RuntimeStateOperationInput!): RuntimeStateOperationResult!",
    "restartDriver(input: RuntimeStateOperationInput!): RuntimeStateOperationResult!",
    "unpublishAgent(appId: ULID!, agentId: ULID!): Agent!",
    "updateAgentConfig(input: UpdateAgentConfigInput!): Agent!",
  ],
  queryFields: [
    "accessibleAgentList(appId: ULID!): [AgentSummary!]!",
    "agent(appId: ULID!, agentId: ULID!): AgentDetail!",
    "agentEditorState(appId: ULID!, agentId: ULID!): AgentEditorState!",
    "agentManifest(appId: ULID!, agentId: ULID!): AgentManifestExport!",
    "exportAgentPackage(appId: ULID!, agentId: ULID!): AgentPackageExport!",
  ],
  typeDefs: agentSchema,
} satisfies GraphQLModuleSpec;

export const environmentGraphQLSpec = {
  mutationFields: [
    "createEnvironment(input: CreateEnvironmentInput!): EnvironmentSummary!",
    "createEnvironmentFork(input: CreateEnvironmentForkInput!): EnvironmentSummary!",
    "deleteEnvironment(input: DeleteEnvironmentInput!): OperationResult!",
    "setEnvironmentVariableValue(input: SetEnvironmentVariableValueInput!): EnvironmentDetail!",
    "setAppDefaultEnvironment(input: SetAppDefaultEnvironmentInput!): EnvironmentSummary!",
    "updateEnvironment(input: UpdateEnvironmentInput!): EnvironmentDetail!",
  ],
  queryFields: [
    "environment(appId: ULID!, environmentId: ULID!): EnvironmentDetail!",
    "appEnvironmentList(appId: ULID!): [EnvironmentSummary!]!",
  ],
  typeDefs: environmentSchema,
} satisfies GraphQLModuleSpec;

export const fileGraphQLSpec = {
  queryFields: ["fileList(input: FileListInput!): FileListing!"],
  typeDefs: fileSchema,
} satisfies GraphQLModuleSpec;

export const mcpGraphQLSpec = {
  mutationFields: [
    "connectMcpBearer(input: ConnectMcpBearerInput!): McpServerWithCredential!",
    "createAppMcpServer(input: CreateAppMcpServerInput!): McpServerWithCredential!",
    "deleteMcpServer(appId: ULID!, serverId: ULID!): OperationResult!",
    "revokeMcpCredential(appId: ULID!, serverId: ULID!): McpServerWithCredential!",
    "setMcpServerEnabled(appId: ULID!, serverId: ULID!, enabled: Boolean!): McpServerWithCredential!",
    "startMcpOAuth(input: StartMcpOAuthInput!): StartMcpOAuthPayload!",
    "updateAppMcpServer(input: UpdateAppMcpServerInput!): McpServerWithCredential!",
  ],
  queryFields: [
    "mcpOAuthFlowStatus(flowId: ULID!): McpOAuthFlowState!",
    "mcpRegistry(appId: ULID!): McpRegistry!",
  ],
  typeDefs: mcpSchema,
} satisfies GraphQLModuleSpec;

export const onboardingGraphQLSpec = {
  mutationFields: ["onboardingBootstrap(input: BootstrapOnboardingInput!): OnboardingStatus!"],
  queryFields: [],
} satisfies GraphQLModuleSpec;

export const appGraphQLSpec = {
  mutationFields: [
    "createApp(input: CreateAppInput!): App!",
    "deleteAppDeployment(input: DeleteAppDeploymentInput!): OperationResult!",
    "deployApp(input: DeployAppInput!): AppDeploymentRun!",
    "renameApp(input: RenameAppInput!): App!",
  ],
  queryFields: [
    "appDeploymentRunList(appId: ULID!, limit: Int): [AppDeploymentRun!]!",
    "appDeploymentStatus(appId: ULID!): AppDeploymentRun",
    "appList(organizationId: ULID!): [App!]!",
    "appOverview(appId: ULID!, agentLimit: Int, credentialLimit: Int): AppOverview!",
    "controlPlaneOverview(appLimit: Int, agentLimit: Int, credentialLimit: Int): ControlPlaneOverview!",
  ],
  typeDefs: appSchema,
} satisfies GraphQLModuleSpec;

export const sessionGraphQLSpec = {
  mutationFields: [
    "addSessionResource(input: AddSessionResourceInput!): SessionResourceUpload!",
    "createAgentSession(input: CreateAgentSessionInput!): Session!",
    "prewarmAgentSession(appId: ULID!, sessionId: ULID!): SessionRuntimePrewarmAck!",
    "sendAgentSessionEvents(appId: ULID!, sessionId: ULID!, events: [AgentSessionEventInput!]!): AgentSessionEventBatch!",
    "startAgentRun(input: StartAgentRunInput!): AgentRunWorkflow!",
    "archiveAgentSession(appId: ULID!, sessionId: ULID!): OperationResult!",
    "autoTitleSession(input: RenameSessionInput!): Session!",
    "deleteAgentSession(appId: ULID!, sessionId: ULID!): OperationResult!",
    "renameSession(input: RenameSessionInput!): Session!",
    "removeSessionResource(input: RemoveSessionResourceInput!): OperationResult!",
    "unarchiveAgentSession(appId: ULID!, sessionId: ULID!): OperationResult!",
  ],
  queryFields: [
    "agentSessionDiagnostics(appId: ULID!, sessionId: ULID!): AgentSessionDiagnostics!",
    "agentSessionRetrieve(appId: ULID!, sessionId: ULID!): AgentSessionRetrieve!",
    "session(appId: ULID!, sessionId: ULID!): Session!",
    "sessionMessages(appId: ULID!, sessionId: ULID!): [SessionMessage!]!",
    "sessionProcessEvents(appId: ULID!, limit: Int, sessionId: ULID!): [SessionProcessEvent!]!",
    "threadAgentSessionList(archived: Boolean, beforeCursor: String, limit: Int, appId: ULID!, type: SessionType): AgentSessionRetrieveConnection!",
    "threadAgentSessionRetrieve(appId: ULID!, sessionId: ULID!): AgentSessionRetrieve!",
    "threadSessionMessages(appId: ULID!, sessionId: ULID!): [SessionMessage!]!",
    "threadSessionProcessEvents(appId: ULID!, limit: Int, sessionId: ULID!): [SessionProcessEvent!]!",
    "listSessionResources(appId: ULID!, sessionId: ULID!): [SessionResource!]!",
    "sessionList(archived: Boolean, beforeCursor: String, limit: Int, appId: ULID!, type: SessionType): SessionConnection!",
    "agentSessionList(appId: ULID!, agentId: ULID!, archived: Boolean, beforeCursor: String, limit: Int, participantOnly: Boolean, type: SessionType): SessionConnection!",
  ],
  typeDefs: sessionSchema,
} satisfies GraphQLModuleSpec;

export const skillGraphQLSpec = {
  mutationFields: [
    "createSkillFork(input: CreateSkillForkInput!): SkillSummary!",
    "deleteOwnedSkill(appId: ULID!, skillId: ULID!): OperationResult!",
  ],
  queryFields: [
    "appSkillList(appId: ULID!): [SkillSummary!]!",
    "skillDetail(appId: ULID!, skillId: ULID!): SkillDetail!",
  ],
  typeDefs: skillSchema,
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
    "setDefaultVendorCredential(input: SetDefaultVendorCredentialInput!): VendorCredential!",
    "testVendorCredential(input: TestVendorCredentialInput!): TestVendorCredentialResult!",
    "updateVendorCredential(input: UpdateVendorCredentialInput!): VendorCredential!",
  ],
  queryFields: [
    "availableAgentModels(appId: ULID!, runtimeId: String!, currentModelId: String, currentVendorId: String): [ResolvedModelEntry!]!",
    "vendorCredentialList(appId: ULID!): [VendorCredential!]!",
  ],
  typeDefs: vendorCredentialSchema,
} satisfies GraphQLModuleSpec;

export const organizationGraphQLSpec = {
  mutationFields: ["renameOrganization(input: RenameOrganizationInput!): Organization!"],
  queryFields: [],
  typeDefs: organizationSchema,
} satisfies GraphQLModuleSpec;

export const graphqlModuleSpecs = [
  commonGraphQLSpec,
  agentGraphQLSpec,
  channelGraphQLSpec,
  costGraphQLSpec,
  environmentGraphQLSpec,
  fileGraphQLSpec,
  mcpGraphQLSpec,
  onboardingGraphQLSpec,
  appGraphQLSpec,
  sessionGraphQLSpec,
  skillGraphQLSpec,
  userGraphQLSpec,
  vendorCredentialGraphQLSpec,
  organizationGraphQLSpec,
] satisfies GraphQLModuleSpec[];
