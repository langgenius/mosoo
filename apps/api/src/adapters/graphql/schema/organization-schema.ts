export const organizationSchema = /* GraphQL */ `
  type Organization {
    avatarUrl: String
    createdAt: String!
    id: ULID!
    name: String!
  }

  input RenameOrganizationInput {
    organizationId: ULID!
    name: String!
  }
`;
