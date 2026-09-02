export const projectSchema = /* GraphQL */ `
  enum ProjectOverviewProviderCredentialStatus {
    configured
  }

  type Project {
    createdAt: String!
    defaultEnvironmentId: ULID
    id: ULID!
    name: String!
    ownerAccountId: ULID!
  }

  type ProjectOverviewAgent {
    projectId: ULID!
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

  type ProjectOverviewAgentList {
    hasMore: Boolean!
    items: [ProjectOverviewAgent!]!
    limit: Int!
  }

  type ProjectOverviewProviderCredential {
    projectId: ULID!
    hasCustomApiBase: Boolean!
    id: ULID!
    isDefault: Boolean!
    modelCount: Int!
    name: String!
    status: ProjectOverviewProviderCredentialStatus!
    vendorId: String!
  }

  type ProjectOverviewProviderCredentialVendorCount {
    count: Int!
    defaultCredentialId: ULID
    vendorId: String!
  }

  type ProjectOverviewProviderCredentialList {
    byVendor: [ProjectOverviewProviderCredentialVendorCount!]!
    configuredCount: Int!
    hasMore: Boolean!
    items: [ProjectOverviewProviderCredential!]!
    limit: Int!
  }

  type ProjectOverview {
    agents: ProjectOverviewAgentList!
    project: Project!
    providerCredentials: ProjectOverviewProviderCredentialList!
  }

  type ControlPlaneOverviewProjectList {
    hasMore: Boolean!
    items: [ProjectOverview!]!
    limit: Int!
  }

  type ControlPlaneOverview {
    activeOrganization: Organization
    projects: ControlPlaneOverviewProjectList!
  }

  input CreateProjectInput {
    name: String!
    organizationId: ULID!
  }

  input RenameProjectInput {
    projectId: ULID!
    name: String!
  }
`;
