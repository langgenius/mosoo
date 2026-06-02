import type {
  AgentBuilderPlannerContext,
  AgentBuilderToolPayload,
  AgentBuilderVisibleAssetBindingState,
} from "@mosoo/contracts/agent-builder";

import {
  AGENT_BUILDER_ASSET_BINDING_STATES,
  isAgentBuilderAssetBindingState,
  normalizeAgentBuilderAssetType,
  normalizeAgentBuilderSearchText,
} from "./asset-tool-assets";
import type {
  SearchableAgentBuilderAsset,
  SearchableAgentBuilderAssetType,
} from "./asset-tool-assets";

export interface ResolveAssetReferenceQuery {
  readonly assetId: string | null;
  readonly assetType: SearchableAgentBuilderAssetType;
  readonly bindingStates: ReadonlySet<AgentBuilderVisibleAssetBindingState>;
  readonly limit: number;
  readonly reference: AgentBuilderToolPayload;
  readonly referenceText: string | null;
  readonly referenceTexts: readonly string[];
}

const DEFAULT_CANDIDATE_LIMIT = 5;
const MAX_CANDIDATE_LIMIT = 20;
const CANDIDATE_SUMMARY_PREFIX_BY_ASSET_TYPE: Partial<
  Record<SearchableAgentBuilderAssetType, string>
> = {
  channel: "Candidate Channels:",
  environment: "Candidate Environments:",
  mcp_server: "Candidate MCP Servers:",
  skill: "Candidate Skills:",
  space: "Candidate Spaces:",
};

export function readResolveAssetReferenceQuery(
  input: AgentBuilderToolPayload,
): ResolveAssetReferenceQuery {
  const assetType = readAssetType(input);
  const assetId = readOptionalString(input, "assetId");
  const referenceTexts = readReferenceTexts(input);
  const referenceText = referenceTexts[0] ?? null;

  return {
    assetId,
    assetType,
    bindingStates: readBindingStateFilter(input),
    limit: readCandidateLimit(input),
    reference: toReferencePayload({ assetId, referenceText }),
    referenceText,
    referenceTexts,
  };
}

export function resolveReferenceTextVariants(input: {
  assetType: SearchableAgentBuilderAssetType;
  assets: SearchableAgentBuilderAsset[];
  context: AgentBuilderPlannerContext | undefined;
  referenceTexts: readonly string[];
}): string[] {
  const variants = new Set<string>();

  for (const candidateText of input.referenceTexts) {
    const resolvedText =
      resolveOrdinalReference({
        assetType: input.assetType,
        assets: input.assets,
        context: input.context,
        referenceText: candidateText,
      }) ?? candidateText;

    for (const variant of createReferenceTextVariants(resolvedText)) {
      variants.add(variant);
    }
  }

  return [...variants];
}

function readAssetType(input: AgentBuilderToolPayload): SearchableAgentBuilderAssetType {
  const value = input["assetType"] ?? input["kind"] ?? input["assetKind"] ?? input["targetType"];

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("resolve_asset_reference requires assetType.");
  }

  return normalizeAgentBuilderAssetType({
    createUnsupportedMessage: (unsupportedValue) =>
      `resolve_asset_reference assetType is unsupported: ${unsupportedValue}.`,
    fieldName: "assetType",
    toolName: "resolve_asset_reference",
    value: value.trim(),
  });
}

function readOptionalString(input: AgentBuilderToolPayload, fieldName: string): string | null {
  const value = input[fieldName];

  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error(`resolve_asset_reference ${fieldName} must be a string.`);
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function readReferenceTexts(input: AgentBuilderToolPayload): string[] {
  return [
    readOptionalString(input, "reference"),
    readOptionalString(input, "name"),
    readOptionalString(input, "assetName"),
    readOptionalString(input, "query"),
  ].reduce<string[]>((texts, text) => {
    if (text !== null && !texts.includes(text)) {
      texts.push(text);
    }

    return texts;
  }, []);
}

function readCandidateLimit(input: AgentBuilderToolPayload): number {
  const value = input["limit"];

  if (value === undefined || value === null) {
    return DEFAULT_CANDIDATE_LIMIT;
  }

  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error("resolve_asset_reference limit must be an integer.");
  }

  return Math.min(Math.max(value, 1), MAX_CANDIDATE_LIMIT);
}

