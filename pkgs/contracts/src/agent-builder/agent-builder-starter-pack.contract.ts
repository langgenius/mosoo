import type {
  AgentBuilderPlannerRunId,
  EnvironmentId,
  McpServerId,
  SkillId,
  SpaceId,
} from "../id/id.contract";
import type {
  AgentBuilderApprovalMode,
  AgentBuilderApprovalPolicy,
} from "./agent-builder-approval.contract";
import { normalizeAgentBuilderApprovalNodeKey } from "./agent-builder-approval.contract";

type AgentBuilderStarterPackAssetId = EnvironmentId | McpServerId | SkillId | SpaceId;

export type AgentBuilderStarterPackItemAssetType =
  | "agent_field"
  | "environment"
  | "mcp"
  | "skill"
  | "space";

export type AgentBuilderStarterPackItemStatus =
  | "applied"
  | "approved"
  | "blocked"
  | "needs_config"
  | "pending"
  | "skipped";

export type AgentBuilderStarterPackWorkflowItemStatus = Exclude<
  AgentBuilderStarterPackItemStatus,
  "approved"
>;

export type AgentBuilderStarterPackApprovalMode = Extract<
  AgentBuilderApprovalMode,
  "blocked" | "external_config" | "single_only" | "single_or_batch"
>;

export type AgentBuilderStarterPackItemAction =
  | {
      patchNodeKey: string;
      type: "draft_patch";
    }
  | {
      assetId: AgentBuilderStarterPackAssetId;
      type: "bind_existing_asset";
    }
  | {
      href: string;
      type: "open_external_setup";
    }
  | {
      type: "none";
    };

export interface AgentBuilderStarterPackItem {
  action: AgentBuilderStarterPackItemAction;
  approvalMode: AgentBuilderStarterPackApprovalMode;
  assetId?: AgentBuilderStarterPackAssetId;
  assetName?: string;
  assetType: AgentBuilderStarterPackItemAssetType;
  evidenceRefs: string[];
  nodeKey: string;
  reason: string;
  status: AgentBuilderStarterPackItemStatus;
  title: string;
}

export interface AgentBuilderStarterPackResult {
  assistantText: string;
  intentSummary: string;
  items: AgentBuilderStarterPackItem[];
  mode: "starter_pack";
  plannerRunId: AgentBuilderPlannerRunId;
  version: 1;
}

export const AGENT_BUILDER_STARTER_PACK_ASSET_TYPE_VALUES = [
  "agent_field",
  "environment",
  "mcp",
  "skill",
  "space",
] as const satisfies readonly AgentBuilderStarterPackItemAssetType[];

export const AGENT_BUILDER_STARTER_PACK_STATUS_VALUES = [
  "applied",
  "approved",
  "blocked",
  "needs_config",
  "pending",
  "skipped",
] as const satisfies readonly AgentBuilderStarterPackItemStatus[];

export const AGENT_BUILDER_STARTER_PACK_WORKFLOW_STATUS_VALUES = [
  "applied",
  "blocked",
  "needs_config",
  "pending",
  "skipped",
] as const satisfies readonly AgentBuilderStarterPackWorkflowItemStatus[];

export const AGENT_BUILDER_STARTER_PACK_APPROVAL_MODE_VALUES = [
  "blocked",
  "external_config",
  "single_only",
  "single_or_batch",
] as const satisfies readonly AgentBuilderStarterPackApprovalMode[];

const AGENT_BUILDER_STARTER_PACK_ASSET_TYPES = new Set<AgentBuilderStarterPackItemAssetType>(
  AGENT_BUILDER_STARTER_PACK_ASSET_TYPE_VALUES,
);

const AGENT_BUILDER_STARTER_PACK_STATUSES = new Set<AgentBuilderStarterPackItemStatus>(
  AGENT_BUILDER_STARTER_PACK_STATUS_VALUES,
);

const AGENT_BUILDER_STARTER_PACK_APPROVAL_MODES = new Set<AgentBuilderStarterPackApprovalMode>(
  AGENT_BUILDER_STARTER_PACK_APPROVAL_MODE_VALUES,
);

const AGENT_BUILDER_EXTERNAL_SETUP_HREFS: Record<AgentBuilderStarterPackItemAssetType, string> = {
  agent_field: "/agent",
  environment: "/environment",
  mcp: "/integrations/mcp",
  skill: "/integrations/skills",
  space: "/space",
};

