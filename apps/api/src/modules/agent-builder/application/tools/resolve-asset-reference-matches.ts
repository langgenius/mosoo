import type {
  AgentBuilderToolPayload,
  AgentBuilderVisibleAssetBindingState,
} from "@mosoo/contracts/agent-builder";

import {
  compareSearchableAgentBuilderAssets,
  normalizeAgentBuilderSearchText,
  scoreSearchableAgentBuilderAsset,
  toAgentBuilderToolAsset,
} from "./asset-tool-assets";
import type {
  SearchableAgentBuilderAsset,
  SearchableAgentBuilderAssetType,
} from "./asset-tool-assets";

type ResolveStatus = "ambiguous" | "missing" | "resolved";
type ResolveMatchType = "exact_id" | "exact_name" | "single_candidate" | "text_candidate";
type ResolveNextAction = "ask_user" | "create_asset_or_block" | "no_op" | "use_resolved_id";

export interface ScoredAssetMatch {
  readonly asset: SearchableAgentBuilderAsset;
  readonly matchType: ResolveMatchType;
  readonly score: number;
}

function toReferenceAsset(
  match: Pick<ScoredAssetMatch, "asset" | "matchType" | "score">,
): AgentBuilderToolPayload {
  return {
    ...toAgentBuilderToolAsset(match.asset),
    matchType: match.matchType,
    score: match.score,
  };
}

function compareScoredMatches(left: ScoredAssetMatch, right: ScoredAssetMatch): number {
  const scoreOrder = right.score - left.score;
  return scoreOrder === 0
    ? compareSearchableAgentBuilderAssets(left.asset, right.asset)
    : scoreOrder;
}

export function resolveExactId(input: {
  assetId: string;
  assetType: SearchableAgentBuilderAssetType;
  assets: SearchableAgentBuilderAsset[];
  reference: AgentBuilderToolPayload;
}): AgentBuilderToolPayload {
  const exactMatch = input.assets.find((asset) => asset.id === input.assetId);

  if (exactMatch === undefined) {
    return createResolveOutput({
      assetType: input.assetType,
      candidates: [],
      reason: `No ${input.assetType} asset exists with id ${input.assetId}.`,
      reference: input.reference,
      status: "missing",
    });
  }

  return createResolveOutput({
    assetType: input.assetType,
    candidates: [],
    reason: `Resolved ${input.assetType} by exact id.`,
    reference: input.reference,
    resolvedMatch: {
      asset: exactMatch,
      matchType: "exact_id",
      score: 100,
    },
    status: "resolved",
  });
}

export function findAlreadyBoundExactMatch(input: {
  allAssets: SearchableAgentBuilderAsset[];
  bindingStates: ReadonlySet<AgentBuilderVisibleAssetBindingState>;
  referenceTexts: readonly string[];
}): ScoredAssetMatch | null {
  if (input.bindingStates.has("bound") || input.referenceTexts.length === 0) {
    return null;
  }

  const referenceTextSet = new Set(input.referenceTexts);
  const exactIdMatch = input.allAssets.find(
    (asset) => asset.bindingState === "bound" && referenceTextSet.has(asset.id),
  );

  if (exactIdMatch !== undefined) {
    return {
      asset: exactIdMatch,
      matchType: "exact_id",
      score: 100,
    };
  }

  const normalizedReferences = new Set(
    input.referenceTexts.map((referenceText) => normalizeAgentBuilderSearchText(referenceText)),
  );
  const exactNameMatch = input.allAssets
    .filter(
      (asset) =>
        asset.bindingState === "bound" &&
        normalizedReferences.has(normalizeAgentBuilderSearchText(asset.name)),
    )
    .toSorted(compareSearchableAgentBuilderAssets)[0];

  if (exactNameMatch === undefined) {
    return null;
  }

  return {
    asset: exactNameMatch,
    matchType: "exact_name",
    score: 100,
  };
}

