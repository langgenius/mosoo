import type {
  AgentBuilderPlanNodeActionKey,
  AgentBuilderPlannerContext,
  AgentBuilderPlannerOutput,
} from "@mosoo/contracts/agent-builder";

export function createAgentBuilderPlainTextPlannerOutput(input: {
  readonly assistantText: string;
  readonly intentSummary: string;
  readonly plannerRunId: AgentBuilderPlannerOutput["plannerRunId"];
}): AgentBuilderPlannerOutput {
  return {
    assistantText: input.assistantText,
    intentSummary: input.intentSummary,
    mode: "plain_text",
    nodes: [],
    plannerRunId: input.plannerRunId,
    version: 1,
  };
}

export function createAgentBuilderActionPlannerOutput(input: {
  readonly actionKey: AgentBuilderPlanNodeActionKey;
  readonly assistantText: string;
  readonly context: AgentBuilderPlannerContext;
  readonly intentSummary: string;
  readonly label: string;
  readonly summary: string;
}): AgentBuilderPlannerOutput {
  return {
    assistantText: input.assistantText,
    intentSummary: input.intentSummary,
    mode: "action",
    nodes: [
      {
        actions: [
          {
            actionKey: input.actionKey,
            label: input.label,
            style: "primary",
          },
        ],
        kind: "action",
        nodeKey: `show_next_action:${input.actionKey}`,
        operation: "show",
        requiresConfirmation: false,
        status: "pending",
        summary: input.summary,
        targetType: "workflow",
      },
    ],
    plannerRunId: input.context.plannerRunId,
    version: 1,
  };
}
