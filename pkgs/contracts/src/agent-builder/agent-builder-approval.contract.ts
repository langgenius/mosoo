import type { AgentBuilderToolId } from "./agent-builder-tool.contract";

export type AgentBuilderApprovalNodeKey = string;

export type AgentBuilderApprovalMode =
  | "automatic"
  | "blocked"
  | "client_only"
  | "external_config"
  | "single_only"
  | "single_or_batch";

export type AgentBuilderApprovalActionSemantics =
  | "bind_existing_asset"
  | "draft_patch"
  | "none"
  | "open_external_setup"
  | "tool_call";

export type AgentBuilderWorkflowToolExecutionPolicy =
  | "approval_required"
  | "blocked"
  | "client_only"
  | "safe_automatic";

export interface AgentBuilderApprovalPolicy {
  readonly actionSemantics: AgentBuilderApprovalActionSemantics;
  readonly approvalMode: AgentBuilderApprovalMode;
  readonly destructive: boolean;
  readonly nodeKey: AgentBuilderApprovalNodeKey;
}

const AGENT_BUILDER_APPROVAL_NODE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u;

export const AGENT_BUILDER_APPROVAL_MODE_VALUES = [
  "automatic",
  "blocked",
  "client_only",
  "external_config",
  "single_only",
  "single_or_batch",
] as const satisfies readonly AgentBuilderApprovalMode[];

export const AGENT_BUILDER_APPROVAL_ACTION_SEMANTIC_VALUES = [
  "bind_existing_asset",
  "draft_patch",
  "none",
  "open_external_setup",
  "tool_call",
] as const satisfies readonly AgentBuilderApprovalActionSemantics[];

export const AGENT_BUILDER_WORKFLOW_TOOL_EXECUTION_POLICY_VALUES = [
  "approval_required",
  "blocked",
  "client_only",
  "safe_automatic",
] as const satisfies readonly AgentBuilderWorkflowToolExecutionPolicy[];

export function normalizeAgentBuilderApprovalNodeKey(
  value: unknown,
): AgentBuilderApprovalNodeKey | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  return AGENT_BUILDER_APPROVAL_NODE_KEY_PATTERN.test(trimmed) ? trimmed : null;
}

export function isAgentBuilderApprovalNodeKey(
  value: unknown,
): value is AgentBuilderApprovalNodeKey {
  return normalizeAgentBuilderApprovalNodeKey(value) !== null;
}

export function getAgentBuilderWorkflowToolApprovalMode(
  executionPolicy: AgentBuilderWorkflowToolExecutionPolicy,
): AgentBuilderApprovalMode {
  if (executionPolicy === "approval_required") {
    return "single_only";
  }

  if (executionPolicy === "safe_automatic") {
    return "automatic";
  }

  return executionPolicy;
}

export function createAgentBuilderWorkflowToolApprovalNodeKey(
  toolId: AgentBuilderToolId,
): AgentBuilderApprovalNodeKey {
  return `tool:${toolId}`;
}

export function createAgentBuilderWorkflowToolApprovalPolicy(input: {
  readonly destructive: boolean;
  readonly executionPolicy: AgentBuilderWorkflowToolExecutionPolicy;
  readonly toolId: AgentBuilderToolId;
}): AgentBuilderApprovalPolicy {
  return {
    actionSemantics: "tool_call",
    approvalMode: getAgentBuilderWorkflowToolApprovalMode(input.executionPolicy),
    destructive: input.destructive,
    nodeKey: createAgentBuilderWorkflowToolApprovalNodeKey(input.toolId),
  };
}
