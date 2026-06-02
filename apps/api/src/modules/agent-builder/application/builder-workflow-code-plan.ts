import type { AgentBuilderToolId } from "@mosoo/contracts/agent-builder";

export const AGENT_BUILDER_WORKFLOW_INTENT_CLASSES = [
  "already_bound_noop",
  "bind_existing_asset",
  "draft_field_edit",
  "first_draft_agent_goal",
  "missing_asset_setup",
  "ordinary_question",
  "unsupported_or_blocked",
] as const;

export const AGENT_BUILDER_WORKFLOW_SOURCE_MODES = [
  "blocked",
  "draft_patch",
  "plain_text",
  "question",
] as const;

export type AgentBuilderWorkflowIntentClass =
  (typeof AGENT_BUILDER_WORKFLOW_INTENT_CLASSES)[number];

export type AgentBuilderWorkflowSourceMode = (typeof AGENT_BUILDER_WORKFLOW_SOURCE_MODES)[number];

export interface AgentBuilderWorkflowPlannerCodePlan {
  readonly code: string;
  readonly intentClass: AgentBuilderWorkflowIntentClass;
  readonly sourceMode: AgentBuilderWorkflowSourceMode;
  readonly toolSequence: readonly AgentBuilderToolId[];
}
