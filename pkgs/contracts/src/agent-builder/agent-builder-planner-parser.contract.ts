import type { AgentBuilderPlannerRunId } from "../id/id.contract";
import { normalizeAgentBuilderApprovalNodeKey } from "./agent-builder-approval.contract";
import type {
  AgentBuilderDraftPatchChange,
  AgentBuilderDraftPatchReference,
  AgentBuilderDraftPatchReferenceId,
  AgentBuilderPlanNode,
  AgentBuilderPlanNodeAction,
  AgentBuilderPlanNodeActionStyle,
  AgentBuilderPlanNodeKind,
  AgentBuilderPlanNodeStatus,
  AgentBuilderPlanNodeTargetType,
  AgentBuilderPlannerOutput,
  AgentBuilderPlannerResponseMode,
} from "./agent-builder-planner-types.contract";
import {
  AGENT_BUILDER_PLANNER_RESPONSE_MODE_VALUES,
  isAgentBuilderDraftPatchFieldPath,
  isAgentBuilderDraftPatchReferenceTargetType,
  isAgentBuilderDraftPatchSectionId,
  isAgentBuilderDraftPatchValue,
  isAgentBuilderVisibleAssetBindingState,
  isAgentBuilderPlanNodeOperation,
} from "./agent-builder-planner-types.contract";

const AGENT_BUILDER_PLANNER_RESPONSE_MODES = new Set<AgentBuilderPlannerResponseMode>(
  AGENT_BUILDER_PLANNER_RESPONSE_MODE_VALUES,
);

const AGENT_BUILDER_PLAN_NODE_KINDS = new Set<AgentBuilderPlanNodeKind>([
  "blocked",
  "draft_patch",
  "question",
]);

const AGENT_BUILDER_PLAN_NODE_STATUSES = new Set<AgentBuilderPlanNodeStatus>([
  "applied",
  "blocked",
  "failed",
  "pending",
]);

const AGENT_BUILDER_PLAN_NODE_TARGET_TYPES = new Set<AgentBuilderPlanNodeTargetType>([
  "channel",
  "draft",
  "environment",
  "mcp",
  "skill",
  "space",
]);

