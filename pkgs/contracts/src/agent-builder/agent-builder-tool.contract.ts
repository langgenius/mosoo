import type { AgentBuilderControlPlaneToolId } from "./agent-builder-control-plane.contract";
import { AGENT_BUILDER_CONTROL_PLANE_TOOL_ID_VALUES } from "./agent-builder-control-plane.contract";

export const AGENT_BUILDER_TOOL_ID_VALUES = AGENT_BUILDER_CONTROL_PLANE_TOOL_ID_VALUES;

export type AgentBuilderToolId = AgentBuilderControlPlaneToolId;

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
