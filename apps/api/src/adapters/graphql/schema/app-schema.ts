export const appSchema = /* GraphQL */ `
  enum AppOverviewBoundAgentExposure {
    public_thread
  }

  enum AppOverviewProviderCredentialStatus {
    configured
  }

  enum AppDeploymentRunStatus {
    activating
    building
    failed
    preparing
    queued
    submitted
    submitting
    success
  }

  enum AppDeploymentTargetKind {
    cloudflare_pages
    cloudflare_worker
  }

  type App {
    createdAt: String!
    defaultEnvironmentId: ULID
    id: ULID!
    name: String!
    ownerAccountId: ULID!
  }

  type AppDeploymentRun {
    appId: ULID!
    createdAt: String!
    deploymentId: ULID!
    errorCode: String
    errorMessage: String
    id: ULID!
    liveUrl: String
    plannedUrl: String!
    sourceBranch: String!
    sourceCommitSha: String!
    status: AppDeploymentRunStatus!
    targetKind: AppDeploymentTargetKind
    updatedAt: String!
  }

  type AppDeployment {
    appId: ULID!
    createdAt: String!
    defaultBranch: String!
    id: ULID!
    latestRun: AppDeploymentRun
    liveUrl: String
    plannedUrl: String!
    repoName: String!
    repoOwner: String!
    repoUrl: String!
    updatedAt: String!
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

  type AppOverviewBoundAgent {
    agentId: ULID!
    envVar: String!
    expose: AppOverviewBoundAgentExposure!
    name: String!
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
    boundAgents: [AppOverviewBoundAgent!]!
    deployment: AppDeployment
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

  input DeployAppInput {
    appId: ULID!
    configPath: String
    repoUrl: String!
  }

  input DeleteAppDeploymentInput {
    appId: ULID!
  }

  input RenameAppInput {
    appId: ULID!
    name: String!
  }
`;
