import type { OrganizationSummary, RenameOrganizationInput } from "@mosoo/contracts/organization";

import { graphql } from "@/gql";
import { requestGraphQL } from "@/platform/http/graphql-client";

import { toOrganizationSummary } from "./organization-mappers";

export * from "./index";

const RENAME_ORGANIZATION_MUTATION = graphql(/* GraphQL */ `
  mutation RenameOrganization($input: RenameOrganizationInput!) {
    renameOrganization(input: $input) {
      avatarUrl
      createdAt
      id
      name
    }
  }
`);

export async function renameOrganization(
  input: RenameOrganizationInput,
): Promise<OrganizationSummary> {
  const payload = await requestGraphQL(RENAME_ORGANIZATION_MUTATION, { input });

  return toOrganizationSummary(payload.renameOrganization);
}
