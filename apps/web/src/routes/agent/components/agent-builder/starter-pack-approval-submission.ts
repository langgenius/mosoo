import type { AgentBuilderStarterPackApprovalInput } from "@/domains/agent-builder/api/agent-builder-client";
import { toAgentBuilderPlannerRunId } from "@/routes/typed-id";

export interface AgentBuilderStarterPackSingleApprovalSubmission {
  nodeKey: string;
  plannerRunId: string;
}

export interface AgentBuilderStarterPackBatchApprovalSubmission {
  nodeKeys: readonly string[];
  plannerRunId: string;
}

export function createStarterPackSingleApprovalInput(
  submission: AgentBuilderStarterPackSingleApprovalSubmission,
): AgentBuilderStarterPackApprovalInput {
  const nodeKey = submission.nodeKey.trim();
  const plannerRunId = submission.plannerRunId.trim();

  if (nodeKey.length === 0 || plannerRunId.length === 0) {
    throw new Error("Starter Pack single approval requires nodeKey and plannerRunId.");
  }

  return {
    mode: "SINGLE",
    nodeKey,
    plannerRunId: toAgentBuilderPlannerRunId(plannerRunId),
  };
}

export function createStarterPackBatchApprovalInput(
  submission: AgentBuilderStarterPackBatchApprovalSubmission,
): AgentBuilderStarterPackApprovalInput {
  const plannerRunId = submission.plannerRunId.trim();

  if (submission.nodeKeys.length === 0 || plannerRunId.length === 0) {
    throw new Error("Starter Pack batch approval requires approvable node keys and plannerRunId.");
  }

  return {
    mode: "BATCH",
    nodeKey: null,
    plannerRunId: toAgentBuilderPlannerRunId(plannerRunId),
  };
}
