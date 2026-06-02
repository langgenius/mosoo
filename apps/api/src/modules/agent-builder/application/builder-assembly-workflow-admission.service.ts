import type {
  AgentBuilderStarterPackItem,
  AgentBuilderStarterPackItemAssetType,
  AgentBuilderStarterPackResult,
  AgentBuilderToolExecutionRecord,
  AgentBuilderToolId,
} from "@mosoo/contracts/agent-builder";
import {
  AGENT_BUILDER_STARTER_PACK_APPROVAL_MODE_VALUES,
  AGENT_BUILDER_STARTER_PACK_ASSET_TYPE_VALUES,
  AGENT_BUILDER_STARTER_PACK_STATUS_VALUES,
  normalizeAgentBuilderApprovalNodeKey,
  parseAgentBuilderStarterPackResult,
} from "@mosoo/contracts/agent-builder";
import type { AgentBuilderPlannerRunId } from "@mosoo/id";

import type { AgentBuilderBindableAssetId } from "./agent-builder-ids";
import { parseAgentBuilderBindableAssetId } from "./agent-builder-ids";
import { validateAgentBuilderStarterPackResult } from "./builder-workflow-result-validator.service";

export interface AgentBuilderAssemblyWorkflowAdmission {
  readonly errors: string[];
  readonly result: AgentBuilderStarterPackResult | null;
  readonly valid: boolean;
}

interface AgentBuilderAssemblyWorkflowAdmissionOptions {
  readonly plannerRunId: AgentBuilderPlannerRunId;
  readonly trace?: readonly AgentBuilderToolExecutionRecord[];
}

interface BoundResolvedAsset {
  readonly assetType: AgentBuilderStarterPackItemAssetType;
  readonly id: AgentBuilderBindableAssetId;
  readonly name: string;
}

const STARTER_PACK_ASSET_TYPES = new Set<string>(AGENT_BUILDER_STARTER_PACK_ASSET_TYPE_VALUES);
const STARTER_PACK_APPROVAL_MODES = new Set<string>(
  AGENT_BUILDER_STARTER_PACK_APPROVAL_MODE_VALUES,
);
const STARTER_PACK_STATUSES = new Set<string>(AGENT_BUILDER_STARTER_PACK_STATUS_VALUES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isBindableStarterPackAssetType(
  value: unknown,
): value is Exclude<AgentBuilderStarterPackItemAssetType, "agent_field"> {
  return value === "environment" || value === "mcp" || value === "skill" || value === "space";
}

function readNonEmptyString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function readEnumValue(
  value: unknown,
  allowedValues: ReadonlySet<string>,
  fallback: string,
): string {
  return typeof value === "string" && allowedValues.has(value) ? value : fallback;
}

function normalizeStarterPackActionLike(item: Record<string, unknown>): Record<string, unknown> {
  const rawAction = item["action"];

  if (isRecord(rawAction)) {
    return rawAction;
  }

  const patchNodeKey = item["patchNodeKey"];
  if (typeof patchNodeKey === "string" && patchNodeKey.trim().length > 0) {
    return {
      patchNodeKey: patchNodeKey.trim(),
      type: "draft_patch",
    };
  }

  const assetId = item["assetId"];
  if (typeof assetId === "string" && assetId.trim().length > 0) {
    return {
      assetId: assetId.trim(),
      type: "bind_existing_asset",
    };
  }

  const href = item["href"];
  if (typeof href === "string" && href.trim().length > 0) {
    return {
      href: href.trim(),
      type: "open_external_setup",
    };
  }

  return {
    type: "none",
  };
}

function defaultAssetTypeForAction(action: Record<string, unknown>): string {
  if (action["type"] === "draft_patch" || action["type"] === "none") {
    return "agent_field";
  }

  return "space";
}

function defaultApprovalModeForAction(action: Record<string, unknown>): string {
  if (action["type"] === "open_external_setup") {
    return "external_config";
  }

  if (action["type"] === "none") {
    return "blocked";
  }

  return "single_or_batch";
}

function defaultStatusForAction(action: Record<string, unknown>): string {
  if (action["type"] === "open_external_setup") {
    return "needs_config";
  }

  if (action["type"] === "none") {
    return "blocked";
  }

  return "pending";
}

function nodeKeyPart(value: string): string {
  return (
    value
      .normalize("NFKC")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "_")
      .replace(/^_+|_+$/gu, "")
      .slice(0, 48) || "unknown"
  );
}

