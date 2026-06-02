import type { AgentBuilderStarterPackItem } from "@mosoo/contracts/agent-builder";
import { isAgentBuilderStarterPackItemBatchApprovable } from "@mosoo/contracts/agent-builder";

export interface BuilderWorkflowResultValidation {
  readonly errors: string[];
  readonly valid: boolean;
}

function hasEvidenceRef(item: AgentBuilderStarterPackItem, prefix: string): boolean {
  return item.evidenceRefs.some((ref) => ref === prefix || ref.startsWith(`${prefix}:`));
}

function requireEvidence(
  errors: string[],
  item: AgentBuilderStarterPackItem,
  evidencePrefix: string,
): void {
  if (!hasEvidenceRef(item, evidencePrefix)) {
    errors.push(`Starter Pack item ${item.nodeKey} is missing ${evidencePrefix} evidence.`);
  }
}

function prepareBindEvidenceForAssetType(
  assetType: AgentBuilderStarterPackItem["assetType"],
):
  | "prepare_bind_environment_patch"
  | "prepare_bind_mcp_patch"
  | "prepare_bind_skill_patch"
  | "prepare_bind_space_patch"
  | null {
  if (assetType === "environment") {
    return "prepare_bind_environment_patch";
  }

  if (assetType === "mcp") {
    return "prepare_bind_mcp_patch";
  }

  if (assetType === "skill") {
    return "prepare_bind_skill_patch";
  }

  if (assetType === "space") {
    return "prepare_bind_space_patch";
  }

  return null;
}

function validateDraftPatchItem(errors: string[], item: AgentBuilderStarterPackItem): void {
  requireEvidence(errors, item, "prepare_draft_patch");
  requireEvidence(errors, item, "dry_run_draft_patch");
}

function validateBindExistingAssetItem(errors: string[], item: AgentBuilderStarterPackItem): void {
  const prepareEvidence = prepareBindEvidenceForAssetType(item.assetType);

  if (prepareEvidence === null) {
    errors.push(`Starter Pack item ${item.nodeKey} cannot bind asset type ${item.assetType}.`);
    return;
  }

  requireEvidence(errors, item, "resolve_asset_reference");
  requireEvidence(errors, item, prepareEvidence);
  requireEvidence(errors, item, "dry_run_draft_patch");
}

function validateBatchApprovableItem(errors: string[], item: AgentBuilderStarterPackItem): void {
  if (!isAgentBuilderStarterPackItemBatchApprovable(item)) {
    return;
  }

  if (item.action.type === "draft_patch") {
    validateDraftPatchItem(errors, item);
    return;
  }

  validateBindExistingAssetItem(errors, item);
}

export function validateAgentBuilderStarterPackResult(input: {
  readonly items: readonly AgentBuilderStarterPackItem[];
}): BuilderWorkflowResultValidation {
  const errors: string[] = [];

  for (const item of input.items) {
    validateBatchApprovableItem(errors, item);
  }

  return {
    errors,
    valid: errors.length === 0,
  };
}
