import { planAgentBuilderOptionalComponentStructuredReply } from "./agent-builder-component-planner-policy.service";
import { planAgentBuilderEnvironmentStructuredReply } from "./agent-builder-environment-planner-policy.service";
import { createAgentBuilderPlainTextPlannerOutput } from "./agent-builder-planner-output-factory";
import type { AgentBuilderLightweightPlanner } from "./agent-builder-planner-turn.service";
import { parseAgentBuilderStructuredReply } from "./agent-builder-structured-input";
import {
  planAgentBuilderRefactorTurn,
  planAgentBuilderWorkflowTurn,
} from "./agent-builder-workflow-planner-policy.service";

export function createDefaultAgentBuilderLightweightPlanner(): AgentBuilderLightweightPlanner {
  return {
    modelId: "heuristic",
    plan({ context }) {
      const structuredReply = parseAgentBuilderStructuredReply(context.turn.inputText);
      const structuredReplyOutput =
        structuredReply === null
          ? null
          : (planAgentBuilderEnvironmentStructuredReply({
              context,
              reply: structuredReply,
            }) ??
            planAgentBuilderOptionalComponentStructuredReply({
              context,
              reply: structuredReply,
            }));

      if (structuredReplyOutput !== null) {
        return structuredReplyOutput;
      }

      if (structuredReply !== null) {
        return createAgentBuilderPlainTextPlannerOutput({
          assistantText: "这个结构化问题已过期或不再是当前步骤；请继续描述要调整的内容。",
          intentSummary: "Reject a stale structured Builder reply.",
          plannerRunId: context.plannerRunId,
        });
      }

      if (context.agent.status !== "draft") {
        return planAgentBuilderRefactorTurn(context);
      }

      return planAgentBuilderWorkflowTurn(context);
    },
    provider: "agent-builder-lightweight",
  };
}
