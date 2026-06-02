import type { AgentBuilderToolPayload } from "@mosoo/contracts/agent-builder";

import type { AgentBuilderToolDefinition } from "../agent-builder-tool-runtime.service";
import type { AgentBuilderVisibleAssetSummaryCollections } from "../agent-builder-visible-assets.types";
import {
  collectSummariesForAgentBuilderAssetTool,
  flattenSearchableAgentBuilderAssets,
  normalizeAgentBuilderAssetType,
} from "./asset-tool-assets";
import type {
  AgentBuilderAssetToolContextOptions,
  SearchableAgentBuilderAsset,
  SearchableAgentBuilderAssetType,
} from "./asset-tool-assets";

type DetailAssetType = SearchableAgentBuilderAssetType;

interface DetailAssetSelection {
  readonly assetId: string;
  readonly assetType: DetailAssetType;
}

export type GetAgentBuilderAssetDetailOptions = AgentBuilderAssetToolContextOptions;

const DEFAULT_FILE_LIMIT = 20;
const MAX_FILE_LIMIT = 50;

function readAssetType(input: AgentBuilderToolPayload): DetailAssetType {
  const value = input["assetType"];

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("get_asset_detail requires assetType.");
  }

  return normalizeAgentBuilderAssetType({
    fieldName: "assetType",
    toolName: "get_asset_detail",
    value,
  });
}

function readRawAssetId(input: AgentBuilderToolPayload): string {
  const value = input["assetId"];

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("get_asset_detail requires assetId.");
  }

  return value.trim();
}

function readAssetSelection(input: AgentBuilderToolPayload): DetailAssetSelection {
  return {
    assetId: readRawAssetId(input),
    assetType: readAssetType(input),
  };
}

function readIncludeFiles(input: AgentBuilderToolPayload): boolean {
  const value = input["includeFiles"];

  if (value === undefined || value === null) {
    return false;
  }

  if (typeof value !== "boolean") {
    throw new Error("get_asset_detail includeFiles must be a boolean.");
  }

  return value;
}

function readFileLimit(input: AgentBuilderToolPayload): number {
  const value = input["fileLimit"];

  if (value === undefined || value === null) {
    return DEFAULT_FILE_LIMIT;
  }

  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error("get_asset_detail fileLimit must be an integer.");
  }

  return Math.min(Math.max(value, 1), MAX_FILE_LIMIT);
}

function readPathRequested(input: AgentBuilderToolPayload): boolean {
  const value = input["path"];

  if (value === undefined || value === null) {
    return false;
  }

  if (typeof value !== "string") {
    throw new Error("get_asset_detail path must be a string.");
  }

  return value.trim().length > 0;
}

function copyPayload(value: AgentBuilderToolPayload): AgentBuilderToolPayload {
  return { ...value };
}

function findVisibleAsset(input: {
  assetId: string;
  assetType: DetailAssetType;
  assets: readonly SearchableAgentBuilderAsset[];
}): SearchableAgentBuilderAsset {
  const asset = input.assets.find(
    (candidate) => candidate.assetType === input.assetType && candidate.id === input.assetId,
  );

  if (asset === undefined) {
    throw new Error(
      `get_asset_detail cannot read ${input.assetType} ${input.assetId}: asset is not in the visible asset index.`,
    );
  }

  return asset;
}

function projectSelectedSpaceFiles(input: {
  assetId: string;
  fileLimit: number;
  summaries: AgentBuilderVisibleAssetSummaryCollections;
}): AgentBuilderToolPayload | null {
  const summary = input.summaries.selectedSpaceFiles.find((asset) => asset.id === input.assetId);

  if (summary === undefined) {
    return null;
  }

  return {
    directories: summary.directories.map((key) => ({ key })).slice(0, input.fileLimit),
    directoryCount: summary.directoryCount,
    fileCount: summary.fileCount,
    files: summary.files
      .map((file) => ({
        key: file.key,
        mimeType: file.mimeType,
        size: file.size,
      }))
      .slice(0, input.fileLimit),
    listingState: summary.listingState,
    unavailableReason: summary.unavailableReason,
  };
}

function detailWarnings(input: {
  asset: SearchableAgentBuilderAsset;
  files: AgentBuilderToolPayload | null;
  includeFiles: boolean;
  pathRequested: boolean;
}): string[] {
  const warnings: string[] = [];
  const authorizationState = input.asset.fields["authorizationState"];

  if (
    input.asset.assetType === "mcp_server" &&
    authorizationState !== "active" &&
    authorizationState !== "authorized"
  ) {
    warnings.push("MCP authorization is not active.");
  }

  if (input.asset.assetType === "channel") {
    warnings.push("Channel assets are not available in Agent Builder yet.");
  }

  if (input.includeFiles && input.asset.assetType !== "space") {
    warnings.push("File summaries are only available for Space assets.");
  }

  if (input.includeFiles && input.asset.assetType === "space" && input.files === null) {
    warnings.push(
      "Space file summaries are only available for Spaces bound in the current Agent Draft.",
    );
  }

  if (input.pathRequested) {
    warnings.push("Space file detail is limited to visible summaries from the current context.");
  }

  return warnings;
}

async function getAgentBuilderAssetDetail(
  options: GetAgentBuilderAssetDetailOptions,
  input: AgentBuilderToolPayload,
): Promise<AgentBuilderToolPayload> {
  const selection = readAssetSelection(input);
  const includeFiles = readIncludeFiles(input);
  const fileLimit = readFileLimit(input);
  const pathRequested = readPathRequested(input);
  const summaries = await collectSummariesForAgentBuilderAssetTool(options);
  const asset = findVisibleAsset({
    assetId: selection.assetId,
    assetType: selection.assetType,
    assets: flattenSearchableAgentBuilderAssets(summaries),
  });
  const files =
    includeFiles && asset.assetType === "space"
      ? projectSelectedSpaceFiles({
          assetId: asset.id,
          fileLimit,
          summaries,
        })
      : null;
  const detail = copyPayload(asset.fields);

  if (asset.assetType === "space") {
    detail["files"] = includeFiles ? files : null;
  }

  return {
    assetId: asset.id,
    assetType: asset.assetType,
    bindingState: asset.bindingState,
    detail,
    name: asset.name,
    warnings: detailWarnings({ asset, files, includeFiles, pathRequested }),
  };
}

export function createGetAssetDetailTool(
  options: GetAgentBuilderAssetDetailOptions,
): AgentBuilderToolDefinition {
  return {
    execute(input) {
      return getAgentBuilderAssetDetail(options, input);
    },
    toolId: "get_asset_detail",
  };
}
