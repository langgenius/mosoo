import type {
  AgentBuilderStarterPackItem,
  AgentBuilderStarterPackResult,
} from "@mosoo/contracts/agent-builder";
import { normalizeAgentBuilderApprovalNodeKey } from "@mosoo/contracts/agent-builder";

export type AgentBuilderStarterPackApprovalRequest =
  | {
      mode: "batch";
    }
  | {
      mode: "single";
      nodeKey: string;
    };

export interface AgentBuilderStarterPackApprovalSkippedItem {
  readonly nodeKey: string;
  readonly reason: string;
}

export interface AgentBuilderStarterPackApprovalPlan {
  readonly approvedItems: AgentBuilderStarterPackItem[];
  readonly skippedItems: AgentBuilderStarterPackApprovalSkippedItem[];
}

function isExecutableStarterPackAction(item: AgentBuilderStarterPackItem): boolean {
  return item.action.type === "bind_existing_asset" || item.action.type === "draft_patch";
}

function isSingleValueBindingItem(item: AgentBuilderStarterPackItem): boolean {
  return item.assetType === "environment" && item.action.type === "bind_existing_asset";
}

function getStarterPackApprovalSkipReason(
  item: AgentBuilderStarterPackItem,
  request: AgentBuilderStarterPackApprovalRequest,
): string | null {
  if (
    request.mode === "single" &&
    item.status === "approved" &&
    isExecutableStarterPackAction(item)
  ) {
    return null;
  }

  if (item.status !== "pending") {
    return `Starter Pack item ${item.nodeKey} is ${item.status}, not pending.`;
  }

  if (!isExecutableStarterPackAction(item)) {
    return `Starter Pack item ${item.nodeKey} has no server-executable approval action.`;
  }

  if (item.approvalMode === "blocked" || item.approvalMode === "external_config") {
    return `Starter Pack item ${item.nodeKey} requires ${item.approvalMode} handling.`;
  }

  if (request.mode === "batch" && item.approvalMode !== "single_or_batch") {
    return `Starter Pack item ${item.nodeKey} is not eligible for Approve all.`;
  }

  return null;
}

function toSkippedItem(
  item: AgentBuilderStarterPackItem,
  reason: string,
): AgentBuilderStarterPackApprovalSkippedItem {
  return {
    nodeKey: item.nodeKey,
    reason,
  };
}

function getSingleValueBindingSkipReason(
  item: AgentBuilderStarterPackItem,
  selectedItem: AgentBuilderStarterPackItem,
): string {
  const selectedName = selectedItem.assetName ?? selectedItem.nodeKey;

  return `Starter Pack item ${item.nodeKey} was skipped because Environment is a single-value Draft field and ${selectedName} was selected.`;
}

function enforceSingleValueBindingApproval(input: {
  approvedItems: readonly AgentBuilderStarterPackItem[];
  result: AgentBuilderStarterPackResult;
  skippedItems: readonly AgentBuilderStarterPackApprovalSkippedItem[];
}): AgentBuilderStarterPackApprovalPlan {
  const approvedItems: AgentBuilderStarterPackItem[] = [];
  const skippedItems: AgentBuilderStarterPackApprovalSkippedItem[] = [...input.skippedItems];
  const skippedNodeKeys = new Set(skippedItems.map((item) => item.nodeKey));
  let selectedEnvironmentItem: AgentBuilderStarterPackItem | null = null;

  for (const item of input.approvedItems) {
    if (!isSingleValueBindingItem(item)) {
      approvedItems.push(item);
      continue;
    }

    if (selectedEnvironmentItem === null) {
      selectedEnvironmentItem = item;
      approvedItems.push(item);
      continue;
    }

    if (!skippedNodeKeys.has(item.nodeKey)) {
      skippedItems.push(
        toSkippedItem(item, getSingleValueBindingSkipReason(item, selectedEnvironmentItem)),
      );
      skippedNodeKeys.add(item.nodeKey);
    }
  }

  if (selectedEnvironmentItem === null) {
    return {
      approvedItems,
      skippedItems,
    };
  }

  for (const item of input.result.items) {
    if (
      item.nodeKey === selectedEnvironmentItem.nodeKey ||
      item.status !== "pending" ||
      !isSingleValueBindingItem(item) ||
      skippedNodeKeys.has(item.nodeKey)
    ) {
      continue;
    }

    skippedItems.push(
      toSkippedItem(item, getSingleValueBindingSkipReason(item, selectedEnvironmentItem)),
    );
    skippedNodeKeys.add(item.nodeKey);
  }

  return {
    approvedItems,
    skippedItems,
  };
}

export function prepareAgentBuilderStarterPackApproval(
  result: AgentBuilderStarterPackResult,
  request: AgentBuilderStarterPackApprovalRequest,
): AgentBuilderStarterPackApprovalPlan {
  const singleNodeKey =
    request.mode === "single" ? normalizeAgentBuilderApprovalNodeKey(request.nodeKey) : null;

  if (request.mode === "single" && singleNodeKey === null) {
    throw new Error("Starter Pack single approval requires nodeKey.");
  }

  const candidates =
    request.mode === "batch"
      ? result.items
      : result.items.filter((item) => item.nodeKey === singleNodeKey);

  if (request.mode === "single" && candidates.length === 0) {
    throw new Error(`Starter Pack item ${request.nodeKey} was not found.`);
  }

  const approvedItems: AgentBuilderStarterPackItem[] = [];
  const skippedItems: AgentBuilderStarterPackApprovalSkippedItem[] = [];

  for (const item of candidates) {
    const skipReason = getStarterPackApprovalSkipReason(item, request);

    if (skipReason === null) {
      approvedItems.push(item);
    } else {
      skippedItems.push(toSkippedItem(item, skipReason));
    }
  }

  return enforceSingleValueBindingApproval({
    approvedItems,
    result,
    skippedItems,
  });
}
