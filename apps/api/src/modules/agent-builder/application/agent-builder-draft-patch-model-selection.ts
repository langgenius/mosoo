import type {
  AgentBuilderDraftPatchChange,
  AgentBuilderPlanNode,
  AgentBuilderPlannerContext,
} from "@mosoo/contracts/agent-builder";
import { PRESET_MODEL_CATALOG } from "@mosoo/contracts/models";
import type { AccountId } from "@mosoo/id";
import { ALL_VENDORS, PUBLIC_RUNTIME_CATALOG } from "@mosoo/runtime-catalog";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { ensureModelAvailableForSelection } from "../../vendor-credentials/application/vendor-credential.service";
import { createBlockedDraftPatchNode } from "./agent-builder-draft-patch-node";
import type { AgentBuilderLightweightPlannerDraftContext } from "./agent-builder-lightweight-draft-types";

interface ModelSelection {
  model: string;
  provider: string;
  runtimeId: string;
}

function normalizeComparable(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "");
}

export function createComparableLookupIndex<T>(
  entries: readonly T[],
  readAliases: (entry: T) => readonly string[],
  readCanonicalValue: (entry: T) => string,
): Map<string, string> {
  const index = new Map<string, { alias: string; canonicalValue: string }>();

  for (const entry of entries) {
    const canonicalValue = readCanonicalValue(entry);

    for (const alias of readAliases(entry)) {
      const comparableAlias = normalizeComparable(alias);

      if (comparableAlias.length === 0) {
        continue;
      }

      const existing = index.get(comparableAlias);

      if (existing !== undefined) {
        if (existing.canonicalValue !== canonicalValue) {
          throw new Error(
            `Catalog aliases ${existing.alias} and ${alias} both normalize to ${comparableAlias} but resolve to different canonical values.`,
          );
        }

        continue;
      }

      index.set(comparableAlias, { alias, canonicalValue });
    }
  }

  return new Map(
    Array.from(index.entries(), ([comparableAlias, entry]) => [
      comparableAlias,
      entry.canonicalValue,
    ]),
  );
}

const PUBLIC_RUNTIME_IDS = new Set(PUBLIC_RUNTIME_CATALOG.map((entry) => entry.runtimeId));
const PUBLIC_RUNTIME_ID_BY_COMPARABLE = createComparableLookupIndex(
  PUBLIC_RUNTIME_CATALOG,
  (entry) => [entry.runtimeId, entry.label],
  (entry) => entry.runtimeId,
);
const VENDOR_ID_BY_COMPARABLE = createComparableLookupIndex(
  ALL_VENDORS,
  (vendor) => [vendor.vendorId, vendor.label],
  (vendor) => vendor.vendorId,
);
const MODEL_ID_BY_COMPARABLE = createComparableLookupIndex(
  PRESET_MODEL_CATALOG,
  (model) => [model.modelId, model.displayName],
  (model) => model.modelId,
);

export function resolvePublicRuntimeId(value: string): string {
  const matchedRuntimeId = PUBLIC_RUNTIME_ID_BY_COMPARABLE.get(normalizeComparable(value));

  if (matchedRuntimeId === undefined) {
    throw new Error(`Runtime ${value} is not available for Agent Builder.`);
  }

  return matchedRuntimeId;
}

export function resolveKnownProviderId(value: string): string {
  return VENDOR_ID_BY_COMPARABLE.get(normalizeComparable(value)) ?? value;
}

export function resolveAgentBuilderModelId(value: string): string {
  const trimmed = value.trim();

  return MODEL_ID_BY_COMPARABLE.get(normalizeComparable(trimmed)) ?? trimmed;
}

function readDraftModelSelection(
  draft: AgentBuilderLightweightPlannerDraftContext,
): ModelSelection {
  return {
    model: resolveAgentBuilderModelId(draft.model?.trim() ?? ""),
    provider: resolveKnownProviderId(draft.provider?.trim() ?? ""),
    runtimeId: draft.runtimeId?.trim() ?? "",
  };
}

