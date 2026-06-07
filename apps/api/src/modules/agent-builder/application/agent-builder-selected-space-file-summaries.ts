import type { AgentBuilderSelectedSpaceFilesSummary } from "@mosoo/contracts/agent-builder";
import type { SpaceId } from "@mosoo/id";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { getSpaceRootFileSummaries } from "../../spaces/application/space-file.service";
import {
  compareByNameThenId,
  normalizeUnique,
  withHash,
} from "./agent-builder-visible-asset-model";
import type { DraftSpaceBinding } from "./agent-builder-visible-assets.types";

const SPACE_FILE_ENTRY_LIMIT = 20;
const SELECTED_SPACE_NOT_VISIBLE_REASON = "Selected Space is not visible to the current viewer.";
const SELECTED_SPACE_FILES_UNAVAILABLE_REASON = "Selected Space files could not be listed.";

type VisibleSpaceIdentity = {
  id: SpaceId;
};
export interface AgentBuilderSelectedSpaceFileListing {
  directories: readonly {
    key: string;
  }[];
  files: readonly {
    key: string;
    mimeType: string | null;
    size: number;
  }[];
}

type SelectedSpaceFilesLister = (
  spaceIds: readonly SpaceId[],
) => Promise<ReadonlyMap<SpaceId, AgentBuilderSelectedSpaceFileListing>>;

function createUnavailableSelectedSpaceFileSummary(
  space: DraftSpaceBinding,
  unavailableReason: string,
): AgentBuilderSelectedSpaceFilesSummary {
  return withHash({
    bindingState: "bound" as const,
    directories: [],
    directoryCount: 0,
    files: [],
    fileCount: 0,
    id: space.id,
    listingState: "unavailable" as const,
    name: space.name,
    unavailableReason,
  });
}

export async function createAgentBuilderSelectedSpaceFileSummaries(input: {
  draftSpaces: readonly DraftSpaceBinding[];
  listSpaceFiles: SelectedSpaceFilesLister;
  visibleSpaces: readonly VisibleSpaceIdentity[];
}): Promise<AgentBuilderSelectedSpaceFilesSummary[]> {
  const visibleSpaceIds = new Set(input.visibleSpaces.map((space) => space.id));
  const selectedVisibleSpaceIds = normalizeUnique(
    input.draftSpaces.map((space) => space.id),
  ).filter((spaceId) => visibleSpaceIds.has(spaceId));
  const listingsBySpaceId =
    selectedVisibleSpaceIds.length === 0
      ? new Map<SpaceId, AgentBuilderSelectedSpaceFileListing>()
      : await input.listSpaceFiles(selectedVisibleSpaceIds);

  return input.draftSpaces
    .map((space) => {
      if (!visibleSpaceIds.has(space.id)) {
        return createUnavailableSelectedSpaceFileSummary(space, SELECTED_SPACE_NOT_VISIBLE_REASON);
      }

      const listing = listingsBySpaceId.get(space.id);
      if (listing === undefined) {
        return createUnavailableSelectedSpaceFileSummary(
          space,
          SELECTED_SPACE_FILES_UNAVAILABLE_REASON,
        );
      }

      const directories = listing.directories.map((directory) => directory.key).toSorted();
      const files = listing.files
        .map((file) => ({
          key: file.key,
          mimeType: file.mimeType,
          size: file.size,
        }))
        .toSorted((left, right) => left.key.localeCompare(right.key));

      return withHash({
        bindingState: "bound" as const,
        directories: directories.slice(0, SPACE_FILE_ENTRY_LIMIT),
        directoryCount: directories.length,
        files: files.slice(0, SPACE_FILE_ENTRY_LIMIT),
        fileCount: files.length,
        id: space.id,
        listingState: "available" as const,
        name: space.name,
        unavailableReason: null,
      });
    })
    .toSorted((left, right) => compareByNameThenId(left, right));
}

export async function collectAgentBuilderSelectedSpaceFileSummaries(input: {
  bindings: ApiBindings;
  draftSpaces: readonly DraftSpaceBinding[];
  viewer: AuthenticatedViewer;
  visibleSpaces: readonly VisibleSpaceIdentity[];
}): Promise<AgentBuilderSelectedSpaceFilesSummary[]> {
  return createAgentBuilderSelectedSpaceFileSummaries({
    draftSpaces: input.draftSpaces,
    listSpaceFiles: (spaceIds) => getSpaceRootFileSummaries(input.bindings, input.viewer, spaceIds),
    visibleSpaces: input.visibleSpaces,
  });
}
