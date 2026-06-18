import type { AgentKind } from "@mosoo/contracts/agent";
import type {
  AgentBuilderComponentDecisions,
  AgentBuilderPlannerDraftBindingsContext,
} from "@mosoo/contracts/agent-builder";
import type { EnvironmentId } from "@mosoo/id";

export interface AgentBuilderLightweightPlannerDraftContext extends AgentBuilderPlannerDraftBindingsContext {
  readonly description: string | null;
  readonly kind: AgentKind | null;
  readonly mcpServersRepresented: boolean;
  readonly model: string | null;
  readonly name: string | null;
  readonly prompt: string | null;
  readonly provider: string | null;
  readonly runtimeId: string | null;
}

export interface AgentBuilderWorkflowDraftSnapshot {
  readonly componentDecisions: AgentBuilderComponentDecisions;
  readonly description: string | null;
  readonly environmentId: EnvironmentId | null;
  readonly kind: AgentKind | null;
  readonly model: string | null;
  readonly name: string | null;
  readonly parseError: string | null;
  readonly parseStatus: "failed" | "parsed";
  readonly prompt: string | null;
  readonly provider: string | null;
  readonly runtimeId: string | null;
}
