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
    user
    organization_shared
  }

  enum McpCredentialRecordScope {
    user
    organization_shared
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
    personal
    organization_shared
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
    hasSharedCredential: Boolean!
    iconUrl: String
    id: ULID!
    name: String!
    ownerId: ULID!
    ownerName: String!
    source: McpServerSource!
    updatedAt: String!
    url: String!
    organizationId: ULID!
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
    hasSharedCredential: Boolean!
    iconUrl: String
    id: ULID!
    name: String!
    ownerId: ULID!
    ownerName: String!
    source: McpServerSource!
    updatedAt: String!
    url: String!
    organizationId: ULID!
  }

  type McpRegistry {
    currentUserEmail: String!
    currentUserId: ULID!
    currentUserName: String!
    isAdmin: Boolean!
    personal: [McpServerWithCredential!]!
    organizationId: ULID!
    organizationShared: [McpServerWithCredential!]!
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
    hasSharedCredential: Boolean!
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

  input CreatePersonalMcpServerInput {
    authType: McpAuthType!
    description: String
    iconUrl: String
    name: String!
    oauthClientId: String
    oauthClientSecret: String
    url: String!
    organizationId: ULID!
  }

  input CreateOrganizationMcpServerInput {
    authType: McpAuthType!
    credentialScope: McpCredentialScope!
    description: String
    iconUrl: String
    name: String!
    oauthClientId: String
    oauthClientSecret: String
    sharedBearerToken: String
    url: String!
    organizationId: ULID!
  }

  input ConnectMcpBearerInput {
    serverId: ULID!
    subjectLabel: String
    token: String!
  }

  input SetOrganizationSharedMcpBearerInput {
    serverId: ULID!
    subjectLabel: String
    token: String!
  }

  input StartMcpOAuthInput {
    returnUrl: String
    serverId: ULID!
  }
`;