function readStringList(value: unknown, fieldName: string): string[] | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === "string") {
    return [value.trim()];
  }

  if (!Array.isArray(value)) {
    throw new Error(`resolve_asset_reference ${fieldName} must be a string or array of strings.`);
  }

  return value.map((entry, index) => {
    if (typeof entry !== "string") {
      throw new Error(`resolve_asset_reference ${fieldName}.${index} must be a string.`);
    }

    return entry.trim();
  });
}

function readBindingStateFilter(
  input: AgentBuilderToolPayload,
): ReadonlySet<AgentBuilderVisibleAssetBindingState> {
  const values = readStringList(input["bindingState"], "bindingState");

  if (values === null || values.length === 0) {
    return new Set(AGENT_BUILDER_ASSET_BINDING_STATES);
  }

  return new Set(
    values.map((value) => {
      if (isAgentBuilderAssetBindingState(value)) {
        return value;
      }

      throw new Error(`resolve_asset_reference bindingState contains unsupported value: ${value}.`);
    }),
  );
}

function toReferencePayload(input: {
  assetId: string | null;
  referenceText: string | null;
}): AgentBuilderToolPayload {
  return {
    assetId: input.assetId,
    text: input.referenceText,
  };
}

function readOrdinalIndex(referenceText: string): number | null {
  const normalized = referenceText.trim().toLowerCase();
  const numericMatch = /(?:第\s*)?([1-9][0-9]*)\s*(?:个|项|号)?/u.exec(normalized);

  if (numericMatch?.[1] !== undefined) {
    return Number.parseInt(numericMatch[1], 10) - 1;
  }

  const ordinalWords = [
    ["first", "第一个", "第一项", "第一", "一号"],
    ["second", "第二个", "第二项", "第二", "二号"],
    ["third", "第三个", "第三项", "第三", "三号"],
    ["fourth", "第四个", "第四项", "第四", "四号"],
    ["fifth", "第五个", "第五项", "第五", "五号"],
  ] as const;

  const matchedIndex = ordinalWords.findIndex((words) =>
    words.some((word) => normalized.includes(word)),
  );

  return matchedIndex === -1 ? null : matchedIndex;
}

function readCandidateNamesFromSummary(
  assetType: SearchableAgentBuilderAssetType,
  summary: string,
): string[] {
  const prefix = CANDIDATE_SUMMARY_PREFIX_BY_ASSET_TYPE[assetType];

  if (prefix === undefined) {
    return [];
  }

  const candidateSummaryStart = summary.indexOf(prefix);

  if (candidateSummaryStart === -1) {
    return [];
  }

  const candidateText = summary
    .slice(candidateSummaryStart + prefix.length)
    .trim()
    .replace(/\.$/u, "");

  return candidateText
    .split(";")
    .map((entry) => entry.replace(/^\s*[0-9]+\.\s*/u, "").trim())
    .filter(Boolean);
}

function readLatestQuestionCandidateNames(
  assetType: SearchableAgentBuilderAssetType,
  context: AgentBuilderPlannerContext | undefined,
): string[] {
  if (context === undefined) {
    return [];
  }

  const node = context.historicalOpenNodes.find(
    (candidate) =>
      candidate.kind === "question" &&
      questionTargetMatchesAssetType(candidate.targetType, assetType) &&
      candidate.status === "pending",
  );

  return node === undefined ? [] : readCandidateNamesFromSummary(assetType, node.summary);
}

function questionTargetMatchesAssetType(
  targetType: string,
  assetType: SearchableAgentBuilderAssetType,
): boolean {
  if (assetType === "mcp_server") {
    return targetType === "mcp" || targetType === "mcp_server";
  }

  return targetType === assetType;
}

