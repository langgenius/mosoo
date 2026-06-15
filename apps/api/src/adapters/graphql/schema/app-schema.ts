export const appSchema = /* GraphQL */ `
  type App {
    createdAt: String!
    defaultEnvironmentId: ULID
    id: ULID!
    name: String!
    ownerAccountId: ULID!
    slug: String!
  }
`;
