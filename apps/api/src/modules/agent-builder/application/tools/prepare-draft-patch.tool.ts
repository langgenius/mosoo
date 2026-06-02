import type {
  AgentBuilderDraftPatchFieldPath,
  AgentBuilderDraftPatchValue,
  AgentBuilderDraftPatchOperation,
  AgentBuilderPlanNode,
  AgentBuilderPlannerContext,
} from "@mosoo/contracts/agent-builder";
import type { AgentBuilderToolPayload } from "@mosoo/contracts/agent-builder";
import {
  isAgentBuilderDraftPatchOperation,
  isAgentBuilderDraftPatchValue,
  resolveAgentBuilderDraftPatchFieldPath,
} from "@mosoo/contracts/agent-builder";
import type { AccountId } from "@mosoo/id";

import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { normalizeAgentBuilderDraftPatchNodes } from "../agent-builder-draft-patch-normalizer.service";
import type { AgentBuilderToolDefinition } from "../agent-builder-tool-runtime.service";

export interface PrepareAgentBuilderDraftPatchOptions {
  actorAccountId: AccountId;
  bindings: ApiBindings;
  context: AgentBuilderPlannerContext;
}

interface PrepareDraftPatchChangeInput {
  readonly fieldPath: AgentBuilderDraftPatchFieldPath;
  readonly nodeKey: string;
  readonly operation: AgentBuilderDraftPatchOperation;
  readonly summary: string;
  readonly value: AgentBuilderDraftPatchValue;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readFieldPath(value: unknown, index: number): AgentBuilderDraftPatchFieldPath {
  const fieldPath = resolveAgentBuilderDraftPatchFieldPath(value);

  if (fieldPath === null) {
    throw new Error(`prepare_draft_patch changes.${index}.fieldPath is unsupported.`);
  }

  return fieldPath;
}

function readPatchValue(value: unknown, index: number): AgentBuilderDraftPatchValue {
  if (!isAgentBuilderDraftPatchValue(value)) {
    throw new Error(`prepare_draft_patch changes.${index}.value is invalid.`);
  }

  return value;
}

function readOperation(value: unknown, index: number): AgentBuilderDraftPatchOperation {
  if (value === undefined || value === null || value === "") {
    return "update";
  }

  if (typeof value !== "string") {
    throw new Error(`prepare_draft_patch changes.${index}.operation is unsupported.`);
  }

  const operation = value.trim();

  if (!isAgentBuilderDraftPatchOperation(operation)) {
    throw new Error(`prepare_draft_patch changes.${index}.operation is unsupported.`);
  }

  return operation;
}

function readOptionalString(value: unknown, fieldName: string): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error(`prepare_draft_patch ${fieldName} must be a string.`);
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function createDefaultNodeKey(fieldPath: AgentBuilderDraftPatchFieldPath, index: number): string {
  return `prepare_draft_patch_${fieldPath}_${index + 1}`;
}

function createDefaultSummary(input: {
  fieldPath: AgentBuilderDraftPatchFieldPath;
  operation: AgentBuilderDraftPatchOperation;
}): string {
  return input.operation === "remove"
    ? `Remove ${input.fieldPath} from the Draft.`
    : `Update ${input.fieldPath} in the Draft.`;
}

function readChanges(input: AgentBuilderToolPayload): PrepareDraftPatchChangeInput[] {
  const rawChanges = input["changes"];

  if (!Array.isArray(rawChanges) || rawChanges.length === 0) {
    throw new Error("prepare_draft_patch requires a non-empty changes array.");
  }

  return rawChanges.map((rawChange, index) => {
    if (!isRecord(rawChange)) {
      throw new Error(`prepare_draft_patch changes.${index} must be an object.`);
    }

    const fieldPath = readFieldPath(rawChange["fieldPath"], index);
    const operation = readOperation(rawChange["operation"], index);
    const nodeKey = readOptionalString(rawChange["nodeKey"], `changes.${index}.nodeKey`);
    const summary = readOptionalString(rawChange["summary"], `changes.${index}.summary`);

    return {
      fieldPath,
      nodeKey: nodeKey ?? createDefaultNodeKey(fieldPath, index),
      operation,
      summary: summary ?? createDefaultSummary({ fieldPath, operation }),
      value: readPatchValue(rawChange["value"], index),
    };
  });
}

function toPlanNode(change: PrepareDraftPatchChangeInput): AgentBuilderPlanNode {
  return {
    actions: [],
    draftPatch: {
      fieldPath: change.fieldPath,
      value: change.value,
    },
    fieldPath: change.fieldPath,
    kind: "draft_patch",
    nodeKey: change.nodeKey,
    operation: change.operation,
    requiresConfirmation: false,
    status: "pending",
    summary: change.summary,
    targetType: "draft",
  };
}

function countNodesByStatus(
  nodes: readonly AgentBuilderPlanNode[],
  status: AgentBuilderPlanNode["status"],
): number {
  return nodes.filter((node) => node.status === status).length;
}

export async function prepareAgentBuilderDraftPatch(
  options: PrepareAgentBuilderDraftPatchOptions,
  input: AgentBuilderToolPayload,
): Promise<AgentBuilderToolPayload> {
  const nodes = await normalizeAgentBuilderDraftPatchNodes({
    actorAccountId: options.actorAccountId,
    bindings: options.bindings,
    context: options.context,
    mode: "draft_patch",
    nodes: readChanges(input).map(toPlanNode),
  });
  const appliedCount = countNodesByStatus(nodes, "applied");
  const blockedCount = countNodesByStatus(nodes, "blocked");

  return {
    appliedCount,
    blockedCount,
    itemCount: nodes.length,
    mode: "draft_patch",
    nodes,
    patches: nodes.flatMap((node) =>
      node.status === "applied" && node.draftPatch !== undefined ? [node.draftPatch] : [],
    ),
    status: blockedCount === 0 ? "ready" : appliedCount > 0 ? "partial" : "blocked",
  };
}

export function createPrepareDraftPatchTool(
  options: PrepareAgentBuilderDraftPatchOptions,
): AgentBuilderToolDefinition {
  return {
    execute(input) {
      return prepareAgentBuilderDraftPatch(options, input);
    },
    toolId: "prepare_draft_patch",
  };
}