const AGENT_BUILDER_PLAN_NODE_ACTION_STYLES = new Set<AgentBuilderPlanNodeActionStyle>([
  "danger",
  "primary",
  "secondary",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function toDraftPatchReferenceId(id: string): AgentBuilderDraftPatchReferenceId {
  return id as AgentBuilderDraftPatchReferenceId;
}

function toPlannerRunId(id: string): AgentBuilderPlannerRunId {
  return id as AgentBuilderPlannerRunId;
}

function isPlannerResponseMode(value: unknown): value is AgentBuilderPlannerResponseMode {
  return (
    isString(value) &&
    AGENT_BUILDER_PLANNER_RESPONSE_MODES.has(value as AgentBuilderPlannerResponseMode)
  );
}

function isPlanNodeKind(value: unknown): value is AgentBuilderPlanNodeKind {
  return isString(value) && AGENT_BUILDER_PLAN_NODE_KINDS.has(value as AgentBuilderPlanNodeKind);
}

function isPlanNodeStatus(value: unknown): value is AgentBuilderPlanNodeStatus {
  return (
    isString(value) && AGENT_BUILDER_PLAN_NODE_STATUSES.has(value as AgentBuilderPlanNodeStatus)
  );
}

function isPlanNodeTargetType(value: unknown): value is AgentBuilderPlanNodeTargetType {
  return (
    isString(value) &&
    AGENT_BUILDER_PLAN_NODE_TARGET_TYPES.has(value as AgentBuilderPlanNodeTargetType)
  );
}

function isPlanNodeActionStyle(value: unknown): value is AgentBuilderPlanNodeActionStyle {
  return (
    isString(value) &&
    AGENT_BUILDER_PLAN_NODE_ACTION_STYLES.has(value as AgentBuilderPlanNodeActionStyle)
  );
}

function parsePlanNodeAction(value: unknown): AgentBuilderPlanNodeAction | null {
  if (!isRecord(value)) {
    return null;
  }

  const action = {
    actionKey: value["actionKey"],
    label: value["label"],
    style: value["style"],
  };

  if (
    !isString(action.actionKey) ||
    !isString(action.label) ||
    !isPlanNodeActionStyle(action.style)
  ) {
    return null;
  }

  return {
    actionKey: action.actionKey,
    label: action.label,
    style: action.style,
  };
}

function parseDraftPatchReference(value: unknown): AgentBuilderDraftPatchReference | null {
  if (!isRecord(value)) {
    return null;
  }

  const bindingState = value["bindingState"];
  const filename = value["filename"];
  const id = value["id"];
  const name = value["name"];
  const targetType = value["targetType"];

  if (
    !isAgentBuilderVisibleAssetBindingState(bindingState) ||
    !isString(id) ||
    !isString(name) ||
    !isAgentBuilderDraftPatchReferenceTargetType(targetType) ||
    (filename !== undefined && !isString(filename))
  ) {
    return null;
  }

  return {
    bindingState,
    ...(filename === undefined ? {} : { filename }),
    id: toDraftPatchReferenceId(id),
    name,
    targetType,
  };
}

function parseDraftPatchChange(value: unknown): AgentBuilderDraftPatchChange | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (!isRecord(value)) {
    return null;
  }

  const autoApply = value["autoApply"];
  const baseDraftRevision = value["baseDraftRevision"];
  const baseValue = value["baseValue"];
  const fieldPath = value["fieldPath"];
  const patchValue = value["value"];
  const resolvedReferences = value["resolvedReferences"];
  const sectionId = value["sectionId"];
  const parsedReferences =
    resolvedReferences === undefined
      ? []
      : Array.isArray(resolvedReferences)
        ? resolvedReferences.map((entry) => parseDraftPatchReference(entry))
        : null;

  if (
    !isAgentBuilderDraftPatchFieldPath(fieldPath) ||
    !isAgentBuilderDraftPatchValue(patchValue) ||
    (autoApply !== undefined && !isBoolean(autoApply)) ||
    (baseDraftRevision !== undefined && !isString(baseDraftRevision)) ||
    (baseValue !== undefined && !isAgentBuilderDraftPatchValue(baseValue)) ||
    (sectionId !== undefined && !isAgentBuilderDraftPatchSectionId(sectionId)) ||
    parsedReferences === null ||
    parsedReferences.some((reference) => reference === null)
  ) {
    return null;
  }

  return {
    ...(autoApply === undefined ? {} : { autoApply }),
    ...(baseDraftRevision === undefined ? {} : { baseDraftRevision }),
    ...(baseValue === undefined ? {} : { baseValue }),
    fieldPath,
    ...(resolvedReferences === undefined
      ? {}
      : {
          resolvedReferences: parsedReferences.filter(
            (reference): reference is AgentBuilderDraftPatchReference => reference !== null,
          ),
        }),
    ...(sectionId === undefined ? {} : { sectionId }),
    value: patchValue,
  };
}

function parsePlanNode(value: unknown): AgentBuilderPlanNode | null {
  if (!isRecord(value)) {
    return null;
  }

  const fieldPath = value["fieldPath"];
  const rawDraftPatch = value["draftPatch"];
  const draftPatch = parseDraftPatchChange(rawDraftPatch);
  const nodeKey = normalizeAgentBuilderApprovalNodeKey(value["nodeKey"]);
  const node = {
    actions: value["actions"],
    fieldPath,
    kind: value["kind"],
    operation: value["operation"],
    requiresConfirmation: value["requiresConfirmation"],
    status: value["status"],
    summary: value["summary"],
    targetType: value["targetType"],
  };
  const actions = Array.isArray(node.actions)
    ? node.actions.map((entry) => parsePlanNodeAction(entry))
    : null;

  if (
    actions === null ||
    actions.some((action) => action === null) ||
    !isPlanNodeKind(node.kind) ||
    nodeKey === null ||
    !isAgentBuilderPlanNodeOperation(node.operation) ||
    !isBoolean(node.requiresConfirmation) ||
    !isPlanNodeStatus(node.status) ||
    !isString(node.summary) ||
    !isPlanNodeTargetType(node.targetType) ||
    (fieldPath !== undefined && fieldPath !== null && !isString(fieldPath)) ||
    (rawDraftPatch !== undefined && rawDraftPatch !== null && draftPatch === null)
  ) {
    return null;
  }

  return {
    actions: actions.filter((action): action is AgentBuilderPlanNodeAction => action !== null),
    ...(draftPatch === null ? {} : { draftPatch }),
    ...(fieldPath === undefined || fieldPath === null ? {} : { fieldPath }),
    kind: node.kind,
    nodeKey,
    operation: node.operation,
    requiresConfirmation: node.requiresConfirmation,
    status: node.status,
    summary: node.summary,
    targetType: node.targetType,
  };
}

export function parseAgentBuilderPlannerOutput(value: unknown): AgentBuilderPlannerOutput | null {
  if (!isRecord(value) || value["version"] !== 1 || !Array.isArray(value["nodes"])) {
    return null;
  }

  const assistantText = value["assistantText"];
  const intentSummary = value["intentSummary"];
  const mode = value["mode"];
  const plannerRunId = value["plannerRunId"];
  const nodes = value["nodes"].map((entry) => parsePlanNode(entry));
  const compactNodes = nodes.filter((node): node is AgentBuilderPlanNode => node !== null);
  const nodeKeys = compactNodes.map((node) => node.nodeKey);

  if (
    !isString(assistantText) ||
    !isString(intentSummary) ||
    !isPlannerResponseMode(mode) ||
    !isString(plannerRunId) ||
    nodes.some((node) => node === null) ||
    new Set(nodeKeys).size !== nodeKeys.length
  ) {
    return null;
  }

  return {
    assistantText,
    intentSummary,
    mode,
    nodes: compactNodes,
    plannerRunId: toPlannerRunId(plannerRunId),
    version: 1,
  };
}

export function parseAgentBuilderPlannerOutputJson(
  value: string,
): AgentBuilderPlannerOutput | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return parseAgentBuilderPlannerOutput(parsed);
  } catch {
    return null;
  }
}
