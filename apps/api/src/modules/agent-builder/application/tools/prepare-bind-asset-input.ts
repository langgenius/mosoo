import type {
  AgentBuilderBindableAssetField,
  AgentBuilderDraftPatchAssetFieldSpec,
  AgentBuilderPlannerContext,
  AgentBuilderToolPayload,
  AgentBuilderVisibleAssetBindingState,
  AgentBuilderVisibleAssetIndexEntry,
} from "@mosoo/contracts/agent-builder";
import { getAgentBuilderBindableAssetFieldSpec } from "@mosoo/contracts/agent-builder";
import type { EnvironmentId, McpServerId, SkillId, SpaceId } from "@mosoo/id";

import { parseAgentBuilderBindableAssetId } from "../agent-builder-ids";
import type { AgentBuilderBindableAssetId } from "../agent-builder-ids";

export type BindableAssetField = AgentBuilderBindableAssetField;

type BindableAssetReferenceId<TField extends BindableAssetField> = TField extends "environment"
  ? EnvironmentId
  : TField extends "mcpServer"
    ? McpServerId
    : TField extends "skill"
      ? SkillId
      : SpaceId;

export interface BindableAssetReference<TField extends BindableAssetField = BindableAssetField> {
  readonly bindingState: AgentBuilderVisibleAssetBindingState;
  readonly id: BindableAssetReferenceId<TField>;
  readonly name: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} is required.`);
  }

  return value.trim();
}

function parseAssetReferenceId(
  fieldName: BindableAssetField,
  value: unknown,
): AgentBuilderBindableAssetId {
  const spec = getAgentBuilderBindableAssetFieldSpec(fieldName);

  return parseAgentBuilderBindableAssetId({
    assetType: spec.visibleAssetKind,
    label: `${fieldName}.id`,
    value,
  });
}

export function readOptionalString(
  input: AgentBuilderToolPayload,
  fieldName: string,
): string | null {
  const value = input[fieldName];

  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error(`${fieldName} must be a string.`);
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function readOptionalBoolean(input: AgentBuilderToolPayload, fieldName: string): boolean {
  const value = input[fieldName];

  if (value === undefined || value === null) {
    return false;
  }

  if (typeof value !== "boolean") {
    throw new Error(`${fieldName} must be a boolean.`);
  }

  return value;
}

export function readAssetReference(
  input: AgentBuilderToolPayload,
  context: AgentBuilderPlannerContext,
  fieldName: "environment",
): BindableAssetReference<"environment">;
export function readAssetReference(
  input: AgentBuilderToolPayload,
  context: AgentBuilderPlannerContext,
  fieldName: "mcpServer",
): BindableAssetReference<"mcpServer">;
export function readAssetReference(
  input: AgentBuilderToolPayload,
  context: AgentBuilderPlannerContext,
  fieldName: "skill",
): BindableAssetReference<"skill">;
export function readAssetReference(
  input: AgentBuilderToolPayload,
  context: AgentBuilderPlannerContext,
  fieldName: "space",
): BindableAssetReference<"space">;
export function readAssetReference(
  input: AgentBuilderToolPayload,
  context: AgentBuilderPlannerContext,
  fieldName: BindableAssetField,
): BindableAssetReference;
export function readAssetReference(
  input: AgentBuilderToolPayload,
  context: AgentBuilderPlannerContext,
  fieldName: BindableAssetField,
): BindableAssetReference {
  const objectValue = input[fieldName];
  const id = isRecord(objectValue)
    ? parseAssetReferenceId(fieldName, readRequiredString(objectValue["id"], `${fieldName}.id`))
    : parseAssetReferenceId(fieldName, readRequiredString(input["assetId"], "assetId"));
  const visibleAsset = findVisibleAssetReference(context, fieldName, id);

  if (visibleAsset === null) {
    throw new Error(
      `Agent Builder cannot bind ${fieldName} ${id}: asset is not in the visible asset index.`,
    );
  }

  return visibleAsset;
}

function findVisibleAssetReference(
  context: AgentBuilderPlannerContext,
  fieldName: BindableAssetField,
  assetId: AgentBuilderBindableAssetId,
): BindableAssetReference | null {
  const listKey = getAgentBuilderBindableAssetFieldSpec(fieldName).listKey;
  const asset = context.assets.currentIndex[listKey].find((candidate) => candidate.id === assetId);

  return asset === undefined
    ? null
    : {
        bindingState: asset.bindingState,
        id: parseAssetReferenceId(fieldName, asset.id),
        name: asset.name,
      };
}

function hasVisibleAsset(
  assets: readonly AgentBuilderVisibleAssetIndexEntry[],
  assetId: string,
): boolean {
  return assets.some((asset) => asset.id === assetId);
}

function createVisibleAssetIndexEntry(input: {
  bindingState: AgentBuilderVisibleAssetBindingState;
  id: string;
  kind: AgentBuilderDraftPatchAssetFieldSpec["visibleAssetKind"];
  name: string;
}): AgentBuilderVisibleAssetIndexEntry {
  return {
    bindingState: input.bindingState,
    hash: `${input.kind}:${input.id}:${input.name}`,
    id: input.id,
    kind: input.kind,
    name: input.name,
  };
}

export function withVisibleAsset(
  context: AgentBuilderPlannerContext,
  fieldName: BindableAssetField,
  asset: BindableAssetReference,
): AgentBuilderPlannerContext {
  const spec = getAgentBuilderBindableAssetFieldSpec(fieldName);
  const assets = context.assets.currentIndex[spec.listKey];

  if (hasVisibleAsset(assets, asset.id)) {
    return context;
  }

  return {
    ...context,
    assets: {
      ...context.assets,
      currentIndex: {
        ...context.assets.currentIndex,
        [spec.listKey]: [
          ...assets,
          createVisibleAssetIndexEntry({
            id: asset.id,
            bindingState: asset.bindingState,
            kind: spec.visibleAssetKind,
            name: asset.name,
          }),
        ],
      },
    },
  };
}
