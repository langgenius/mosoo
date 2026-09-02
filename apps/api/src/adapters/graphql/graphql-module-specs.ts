import type { GraphQLModule } from "./graphql-module.ts";
import { agentSchema } from "./schema/agent-schema.ts";
import { commonSchema } from "./schema/common-schema.ts";
import { costSchema } from "./schema/cost-schema.ts";
import { environmentSchema } from "./schema/environment-schema.ts";
import { fileSchema } from "./schema/file-schema.ts";
import { mcpSchema } from "./schema/mcp-schema.ts";
import { organizationSchema } from "./schema/organization-schema.ts";
import { projectSchema } from "./schema/project-schema.ts";
import { sessionSchema } from "./schema/session-schema.ts";
import { skillSchema } from "./schema/skill-schema.ts";
import { userSchema } from "./schema/user-schema.ts";
import { vendorCredentialSchema } from "./schema/vendor-credential-schema.ts";

type GraphQLModuleSpec = Pick<GraphQLModule, "mutationFields" | "queryFields" | "typeDefs">;

export const commonGraphQLSpec = {
  queryFields: ["appInfo: AppInfo!"],
  typeDefs: commonSchema,
} satisfies GraphQLModuleSpec;

export const costGraphQLSpec = {
  queryFields: [
    "agentCostCard(projectId: ULID!, agentId: ULID!, range: CostRange!, runPurposes: [CostRunPurpose!]): AgentCostCard!",
    "organizationBillingCostCard(organizationId: ULID!, range: CostRange!, runPurposes: [CostRunPurpose!]): OrganizationBillingCostCard!",
    "projectCostCard(projectId: ULID!, range: CostRange!, runPurposes: [CostRunPurpose!]): ProjectCostCard!",
  ],
  typeDefs: costSchema,
} satisfies GraphQLModuleSpec;

export const agentGraphQLSpec = {
  mutationFields: [
    "createAgentFork(input: CreateAgentForkInput!): AgentPackageImportResult!",
    "createAgent(input: CreateAgentInput!): Agent!",
    "deleteAgent(input: DeleteAgentInput!): OperationResult!",
    "importAgentPackage(input: ImportAgentPackageInput!): AgentPackageImportResult!",
    "publishAgent(input: PublishAgentInput!): Agent!",
    "recreateSandbox(input: RuntimeStateOperationInput!): RuntimeStateOperationResult!",
    "resetAgentState(input: RuntimeStateOperationInput!): RuntimeStateOperationResult!",
    "restartDriver(input: RuntimeStateOperationInput!): RuntimeStateOperationResult!",
    "unpublishAgent(projectId: ULID!, agentId: ULID!): Agent!",
    "updateAgentConfig(input: UpdateAgentConfigInput!): Agent!",
  ],
  queryFields: [
    "accessibleAgentList(projectId: ULID!): [AgentSummary!]!",
    "agent(projectId: ULID!, agentId: ULID!): AgentDetail!",
    "agentEditorState(projectId: ULID!, agentId: ULID!): AgentEditorState!",
    "agentManifest(projectId: ULID!, agentId: ULID!): AgentManifestExport!",
    "exportAgentPackage(projectId: ULID!, agentId: ULID!): AgentPackageExport!",
  ],
  typeDefs: agentSchema,
} satisfies GraphQLModuleSpec;

export const environmentGraphQLSpec = {
  mutationFields: [
    "createEnvironment(input: CreateEnvironmentInput!): EnvironmentSummary!",
    "createEnvironmentFork(input: CreateEnvironmentForkInput!): EnvironmentSummary!",
    "deleteEnvironment(input: DeleteEnvironmentInput!): OperationResult!",
    "setEnvironmentVariableValue(input: SetEnvironmentVariableValueInput!): EnvironmentDetail!",
    "setProjectDefaultEnvironment(input: SetProjectDefaultEnvironmentInput!): EnvironmentSummary!",
    "updateEnvironment(input: UpdateEnvironmentInput!): EnvironmentDetail!",
  ],
  queryFields: [
    "environment(projectId: ULID!, environmentId: ULID!): EnvironmentDetail!",
    "projectEnvironmentList(projectId: ULID!): [EnvironmentSummary!]!",
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
    "createProjectMcpServer(input: CreateProjectMcpServerInput!): McpServerWithCredential!",
    "deleteMcpServer(projectId: ULID!, serverId: ULID!): OperationResult!",
    "revokeMcpCredential(projectId: ULID!, serverId: ULID!): McpServerWithCredential!",
    "setMcpServerEnabled(projectId: ULID!, serverId: ULID!, enabled: Boolean!): McpServerWithCredential!",
    "startMcpOAuth(input: StartMcpOAuthInput!): StartMcpOAuthPayload!",
    "updateProjectMcpServer(input: UpdateProjectMcpServerInput!): McpServerWithCredential!",
  ],
  queryFields: [
    "mcpOAuthFlowStatus(flowId: ULID!): McpOAuthFlowState!",
    "mcpRegistry(projectId: ULID!): McpRegistry!",
  ],
  typeDefs: mcpSchema,
} satisfies GraphQLModuleSpec;

