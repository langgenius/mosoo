import type { SpaceFileListing } from "@mosoo/contracts/space";
import { useQuery } from "@tanstack/react-query";
import type { QueryClient, UseQueryResult } from "@tanstack/react-query";

import { toSpaceId } from "@/routes/typed-id";

import { spaceFiles } from "../api/files";

type SpaceFilesQueryResult = UseQueryResult<SpaceFileListing>;

const spaceFileKeys = {
  all: ["space-files"] as const,
  listing: (spaceId: string, path: string) => [...spaceFileKeys.listings(), spaceId, path] as const,
  listings: () => [...spaceFileKeys.all, "listing"] as const,
  missing: () => [...spaceFileKeys.listings(), "missing"] as const,
};

function listingPath(path: string): string {
  return path;
}

async function fetchSpaceFiles(spaceId: string, path: string): Promise<SpaceFileListing> {
  return spaceFiles(toSpaceId(spaceId), path.length > 0 ? path : undefined);
}

function requireSpaceId(spaceId: string | null): string {
  if (spaceId === null || spaceId.length === 0) {
    throw new Error("Space id is required.");
  }

  return spaceId;
}

export function useSpaceFilesQuery(spaceId: string | null, path: string): SpaceFilesQueryResult {
  return useQuery({
    enabled: spaceId !== null,
    queryFn: async () => fetchSpaceFiles(requireSpaceId(spaceId), listingPath(path)),
    queryKey:
      spaceId !== null && spaceId.length > 0
        ? spaceFileKeys.listing(spaceId, listingPath(path))
        : spaceFileKeys.missing(),
  });
}

export async function refreshSpaceFiles(
  queryClient: QueryClient,
  spaceId: string,
  path: string,
): Promise<SpaceFileListing> {
  const normalizedPath = listingPath(path);
  const queryKey = spaceFileKeys.listing(spaceId, normalizedPath);

  await queryClient.invalidateQueries({ queryKey });
  return queryClient.fetchQuery({
    queryFn: async () => fetchSpaceFiles(spaceId, normalizedPath),
    queryKey,
  });
}
