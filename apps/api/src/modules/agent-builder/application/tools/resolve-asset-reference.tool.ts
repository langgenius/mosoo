import type {
  AgentBuilderPlannerContext,
  AgentBuilderToolPayload,
} from "@mosoo/contracts/agent-builder";

import type { AgentBuilderToolDefinition } from "../agent-builder-tool-runtime.service";
import {
  collectSummariesForAgentBuilderAssetTool,
  flattenSearchableAgentBuilderAssets,
} from "./asset-tool-assets";
import type { AgentBuilderAssetToolContextOptions } from "./asset-tool-assets";
import {
  createResolveOutput,
  findAlreadyBoundExactMatch,
  findAlreadyBoundSingleTextMatch,
  findReferenceMatches,
  normalizeSingleTextMatch,
  resolveExactId,
  toReferenceCandidates,
} from "./resolve-asset-reference-matches";
import type { ScoredAssetMatch } from "./resolve-asset-reference-matches";
import {
  readResolveAssetReferenceQuery,
  resolveReferenceTextVariants,
} from "./resolve-asset-reference-query";
import type { ResolveAssetReferenceQuery } from "./resolve-asset-reference-query";

export interface ResolveAgentBuilderAssetReferenceOptions extends AgentBuilderAssetToolContextOptions {
  context?: AgentBuilderPlannerContext;
}

async function resolveAgentBuilderAssetReference(
  options: ResolveAgentBuilderAssetReferenceOptions,
  input: AgentBuilderToolPayload,
): Promise<AgentBuilderToolPayload> {
  const query = readResolveAssetReferenceQuery(input);
  const summaries = await collectSummariesForAgentBuilderAssetTool(options);
  const allAssets = flattenSearchableAgentBuilderAssets(summaries).filter(
    (asset) => asset.assetType === query.assetType,
  );
  const assets = allAssets.filter((asset) => query.bindingStates.has(asset.bindingState));

  if (query.assetId !== null) {
    const alreadyBoundMatch = findAlreadyBoundExactMatch({
      allAssets,
      bindingStates: query.bindingStates,
      referenceTexts: [query.assetId],
    });

    if (alreadyBoundMatch !== null) {
      return createAlreadyBoundOutput(query, alreadyBoundMatch);
    }

    return resolveExactId({
      assetId: query.assetId,
      assetType: query.assetType,
      assets,
      reference: query.reference,
    });
  }

  if (query.referenceText === null) {
    throw new Error("resolve_asset_reference requires assetId, name, query, or reference.");
  }

  const referenceTexts = resolveReferenceTextVariants({
    assetType: query.assetType,
    assets,
    context: options.context,
    referenceTexts: query.referenceTexts,
  });
  const alreadyBoundMatch = findAlreadyBoundExactMatch({
    allAssets,
    bindingStates: query.bindingStates,
    referenceTexts,
  });

  if (alreadyBoundMatch !== null) {
    return createAlreadyBoundOutput(query, alreadyBoundMatch);
  }

  const matches = findReferenceMatches({
    assets,
    limit: query.limit,
    referenceTexts,
  });

  if (matches.length === 0) {
    const alreadyBoundTextMatch = findAlreadyBoundSingleTextMatch({
      allAssets,
      bindingStates: query.bindingStates,
      referenceTexts,
    });

    if (alreadyBoundTextMatch !== null) {
      return createAlreadyBoundOutput(query, alreadyBoundTextMatch);
    }

    return createResolveOutput({
      assetType: query.assetType,
      candidates: [],
      reason: `No ${query.assetType} asset matched ${query.referenceText}.`,
      reference: query.reference,
      status: "missing",
    });
  }

  if (matches.length === 1) {
    const onlyMatch = matches[0];

    if (onlyMatch === undefined) {
      throw new Error("resolve_asset_reference produced an invalid empty match set.");
    }

    const resolvedMatch = normalizeSingleTextMatch(onlyMatch);

    return createResolveOutput({
      assetType: query.assetType,
      candidates: [],
      reason: `Resolved ${query.assetType} by ${resolvedMatch.matchType}.`,
      reference: query.reference,
      resolvedMatch,
      status: "resolved",
    });
  }

  return createResolveOutput({
    assetType: query.assetType,
    candidates: toReferenceCandidates(matches),
    reason: `${matches.length} ${query.assetType} assets matched ${query.referenceText}.`,
    reference: query.reference,
    status: "ambiguous",
  });
}

function createAlreadyBoundOutput(
  query: ResolveAssetReferenceQuery,
  resolvedMatch: ScoredAssetMatch,
): AgentBuilderToolPayload {
  return createResolveOutput({
    alreadyBound: true,
    assetType: query.assetType,
    candidates: [],
    nextAction: "no_op",
    reason: `The requested ${query.assetType} is already bound to this Agent Draft.`,
    reference: query.reference,
    resolvedMatch,
    status: "resolved",
  });
}

export function createResolveAssetReferenceTool(
  options: ResolveAgentBuilderAssetReferenceOptions,
): AgentBuilderToolDefinition {
  return {
    execute(input) {
      return resolveAgentBuilderAssetReference(options, input);
    },
    toolId: "resolve_asset_reference",
  };
}
