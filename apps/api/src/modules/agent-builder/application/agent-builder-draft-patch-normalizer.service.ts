import type {
  AgentBuilderDraftPatchFieldPath,
  AgentBuilderDraftPatchValue,
  AgentBuilderPlanNode,
  AgentBuilderPlannerContext,
  AgentBuilderPlannerResponseMode,
} from "@mosoo/contracts/agent-builder";
import { getAgentBuilderDraftPatchSectionId } from "@mosoo/contracts/agent-builder";
import type { AccountId } from "@mosoo/id";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { parseAgentBuilderPlannerDraft } from "./agent-builder-draft-parser";
import {
  createVisibleAssetReferenceMapResolver,
  resolveDraftPatchReferences,
} from "./agent-builder-draft-patch-assets";
import type { VisibleAssetReferenceMapResolver } from "./agent-builder-draft-patch-assets";
import {
  appendUniqueDraftPatchIds,
  normalizeDraftPatchIdList,
} from "./agent-builder-draft-patch-id-list";
import {
  ensureRuntimeAndModelPatchAvailable,
  resolveAgentBuilderModelId,
  resolveKnownProviderId,
  resolvePublicRuntimeId,
} from "./agent-builder-draft-patch-model-selection";
import { createBlockedDraftPatchNode } from "./agent-builder-draft-patch-node";

export {
  createComparableLookupIndex,
  resolveAgentBuilderModelId,
} from "./agent-builder-draft-patch-model-selection";

type ParsedPlannerDraft = ReturnType<typeof parseAgentBuilderPlannerDraft>;

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

  const draft = parseAgentBuilderPlannerDraft(input.context.draft.yaml);

  if (draft.parseStatus === "failed") {
    throw new Error(draft.parseError ?? "Agent Builder draft YAML could not be parsed.");
  }

  const resolveVisibleAssetReferenceMap = createVisibleAssetReferenceMapResolver(input.context);
  const workingValues: DraftPatchWorkingValues = new Map();
  const nodes = input.nodes.map((node) => {
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

function normalizeDraftPatchValue(
  currentValue: AgentBuilderDraftPatchValue,
  fieldPath: AgentBuilderDraftPatchFieldPath,
  operation: AgentBuilderPlanNode["operation"],
  value: AgentBuilderDraftPatchValue,
): AgentBuilderDraftPatchValue {
  if (operation === "remove" && fieldPath !== "spaceIds") {
    throw new Error("Agent Builder can only auto-remove Space bindings in this slice.");
  }

  if (
    fieldPath === "name" ||
    fieldPath === "description" ||
    fieldPath === "prompt" ||
    fieldPath === "runtimeId" ||
    fieldPath === "provider" ||
    fieldPath === "model"
  ) {
    if (typeof value !== "string") {
      throw new Error(`Agent Builder draft_patch ${fieldPath} value must be a string.`);
    }

    const trimmed = value.trim();

    if (fieldPath === "name" && trimmed.length === 0) {
      throw new Error("Agent Builder draft_patch name must not be empty.");
    }

    if (fieldPath === "runtimeId") {
      return resolvePublicRuntimeId(trimmed);
    }

    if (fieldPath === "provider") {
      return resolveKnownProviderId(trimmed);
    }

    if (fieldPath === "model") {
      return resolveAgentBuilderModelId(trimmed);
    }

    return fieldPath === "prompt" ? value.trim() : trimmed;
  }

  if (fieldPath === "environmentId") {
    if (value !== null && typeof value !== "string") {
      throw new Error("Agent Builder draft_patch environmentId value must be a string or null.");
    }

    const nextEnvironmentId = typeof value === "string" ? value.trim() : null;

    return nextEnvironmentId === "" ? null : nextEnvironmentId;
  }

  if (fieldPath === "skillIds") {
    const currentIds = normalizeDraftPatchIdList(currentValue);
    const ids = normalizeDraftPatchIdList(value);

    return appendUniqueDraftPatchIds(currentIds, ids);
  }

  if (fieldPath === "mcpServerIds") {
    const currentIds = normalizeDraftPatchIdList(currentValue);
    const ids = normalizeDraftPatchIdList(value);

    return appendUniqueDraftPatchIds(currentIds, ids);
  }

  const ids = normalizeDraftPatchIdList(value);
  const currentSpaceIds = normalizeDraftPatchIdList(currentValue);

  if (operation === "remove") {
    const idsToRemove = new Set(ids);
    const currentSpaceIdSet = new Set(currentSpaceIds);
    const unboundIds = ids.filter((id) => !currentSpaceIdSet.has(id));

    if (idsToRemove.size === 0) {
      throw new Error("Agent Builder Space removal must include at least one bound Space ID.");
    }

    if (unboundIds.length > 0) {
      throw new Error(
        `Agent Builder can only unmount currently bound Spaces: ${unboundIds.join(", ")}.`,
      );
    }

    return currentSpaceIds.filter((id) => !idsToRemove.has(id));
  }

  return appendUniqueDraftPatchIds(currentSpaceIds, ids);
}

function readDraftPatchBaseValue(
  draft: ParsedPlannerDraft,
  fieldPath: AgentBuilderDraftPatchFieldPath,
): AgentBuilderDraftPatchValue {
  switch (fieldPath) {
    case "description":
      return draft.description ?? "";
    case "environmentId":
      return draft.environmentId;
    case "model":
      return draft.model ?? "";
    case "mcpServerIds":
      return draft.mcpServerIds;
    case "name":
      return draft.name ?? "";
    case "prompt":
      return draft.prompt ?? "";
    case "provider":
      return draft.provider ?? "";
    case "runtimeId":
      return draft.runtimeId ?? "";
    case "skillIds":
      return draft.skillIds;
    case "spaceIds":
      return draft.spaceIds;
  }
}

function readDraftPatchWorkingValue(
  draft: ParsedPlannerDraft,
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
  draft: ParsedPlannerDraft,
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
  draft: ParsedPlannerDraft,
  workingValues: DraftPatchWorkingValues,
  resolveVisibleAssetReferenceMap: VisibleAssetReferenceMapResolver,
  node: AgentBuilderPlanNode,
): AgentBuilderPlanNode {
  const draftPatch = node.draftPatch;

  if (draftPatch === undefined) {
    throw new Error("Agent Builder draft_patch node is missing draftPatch payload.");
  }

  const value = normalizeDraftPatchValue(
    readDraftPatchWorkingValue(draft, workingValues, draftPatch.fieldPath),
    draftPatch.fieldPath,
    node.operation,
    draftPatch.value,
  );
  const resolvedReferences = resolveDraftPatchReferences(
    resolveVisibleAssetReferenceMap,
    draftPatch.fieldPath,
    value,
  );
  const operation =
    node.operation === "remove" && draftPatch.fieldPath === "spaceIds"
      ? "remove"
      : node.operation === "bind"
        ? "bind"
        : "update";

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
