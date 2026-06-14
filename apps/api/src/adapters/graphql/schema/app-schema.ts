export const appSchema = /* GraphQL */ `
  type App {
    createdAt: String!
    defaultEnvironmentId: ULID
    id: ULID!
    name: String!
    organizationId: ULID!
    ownerAccountId: ULID!
    slug: String!
  }
`;