function splitHrefPath(input: string): { pathname: string; suffix: string } {
  const suffixStart = input.search(/[?#]/);

  if (suffixStart === -1) {
    return {
      pathname: input,
      suffix: "",
    };
  }

  return {
    pathname: input.slice(0, suffixStart),
    suffix: input.slice(suffixStart),
  };
}

function trimTrailingSlash(pathname: string): string {
  if (pathname === "/") {
    return pathname;
  }

  return pathname.replace(/\/+$/g, "");
}

function readHrefPath(href: string): string {
  const trimmed = href.trim();

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed.replace(/^https?:\/\/[^/]+/i, "") || "/";
  }

  return trimmed;
}

export function getAgentBuilderExternalSetupHrefForAssetType(
  assetType: AgentBuilderStarterPackItemAssetType,
): string {
  return AGENT_BUILDER_EXTERNAL_SETUP_HREFS[assetType];
}

export function normalizeAgentBuilderExternalSetupHref(input: {
  assetType: AgentBuilderStarterPackItemAssetType;
  href: string;
}): string {
  const fallbackHref = getAgentBuilderExternalSetupHrefForAssetType(input.assetType);
  const normalizedInput = readHrefPath(input.href);

  if (!normalizedInput.startsWith("/")) {
    return fallbackHref;
  }

  const { pathname, suffix } = splitHrefPath(normalizedInput);
  const normalizedPathname = trimTrailingSlash(pathname);

  if (normalizedPathname === "/mcp" || normalizedPathname.startsWith("/mcp/")) {
    return "/integrations/mcp";
  }

  if (
    normalizedPathname === "/skill" ||
    normalizedPathname === "/skills" ||
    normalizedPathname.startsWith("/skill/") ||
    normalizedPathname.startsWith("/skills/")
  ) {
    return "/integrations/skills";
  }

  if (normalizedPathname === "/space" || normalizedPathname === "/spaces") {
    return "/space";
  }

  if (normalizedPathname.startsWith("/spaces/")) {
    return `/space${normalizedPathname.slice("/spaces".length)}${suffix}`;
  }

  if (normalizedPathname === "/environment" || normalizedPathname === "/environments") {
    return "/environment";
  }

  if (normalizedPathname.startsWith("/environment/")) {
    return `${normalizedPathname}${suffix}`;
  }

  if (normalizedPathname.startsWith("/environments/")) {
    return `/environment${normalizedPathname.slice("/environments".length)}${suffix}`;
  }

  if (
    normalizedPathname === "/provider" ||
    normalizedPathname === "/providers" ||
    normalizedPathname === "/settings/providers"
  ) {
    return "/providers";
  }

  if (
    normalizedPathname === "/integrations/mcp" ||
    normalizedPathname.startsWith("/integrations/mcp/")
  ) {
    return "/integrations/mcp";
  }

  if (
    normalizedPathname === "/integrations/skill" ||
    normalizedPathname === "/integrations/skills" ||
    normalizedPathname.startsWith("/integrations/skill/") ||
    normalizedPathname.startsWith("/integrations/skills/")
  ) {
    return "/integrations/skills";
  }

  if (
    normalizedPathname === "/agent" ||
    normalizedPathname.startsWith("/agent/") ||
    normalizedPathname === "/providers" ||
    normalizedPathname.startsWith("/settings/")
  ) {
    return `${normalizedPathname}${suffix}`;
  }

  return fallbackHref;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNonEmptyString(value: unknown): value is string {
  return isString(value) && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => isString(entry));
}

function toStarterPackAssetId(id: string): AgentBuilderStarterPackAssetId {
  return id.trim() as AgentBuilderStarterPackAssetId;
}

function toPlannerRunId(id: string): AgentBuilderPlannerRunId {
  return id.trim() as AgentBuilderPlannerRunId;
}

function parseStarterPackAction(value: unknown): AgentBuilderStarterPackItemAction | null {
  if (!isRecord(value)) {
    return null;
  }

  const type = value["type"];

  if (type === "draft_patch") {
    const patchNodeKey = normalizeAgentBuilderApprovalNodeKey(value["patchNodeKey"]);

    return patchNodeKey !== null
      ? {
          patchNodeKey,
          type,
        }
      : null;
  }

  if (type === "bind_existing_asset") {
    const assetId = value["assetId"];

    return isNonEmptyString(assetId)
      ? {
          assetId: toStarterPackAssetId(assetId),
          type,
        }
      : null;
  }

  if (type === "open_external_setup") {
    const href = value["href"];

    return isNonEmptyString(href)
      ? {
          href: href.trim(),
          type,
        }
      : null;
  }

  if (type === "none") {
    return { type };
  }

  return null;
}

function parseStarterPackItem(value: unknown): AgentBuilderStarterPackItem | null {
  if (!isRecord(value)) {
    return null;
  }

  const action = parseStarterPackAction(value["action"]);
  const approvalMode = value["approvalMode"];
  const assetId = value["assetId"];
  const assetName = value["assetName"];
  const assetType = value["assetType"];
  const evidenceRefs = value["evidenceRefs"];
  const nodeKey = value["nodeKey"];
  const parsedNodeKey = normalizeAgentBuilderApprovalNodeKey(nodeKey);
  const reason = value["reason"];
  const status = value["status"];
  const title = value["title"];

  if (
    action === null ||
    !AGENT_BUILDER_STARTER_PACK_APPROVAL_MODES.has(
      approvalMode as AgentBuilderStarterPackApprovalMode,
    ) ||
    !AGENT_BUILDER_STARTER_PACK_ASSET_TYPES.has(
      assetType as AgentBuilderStarterPackItemAssetType,
    ) ||
    !isStringArray(evidenceRefs) ||
    parsedNodeKey === null ||
    !isNonEmptyString(reason) ||
    !AGENT_BUILDER_STARTER_PACK_STATUSES.has(status as AgentBuilderStarterPackItemStatus) ||
    !isNonEmptyString(title) ||
    (assetId !== undefined && !isString(assetId)) ||
    (assetName !== undefined && !isString(assetName))
  ) {
    return null;
  }

  const parsedAssetType = assetType as AgentBuilderStarterPackItemAssetType;
  const parsedAction: AgentBuilderStarterPackItemAction =
    action.type === "open_external_setup"
      ? {
          href: normalizeAgentBuilderExternalSetupHref({
            assetType: parsedAssetType,
            href: action.href,
          }),
          type: "open_external_setup",
        }
      : action;

  return {
    action: parsedAction,
    approvalMode: approvalMode as AgentBuilderStarterPackApprovalMode,
    ...(assetId === undefined ? {} : { assetId: toStarterPackAssetId(assetId) }),
    ...(assetName === undefined ? {} : { assetName }),
    assetType: parsedAssetType,
    evidenceRefs,
    nodeKey: parsedNodeKey,
    reason: reason.trim(),
    status: status as AgentBuilderStarterPackItemStatus,
    title: title.trim(),
  };
}

export function parseAgentBuilderStarterPackResult(
  value: unknown,
): AgentBuilderStarterPackResult | null {
  if (!isRecord(value) || value["version"] !== 1 || value["mode"] !== "starter_pack") {
    return null;
  }

  const assistantText = value["assistantText"];
  const intentSummary = value["intentSummary"];
  const items = value["items"];
  const plannerRunId = value["plannerRunId"];
  const parsedItems = Array.isArray(items) ? items.map((item) => parseStarterPackItem(item)) : null;
  const compactItems = parsedItems?.filter(
    (item): item is AgentBuilderStarterPackItem => item !== null,
  );
  const nodeKeys = compactItems?.map((item) => item.nodeKey);

  if (
    !isNonEmptyString(assistantText) ||
    !isNonEmptyString(intentSummary) ||
    parsedItems === null ||
    parsedItems.some((item) => item === null) ||
    compactItems === undefined ||
    nodeKeys === undefined ||
    new Set(nodeKeys).size !== nodeKeys.length ||
    !isNonEmptyString(plannerRunId)
  ) {
    return null;
  }

  return {
    assistantText: assistantText.trim(),
    intentSummary: intentSummary.trim(),
    items: compactItems,
    mode: "starter_pack",
    plannerRunId: toPlannerRunId(plannerRunId),
    version: 1,
  };
}

export function isAgentBuilderStarterPackItemBatchApprovable(
  item: AgentBuilderStarterPackItem,
): boolean {
  return (
    item.approvalMode === "single_or_batch" &&
    item.status === "pending" &&
    (item.action.type === "bind_existing_asset" || item.action.type === "draft_patch")
  );
}

export function listAgentBuilderStarterPackBatchApprovableItems(
  result: AgentBuilderStarterPackResult,
): AgentBuilderStarterPackItem[] {
  return result.items.filter(isAgentBuilderStarterPackItemBatchApprovable);
}

export function getAgentBuilderStarterPackItemApprovalPolicy(
  item: AgentBuilderStarterPackItem,
): AgentBuilderApprovalPolicy {
  return {
    actionSemantics: item.action.type,
    approvalMode: item.approvalMode,
    destructive: false,
    nodeKey: item.nodeKey,
  };
}
