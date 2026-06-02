import {
  listAgentBuilderStarterPackBatchApprovableItems,
  normalizeAgentBuilderExternalSetupHref,
  parseAgentBuilderStarterPackResult,
} from "@mosoo/contracts/agent-builder";
import type {
  AgentBuilderStarterPackItem,
  AgentBuilderStarterPackItemStatus,
  AgentBuilderStarterPackResult,
} from "@mosoo/contracts/agent-builder";
import { Check, ExternalLink } from "lucide-react";
import type { ReactElement } from "react";

import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";

type StarterPackBadgeVariant = "danger" | "success" | "warning";

const STARTER_PACK_STATUS_LABELS: Record<AgentBuilderStarterPackItemStatus, string> = {
  applied: "已应用",
  approved: "已确认",
  blocked: "已拦截",
  needs_config: "需配置",
  pending: "待确认",
  skipped: "已跳过",
};

const STARTER_PACK_ASSET_TYPE_LABELS: Record<AgentBuilderStarterPackItem["assetType"], string> = {
  agent_field: "Draft",
  environment: "Environment",
  mcp: "MCP",
  skill: "Skill",
  space: "Space",
};

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

function getStarterPackActionLabel(item: AgentBuilderStarterPackItem): string | null {
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

function isStarterPackItemIndividuallyApprovable(item: AgentBuilderStarterPackItem): boolean {
  return (
    (item.status === "pending" || item.status === "approved") &&
    (item.approvalMode === "single_only" || item.approvalMode === "single_or_batch") &&
    (item.action.type === "bind_existing_asset" || item.action.type === "draft_patch")
  );
}

function getStarterPackApprovalButtonLabel(item: AgentBuilderStarterPackItem): string {
  if (item.status === "approved") {
    return getStarterPackActionLabel(item) ?? "应用";
  }

  return "确认";
}

function StarterPackItemCard({
  approvalsDisabled,
  item,
  onApproveItem,
}: {
  approvalsDisabled: boolean;
  item: AgentBuilderStarterPackItem;
  onApproveItem?: ((nodeKey: string) => void) | undefined;
}): ReactElement {
  const actionLabel = getStarterPackActionLabel(item);
  const canApprove = isStarterPackItemIndividuallyApprovable(item);
  const setupHref =
    item.action.type === "open_external_setup"
      ? normalizeAgentBuilderExternalSetupHref({
          assetType: item.assetType,
          href: item.action.href,
        })
      : null;

  return (
    <div className="bg-bg-1 rounded-md p-2.5 text-left">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Badge variant={getStarterPackStatusBadgeVariant(item.status)}>
          {STARTER_PACK_STATUS_LABELS[item.status]}
        </Badge>
        <span className="text-foreground text-[12px] leading-none font-semibold break-words">
          {STARTER_PACK_ASSET_TYPE_LABELS[item.assetType]}
        </span>
      </div>
      <div className="text-foreground mt-2 text-[13px] leading-relaxed font-medium break-words">
        {item.title}
      </div>
      <div className="text-muted-foreground mt-1 text-[12px] leading-relaxed break-words">
        {item.reason}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {setupHref !== null ? (
          <Button asChild size="sm" type="button" variant="secondary">
            <a href={setupHref}>
              <ExternalLink />
              {actionLabel}
            </a>
          </Button>
        ) : actionLabel === null || canApprove ? null : (
          <Badge variant="outline">{actionLabel}</Badge>
        )}
        {onApproveItem === undefined || !canApprove ? null : (
          <Button
            disabled={approvalsDisabled}
            onClick={() => onApproveItem(item.nodeKey)}
            size="sm"
            type="button"
            variant="tonal"
          >
            <Check />
            {getStarterPackApprovalButtonLabel(item)}
          </Button>
        )}
      </div>
    </div>
  );
}

export function StarterPackCard({
  approvalsDisabled = false,
  onApproveAll,
  onApproveItem,
  result,
}: {
  approvalsDisabled?: boolean | undefined;
  onApproveAll?: ((nodeKeys: string[]) => void) | undefined;
  onApproveItem?: ((nodeKey: string) => void) | undefined;
  result: AgentBuilderStarterPackResult;
}): ReactElement | null {
  if (result.items.length === 0) {
    return null;
  }

  const approvableNodeKeys = listStarterPackApprovableNodeKeys(result);

  return (
    <div className="border-border-subtle mt-2.5 space-y-2 border-t pt-2.5">
      {onApproveAll === undefined || approvableNodeKeys.length <= 1 ? null : (
        <div className="flex justify-end">
          <Button
            disabled={approvalsDisabled}
            onClick={() => onApproveAll(approvableNodeKeys)}
            size="sm"
            type="button"
          >
            <Check />
            全部确认
          </Button>
        </div>
      )}
      {result.items.map((item) => (
        <StarterPackItemCard
          approvalsDisabled={approvalsDisabled}
          item={item}
          key={item.nodeKey}
          onApproveItem={onApproveItem}
        />
      ))}
    </div>
  );
}