export function normalizeSingleTextMatch(match: ScoredAssetMatch): ScoredAssetMatch {
  return match.matchType === "text_candidate"
    ? {
        asset: match.asset,
        matchType: "single_candidate",
        score: match.score,
      }
    : match;
}

export function findAlreadyBoundSingleTextMatch(input: {
  allAssets: SearchableAgentBuilderAsset[];
  bindingStates: ReadonlySet<AgentBuilderVisibleAssetBindingState>;
  referenceTexts: readonly string[];
}): ScoredAssetMatch | null {
  if (input.bindingStates.has("bound") || input.referenceTexts.length === 0) {
    return null;
  }

  const boundMatches = findReferenceMatches({
    assets: input.allAssets.filter((asset) => asset.bindingState === "bound"),
    limit: 2,
    referenceTexts: input.referenceTexts,
  });

  if (boundMatches.length !== 1) {
    return null;
  }

  const boundMatch = boundMatches[0];

  return boundMatch === undefined ? null : normalizeSingleTextMatch(boundMatch);
}

export function createResolveOutput(input: {
  alreadyBound?: boolean;
  assetType: SearchableAgentBuilderAssetType;
  candidates: readonly AgentBuilderToolPayload[];
  nextAction?: ResolveNextAction;
  reason: string;
  reference: AgentBuilderToolPayload;
  resolvedMatch?: ScoredAssetMatch;
  status: ResolveStatus;
}): AgentBuilderToolPayload {
  const nextActionByStatus: Record<ResolveStatus, ResolveNextAction> = {
    ambiguous: "ask_user",
    missing: "create_asset_or_block",
    resolved: "use_resolved_id",
  };

  return {
    assetType: input.assetType,
    ...(input.alreadyBound === undefined ? {} : { alreadyBound: input.alreadyBound }),
    candidateCount: input.candidates.length,
    candidates: input.candidates,
    nextAction: input.nextAction ?? nextActionByStatus[input.status],
    reason: input.reason,
    reference: input.reference,
    resolvedAsset: input.resolvedMatch === undefined ? null : toReferenceAsset(input.resolvedMatch),
    status: input.status,
  };
}

export function findReferenceMatches(input: {
  assets: SearchableAgentBuilderAsset[];
  limit: number;
  referenceTexts: readonly string[];
}): ScoredAssetMatch[] {
  const referenceTextSet = new Set(input.referenceTexts);
  const normalizedReferences = new Set(
    input.referenceTexts.map((referenceText) => normalizeAgentBuilderSearchText(referenceText)),
  );
  const exactIdMatches = input.assets
    .filter((asset) => referenceTextSet.has(asset.id))
    .map(
      (asset): ScoredAssetMatch => ({
        asset,
        matchType: "exact_id",
        score: 100,
      }),
    );

  if (exactIdMatches.length > 0) {
    return exactIdMatches;
  }

  const exactNameMatches = input.assets
    .filter((asset) => normalizedReferences.has(normalizeAgentBuilderSearchText(asset.name)))
    .map(
      (asset): ScoredAssetMatch => ({
        asset,
        matchType: "exact_name",
        score: 100,
      }),
    );

  if (exactNameMatches.length > 0) {
    return exactNameMatches;
  }

  return input.assets
    .map((asset): ScoredAssetMatch => {
      const score = Math.max(
        ...[...normalizedReferences].map((referenceText) =>
          scoreSearchableAgentBuilderAsset(asset, referenceText),
        ),
      );

      return {
        asset,
        matchType: score > 0 ? "text_candidate" : "single_candidate",
        score,
      };
    })
    .filter((match) => match.score > 0)
    .toSorted(compareScoredMatches)
    .slice(0, input.limit);
}

export function toReferenceCandidates(
  matches: readonly ScoredAssetMatch[],
): AgentBuilderToolPayload[] {
  return matches.map(toReferenceAsset);
}
