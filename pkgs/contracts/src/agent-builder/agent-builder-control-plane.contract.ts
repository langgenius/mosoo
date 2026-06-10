import type { McpServerId } from "../id/id.contract";
import type { McpAuthType } from "../mcp/mcp.contract";

export const AGENT_BUILDER_CONTROL_PLANE_TOOL_ID_VALUES = [
  "inspect_builder_context",
  "search_builder_assets",
  "patch_manifest_draft",
  "ask_user",
  "show_next_action",
  "create_agent",
  "apply_agent_config",
  "create_environment",
  "create_remote_mcp_server",
  "reset_preview_session",
] as const;

export type AgentBuilderControlPlaneToolId =
  (typeof AGENT_BUILDER_CONTROL_PLANE_TOOL_ID_VALUES)[number];

export const AGENT_BUILDER_EXECUTABLE_ACTION_TOOL_ID_VALUES = [
  "create_agent",
  "apply_agent_config",
  "open_preview",
  "create_environment",
  "create_remote_mcp_server",
  "reset_preview_session",
] as const;

export type AgentBuilderExecutableActionToolId =
  (typeof AGENT_BUILDER_EXECUTABLE_ACTION_TOOL_ID_VALUES)[number];

export const AGENT_BUILDER_SECURE_UI_ACTION_KIND_VALUES = [
  "create_environment",
  "create_remote_mcp_server",
  "connect_mcp_credential",
] as const;

export type AgentBuilderSecureUiActionKind =
  (typeof AGENT_BUILDER_SECURE_UI_ACTION_KIND_VALUES)[number];

export interface AgentBuilderSecureUiAction {
  readonly kind: AgentBuilderSecureUiActionKind;
  readonly mcpServerId?: McpServerId;
}

// Builder actions may create these resources directly, but credentials (bearer
// tokens, OAuth secrets) must never travel through the planner/control-plane
// path — credential connection always happens in the dedicated secure UI.
// Setup scripts are also excluded: they execute with the environment's secret
// env vars at provisioning time, so they must stay human-authored and visible
// in the Environment UI rather than LLM-authored behind a button label.
export interface AgentBuilderCreateEnvironmentActionPayload {
  readonly description?: string | null;
  readonly name: string;
}

export interface AgentBuilderCreateRemoteMcpServerActionPayload {
  readonly authType: McpAuthType;
  readonly description?: string | null;
  readonly name: string;
  readonly url: string;
}

export const AGENT_BUILDER_ASK_USER_MODE_VALUES = [
  "single_select",
  "multi_select",
  "free_text",
] as const;

export type AgentBuilderAskUserMode = (typeof AGENT_BUILDER_ASK_USER_MODE_VALUES)[number];

export const AGENT_BUILDER_NEXT_ACTION_KIND_VALUES = [
  "create_agent",
  "configure_environment",
  "open_preview",
  "keep_refining",
] as const;

export type AgentBuilderNextActionKind = (typeof AGENT_BUILDER_NEXT_ACTION_KIND_VALUES)[number];

export const AGENT_BUILDER_PLAN_NODE_ACTION_KEY_VALUES = [
  "create_agent",
  "configure_environment",
  "open_preview",
  "keep_refining",
  "apply_agent_config",
  "create_environment",
  "create_remote_mcp_server",
  "reset_preview_session",
] as const;

export type AgentBuilderPlanNodeActionKey =
  (typeof AGENT_BUILDER_PLAN_NODE_ACTION_KEY_VALUES)[number];

const AGENT_BUILDER_PLAN_NODE_ACTION_KEYS = new Set<string>(
  AGENT_BUILDER_PLAN_NODE_ACTION_KEY_VALUES,
);

export function isAgentBuilderPlanNodeActionKey(
  value: unknown,
): value is AgentBuilderPlanNodeActionKey {
  return typeof value === "string" && AGENT_BUILDER_PLAN_NODE_ACTION_KEYS.has(value);
}

export type AgentBuilderWorkflowStageId =
  | "configure_components"
  | "create_agent"
  | "preview"
  | "refine";

export type AgentBuilderWorkflowStageStatus = "active" | "completed" | "pending";

export type AgentBuilderComponentDecision = "bound" | "created" | "skipped";

// Records that the agent type (kind) was explicitly chosen or skipped during
// the Builder stage flow; kind itself always holds a value, so the decision
// needs its own marker.
export type AgentBuilderAgentTypeDecision = "decided" | "skipped";

export interface AgentBuilderComponentDecisions {
  readonly agentType?: AgentBuilderAgentTypeDecision;
  readonly environment?: AgentBuilderComponentDecision;
}

export interface AgentBuilderPreviewStageSnapshot {
  readonly messageCount: number;
  readonly opened: boolean;
  readonly sessionExists: boolean;
}

export interface AgentBuilderNextAction {
  readonly kind: AgentBuilderNextActionKind;
  readonly label: string;
}

export interface AgentBuilderCreateAgentStageState {
  readonly missingFields: readonly string[];
  readonly status: AgentBuilderWorkflowStageStatus;
}

export type AgentBuilderComponentChecklistItem =
  | "environment"
  | "mcp_servers"
  | "skills"
  | "spaces";

export interface AgentBuilderConfigureComponentsStageState {
  readonly blockingMissingItems: readonly AgentBuilderComponentChecklistItem[];
  readonly optionalItems: readonly AgentBuilderComponentChecklistItem[];
  readonly status: AgentBuilderWorkflowStageStatus;
}

export interface AgentBuilderPreviewStageState {
  readonly sessionStarted: boolean;
  readonly status: AgentBuilderWorkflowStageStatus;
}

export interface AgentBuilderRefineStageState {
  readonly status: AgentBuilderWorkflowStageStatus;
}

export interface AgentBuilderWorkflowState {
  readonly activeStageId: AgentBuilderWorkflowStageId;
  readonly nextAction: AgentBuilderNextAction;
  readonly steps: {
    readonly configureComponents: AgentBuilderConfigureComponentsStageState;
    readonly createAgent: AgentBuilderCreateAgentStageState;
    readonly preview: AgentBuilderPreviewStageState;
    readonly refine: AgentBuilderRefineStageState;
  };
}
