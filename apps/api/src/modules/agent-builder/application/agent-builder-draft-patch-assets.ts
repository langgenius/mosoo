import type {
  AgentBuilderDraftPatchAssetFieldPath,
  AgentBuilderDraftPatchAssetFieldSpec,
  AgentBuilderDraftPatchFieldPath,
  AgentBuilderDraftPatchReference,
  AgentBuilderDraftPatchReferenceId,
  AgentBuilderDraftPatchValue,
  AgentBuilderPlannerContext,
  AgentBuilderVisibleAssetIndexEntry,
} from "@mosoo/contracts/agent-builder";
import { getAgentBuilderDraftPatchAssetFieldSpec } from "@mosoo/contracts/agent-builder";

import { normalizeDraftPatchIdList } from "./agent-builder-draft-patch-id-list";
import { parseEnvironmentId, parseMcpServerId, parseSkillId } from "./agent-builder-ids";

export type VisibleAssetReferenceMapResolver = (
  fieldPath: AgentBuilderDraftPatchFieldPath,
) => Map<string, AgentBuilderDraftPatchReference>;

function createVisibleAssetReferenceMap(
  context: AgentBuilderPlannerContext,
  fieldPath: AgentBuilderDraftPatchFieldPath,
): Map<string, AgentBuilderDraftPatchReference> {
  const spec = getAgentBuilderDraftPatchAssetFieldSpec(fieldPath);

  if (spec === null) {
    return new Map();
  }

  return new Map(
    context.assets.currentIndex[spec.listKey].map((asset) => {
      const reference = createDraftPatchReference(spec, asset);
      return [reference.id, reference];
    }),
  );
}

export function createVisibleAssetReferenceMapResolver(
  context: AgentBuilderPlannerContext,
): VisibleAssetReferenceMapResolver {
  const referencesByFieldPath = new Map<
    AgentBuilderDraftPatchAssetFieldPath,
    Map<string, AgentBuilderDraftPatchReference>
  >();

  return (fieldPath) => {
    const spec = getAgentBuilderDraftPatchAssetFieldSpec(fieldPath);

    if (spec === null) {
      return createVisibleAssetReferenceMap(context, fieldPath);
    }

    const existing = referencesByFieldPath.get(spec.fieldPath);

    if (existing !== undefined) {
      return existing;
    }

    const references = createVisibleAssetReferenceMap(context, spec.fieldPath);
    referencesByFieldPath.set(spec.fieldPath, references);
    return references;
  };
}

function parseReferenceId(
  spec: AgentBuilderDraftPatchAssetFieldSpec,
  value: unknown,
): AgentBuilderDraftPatchReferenceId {
  const label = `currentIndex.${spec.listKey}[].id`;

  if (spec.targetType === "environment") {
    return parseEnvironmentId(value, label);
  }

  if (spec.targetType === "mcp_server") {
    return parseMcpServerId(value, label);
  }

  if (spec.targetType === "skill") {
    return parseSkillId(value, label);
  }

  throw new Error(`Unsupported draft patch reference target type: ${spec.targetType}`);
}

function createDraftPatchReference(
  spec: AgentBuilderDraftPatchAssetFieldSpec,
  asset: AgentBuilderVisibleAssetIndexEntry,
): AgentBuilderDraftPatchReference {
  const id = parseReferenceId(spec, asset.id);

  return {
    bindingState: asset.bindingState,
    ...(spec.fieldPath === "skillIds" ? { filename: `${id}.md` } : {}),
    id,
    name: asset.name,
    targetType: spec.targetType,
  };
}

export function resolveDraftPatchReferences(
  resolveVisibleAssetReferenceMap: VisibleAssetReferenceMapResolver,
  fieldPath: AgentBuilderDraftPatchFieldPath,
  value: AgentBuilderDraftPatchValue,
): AgentBuilderDraftPatchReference[] {
  const spec = getAgentBuilderDraftPatchAssetFieldSpec(fieldPath);

  if (spec === null) {
    return [];
  }

  const referenceMap = resolveVisibleAssetReferenceMap(fieldPath);
  const ids =
    spec.fieldPath === "environmentId"
      ? typeof value === "string" && value.length > 0
        ? [value]
        : []
      : normalizeDraftPatchIdList(value);
  const references: AgentBuilderDraftPatchReference[] = [];
  const missingIds: string[] = [];

  for (const id of ids) {
    const reference = referenceMap.get(id);

    if (reference === undefined) {
      missingIds.push(id);
      continue;
    }

    references.push(reference);
  }

  if (missingIds.length > 0) {
    throw new Error(
      `Agent Builder draft_patch ${fieldPath} contains non-visible asset IDs: ${missingIds.join(
        ", ",
      )}.`,
    );
  }

  return references;
}
