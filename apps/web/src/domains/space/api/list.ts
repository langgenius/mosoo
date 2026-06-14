import type { AppId } from "@mosoo/contracts/id";
import type { SpaceView } from "@mosoo/contracts/space";

import { graphql } from "@/gql";
import { requestGraphQL } from "@/platform/http/graphql-client";

import { toSpaceView } from "./space-mappers";

const SPACES_QUERY = graphql(/* GraphQL */ `
  query Spaces($appId: ULID!) {
    spaceList(appId: $appId) {
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

export async function spaces(appId: AppId): Promise<SpaceView[]> {
  const payload = await requestGraphQL(SPACES_QUERY, {
    appId,
  });

  return payload.spaceList.map(toSpaceView);
}