function defaultNodeKeyForAction(action: Record<string, unknown>, assetType: string): string {
  const patchNodeKey = action["patchNodeKey"];
  const normalizedPatchNodeKey = normalizeAgentBuilderApprovalNodeKey(patchNodeKey);

  if (normalizedPatchNodeKey !== null) {
    return normalizedPatchNodeKey;
  }

  const assetId = action["assetId"];
  if (typeof assetId === "string" && assetId.trim().length > 0) {
    return `bind_${nodeKeyPart(assetType)}_${nodeKeyPart(assetId)}`;
  }

  const href = action["href"];
  if (typeof href === "string" && href.trim().length > 0) {
    return `open_${nodeKeyPart(assetType)}_${nodeKeyPart(href)}`;
  }

  const type = typeof action["type"] === "string" ? action["type"] : "item";

  return `${nodeKeyPart(assetType)}_${nodeKeyPart(type)}`;
}

function normalizeStarterPackItemLike(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }

  const action = normalizeStarterPackActionLike(value);
  const assetType = readEnumValue(
    value["assetType"],
    STARTER_PACK_ASSET_TYPES,
    defaultAssetTypeForAction(action),
  );
  const nodeKey =
    normalizeAgentBuilderApprovalNodeKey(value["nodeKey"]) ??
    defaultNodeKeyForAction(action, assetType);
  const title = readNonEmptyString(value["title"], nodeKey);
  const reason = readNonEmptyString(value["reason"], title);

  return {
    ...value,
    action,
    approvalMode: readEnumValue(
      value["approvalMode"],
      STARTER_PACK_APPROVAL_MODES,
      defaultApprovalModeForAction(action),
    ),
    assetType,
    evidenceRefs: isStringArray(value["evidenceRefs"]) ? value["evidenceRefs"] : [],
    nodeKey,
    reason,
    status: readEnumValue(value["status"], STARTER_PACK_STATUSES, defaultStatusForAction(action)),
    title,
  };
}

function normalizeStarterPackResultLike(
  value: unknown,
  options: AgentBuilderAssemblyWorkflowAdmissionOptions,
): unknown {
  if (!isRecord(value) || (value["mode"] !== "starter_pack" && !Array.isArray(value["items"]))) {
    return value;
  }

  const items = value["items"];

  return {
    ...value,
    assistantText: readNonEmptyString(
      value["assistantText"],
      "Agent Builder prepared a Starter Pack.",
    ),
    intentSummary: readNonEmptyString(value["intentSummary"], "Prepare a Starter Pack."),
    items: Array.isArray(items) ? items.map(normalizeStarterPackItemLike) : [],
    mode: "starter_pack",
    plannerRunId: readNonEmptyString(value["plannerRunId"], options.plannerRunId),
    version: 1,
  };
}

function payloadContains(value: unknown, needle: string): boolean {
  try {
    return JSON.stringify(value).includes(needle);
  } catch {
    return false;
  }
}

function findCompletedToolRecord(input: {
  needle?: string;
  toolId: AgentBuilderToolId;
  trace: readonly AgentBuilderToolExecutionRecord[];
}): AgentBuilderToolExecutionRecord | null {
  const completedRecords = input.trace.filter(
    (record) => record.toolId === input.toolId && record.status === "completed",
  );

  if (input.needle === undefined) {
    return completedRecords[0] ?? null;
  }

  return (
    completedRecords.find(
      (record) =>
        payloadContains(record.input, input.needle ?? "") ||
        payloadContains(record.output, input.needle ?? ""),
    ) ??
    completedRecords[0] ??
    null
  );
}

function addTraceEvidence(input: {
  evidenceRefs: Set<string>;
  needle?: string;
  toolId: AgentBuilderToolId;
  trace: readonly AgentBuilderToolExecutionRecord[];
}): void {
  const record = findCompletedToolRecord(input);

  if (record === null) {
    return;
  }

  input.evidenceRefs.add(
    input.needle === undefined ? input.toolId : `${input.toolId}:${input.needle}`,
  );
}