function applyModelPatchValue(
  selection: ModelSelection,
  draftPatch: AgentBuilderDraftPatchChange,
): ModelSelection {
  const value = draftPatch.value;

  if (typeof value !== "string") {
    return selection;
  }

  switch (draftPatch.fieldPath) {
    case "model":
      return { ...selection, model: value };
    case "provider":
      return { ...selection, provider: value };
    case "runtimeId":
      return { ...selection, runtimeId: value };
    default:
      return selection;
  }
}

function isAppliedRuntimeOrModelPatch(node: AgentBuilderPlanNode): boolean {
  return (
    node.status === "applied" &&
    (node.draftPatch?.fieldPath === "model" ||
      node.draftPatch?.fieldPath === "provider" ||
      node.draftPatch?.fieldPath === "runtimeId")
  );
}

export async function ensureRuntimeAndModelPatchAvailable(
  bindings: ApiBindings,
  actorAccountId: AccountId,
  context: AgentBuilderPlannerContext,
  draft: AgentBuilderLightweightPlannerDraftContext,
  nodes: AgentBuilderPlanNode[],
): Promise<AgentBuilderPlanNode[]> {
  const nextNodes = [...nodes];

  for (const [index, node] of nextNodes.entries()) {
    if (
      node.status !== "applied" ||
      node.draftPatch?.fieldPath !== "runtimeId" ||
      typeof node.draftPatch.value !== "string"
    ) {
      continue;
    }

    if (!PUBLIC_RUNTIME_IDS.has(node.draftPatch.value)) {
      nextNodes[index] = createBlockedDraftPatchNode(
        node,
        `Runtime ${node.draftPatch.value} is not available for Agent Builder.`,
      );
    }
  }

  const selectionNodes = nextNodes.filter(
    (node) =>
      node.status === "applied" &&
      (node.draftPatch?.fieldPath === "model" ||
        node.draftPatch?.fieldPath === "provider" ||
        node.draftPatch?.fieldPath === "runtimeId"),
  );

  if (selectionNodes.length === 0) {
    return nextNodes;
  }

  const selectionNodeSet = new Set(selectionNodes);
  const currentSelection = readDraftModelSelection(draft);
  const selection = nextNodes
    .filter(isAppliedRuntimeOrModelPatch)
    .reduce(
      (current, node) =>
        node.draftPatch === undefined ? current : applyModelPatchValue(current, node.draftPatch),
      currentSelection,
    );

  if (
    currentSelection.provider.length > 0 &&
    currentSelection.model.length > 0 &&
    currentSelection.runtimeId.length > 0 &&
    selection.model === currentSelection.model &&
    selection.provider === currentSelection.provider &&
    selection.runtimeId === currentSelection.runtimeId
  ) {
    return nextNodes;
  }

  if (selection.provider.length === 0 || selection.model.length === 0) {
    return nextNodes.map((node) =>
      selectionNodeSet.has(node)
        ? createBlockedDraftPatchNode(
            node,
            "Provider and model are required before auto-applying model changes.",
          )
        : node,
    );
  }

  if (selection.runtimeId.length === 0 || !PUBLIC_RUNTIME_IDS.has(selection.runtimeId)) {
    const summary =
      selection.runtimeId.length === 0
        ? "Runtime is required before auto-applying model changes."
        : `Runtime ${selection.runtimeId} is not available for Agent Builder.`;

    return nextNodes.map((node) =>
      selectionNodeSet.has(node) ? createBlockedDraftPatchNode(node, summary) : node,
    );
  }

  try {
    await ensureModelAvailableForSelection(bindings.DB, {
      accountId: actorAccountId,
      modelId: selection.model,
      organizationId: context.agent.organizationId,
      runtimeId: selection.runtimeId,
      vendorId: selection.provider,
    });
  } catch (error) {
    const summary =
      error instanceof Error
        ? error.message
        : "Model selection is not available for Agent Builder.";

    return nextNodes.map((node) =>
      selectionNodeSet.has(node) ? createBlockedDraftPatchNode(node, summary) : node,
    );
  }

  return nextNodes;
}
