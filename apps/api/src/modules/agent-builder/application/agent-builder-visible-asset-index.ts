import type {
  AgentBuilderRemovedVisibleAsset,
  AgentBuilderVisibleAssetIndexEntry,
} from "@mosoo/contracts/agent-builder";

import type {
  AgentBuilderVisibleAssetSummaryCollections,
  HashableAssetSummary,
  VisibleAssetChangeSet,
  VisibleAssetChangesSinceLastTurn,
  VisibleAssetCurrentIndex,
  VisibleAssetKindByCollection,
} from "./agent-builder-visible-assets.types";

const VISIBLE_ASSET_KIND_BY_COLLECTION = {
  environments: "environment",
  mcpServers: "mcp_server",
  selectedSpaceFiles: "selected_space_files",
  skills: "skill",
  spaces: "space",
} satisfies VisibleAssetKindByCollection;

function toIndexEntry(
  kind: AgentBuilderVisibleAssetIndexEntry["kind"],
  asset: HashableAssetSummary,
): AgentBuilderVisibleAssetIndexEntry {
  return {
    bindingState: asset.bindingState,
    hash: asset.hash,
    id: asset.id,
    kind,
    name: asset.name,
  };
}

function toRemovedAsset(
  entry: AgentBuilderVisibleAssetIndexEntry,
): AgentBuilderRemovedVisibleAsset {
  return {
    bindingState: entry.bindingState,
    hash: entry.hash,
    id: entry.id,
    kind: entry.kind,
    name: entry.name,
  };
}

function diffAssets<TAsset extends HashableAssetSummary>(
  current: TAsset[],
  previous: AgentBuilderVisibleAssetIndexEntry[],
): VisibleAssetChangeSet<TAsset> {
  const previousById = new Map(previous.map((entry) => [entry.id, entry]));
  const currentIds = new Set(current.map((asset) => asset.id));
  const added: TAsset[] = [];
  const updated: TAsset[] = [];
  const removed: AgentBuilderRemovedVisibleAsset[] = [];

  for (const asset of current) {
    const previousEntry = previousById.get(asset.id);

    if (previousEntry === undefined) {
      added.push(asset);
      continue;
    }

    if (previousEntry.hash !== asset.hash || previousEntry.bindingState !== asset.bindingState) {
      updated.push(asset);
    }
  }

  for (const entry of previous) {
    if (!currentIds.has(entry.id)) {
      removed.push(toRemovedAsset(entry));
    }
  }

  return { added, removed, updated };
}

export function emptyVisibleAssetIndex(): VisibleAssetCurrentIndex {
  return {
    environments: [],
    mcpServers: [],
    selectedSpaceFiles: [],
    skills: [],
    spaces: [],
  };
}

export function createVisibleAssetCurrentIndex(
  summaries: AgentBuilderVisibleAssetSummaryCollections,
): VisibleAssetCurrentIndex {
  return {
    environments: summaries.environments.map((asset) =>
      toIndexEntry(VISIBLE_ASSET_KIND_BY_COLLECTION.environments, asset),
    ),
    mcpServers: summaries.mcpServers.map((asset) =>
      toIndexEntry(VISIBLE_ASSET_KIND_BY_COLLECTION.mcpServers, asset),
    ),
    selectedSpaceFiles: summaries.selectedSpaceFiles.map((asset) =>
      toIndexEntry(VISIBLE_ASSET_KIND_BY_COLLECTION.selectedSpaceFiles, asset),
    ),
    skills: summaries.skills.map((asset) =>
      toIndexEntry(VISIBLE_ASSET_KIND_BY_COLLECTION.skills, asset),
    ),
    spaces: summaries.spaces.map((asset) =>
      toIndexEntry(VISIBLE_ASSET_KIND_BY_COLLECTION.spaces, asset),
    ),
  };
}

export function emptyVisibleAssetChanges(): VisibleAssetChangesSinceLastTurn {
  return {
    environments: { added: [], removed: [], updated: [] },
    mcpServers: { added: [], removed: [], updated: [] },
    selectedSpaceFiles: { added: [], removed: [], updated: [] },
    skills: { added: [], removed: [], updated: [] },
    spaces: { added: [], removed: [], updated: [] },
  };
}

export function createVisibleAssetChanges(
  summaries: AgentBuilderVisibleAssetSummaryCollections,
  previousIndex: VisibleAssetCurrentIndex,
): VisibleAssetChangesSinceLastTurn {
  return {
    environments: diffAssets(summaries.environments, previousIndex.environments),
    mcpServers: diffAssets(summaries.mcpServers, previousIndex.mcpServers),
    selectedSpaceFiles: diffAssets(summaries.selectedSpaceFiles, previousIndex.selectedSpaceFiles),
    skills: diffAssets(summaries.skills, previousIndex.skills),
    spaces: diffAssets(summaries.spaces, previousIndex.spaces),
  };
}
