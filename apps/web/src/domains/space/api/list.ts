import type { OrganizationId } from "@mosoo/contracts/id";
import type { SpaceView } from "@mosoo/contracts/space";

import { graphql } from "@/gql";
import { requestGraphQL } from "@/platform/http/graphql-client";

import { toSpaceView } from "./space-mappers";

const SPACES_QUERY = graphql(/* GraphQL */ `
  query Spaces($organizationId: ULID!) {
    spaceList(organizationId: $organizationId) {
      createdAt
      id
      isSharedWithViewer
      name
      ownerId
      role
      storagePrefix
      canDelete
      canUpdateAcl
      creatorMembershipStatus
      viewerAssetRole
      visibility
    }
  }
`);

export async function spaces(organizationId: OrganizationId): Promise<SpaceView[]> {
  const payload = await requestGraphQL(SPACES_QUERY, {
    organizationId,
  });

  return payload.spaceList.map(toSpaceView);
}
