import type { SpaceFileListing } from "@mosoo/contracts/space";
import { useQuery } from "@tanstack/react-query";
import type { QueryClient, UseQueryResult } from "@tanstack/react-query";

import { toAppId, toSpaceId } from "@/routes/typed-id";

import { spaceFiles } from "../api/files";

type SpaceFilesQueryResult = UseQueryResult<SpaceFileListing>;

const spaceFileKeys = {
  all: ["space-files"] as const,
  listing: (appId: string, spaceId: string, path: string) =>
    [...spaceFileKeys.listings(), appId, spaceId, path] as const,
  listings: () => [...spaceFileKeys.all, "listing"] as const,
  missing: () => [...spaceFileKeys.listings(), "missing"] as const,
};

function listingPath(path: string): string {
  return path;
}

async function fetchSpaceFiles(
  appId: string,
  spaceId: string,
  path: string,
): Promise<SpaceFileListing> {
  return spaceFiles(toAppId(appId), toSpaceId(spaceId), path.length > 0 ? path : undefined);
}

function requireId(id: string | null, label: string): string {
  if (id === null || id.length === 0) {
    throw new Error(`${label} is required.`);
  }

  return id;
}

export function useSpaceFilesQuery(
  appId: string | null,
  spaceId: string | null,
  path: string,
): SpaceFilesQueryResult {
  return useQuery({
    enabled: appId !== null && spaceId !== null,
    queryFn: async () =>
      fetchSpaceFiles(
        requireId(appId, "App id"),
        requireId(spaceId, "Space id"),
        listingPath(path),
      ),
    queryKey:
      appId !== null && appId.length > 0 && spaceId !== null && spaceId.length > 0
        ? spaceFileKeys.listing(appId, spaceId, listingPath(path))
        : spaceFileKeys.missing(),
  });
}

export async function refreshSpaceFiles(
  queryClient: QueryClient,
  appId: string,
  spaceId: string,
  path: string,
): Promise<SpaceFileListing> {
  const normalizedPath = listingPath(path);
  const queryKey = spaceFileKeys.listing(appId, spaceId, normalizedPath);

  await queryClient.invalidateQueries({ queryKey });
  return queryClient.fetchQuery({
    queryFn: async () => fetchSpaceFiles(appId, spaceId, normalizedPath),
    queryKey,
  });
}