export const onboardingGraphQLSpec = {
  mutationFields: ["onboardingBootstrap(input: BootstrapOnboardingInput!): OnboardingStatus!"],
  queryFields: [],
} satisfies GraphQLModuleSpec;

export const projectGraphQLSpec = {
  mutationFields: [
    "createProject(input: CreateProjectInput!): Project!",
    "renameProject(input: RenameProjectInput!): Project!",
  ],
  queryFields: [
    "projectList(organizationId: ULID!): [Project!]!",
    "projectOverview(projectId: ULID!, agentLimit: Int, credentialLimit: Int): ProjectOverview!",
    "controlPlaneOverview(projectLimit: Int, agentLimit: Int, credentialLimit: Int): ControlPlaneOverview!",
  ],
  typeDefs: projectSchema,
} satisfies GraphQLModuleSpec;

export const sessionGraphQLSpec = {
  mutationFields: [
    "addSessionResource(input: AddSessionResourceInput!): SessionResourceUpload!",
    "createAgentSession(input: CreateAgentSessionInput!): Session!",
    "prewarmAgentSession(projectId: ULID!, sessionId: ULID!): SessionRuntimePrewarmAck!",
    "sendAgentSessionEvents(projectId: ULID!, sessionId: ULID!, events: [AgentSessionEventInput!]!): AgentSessionEventBatch!",
    "startAgentRun(input: StartAgentRunInput!): AgentRunWorkflow!",
    "archiveAgentSession(projectId: ULID!, sessionId: ULID!): OperationResult!",
    "autoTitleSession(input: RenameSessionInput!): Session!",
    "deleteAgentSession(projectId: ULID!, sessionId: ULID!): OperationResult!",
    "renameSession(input: RenameSessionInput!): Session!",
    "removeSessionResource(input: RemoveSessionResourceInput!): OperationResult!",
    "unarchiveAgentSession(projectId: ULID!, sessionId: ULID!): OperationResult!",
  ],
  queryFields: [
    "agentSessionDiagnostics(projectId: ULID!, sessionId: ULID!): AgentSessionDiagnostics!",
    "agentSessionRetrieve(projectId: ULID!, sessionId: ULID!): AgentSessionRetrieve!",
    "session(projectId: ULID!, sessionId: ULID!): Session!",
    "sessionMessages(projectId: ULID!, sessionId: ULID!): [SessionMessage!]!",
    "sessionProcessEvents(projectId: ULID!, limit: Int, sessionId: ULID!): [SessionProcessEvent!]!",
    "threadAgentSessionList(archived: Boolean, beforeCursor: String, limit: Int, projectId: ULID!, type: SessionType): AgentSessionRetrieveConnection!",
    "threadAgentSessionRetrieve(projectId: ULID!, sessionId: ULID!): AgentSessionRetrieve!",
    "threadSessionMessages(projectId: ULID!, sessionId: ULID!): [SessionMessage!]!",
    "threadSessionProcessEvents(projectId: ULID!, limit: Int, sessionId: ULID!): [SessionProcessEvent!]!",
    "listSessionResources(projectId: ULID!, sessionId: ULID!): [SessionResource!]!",
    "sessionList(archived: Boolean, beforeCursor: String, limit: Int, projectId: ULID!, type: SessionType): SessionConnection!",
    "agentSessionList(projectId: ULID!, agentId: ULID!, archived: Boolean, beforeCursor: String, limit: Int, participantOnly: Boolean, type: SessionType): SessionConnection!",
  ],
  typeDefs: sessionSchema,
} satisfies GraphQLModuleSpec;

export const skillGraphQLSpec = {
  mutationFields: [
    "createSkillFork(input: CreateSkillForkInput!): SkillSummary!",
    "deleteOwnedSkill(projectId: ULID!, skillId: ULID!): OperationResult!",
  ],
  queryFields: [
    "projectSkillList(projectId: ULID!): [SkillSummary!]!",
    "skillDetail(projectId: ULID!, skillId: ULID!): SkillDetail!",
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
    "availableAgentModels(projectId: ULID!, runtimeId: String!, currentModelId: String, currentVendorId: String): [ResolvedModelEntry!]!",
    "vendorCredentialList(projectId: ULID!): [VendorCredential!]!",
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
  costGraphQLSpec,
  environmentGraphQLSpec,
  fileGraphQLSpec,
  mcpGraphQLSpec,
  onboardingGraphQLSpec,
  projectGraphQLSpec,
  sessionGraphQLSpec,
  skillGraphQLSpec,
  userGraphQLSpec,
  vendorCredentialGraphQLSpec,
  organizationGraphQLSpec,
] satisfies GraphQLModuleSpec[];
