import type { AgentBuilderPlanNode } from "@mosoo/contracts/agent-builder";

export function createBlockedDraftPatchNode(
  node: AgentBuilderPlanNode,
  summary: string,
): AgentBuilderPlanNode {
  return {
    ...node,
    actions: [],
    operation: "blocked",
    requiresConfirmation: false,
    status: "blocked",
    summary,
    targetType: "draft",
  };
}
