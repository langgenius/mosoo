import type { OrganizationId, SpaceId } from "@mosoo/contracts/id";
import type { SpaceView, SpaceVisibility } from "@mosoo/contracts/space";

import { graphql } from "@/gql";
import { requestGraphQL } from "@/platform/http/graphql-client";

import { toSpaceView } from "./space-mappers";

const CREATE_SPACE_MUTATION = graphql(/* GraphQL */ `
  mutation CreateSpace($input: CreateSpaceInput!) {
    createSpace(input: $input) {
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

const DELETE_SPACE_MUTATION = graphql(/* GraphQL */ `
  mutation DeleteSpace($spaceId: ULID!) {
    deleteSpace(spaceId: $spaceId) {
      ok
    }
  }
`);

export async function createSpace(
  organizationId: OrganizationId,
  name: string,
  visibility: SpaceVisibility = "private",
): Promise<SpaceView> {
  const payload = await requestGraphQL(CREATE_SPACE_MUTATION, {
    input: {
      name,
      organizationId,
      visibility,
    },
  });

  return toSpaceView(payload.createSpace);
}

export async function deleteSpace(spaceId: SpaceId): Promise<{ ok: true }> {
  await requestGraphQL(DELETE_SPACE_MUTATION, { spaceId });

  return { ok: true };
}
