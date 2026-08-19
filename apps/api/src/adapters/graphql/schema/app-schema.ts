export const appSchema = /* GraphQL */ `
  type App {
    createdAt: String!
    defaultEnvironmentId: ULID
    id: ULID!
    name: String!
    ownerAccountId: ULID!
  }

  input CreateAppInput {
    name: String!
    organizationId: ULID!
  }

  input RenameAppInput {
    appId: ULID!
    name: String!
  }
`;
