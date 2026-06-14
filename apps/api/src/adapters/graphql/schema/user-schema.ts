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

  type OnboardingStatus {
    completed: Boolean!
    organization: Organization
  }

  type ViewerAuth {
    currentSecurityLevel: AuthSecurityLevel!
    methods: [AuthMethod!]!
  }

  type Viewer {
    account: Account
    activeOrganization: Organization
    auth: ViewerAuth!
    organizations: [Organization!]!
  }

  input BootstrapOnboardingInput {
    name: String
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
