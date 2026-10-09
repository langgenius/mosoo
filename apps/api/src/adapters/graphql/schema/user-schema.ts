export const userSchema = /* GraphQL */ `
  type Account {
    email: String!
    id: ULID!
    imageUrl: String
    name: String!
  }

  type OnboardingStatus {
    completed: Boolean!
    organization: Organization
  }

  type Viewer {
    account: Account
    activeOrganization: Organization
    organizations: [Organization!]!
  }

  input BootstrapOnboardingInput {
    name: String
  }

  input UpdateAccountProfileInput {
    imageUrl: String
    name: String!
  }
`;
