export const AGENT_BUILDER_TOOL_ID_VALUES = [
  "apply_safe_patch",
  "ask_user",
  "check_model_availability",
  "check_readiness",
  "commit_channel_setup",
  "commit_create_environment",
  "commit_create_mcp_server",
  "commit_create_skill",
  "commit_create_space",
  "commit_terminal_action",
  "dry_run_draft_patch",
  "get_asset_detail",
  "get_builder_context",
  "get_draft_snapshot",
  "open_authorization_flow",
  "prepare_bind_environment_patch",
  "prepare_bind_mcp_patch",
  "prepare_bind_skill_patch",
  "prepare_bind_space_patch",
  "prepare_channel_setup",
  "prepare_create_environment",
  "prepare_create_mcp_server",
  "prepare_create_skill",
  "prepare_create_space",
  "prepare_draft_patch",
  "prepare_secret_requirement",
  "prepare_replace_skill_patch",
  "prepare_terminal_action",
  "record_builder_event",
  "resolve_asset_reference",
  "return_blocked",
  "search_assets",
  "search_space_files",
] as const;

export type AgentBuilderToolId = (typeof AGENT_BUILDER_TOOL_ID_VALUES)[number];

export type AgentBuilderToolExecutionStatus = "blocked" | "completed" | "failed";

export type AgentBuilderToolPayload = Record<string, unknown>;

export interface AgentBuilderToolExecutionRecord {
  completedAt: string;
  errorMessage: string | null;
  input: AgentBuilderToolPayload;
  output: AgentBuilderToolPayload | null;
  redactedInputSummary: string;
  redactedOutputSummary: string | null;
  requestedToolId: string;
  startedAt: string;
  status: AgentBuilderToolExecutionStatus;
  toolId: AgentBuilderToolId | null;
}

export function isAgentBuilderToolId(value: string): value is AgentBuilderToolId {
  return (AGENT_BUILDER_TOOL_ID_VALUES as readonly string[]).includes(value);
}
