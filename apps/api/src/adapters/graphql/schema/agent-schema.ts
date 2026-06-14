export const agentSchema = /* GraphQL */ `
  enum AgentSkillState {
    active
    tombstone
  }

  enum AgentStatus {
    draft
    published
  }

  enum AgentKind {
    pet
    cattle
  }

  enum AgentVisibility {
    private
  }

  enum AgentViewerRole {
    owner
    none
  }

  enum AgentReadinessSeverity {
    error
    warning
  }

  enum AgentResolutionSeverity {
    error
    info
    warning
  }

  enum AgentResolutionStatus {
    missing
    needs_reconnect
    permission_denied
    resolved
    unavailable
    unsupported
    warning
  }

  enum AgentResolutionTargetType {
    agent
    channel
    environment
    model
    mcp_server
    provider
    runtime
    skill
    space
  }

  enum AgentPackageResolutionSource {
    fork
    import
  }

  enum AgentBuilderComponentDecision {
    bound
    created
    skipped
  }

  enum AgentBuilderAgentTypeDecision {
    decided
    skipped
  }

  enum RuntimeStateOperation {
    recreateSandbox
    resetAgentState
    restartDriver
  }

  type AgentSkillReference {
    ownerName: String
    skillId: ULID!
    skillName: String!
    state: AgentSkillState!
  }

  type AgentDeploymentVersion {
    agentId: ULID!
    createdAt: String!
    createdByAccountId: ULID!
    environmentId: ULID
    id: ULID!
    isLive: Boolean!
    kind: AgentKind!
    model: String!
    provider: String!
    runtimeId: String!
    summary: String!
    versionNumber: Int!
  }

  type Agent {
    createdAt: String!
    description: String
    id: ULID!
    kind: AgentKind!
    liveVersion: AgentDeploymentVersion
    model: String!
    name: String!
    prompt: String!
    provider: String!
    runtimeId: String!
    skills: [AgentSkillReference!]!
    status: AgentStatus!
    updatedAt: String!
    visibility: AgentVisibility!
    organizationId: ULID!
    appId: ULID!
  }

  type AgentEnvironmentConfig {
    boundSpaceIds: [ULID!]!
    environmentId: ULID
  }

  type AgentBuilderComponentDecisions {
    agentType: AgentBuilderAgentTypeDecision
    environment: AgentBuilderComponentDecision
  }

  type AgentBuilderMetadata {
    componentDecisions: AgentBuilderComponentDecisions!
  }

  type AgentReadinessIssue {
    code: String!
    message: String!
    severity: AgentReadinessSeverity!
  }

  type AgentReadiness {
    checkedAt: String!
    issues: [AgentReadinessIssue!]!
    ready: Boolean!
  }

  type AgentResolutionIssue {
    actionLabel: String
    code: String!
    message: String!
    required: Boolean!
    severity: AgentResolutionSeverity!
    status: AgentResolutionStatus!
    targetLabel: String
    targetType: AgentResolutionTargetType!
  }

  type AgentPackageResolutionSummary {
    boundMcpServerCount: Int!
    boundSkillCount: Int!
    boundSpaceCount: Int!
    copiedAssetCount: Int!
    createdMcpServerCount: Int!
    reusedMcpServerCount: Int!
  }

  type AgentPackageResolutionReport {
    issues: [AgentResolutionIssue!]!
    summary: AgentPackageResolutionSummary!
  }

  type AgentPackageResolutionState {
    recordedAt: String!
    report: AgentPackageResolutionReport!
    source: AgentPackageResolutionSource!
  }

  type AgentManifestExport {
    agentId: ULID!
    json: String!
    yaml: String!
  }

  type AgentPackageExport {
    agentId: ULID!
    contentType: String!
    fileId: ULID!
    fileName: String!
    manifestYaml: String!
    size: Int!
  }

  type AgentPackageImportResult {
    agent: Agent!
    resolution: AgentPackageResolutionReport!
  }

  type RuntimeStateOperationResult {
    affectedSessionCount: Int!
    agentId: ULID!
    ok: Boolean!
    operation: RuntimeStateOperation!
  }

  input RuntimeStateOperationInput {
    affectedFields: [String!]
    agentId: ULID!
    applyActionKind: String
    targetVersion: RuntimeStateTargetVersionInput
    appId: ULID!
  }

  input RuntimeStateTargetVersionInput {
    id: ULID!
    versionNumber: Int!
  }

  type AgentOwnerSummary {
    id: ULID!
    imageUrl: String
    name: String
  }

  type AgentToolSummary {
    enabled: Boolean!
    iconUrl: String
    name: String!
    serverId: ULID!
  }

  type AgentSummary {
    createdAt: String!
    description: String
    id: ULID!
    kind: AgentKind!
    name: String!
    owner: AgentOwnerSummary!
    runtimeId: String!
    status: AgentStatus!
    tools: [AgentToolSummary!]!
    updatedAt: String!
    viewerRole: AgentViewerRole!
    visibility: AgentVisibility!
    organizationId: ULID!
    appId: ULID!
  }

  type AgentDetail {
    createdAt: String!
    description: String
    id: ULID!
    kind: AgentKind!
    liveVersion: AgentDeploymentVersion
    model: String!
    name: String!
    owner: AgentOwnerSummary!
    prompt: String!
    provider: String!
    runtimeId: String!
    skills: [AgentSkillReference!]!
    status: AgentStatus!
    tools: [AgentToolSummary!]!
    updatedAt: String!
    versions: [AgentDeploymentVersion!]!
    viewerRole: AgentViewerRole!
    visibility: AgentVisibility!
    organizationId: ULID!
    appId: ULID!
  }

  type AgentEditorState {
    builder: AgentBuilderMetadata!
    environment: AgentEnvironmentConfig!
    id: ULID!
    packageResolution: AgentPackageResolutionState
    mcpBindings: [AgentMcpBinding!]!
    providerOptions: JsonObject!
    readiness: AgentReadiness!
  }

  input CreateAgentInput {
    description: String
    kind: AgentKind!
    model: String!
    name: String!
    prompt: String!
    provider: String!
    runtimeId: String!
    skillIds: [ULID!]!
    appId: ULID!
  }

  input UpdateAgentConfigInput {
    agentId: ULID!
    builder: AgentBuilderMetadataInput!
    description: String
    environment: AgentEnvironmentConfigInput!
    kind: AgentKind!
    mcpServerIds: [ULID!]!
    model: String!
    name: String!
    prompt: String!
    provider: String!
    providerOptions: JsonObject!
    runtimeId: String!
    skillIds: [ULID!]!
    appId: ULID!
  }

  input AgentBuilderComponentDecisionsInput {
    agentType: AgentBuilderAgentTypeDecision
    environment: AgentBuilderComponentDecision
  }

  input AgentBuilderMetadataInput {
    componentDecisions: AgentBuilderComponentDecisionsInput!
  }

  input DeleteAgentInput {
    agentId: ULID!
    appId: ULID!
  }

  input PublishAgentInput {
    agentId: ULID!
    appId: ULID!
  }

  input AgentEnvironmentConfigInput {
    boundSpaceIds: [ULID!]!
    environmentId: ULID
  }

  input ImportAgentPackageInput {
    fileId: ULID!
    appId: ULID!
  }

  input CreateAgentForkInput {
    agentId: ULID!
    kind: AgentKind
    appId: ULID!
  }
`;
