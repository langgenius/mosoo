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
    appId: ULID!
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
    appId: ULID!
    source: McpServerSource!
    updatedAt: String!
    url: String!
  }

  type McpRegistry {
    currentUserEmail: String!
    currentUserId: ULID!
    currentUserName: String!
    appId: ULID!
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

  input CreateAppMcpServerInput {
    authType: McpAuthType!
    description: String
    iconUrl: String
    name: String!
    oauthClientId: String
    oauthClientSecret: String
    appId: ULID!
    url: String!
  }

  input UpdateAppMcpServerInput {
    appId: ULID!
    description: String
    iconUrl: String
    name: String!
    serverId: ULID!
    url: String!
  }

  input ConnectMcpBearerInput {
    appId: ULID!
    serverId: ULID!
    subjectLabel: String
    token: String!
  }

  input StartMcpOAuthInput {
    appId: ULID!
    returnUrl: String
    serverId: ULID!
  }
`;
