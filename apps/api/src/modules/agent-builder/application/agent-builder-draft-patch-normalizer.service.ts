import type {
  AgentBuilderDraftPatchFieldPath,
  AgentBuilderDraftPatchValue,
  AgentBuilderPlanNode,
  AgentBuilderPlannerContext,
  AgentBuilderPlannerResponseMode,
} from "@mosoo/contracts/agent-builder";
import {
  getAgentBuilderDraftPatchAssetFieldSpec,
  getAgentBuilderDraftPatchSectionId,
} from "@mosoo/contracts/agent-builder";
import type { AccountId } from "@mosoo/id";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import {
  createVisibleAssetReferenceMapResolver,
  resolveDraftPatchReferences,
} from "./agent-builder-draft-patch-assets";
import type { VisibleAssetReferenceMapResolver } from "./agent-builder-draft-patch-assets";
import { normalizeDraftPatchIdList } from "./agent-builder-draft-patch-id-list";
import { ensureRuntimeAndModelPatchAvailable } from "./agent-builder-draft-patch-model-selection";
import { createBlockedDraftPatchNode } from "./agent-builder-draft-patch-node";
import type { AgentBuilderLightweightPlannerDraftContext } from "./agent-builder-lightweight-draft-types";
import { toAgentBuilderPlannerDraftContext } from "./agent-builder-lightweight-manifest-projections";
import {
  normalizeAgentBuilderManifestPatchValue,
  readAgentBuilderManifestPatchBaseValue,
} from "./agent-builder-manifest-patch-policy.service";

export {
  createComparableLookupIndex,
  resolveAgentBuilderModelId,
} from "./agent-builder-draft-patch-model-selection";

type DraftPatchWorkingValues = Map<AgentBuilderDraftPatchFieldPath, AgentBuilderDraftPatchValue>;

export async function normalizeAgentBuilderDraftPatchNodes(input: {
  actorAccountId: AccountId;
  bindings: ApiBindings;
  context: AgentBuilderPlannerContext;
  mode: AgentBuilderPlannerResponseMode;
  nodes: AgentBuilderPlanNode[];
}): Promise<AgentBuilderPlanNode[]> {
  if (input.mode !== "draft_patch") {
    return input.nodes;
  }

  const draft = toAgentBuilderPlannerDraftContext(input.context.draft.yaml);

  if (draft.parseStatus === "failed") {
    throw new Error(draft.parseError ?? "Agent Builder draft YAML could not be parsed.");
  }

  const resolveVisibleAssetReferenceMap = createVisibleAssetReferenceMapResolver(input.context);
  const workingValues: DraftPatchWorkingValues = new Map();
  const nodes = input.nodes.map((node) => {
    if (node.kind !== "draft_patch") {
      return node;
    }

    const normalized = normalizeDraftPatchNodeOrBlock(
      input.context,
      draft,
      workingValues,
      resolveVisibleAssetReferenceMap,
      node,
    );

    if (normalized.status === "applied" && normalized.draftPatch !== undefined) {
      workingValues.set(normalized.draftPatch.fieldPath, normalized.draftPatch.value);
    }

    return normalized;
  });

  return ensureRuntimeAndModelPatchAvailable(
    input.bindings,
    input.actorAccountId,
    input.context,
    draft,
    nodes,
  );
}

function readDraftPatchBaseValue(
  draft: AgentBuilderLightweightPlannerDraftContext,
  fieldPath: AgentBuilderDraftPatchFieldPath,
): AgentBuilderDraftPatchValue {
  return readAgentBuilderManifestPatchBaseValue(draft, fieldPath);
}

function readDraftPatchWorkingValue(
  draft: AgentBuilderLightweightPlannerDraftContext,
  workingValues: DraftPatchWorkingValues,
  fieldPath: AgentBuilderDraftPatchFieldPath,
): AgentBuilderDraftPatchValue {
  if (!workingValues.has(fieldPath)) {
    return readDraftPatchBaseValue(draft, fieldPath);
  }

  const value = workingValues.get(fieldPath);

  if (value === undefined) {
    throw new Error(`Agent Builder draft_patch ${fieldPath} working value is missing.`);
  }

  return value;
}

function normalizeDraftPatchNodeOrBlock(
  context: AgentBuilderPlannerContext,
  draft: AgentBuilderLightweightPlannerDraftContext,
  workingValues: DraftPatchWorkingValues,
  resolveVisibleAssetReferenceMap: VisibleAssetReferenceMapResolver,
  node: AgentBuilderPlanNode,
): AgentBuilderPlanNode {
  try {
    return normalizeDraftPatchNode(
      context,
      draft,
      workingValues,
      resolveVisibleAssetReferenceMap,
      node,
    );
  } catch (error) {
    const summary =
      error instanceof Error ? error.message : "Agent Builder draft_patch could not be normalized.";

    return createBlockedDraftPatchNode(node, summary);
  }
}

function normalizeDraftPatchNode(
  context: AgentBuilderPlannerContext,
  draft: AgentBuilderLightweightPlannerDraftContext,
  workingValues: DraftPatchWorkingValues,
  resolveVisibleAssetReferenceMap: VisibleAssetReferenceMapResolver,
  node: AgentBuilderPlanNode,
): AgentBuilderPlanNode {
  const draftPatch = node.draftPatch;

  if (draftPatch === undefined) {
    throw new Error("Agent Builder draft_patch node is missing draftPatch payload.");
  }

  const currentValue = readDraftPatchWorkingValue(draft, workingValues, draftPatch.fieldPath);
  const value = normalizeAgentBuilderManifestPatchValue(
    currentValue,
    draftPatch.fieldPath,
    node.operation,
    draftPatch.value,
  );
  const resolvedReferences = resolveDraftPatchReferences(
    resolveVisibleAssetReferenceMap,
    draftPatch.fieldPath,
    readDraftPatchReferenceValue(currentValue, draftPatch.fieldPath, node.operation, value),
  );
  const operation = node.operation === "bind" ? "bind" : "update";

  return {
    ...node,
    actions: [],
    draftPatch: {
      autoApply: true,
      baseDraftRevision: context.draft.revision,
      baseValue: readDraftPatchBaseValue(draft, draftPatch.fieldPath),
      fieldPath: draftPatch.fieldPath,
      ...(resolvedReferences.length === 0 ? {} : { resolvedReferences }),
      sectionId: getAgentBuilderDraftPatchSectionId(draftPatch.fieldPath),
      value,
    },
    fieldPath: draftPatch.fieldPath,
    kind: "draft_patch",
    operation,
    requiresConfirmation: false,
    status: "applied",
    targetType: "draft",
  };
}

function readDraftPatchReferenceValue(
  currentValue: AgentBuilderDraftPatchValue,
  fieldPath: AgentBuilderDraftPatchFieldPath,
  operation: AgentBuilderPlanNode["operation"],
  value: AgentBuilderDraftPatchValue,
): AgentBuilderDraftPatchValue {
  const spec = getAgentBuilderDraftPatchAssetFieldSpec(fieldPath);

  if (spec === null) {
    return value;
  }

  if (fieldPath === "environmentId") {
    const currentEnvironmentId = typeof currentValue === "string" ? currentValue : null;

    return typeof value === "string" && value.length > 0 && value !== currentEnvironmentId
      ? value
      : null;
  }

  if (operation === "remove") {
    return [];
  }

  const currentIds = new Set(normalizeDraftPatchIdList(currentValue));

  return normalizeDraftPatchIdList(value).filter((id) => !currentIds.has(id));
}
