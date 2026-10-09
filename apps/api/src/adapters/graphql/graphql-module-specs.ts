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

interface GraphQLModuleSpec {
  mutationFields?: string[];
  queryFields?: string[];
  typeDefs?: string;
}

const commonGraphQLSpec = {
  typeDefs: commonSchema,
};

const costGraphQLSpec = {
  queryFields: [
    "agentCostCard(projectId: ULID!, agentId: ULID!, range: CostRange!, runPurposes: [CostRunPurpose!]): AgentCostCard!",
    "projectCostCard(projectId: ULID!, range: CostRange!, runPurposes: [CostRunPurpose!]): ProjectCostCard!",
  ],
  typeDefs: costSchema,
};

const agentGraphQLSpec = {
  mutationFields: [
    "createAgentFork(input: CreateAgentForkInput!): AgentPackageImportResult!",
    "createAgent(input: CreateAgentInput!): Agent!",
    "deleteAgent(input: DeleteAgentInput!): OperationResult!",
    "importAgentPackage(input: ImportAgentPackageInput!): AgentPackageImportResult!",
    "publishAgent(input: PublishAgentInput!): Agent!",
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
};

const environmentGraphQLSpec = {
  mutationFields: [
    "createEnvironment(input: CreateEnvironmentInput!): EnvironmentSummary!",
    "deleteEnvironment(input: DeleteEnvironmentInput!): OperationResult!",
    "setProjectDefaultEnvironment(input: SetProjectDefaultEnvironmentInput!): EnvironmentSummary!",
    "updateEnvironment(input: UpdateEnvironmentInput!): EnvironmentDetail!",
  ],
  queryFields: [
    "environment(projectId: ULID!, environmentId: ULID!): EnvironmentDetail!",
    "projectEnvironmentList(projectId: ULID!): [EnvironmentSummary!]!",
  ],
  typeDefs: environmentSchema,
};

const fileGraphQLSpec = {
  queryFields: ["fileList(input: FileListInput!): FileListing!"],
  typeDefs: fileSchema,
};

const mcpGraphQLSpec = {
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
};

const onboardingGraphQLSpec = {
  mutationFields: ["onboardingBootstrap(input: BootstrapOnboardingInput!): OnboardingStatus!"],
};

const projectGraphQLSpec = {
  mutationFields: [
    "createProject(input: CreateProjectInput!): Project!",
    "renameProject(input: RenameProjectInput!): Project!",
  ],
  queryFields: ["projectList(organizationId: ULID!): [Project!]!"],
  typeDefs: projectSchema,
};

const sessionGraphQLSpec = {
  mutationFields: [
    "restartSessionDriver(projectId: ULID!, sessionId: ULID!): SessionRuntimeOperationResult!",
    "recreateSessionSandbox(projectId: ULID!, sessionId: ULID!): SessionRuntimeOperationResult!",
    "addSessionResource(input: AddSessionResourceInput!): SessionResourceUpload!",
    "createAgentSession(input: CreateAgentSessionInput!): Session!",
    "prewarmAgentSession(projectId: ULID!, sessionId: ULID!): SessionRuntimePrewarmAck!",
    "sendAgentSessionEvents(projectId: ULID!, sessionId: ULID!, events: [AgentSessionEventInput!]!): AgentSessionEventBatch!",
    "archiveAgentSession(projectId: ULID!, sessionId: ULID!): OperationResult!",
    "deleteAgentSession(projectId: ULID!, sessionId: ULID!): OperationResult!",
    "unarchiveAgentSession(projectId: ULID!, sessionId: ULID!): OperationResult!",
  ],
  queryFields: [
    "agentSessionDiagnostics(projectId: ULID!, sessionId: ULID!): AgentSessionDiagnostics!",
    "threadAgentSessionList(archived: Boolean, beforeCursor: String, limit: Int, projectId: ULID!, type: SessionType): AgentSessionRetrieveConnection!",
    "threadAgentSessionRetrieve(projectId: ULID!, sessionId: ULID!): AgentSessionRetrieve!",
    "threadSessionMessages(projectId: ULID!, sessionId: ULID!): [SessionMessage!]!",
    "threadSessionProcessEvents(projectId: ULID!, limit: Int, sessionId: ULID!): [SessionProcessEvent!]!",
    "agentSessionList(projectId: ULID!, agentId: ULID!, sessionId: ULID, archived: Boolean, beforeCursor: String, limit: Int, type: SessionType): SessionConnection!",
  ],
  typeDefs: sessionSchema,
};

const skillGraphQLSpec = {
  mutationFields: [
    "createSkillFork(input: CreateSkillForkInput!): SkillSummary!",
    "deleteOwnedSkill(projectId: ULID!, skillId: ULID!): OperationResult!",
  ],
  queryFields: [
    "projectSkillList(projectId: ULID!): [SkillSummary!]!",
    "skillDetail(projectId: ULID!, skillId: ULID!): SkillDetail!",
  ],
  typeDefs: skillSchema,
};

const userGraphQLSpec = {
  mutationFields: ["updateProfile(input: UpdateAccountProfileInput!): Account!"],
  queryFields: ["viewer: Viewer!"],
  typeDefs: userSchema,
};

const vendorCredentialGraphQLSpec = {
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
};

const organizationGraphQLSpec = {
  mutationFields: ["renameOrganization(input: RenameOrganizationInput!): Organization!"],
  typeDefs: organizationSchema,
};

const graphqlModuleSpecs: GraphQLModuleSpec[] = [
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
];

export const graphqlTypeDefs = /* GraphQL */ `
  ${graphqlModuleSpecs.flatMap((spec) => spec.typeDefs ?? []).join("\n")}

  type Query {
    ${graphqlModuleSpecs.flatMap((spec) => spec.queryFields ?? []).join("\n    ")}
  }

  type Mutation {
    ${graphqlModuleSpecs.flatMap((spec) => spec.mutationFields ?? []).join("\n    ")}
  }
`;
