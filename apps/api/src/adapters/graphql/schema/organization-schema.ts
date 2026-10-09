export const organizationSchema = /* GraphQL */ `
  type Organization {
    createdAt: String!
    id: ULID!
    name: String!
  }

  input RenameOrganizationInput {
    organizationId: ULID!
    name: String!
  }
`;
