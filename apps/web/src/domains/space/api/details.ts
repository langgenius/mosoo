import type { AppId, SpaceId } from "@mosoo/contracts/id";
import type { SpaceView } from "@mosoo/contracts/space";

import { graphql } from "@/gql";
import { requestGraphQL } from "@/platform/http/graphql-client";

import { toSpaceView } from "./space-mappers";

const CREATE_SPACE_MUTATION = graphql(/* GraphQL */ `
  mutation CreateSpace($input: CreateSpaceInput!) {
    createSpace(input: $input) {
      createdAt
      id
      name
      ownerId
      appId
      role
      storagePrefix
      canDelete
      viewerAssetRole
    }
  }
`);

const DELETE_SPACE_MUTATION = graphql(/* GraphQL */ `
  mutation DeleteSpace($appId: ULID!, $spaceId: ULID!) {
    deleteSpace(appId: $appId, spaceId: $spaceId) {
      ok
    }
  }
`);

export async function createSpace(appId: AppId, name: string): Promise<SpaceView> {
  const payload = await requestGraphQL(CREATE_SPACE_MUTATION, {
    input: {
      name,
      appId,
    },
  });

  return toSpaceView(payload.createSpace);
}

export async function deleteSpace(appId: AppId, spaceId: SpaceId): Promise<{ ok: true }> {
  await requestGraphQL(DELETE_SPACE_MUTATION, { appId, spaceId });

  return { ok: true };
}
