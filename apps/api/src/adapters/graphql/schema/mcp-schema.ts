export const mcpSchema = /* GraphQL */ `
  enum McpAuthType {
    oauth
    bearer
  }

  enum McpAuthorizationState {
    active
    authorization_required
    disabled
    expired
    revoked
  }

  enum AgentMcpCredentialMode {
    runtime_resolved
    agent_bound
  }

  # "app" is the frozen storage token for Project-scoped MCP rows: production
  # rows and the append-only migration chain already carry it, so the wire enum
  # mirrors the stored value instead of forcing a data rewrite.
  enum McpCredentialScope {
    app
  }

  enum McpCredentialRecordScope {
    app
    agent
  }

  enum McpCredentialStatus {
    none
    active
    expired
    revoked
  }

  enum McpOAuthFlowStatus {
    pending
    succeeded
    failed
    expired
  }

  # "app" is the frozen storage token for Project-provided servers (see the
  # McpCredentialScope note above).
  enum McpServerSource {
    app
  }

  type McpCredentialSummary {
    authType: McpAuthType!
    createdAt: String!
    expiresAt: String
    id: ULID!
    scope: McpCredentialRecordScope!
    scopeValues: [String!]!
    status: McpCredentialStatus!
    subjectLabel: String
    updatedAt: String!
  }

  type McpServer {
    authType: McpAuthType!
    createdAt: String!
    credentialScope: McpCredentialScope!
    description: String
    enabled: Boolean!
    hasCredential: Boolean!
    iconUrl: String
    id: ULID!
    name: String!
    ownerId: ULID!
    ownerName: String!
    projectId: ULID!
    source: McpServerSource!
    updatedAt: String!
    url: String!
  }

  type McpServerWithCredential {
    authType: McpAuthType!
    authorizationState: McpAuthorizationState!
    createdAt: String!
    credential: McpCredentialSummary
    credentialScope: McpCredentialScope!
    credentialStatus: McpCredentialStatus!
    description: String
    enabled: Boolean!
    hasCredential: Boolean!
    iconUrl: String
    id: ULID!
    name: String!
    ownerId: ULID!
    ownerName: String!
    projectId: ULID!
    source: McpServerSource!
    updatedAt: String!
    url: String!
  }

  type McpRegistry {
    currentUserEmail: String!
    currentUserId: ULID!
    currentUserName: String!
    projectId: ULID!
    servers: [McpServerWithCredential!]!
  }

  type AgentMcpBinding {
    authType: McpAuthType!
    authorizationState: McpAuthorizationState!
    createdAt: String!
    credentialMode: AgentMcpCredentialMode!
    credentialScope: McpCredentialScope!
    credentialStatus: McpCredentialStatus!
    credentialSubject: String
    enabled: Boolean!
    hasCredential: Boolean!
    iconUrl: String
    id: ULID!
    name: String!
    serverId: ULID!
    source: McpServerSource!
    updatedAt: String!
    url: String!
  }

  type StartMcpOAuthPayload {
    authorizationUrl: String!
    flowId: ULID!
  }

  type McpOAuthFlowState {
    authorizationState: McpAuthorizationState
    errorMessage: String
    flowId: ULID!
    serverId: ULID!
    status: McpOAuthFlowStatus!
    subjectLabel: String
  }

  input CreateProjectMcpServerInput {
    authType: McpAuthType!
    description: String
    iconUrl: String
    name: String!
    oauthClientId: String
    oauthClientSecret: String
    projectId: ULID!
    url: String!
  }

  input UpdateProjectMcpServerInput {
    projectId: ULID!
    description: String
    iconUrl: String
    name: String!
    serverId: ULID!
    url: String!
  }

  input ConnectMcpBearerInput {
    projectId: ULID!
    serverId: ULID!
    subjectLabel: String
    token: String!
  }

  input StartMcpOAuthInput {
    projectId: ULID!
    returnUrl: String
    serverId: ULID!
  }
`;