function resolveOrdinalReference(input: {
  assetType: SearchableAgentBuilderAssetType;
  assets: SearchableAgentBuilderAsset[];
  context: AgentBuilderPlannerContext | undefined;
  referenceText: string;
}): string | null {
  const ordinalIndex = readOrdinalIndex(input.referenceText);

  if (ordinalIndex === null) {
    return null;
  }

  const candidateNames = readLatestQuestionCandidateNames(input.assetType, input.context);
  const candidateName = candidateNames[ordinalIndex];

  if (candidateName === undefined) {
    return null;
  }

  const normalizedCandidateName = normalizeAgentBuilderSearchText(candidateName);
  const exactAsset = input.assets.find(
    (asset) => normalizeAgentBuilderSearchText(asset.name) === normalizedCandidateName,
  );

  return exactAsset?.name ?? candidateName;
}

function createReferenceTextVariants(referenceText: string): string[] {
  const variants = new Set<string>();
  const trimmed = referenceText.trim();

  function add(value: string): void {
    const nextValue = value.trim();

    if (nextValue.length > 0) {
      variants.add(nextValue);
    }
  }

  add(trimmed);

  const prefixPatterns = [
    /^please\s+/iu,
    /^添加\s+/iu,
    /^替换\s+/iu,
    /^换成\s+/iu,
    /^使用\s+/iu,
    /^use\s+/iu,
    /^使用现有\s*(?:space|environment|mcp\s*server|mcp|skill)\s*[:：]?\s*/iu,
    /^绑定现有\s*space\s*[:：]?\s*/iu,
    /^绑定已有\s*space\s*[:：]?\s*/iu,
    /^绑定\s*space\s*[:：]?\s*/iu,
    /^绑定现有\s*environment\s*[:：]?\s*/iu,
    /^绑定已有\s*environment\s*[:：]?\s*/iu,
    /^绑定\s*environment\s*[:：]?\s*/iu,
    /^绑定现有\s*(?:mcp\s*server|mcp)\s*[:：]?\s*/iu,
    /^绑定已有\s*(?:mcp\s*server|mcp)\s*[:：]?\s*/iu,
    /^绑定\s*(?:mcp\s*server|mcp)\s*[:：]?\s*/iu,
    /^绑定现有\s*skill\s*[:：]?\s*/iu,
    /^绑定已有\s*skill\s*[:：]?\s*/iu,
    /^绑定\s*skill\s*[:：]?\s*/iu,
    /^绑定\s+/iu,
    /^bind\s+existing\s+space\s*[:：]?\s*/iu,
    /^use\s+existing\s+space\s*[:：]?\s*/iu,
    /^bind\s+existing\s+environment\s*[:：]?\s*/iu,
    /^use\s+existing\s+environment\s*[:：]?\s*/iu,
    /^bind\s+existing\s+(?:mcp\s+server|mcp)\s*[:：]?\s*/iu,
    /^use\s+existing\s+(?:mcp\s+server|mcp)\s*[:：]?\s*/iu,
    /^bind\s+existing\s+skill\s*[:：]?\s*/iu,
    /^use\s+existing\s+skill\s*[:：]?\s*/iu,
    /^please\s+bind\s+/iu,
    /^please\s+use\s+/iu,
    /^add\s+/iu,
    /^replace\s+with\s+/iu,
    /^replace\s+/iu,
    /^bind\s+/iu,
    /^use\s+/iu,
  ] as const;
  const suffixPatterns = [
    /\s+to\s+this\s+agent\.?$/iu,
    /\s+to\s+the\s+agent\.?$/iu,
    /\s+for\s+this\s+agent\.?$/iu,
    /\s+(?:space|environment|mcp\s*server|mcp|skill)\.?$/iu,
    /[。.!！]\s*$/u,
  ] as const;

  for (const pattern of prefixPatterns) {
    add(trimmed.replace(pattern, ""));
  }

  const currentVariants = [...variants];

  for (const variant of currentVariants) {
    for (const pattern of suffixPatterns) {
      add(variant.replace(pattern, ""));
    }
  }

  const variantsWithSuffixes = Array.from(variants);

  for (const variant of variantsWithSuffixes) {
    for (const prefixPattern of prefixPatterns) {
      for (const suffixPattern of suffixPatterns) {
        add(variant.replace(prefixPattern, "").replace(suffixPattern, ""));
      }
    }
  }

  return [...variants];
}
