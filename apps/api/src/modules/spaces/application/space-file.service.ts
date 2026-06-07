import { getParentPath, joinPath } from "@mosoo/contracts/file";
import type {
  CreateSpaceDirectoryInput,
  DirectoryEntry,
  SpaceFileListing,
} from "@mosoo/contracts/space";
import { spaceDirectoriesTable } from "@mosoo/db";
import type { SpaceDirectoryId } from "@mosoo/db";
import { createPlatformId, parsePlatformId } from "@mosoo/id";
import type { AccountId, SpaceId } from "@mosoo/id";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../time";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import {
  normalizeFileName,
  normalizeSpaceDirectoryPath,
} from "../../files/application/file-path.service";
import {
  deleteSpaceEntry as deleteStoredSpaceEntry,
  listSpaceFiles,
  listSpaceRootFileSummaries,
} from "../../files/application/space-file-store.service";
import type { SpaceRootFileSummaryListing } from "../../files/application/space-file-store.service";
import { ensureParentDirectories, ensureSpaceAccess } from "../domain/space-access.policy";

export async function getSpaceFiles(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  spaceId: SpaceId,
  path?: string,
): Promise<SpaceFileListing> {
  return listSpaceFiles(bindings, viewer, spaceId, path);
}

export async function getSpaceRootFileSummaries(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  spaceIds: readonly SpaceId[],
): Promise<Map<SpaceId, SpaceRootFileSummaryListing>> {
  return listSpaceRootFileSummaries(bindings, viewer, spaceIds);
}

export async function createSpaceDirectory(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: CreateSpaceDirectoryInput,
): Promise<DirectoryEntry> {
  const viewerId: AccountId = parsePlatformId(viewer.id, "viewer ID");
  await ensureSpaceAccess(database, viewerId, input.spaceId, "edit");

  const path = joinPath(normalizeSpaceDirectoryPath(input.path), normalizeFileName(input.name));
  const parentPath = getParentPath(path);
  const timestampMs = currentTimestampMs();

  await ensureParentDirectories(database, viewerId, input.spaceId, parentPath);

  await getAppDatabase(database)
    .insert(spaceDirectoriesTable)
    .values({
      createdAt: timestampMs,
      createdByAccountId: viewerId,
      id: createPlatformId<SpaceDirectoryId>(),
      name: path.split("/").pop() ?? path,
      parentPath,
      path,
      spaceId: input.spaceId,
      updatedAt: timestampMs,
    })
    .onConflictDoNothing({ target: [spaceDirectoriesTable.spaceId, spaceDirectoriesTable.path] })
    .run();

  return {
    key: `${path}/`,
  };
}

export async function deleteSpaceEntry(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: { key: string; spaceId: SpaceId },
): Promise<void> {
  await deleteStoredSpaceEntry(bindings, viewer, input);
}
