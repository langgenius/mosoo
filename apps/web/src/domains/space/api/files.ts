import type { AppId, SpaceId } from "@mosoo/contracts/id";
import type { SpaceFileListing } from "@mosoo/contracts/space";

import { graphql } from "@/gql";
import { requestGraphQL } from "@/platform/http/graphql-client";

import { toSpaceFileListing } from "./space-mappers";

const SPACE_FILES_QUERY = graphql(/* GraphQL */ `
  query SpaceFiles($appId: ULID!, $spaceId: ULID!, $path: String) {
    spaceFiles(appId: $appId, spaceId: $spaceId, path: $path) {
      directories {
        key
      }
      files {
        etag
        id
        key
        lock {
          expiresAt
          holder {
            displayName
            id
            type
          }
          path
        }
        mimeType
        size
        uploadedAt
        version
      }
    }
  }
`);

const CREATE_SPACE_DIRECTORY_MUTATION = graphql(/* GraphQL */ `
  mutation CreateSpaceDirectory($input: CreateSpaceDirectoryInput!) {
    createSpaceDirectory(input: $input) {
      key
    }
  }
`);

const DELETE_SPACE_ENTRY_MUTATION = graphql(/* GraphQL */ `
  mutation DeleteSpaceEntry($input: DeleteSpaceEntryInput!) {
    deleteSpaceEntry(input: $input) {
      ok
    }
  }
`);

export async function spaceFiles(
  appId: AppId,
  spaceId: SpaceId,
  path?: string,
): Promise<SpaceFileListing> {
  const payload = await requestGraphQL(SPACE_FILES_QUERY, {
    path: path ?? null,
    appId,
    spaceId,
  });

  return toSpaceFileListing(payload.spaceFiles);
}

export async function createFolder(
  appId: AppId,
  spaceId: SpaceId,
  name: string,
  path?: string,
): Promise<{ created: string }> {
  const payload = await requestGraphQL(CREATE_SPACE_DIRECTORY_MUTATION, {
    input: {
      name,
      path: path ?? null,
      appId,
      spaceId,
    },
  });

  return {
    created: payload.createSpaceDirectory.key,
  };
}

export async function deleteSpaceEntry(
  appId: AppId,
  spaceId: SpaceId,
  key: string,
): Promise<{ ok: true }> {
  await requestGraphQL(DELETE_SPACE_ENTRY_MUTATION, {
    input: {
      key,
      appId,
      spaceId,
    },
  });

  return { ok: true };
}
