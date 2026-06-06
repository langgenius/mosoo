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
    organization
  }

  enum AgentViewerRole {
    owner
    admin
    user
    none
  }

  enum AgentCollaboratorRole {
    admin
    user
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

  enum RuntimeStateOperation {
    recreateSandbox
    resetAgentState
    restartDriver
  }

  enum AgentFileEntryKind {
    directory
    file
    space_mount
    symlink
  }

  enum AgentFilePersistence {
    persistent
    temporary
  }

  enum AgentFilePreview {
    binary
    empty
    large_text
    text
  }

  enum AgentFileSandboxStatus {
    active
    backing_up
    cold
    destroying
    error
    missing
    restoring
    unsupported
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
    packageSharingEnabled: Boolean!
    prompt: String!
    provider: String!
    runtimeId: String!
    skills: [AgentSkillReference!]!
    status: AgentStatus!
    updatedAt: String!
    visibility: AgentVisibility!
    organizationId: ULID!
  }

  type AgentEnvironmentConfig {
    boundSpaceIds: [ULID!]!
    environmentId: ULID
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

  type AgentFileSessionNode {
    active: Boolean!
    id: ULID!
    status: SessionStatus!
    title: String
    updatedAt: String!
  }

  type AgentFileSpaceMountNode {
    path: String!
    spaceId: ULID!
    spaceName: String!
    url: String!
  }

  type AgentFileEntry {
    kind: AgentFileEntryKind!
    mimeType: String
    name: String!
    path: String!
    persistence: AgentFilePersistence!
    preview: AgentFilePreview!
    session: AgentFileSessionNode
    sizeBytes: Int!
    space: AgentFileSpaceMountNode
  }

  type AgentFileTree {
    agentId: ULID!
    entries: [AgentFileEntry!]!
    lastError: String
    path: String!
    sandboxId: ULID
    sandboxStatus: AgentFileSandboxStatus!
    totalCount: Int!
    truncated: Boolean!
  }

  type AgentFileContent {
    agentId: ULID!
    content: String
    mimeType: String!
    name: String!
    path: String!
    preview: AgentFilePreview!
    sandboxId: ULID!
    sizeBytes: Int!
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
  }

  input RuntimeStateTargetVersionInput {
    id: ULID!
    versionNumber: Int!
  }

  type AgentCollaborator {
    email: String
    imageUrl: String
    name: String
    principal: String!
    role: AgentCollaboratorRole!
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
    packageSharingEnabled: Boolean!
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
  }

  type AgentEditorState {
    collaborators: [AgentCollaborator!]!
    environment: AgentEnvironmentConfig!
    id: ULID!
    packageResolution: AgentPackageResolutionState
    mcpBindings: [AgentMcpBinding!]!
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
    organizationId: ULID!
  }

  input UpdateAgentConfigInput {
    agentId: ULID!
    description: String
    environment: AgentEnvironmentConfigInput!
    kind: AgentKind!
    mcpServerIds: [ULID!]!
    model: String!
    name: String!
    prompt: String!
    provider: String!
    runtimeId: String!
    skillIds: [ULID!]!
  }

  input DeleteAgentInput {
    agentId: ULID!
  }

  input PublishAgentInput {
    agentId: ULID!
    """
    Omit on re-publish to inherit the agent's current visibility. Required only
    on the very first publish.
    """
    visibility: AgentVisibility
  }

  input UpdateAgentPackageSharingInput {
    agentId: ULID!
    packageSharingEnabled: Boolean!
  }

  input AgentEnvironmentConfigInput {
    boundSpaceIds: [ULID!]!
    environmentId: ULID
  }

  input ImportAgentPackageInput {
    fileId: ULID!
    organizationId: ULID!
  }

  input CreateAgentForkInput {
    agentId: ULID!
    kind: AgentKind
  }

  input AddAgentCollaboratorInput {
    agentId: ULID!
    principal: String!
    role: AgentCollaboratorRole!
  }

  input RemoveAgentCollaboratorInput {
    agentId: ULID!
    principal: String!
  }

  input UpdateAgentCollaboratorInput {
    agentId: ULID!
    principal: String!
    role: AgentCollaboratorRole!
  }
`;
