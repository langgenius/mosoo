export const projectSchema = /* GraphQL */ `
  type Project {
    createdAt: String!
    defaultEnvironmentId: ULID
    id: ULID!
    name: String!
    ownerAccountId: ULID!
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
