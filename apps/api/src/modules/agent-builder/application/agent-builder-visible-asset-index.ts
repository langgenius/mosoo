import type {
  AgentBuilderPlannerDraftBindingsContext,
  AgentBuilderRemovedVisibleAsset,
  AgentBuilderVisibleAssetIndexEntry,
  AgentBuilderVisibleAssetsContext,
} from "@mosoo/contracts/agent-builder";

import { isRecord, readString } from "./agent-builder-draft-parser";
import {
  parseChannelBindingIdList,
  parseMcpServerIdList,
  parseNullableEnvironmentId,
  parseSkillIdList,
  parseSpaceIdList,
} from "./agent-builder-ids";
import type {
  AgentBuilderVisibleAssetSummaryCollections,
  HashableAssetSummary,
  VisibleAssetChangeSet,
  VisibleAssetChangesSinceLastTurn,
  VisibleAssetCurrentIndex,
  VisibleAssetIndexEntry,
  VisibleAssetKindByCollection,
} from "./agent-builder-visible-assets.types";

const VISIBLE_ASSET_KIND_BY_COLLECTION = {
  channels: "channel",
  environments: "environment",
  mcpServers: "mcp_server",
  selectedSpaceFiles: "selected_space_files",
  skills: "skill",
  spaces: "space",
} satisfies VisibleAssetKindByCollection;

function emptyDraftBindings(): AgentBuilderPlannerDraftBindingsContext {
  return {
    channelIds: [],
    environmentId: null,
    mcpServerIds: [],
    parseError: null,
    parseStatus: "parsed",
    skillIds: [],
    spaceIds: [],
  };
}

function readNullableString(value: unknown): string | null {
  return value === null || typeof value === "string" ? value : null;
}

function readStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === "string").toSorted();
}

function readDraftBindings(value: unknown): AgentBuilderPlannerDraftBindingsContext {
  if (!isRecord(value)) {
    return emptyDraftBindings();
  }

  const parseStatus = value["parseStatus"] === "failed" ? "failed" : "parsed";

  return {
    channelIds: parseChannelBindingIdList(readStringList(value["channelIds"]), "channelIds"),
    environmentId: parseNullableEnvironmentId(
      readNullableString(value["environmentId"]),
      "environmentId",
    ),
    mcpServerIds: parseMcpServerIdList(readStringList(value["mcpServerIds"]), "mcpServerIds"),
    parseError: readNullableString(value["parseError"]),
    parseStatus,
    skillIds: parseSkillIdList(readStringList(value["skillIds"]), "skillIds"),
    spaceIds: parseSpaceIdList(readStringList(value["spaceIds"]), "spaceIds"),
  };
}

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
    channels: [],
    environments: [],
    mcpServers: [],
    selectedSpaceFiles: [],
    skills: [],
    spaces: [],
  };
}

function readIndexEntries(
  value: unknown,
  kind: AgentBuilderVisibleAssetIndexEntry["kind"],
): VisibleAssetIndexEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry): AgentBuilderVisibleAssetIndexEntry[] => {
    if (!isRecord(entry)) {
      return [];
    }

    const bindingState = entry["bindingState"];
    const hash = readString(entry["hash"]);
    const id = readString(entry["id"]);
    const name = readString(entry["name"]);

    if (
      hash === null ||
      id === null ||
      name === null ||
      (bindingState !== "bound" &&
        bindingState !== "not_bound" &&
        bindingState !== "not_represented")
    ) {
      return [];
    }

    return [
      {
        bindingState,
        hash,
        id,
        kind,
        name,
      },
    ];
  });
}

function readVisibleAssetCurrentIndex(value: Record<string, unknown>): VisibleAssetCurrentIndex {
  return {
    channels: readIndexEntries(value["channels"], "channel"),
    environments: readIndexEntries(value["environments"], "environment"),
    mcpServers: readIndexEntries(value["mcpServers"], "mcp_server"),
    selectedSpaceFiles: readIndexEntries(value["selectedSpaceFiles"], "selected_space_files"),
    skills: readIndexEntries(value["skills"], "skill"),
    spaces: readIndexEntries(value["spaces"], "space"),
  };
}

export function readVisibleAssetsFromPlannerContextJson(
  contextJson: string | null,
): AgentBuilderVisibleAssetsContext | null {
  if (contextJson === null) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(contextJson);
    const root = isRecord(parsed) ? parsed : {};
    const assets = isRecord(root["assets"]) ? root["assets"] : {};
    const currentIndex = isRecord(assets["currentIndex"]) ? assets["currentIndex"] : {};

    return {
      changesSinceLastTurn: emptyVisibleAssetChanges(),
      currentIndex: readVisibleAssetCurrentIndex(currentIndex),
      draftBindings: readDraftBindings(assets["draftBindings"]),
      observedAt: readString(assets["observedAt"]) ?? "",
      snapshotHash: readString(assets["snapshotHash"]) ?? "",
    };
  } catch {
    return null;
  }
}

export function createVisibleAssetCurrentIndex(
  summaries: AgentBuilderVisibleAssetSummaryCollections,
): VisibleAssetCurrentIndex {
  return {
    channels: summaries.channels.map((asset) =>
      toIndexEntry(VISIBLE_ASSET_KIND_BY_COLLECTION.channels, asset),
    ),
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
    channels: { added: [], removed: [], updated: [] },
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
    channels: diffAssets(summaries.channels, previousIndex.channels),
    environments: diffAssets(summaries.environments, previousIndex.environments),
    mcpServers: diffAssets(summaries.mcpServers, previousIndex.mcpServers),
    selectedSpaceFiles: diffAssets(summaries.selectedSpaceFiles, previousIndex.selectedSpaceFiles),
    skills: diffAssets(summaries.skills, previousIndex.skills),
    spaces: diffAssets(summaries.spaces, previousIndex.spaces),
  };
}