function prepareBindToolIdForAssetType(
  assetType: AgentBuilderStarterPackItem["assetType"],
): AgentBuilderToolId | null {
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

function displayAssetType(assetType: AgentBuilderStarterPackItemAssetType): string {
  if (assetType === "environment") {
    return "Environment";
  }

  if (assetType === "mcp") {
    return "MCP";
  }

  if (assetType === "skill") {
    return "Skill";
  }

  if (assetType === "space") {
    return "Space";
  }

  return "Draft";
}

function readBoundResolvedAssets(
  trace: readonly AgentBuilderToolExecutionRecord[],
): Map<string, BoundResolvedAsset> {
  const assets = new Map<string, BoundResolvedAsset>();

  for (const record of trace) {
    if (
      record.toolId !== "resolve_asset_reference" ||
      record.status !== "completed" ||
      record.errorMessage !== null ||
      !isRecord(record.output) ||
      record.output["status"] !== "resolved"
    ) {
      continue;
    }

    const resolvedAsset = isRecord(record.output["resolvedAsset"])
      ? record.output["resolvedAsset"]
      : null;

    if (resolvedAsset === null || resolvedAsset["bindingState"] !== "bound") {
      continue;
    }

    const assetType = resolvedAsset["assetType"];
    const id = resolvedAsset["id"];
    const name = resolvedAsset["name"];

    if (
      !isBindableStarterPackAssetType(assetType) ||
      typeof id !== "string" ||
      id.trim().length === 0 ||
      typeof name !== "string" ||
      name.trim().length === 0
    ) {
      continue;
    }

    const assetId = parseAgentBuilderBindableAssetId({
      assetType,
      label: "resolvedAsset.id",
      value: id,
    });

    assets.set(assetId, {
      assetType,
      id: assetId,
      name: name.trim(),
    });
  }

  return assets;
}

function markAlreadyBoundItemFromTrace(input: {
  boundAssets: ReadonlyMap<string, BoundResolvedAsset>;
  item: AgentBuilderStarterPackItem;
}): AgentBuilderStarterPackItem {
  if (input.item.action.type !== "bind_existing_asset" || input.item.status !== "pending") {
    return input.item;
  }

  const boundAsset = input.boundAssets.get(input.item.action.assetId);

  if (boundAsset === undefined) {
    return input.item;
  }

  return {
    ...input.item,
    action: {
      type: "none",
    },
    approvalMode: "blocked",
    assetId: boundAsset.id,
    assetName: boundAsset.name,
    assetType: boundAsset.assetType,
    evidenceRefs: Array.from(
      new Set([...input.item.evidenceRefs, `resolve_asset_reference:${boundAsset.id}`]),
    ),
    reason: `${displayAssetType(boundAsset.assetType)} ${boundAsset.name} 已经绑定到当前 Agent Draft，无需再次确认。`,
    status: "applied",
    title: `已绑定 ${displayAssetType(boundAsset.assetType)}：${boundAsset.name}`,
  };
}

function markAlreadyBoundItemsFromTrace(
  result: AgentBuilderStarterPackResult,
  trace: readonly AgentBuilderToolExecutionRecord[] | undefined,
): AgentBuilderStarterPackResult {
  if (trace === undefined || trace.length === 0) {
    return result;
  }

  const boundAssets = readBoundResolvedAssets(trace);

  if (boundAssets.size === 0) {
    return result;
  }

  return {
    ...result,
    items: result.items.map((item) =>
      markAlreadyBoundItemFromTrace({
        boundAssets,
        item,
      }),
    ),
  };
}

function enrichItemEvidenceFromTrace(
  item: AgentBuilderStarterPackItem,
  trace: readonly AgentBuilderToolExecutionRecord[],
): AgentBuilderStarterPackItem {
  const evidenceRefs = new Set(item.evidenceRefs);

  if (item.action.type === "draft_patch") {
    const patchNodeKey = item.action.patchNodeKey;

    addTraceEvidence({
      evidenceRefs,
      needle: patchNodeKey,
      toolId: "prepare_draft_patch",
      trace,
    });
    addTraceEvidence({
      evidenceRefs,
      needle: patchNodeKey,
      toolId: "dry_run_draft_patch",
      trace,
    });
  }

  if (item.action.type === "bind_existing_asset") {
    const assetId = item.action.assetId;
    const prepareToolId = prepareBindToolIdForAssetType(item.assetType);

    addTraceEvidence({
      evidenceRefs,
      needle: assetId,
      toolId: "resolve_asset_reference",
      trace,
    });

    if (prepareToolId !== null) {
      addTraceEvidence({
        evidenceRefs,
        needle: assetId,
        toolId: prepareToolId,
        trace,
      });
    }

    addTraceEvidence({
      evidenceRefs,
      needle: assetId,
      toolId: "dry_run_draft_patch",
      trace,
    });
  }

  return {
    ...item,
    evidenceRefs: [...evidenceRefs],
  };
}

function enrichResultEvidenceFromTrace(
  result: AgentBuilderStarterPackResult,
  trace: readonly AgentBuilderToolExecutionRecord[] | undefined,
): AgentBuilderStarterPackResult {
  if (trace === undefined || trace.length === 0) {
    return result;
  }

  return {
    ...result,
    items: result.items.map((item) => enrichItemEvidenceFromTrace(item, trace)),
  };
}

export function admitAgentBuilderStarterPackWorkflowResult(
  value: unknown,
  options: AgentBuilderAssemblyWorkflowAdmissionOptions,
): AgentBuilderAssemblyWorkflowAdmission {
  const parsedResult = parseAgentBuilderStarterPackResult(
    normalizeStarterPackResultLike(value, options),
  );

  if (parsedResult === null) {
    return {
      errors: ["Agent Builder workflow did not return a valid Starter Pack result."],
      result: null,
      valid: false,
    };
  }

  const result = markAlreadyBoundItemsFromTrace(
    enrichResultEvidenceFromTrace(parsedResult, options.trace),
    options.trace,
  );
  const validation = validateAgentBuilderStarterPackResult(result);

  return {
    errors: validation.errors,
    result,
    valid: validation.valid,
  };
}
