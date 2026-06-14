import type { OrganizationSummary } from "@mosoo/contracts/organization";

import { toOrganizationId } from "@/routes/typed-id";

type GraphQLOrganizationSummary = Omit<OrganizationSummary, "id"> & {
  id: string;
};

export function toOrganizationSummary(
  organization: GraphQLOrganizationSummary,
): OrganizationSummary {
  return {
    ...organization,
    id: toOrganizationId(organization.id),
  };
}
