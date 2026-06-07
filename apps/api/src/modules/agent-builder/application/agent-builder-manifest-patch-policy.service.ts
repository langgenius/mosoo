import type {
  AgentBuilderDraftPatchFieldPath,
  AgentBuilderDraftPatchValue,
  AgentBuilderPlanNode,
} from "@mosoo/contracts/agent-builder";

import {
  appendUniqueDraftPatchIds,
  normalizeDraftPatchIdList,
} from "./agent-builder-draft-patch-id-list";
import {
  resolveAgentBuilderModelId,
  resolveKnownProviderId,
  resolvePublicRuntimeId,
} from "./agent-builder-draft-patch-model-selection";
import type { AgentBuilderLightweightPlannerDraftContext } from "./agent-builder-lightweight-draft-types";

const REMOVABLE_BINDING_FIELD_PATHS = new Set<AgentBuilderDraftPatchFieldPath>([
  "mcpServerIds",
  "skillIds",
  "spaceIds",
]);

export function isAgentBuilderManifestBindingRemove(input: {
  readonly fieldPath: AgentBuilderDraftPatchFieldPath;
  readonly operation: AgentBuilderPlanNode["operation"];
}): boolean {
  return input.operation === "remove" && REMOVABLE_BINDING_FIELD_PATHS.has(input.fieldPath);
}

export function readAgentBuilderManifestPatchBaseValue(
  draft: AgentBuilderLightweightPlannerDraftContext,
  fieldPath: AgentBuilderDraftPatchFieldPath,
): AgentBuilderDraftPatchValue {
  switch (fieldPath) {
    case "componentDecisions.environment":
      return draft.componentDecisions.environment ?? null;
    case "description":
      return draft.description ?? "";
    case "environmentId":
      return draft.environmentId;
    case "kind":
      return draft.kind ?? "";
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

export function normalizeAgentBuilderManifestPatchValue(
  currentValue: AgentBuilderDraftPatchValue,
  fieldPath: AgentBuilderDraftPatchFieldPath,
  operation: AgentBuilderPlanNode["operation"],
  value: AgentBuilderDraftPatchValue,
): AgentBuilderDraftPatchValue {
  if (operation === "remove") {
    return removeManifestBindingIds(fieldPath, currentValue, value);
  }

  if (
    fieldPath === "kind" ||
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

    if (fieldPath === "kind" && trimmed !== "pet" && trimmed !== "cattle") {
      throw new Error("Agent Builder draft_patch kind must be pet or cattle.");
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

  if (fieldPath === "componentDecisions.environment") {
    if (typeof value !== "string") {
      throw new Error(
        "Agent Builder draft_patch componentDecisions.environment value must be a string.",
      );
    }

    const decision = value.trim();

    if (decision !== "bound" && decision !== "created" && decision !== "skipped") {
      throw new Error(
        "Agent Builder draft_patch componentDecisions.environment must be bound, created, or skipped.",
      );
    }

    return decision;
  }

  const currentIds = normalizeDraftPatchIdList(currentValue);
  const ids = normalizeDraftPatchIdList(value);

  return appendUniqueDraftPatchIds(currentIds, ids);
}

function getBindingFieldLabel(fieldPath: AgentBuilderDraftPatchFieldPath): string {
  switch (fieldPath) {
    case "mcpServerIds":
      return "MCP servers";
    case "skillIds":
      return "Skills";
    case "spaceIds":
      return "Spaces";
    default:
      return "bindings";
  }
}

function removeManifestBindingIds(
  fieldPath: AgentBuilderDraftPatchFieldPath,
  currentValue: AgentBuilderDraftPatchValue,
  value: AgentBuilderDraftPatchValue,
): AgentBuilderDraftPatchValue {
  if (!REMOVABLE_BINDING_FIELD_PATHS.has(fieldPath)) {
    throw new Error("Agent Builder can only auto-remove bound component references.");
  }

  const currentIds = normalizeDraftPatchIdList(currentValue);
  const ids = normalizeDraftPatchIdList(value);
  const idsToRemove = new Set(ids);
  const currentIdSet = new Set(currentIds);
  const unboundIds = ids.filter((id) => !currentIdSet.has(id));
  const label = getBindingFieldLabel(fieldPath);

  if (idsToRemove.size === 0) {
    throw new Error(`Agent Builder ${label} removal must include at least one bound ID.`);
  }

  if (unboundIds.length > 0) {
    throw new Error(
      `Agent Builder can only unmount currently bound ${label}: ${unboundIds.join(", ")}.`,
    );
  }

  return currentIds.filter((id) => !idsToRemove.has(id));
}
