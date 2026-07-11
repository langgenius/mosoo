export const appSchema = /* GraphQL */ `
  enum AppOverviewProviderCredentialStatus {
    configured
  }

  enum AppVibeAppStatus {
    generating
    ready
  }

  type App {
    createdAt: String!
    defaultEnvironmentId: ULID
    id: ULID!
    name: String!
    ownerAccountId: ULID!
  }

  type AppVibeApp {
    appId: ULID!
    createdAt: String!
    id: ULID!
    previewUrl: String
    productionUrl: String
    status: AppVibeAppStatus!
    title: String
    updatedAt: String!
    vibeAppId: String!
  }

  type AppVibeAppCloneUrl {
    cloneUrl: String!
    expiresAt: String!
  }

  type AppOverviewAgent {
    appId: ULID!
    description: String
    id: ULID!
    kind: AgentKind!
    model: String!
    name: String!
    provider: String!
    runtimeId: String!
    status: AgentStatus!
    updatedAt: String!
  }

  type AppOverviewAgentList {
    hasMore: Boolean!
    items: [AppOverviewAgent!]!
    limit: Int!
  }

  type AppOverviewProviderCredential {
    appId: ULID!
    hasCustomApiBase: Boolean!
    id: ULID!
    isDefault: Boolean!
    modelCount: Int!
    name: String!
    status: AppOverviewProviderCredentialStatus!
    vendorId: String!
  }

  type AppOverviewProviderCredentialVendorCount {
    count: Int!
    defaultCredentialId: ULID
    vendorId: String!
  }

  type AppOverviewProviderCredentialList {
    byVendor: [AppOverviewProviderCredentialVendorCount!]!
    configuredCount: Int!
    hasMore: Boolean!
    items: [AppOverviewProviderCredential!]!
    limit: Int!
  }

  type AppOverview {
    agents: AppOverviewAgentList!
    app: App!
    providerCredentials: AppOverviewProviderCredentialList!
  }

  type ControlPlaneOverviewAppList {
    hasMore: Boolean!
    items: [AppOverview!]!
    limit: Int!
  }

  type ControlPlaneOverview {
    activeOrganization: Organization
    apps: ControlPlaneOverviewAppList!
  }

  input CreateAppInput {
    name: String!
    organizationId: ULID!
  }

  input RenameAppInput {
    appId: ULID!
    name: String!
  }

  input CreateAppVibeAppInput {
    appId: ULID!
    prompt: String!
  }

  input SendAppVibeAppPromptInput {
    appId: ULID!
    prompt: String!
  }

  input PublishAppVibeAppInput {
    appId: ULID!
  }

  input RefreshAppVibeAppPreviewInput {
    appId: ULID!
  }

  input CreateAppVibeAppCloneUrlInput {
    appId: ULID!
  }

  input DeleteAppVibeAppInput {
    appId: ULID!
  }
`;
