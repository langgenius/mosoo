import type { OrganizationSummary } from "@mosoo/contracts/organization";
import type { OrganizationId, PlatformId } from "@mosoo/id";

type GraphQLOrganizationSummary = Omit<OrganizationSummary, "id"> & {
  id: PlatformId;
};

export function toOrganizationSummary(
  organization: GraphQLOrganizationSummary,
): OrganizationSummary {
  return {
    ...organization,
    id: organization.id as OrganizationId,
  };
}
