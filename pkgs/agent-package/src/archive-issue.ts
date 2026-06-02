import type { AgentResolutionIssue, AgentResolutionStatus } from "@mosoo/contracts/agent-manifest";

export function createArchiveIssue(input: {
  code: string;
  message: string;
  status: AgentResolutionStatus;
  targetLabel: string | null;
  targetType: AgentResolutionIssue["targetType"];
}): AgentResolutionIssue {
  return {
    actionLabel: null,
    code: input.code,
    message: input.message,
    required: true,
    severity: "error",
    status: input.status,
    targetLabel: input.targetLabel,
    targetType: input.targetType,
  };
}
