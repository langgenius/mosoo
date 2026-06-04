import {
  listAgentBuilderStarterPackBatchApprovableItems,
  parseAgentBuilderStarterPackResult,
} from "@mosoo/contracts/agent-builder";
import type {
  AgentBuilderStarterPackItem,
  AgentBuilderStarterPackItemStatus,
  AgentBuilderStarterPackResult,
} from "@mosoo/contracts/agent-builder";

export type StarterPackBadgeVariant = "danger" | "success" | "warning";

export function getStarterPackStatusBadgeVariant(
  status: AgentBuilderStarterPackItemStatus,
): StarterPackBadgeVariant {
  switch (status) {
    case "applied":
    case "approved":
      return "success";
    case "blocked":
      return "danger";
    case "needs_config":
    case "pending":
    case "skipped":
      return "warning";
  }
}

export function listStarterPackApprovableNodeKeys(result: AgentBuilderStarterPackResult): string[] {
  return listAgentBuilderStarterPackBatchApprovableItems(result).map((item) => item.nodeKey);
}

export function parseAgentBuilderStarterPackCardsJson(
  cardsJson: string | null,
): AgentBuilderStarterPackResult | null {
  if (cardsJson === null) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(cardsJson);
    return parseAgentBuilderStarterPackResult(parsed);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return null;
    }

    throw error;
  }
}

export function getStarterPackActionLabel(item: AgentBuilderStarterPackItem): string | null {
  switch (item.action.type) {
    case "bind_existing_asset":
      return item.assetName === undefined ? "绑定已有资产" : `绑定 ${item.assetName}`;
    case "draft_patch":
      return "更新 Draft";
    case "open_external_setup":
      return "去配置";
    case "none":
      return null;
  }
}

export function isStarterPackItemIndividuallyApprovable(
  item: AgentBuilderStarterPackItem,
): boolean {
  return (
    (item.status === "pending" || item.status === "approved") &&
    (item.approvalMode === "single_only" || item.approvalMode === "single_or_batch") &&
    (item.action.type === "bind_existing_asset" || item.action.type === "draft_patch")
  );
}

export function getStarterPackApprovalButtonLabel(item: AgentBuilderStarterPackItem): string {
  if (item.status === "approved") {
    return getStarterPackActionLabel(item) ?? "应用";
  }

  return "确认";
}
