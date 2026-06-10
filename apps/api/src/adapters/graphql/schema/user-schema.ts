export const userSchema = /* GraphQL */ `
  type Account {
    email: String!
    id: ULID!
    imageUrl: String
    name: String!
    systemAgentModel: SystemAgentModelSetting
  }

  type SystemAgentModelSetting {
    modelId: String!
    vendor: String!
  }

  type OnboardingDiscoveryOrganization {
    creator: String!
    id: ULID!
    joinPolicy: OrganizationJoinPolicy!
    memberCount: Int!
    name: String!
  }

  type OnboardingDiscovery {
    domain: String!
    isPublicEmail: Boolean!
    orgs: [OnboardingDiscoveryOrganization!]!
  }

  type OnboardingStatus {
    completed: Boolean!
    organization: Organization
  }

  type ViewerAuth {
    currentSecurityLevel: AuthSecurityLevel!
    methods: [AuthMethod!]!
  }

  type ViewerOrganizationMembership {
    joinedAt: String!
    organization: Organization!
    role: OrganizationMemberRole!
  }

  type Viewer {
    account: Account
    activeOrganization: Organization
    auth: ViewerAuth!
    memberships: [ViewerOrganizationMembership!]!
  }

  input BootstrapOnboardingInput {
    action: String!
    name: String
    organizationId: ULID
  }

  input UpdateAccountProfileInput {
    imageUrl: String
    name: String!
  }

  input SetSystemAgentModelInput {
    modelId: String!
    vendor: String!
  }
`;
