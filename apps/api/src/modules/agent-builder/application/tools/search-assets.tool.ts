import type {
  AgentBuilderToolPayload,
  AgentBuilderVisibleAssetBindingState,
} from "@mosoo/contracts/agent-builder";

import type { AgentBuilderToolDefinition } from "../agent-builder-tool-runtime.service";
import {
  AGENT_BUILDER_ASSET_BINDING_STATES,
  SEARCHABLE_AGENT_BUILDER_ASSET_TYPES,
  collectSummariesForAgentBuilderAssetTool,
  compareSearchableAgentBuilderAssets,
  flattenSearchableAgentBuilderAssets,
  isAgentBuilderAssetBindingState,
  normalizeAgentBuilderAssetType,
  normalizeAgentBuilderSearchText,
  scoreSearchableAgentBuilderAsset,
  toAgentBuilderToolAsset,
} from "./asset-tool-assets";
import type {
  AgentBuilderAssetToolContextOptions,
  SearchableAgentBuilderAssetType,
} from "./asset-tool-assets";

export interface SearchAgentBuilderAssetsOptions extends AgentBuilderAssetToolContextOptions {}

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

function readStringList(value: unknown, fieldName: string): string[] | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length === 0 ? [] : [trimmed];
  }

  if (!Array.isArray(value)) {
    throw new Error(`search_assets ${fieldName} must be a string or array of strings.`);
  }

  return value.flatMap((entry, index) => {
    if (typeof entry !== "string") {
      throw new Error(`search_assets ${fieldName}.${index} must be a string.`);
    }

    const trimmed = entry.trim();
    return trimmed.length === 0 ? [] : [trimmed];
  });
}

function readAssetTypeFilter(input: AgentBuilderToolPayload): Set<SearchableAgentBuilderAssetType> {
  const values = readStringList(input["assetTypes"], "assetTypes");

  if (values === null || values.length === 0) {
    return new Set(SEARCHABLE_AGENT_BUILDER_ASSET_TYPES);
  }

  return new Set(
    values.map((value) =>
      normalizeAgentBuilderAssetType({
        createUnsupportedMessage: (unsupportedValue) =>
          `search_assets assetTypes contains unsupported asset type: ${unsupportedValue}.`,
        fieldName: "assetTypes contains unsupported asset type",
        toolName: "search_assets",
        value,
      }),
    ),
  );
}

function readBindingStateFilter(
  input: AgentBuilderToolPayload,
): Set<AgentBuilderVisibleAssetBindingState> {
  const values = readStringList(input["bindingState"], "bindingState");

  if (values === null || values.length === 0) {
    return new Set(AGENT_BUILDER_ASSET_BINDING_STATES);
  }

  return new Set(
    values.map((value) => {
      if (isAgentBuilderAssetBindingState(value)) {
        return value;
      }

      throw new Error(`search_assets bindingState contains unsupported value: ${value}.`);
    }),
  );
}

function readQuery(input: AgentBuilderToolPayload): string {
  const value = input["query"];

  if (value === undefined || value === null) {
    return "";
  }

  if (typeof value !== "string") {
    throw new Error("search_assets query must be a string.");
  }

  return normalizeAgentBuilderSearchText(value);
}

function readLimit(input: AgentBuilderToolPayload): number {
  const value = input["limit"];

  if (value === undefined || value === null) {
    return DEFAULT_LIMIT;
  }

  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error("search_assets limit must be an integer.");
  }

  return Math.min(Math.max(value, 1), MAX_LIMIT);
}

function readOffset(input: AgentBuilderToolPayload): number {
  const value = input["cursor"];

  if (value === undefined || value === null || value === "") {
    return 0;
  }

  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return value;
  }

  if (typeof value === "string") {
    const cursor = value.trim();

    if (cursor.length === 0) {
      return 0;
    }

    if (!/^\d+$/u.test(cursor)) {
      throw new Error("search_assets cursor must be a non-negative offset.");
    }

    const offset = Number(cursor);

    if (Number.isSafeInteger(offset)) {
      return offset;
    }
  }

  throw new Error("search_assets cursor must be a non-negative offset.");
}

async function searchAgentBuilderAssets(
  options: SearchAgentBuilderAssetsOptions,
  input: AgentBuilderToolPayload,
): Promise<AgentBuilderToolPayload> {
  const assetTypes = readAssetTypeFilter(input);
  const bindingStates = readBindingStateFilter(input);
  const limit = readLimit(input);
  const offset = readOffset(input);
  const query = readQuery(input);
  const summaries = await collectSummariesForAgentBuilderAssetTool(options);
  const matches = flattenSearchableAgentBuilderAssets(summaries)
    .filter((asset) => assetTypes.has(asset.assetType))
    .filter((asset) => bindingStates.has(asset.bindingState))
    .map((asset) => ({
      asset,
      score: scoreSearchableAgentBuilderAsset(asset, query),
    }))
    .filter((match) => match.score > 0)
    .toSorted((left, right) => {
      const scoreOrder = right.score - left.score;
      return scoreOrder === 0
        ? compareSearchableAgentBuilderAssets(left.asset, right.asset)
        : scoreOrder;
    });
  const page = matches
    .slice(offset, offset + limit)
    .map((match) => toAgentBuilderToolAsset(match.asset));
  const nextOffset = offset + page.length;
  const hasMore = nextOffset < matches.length;

  return {
    assetTypes: [...assetTypes].toSorted(),
    assets: page,
    bindingStates: [...bindingStates].toSorted(),
    count: page.length,
    hasMore,
    limit,
    nextCursor: hasMore ? String(nextOffset) : null,
    query,
    totalMatched: matches.length,
  };
}

export function createSearchAssetsTool(
  options: SearchAgentBuilderAssetsOptions,
): AgentBuilderToolDefinition {
  return {
    execute(input) {
      return searchAgentBuilderAssets(options, input);
    },
    toolId: "search_assets",
  };
}
