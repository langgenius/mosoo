import type { AgentBuilderPlannerRunId, AgentId } from "@mosoo/id";

import type { AgentBuilderMessageModel } from "./agent-builder-thread.service";

export interface AgentBuilderSystemAgentState {
  readonly draftId: AgentId | null;
  readonly lastPlannerRunId: AgentBuilderPlannerRunId | null;
}

export const INITIAL_AGENT_BUILDER_SYSTEM_AGENT_STATE = {
  draftId: null,
  lastPlannerRunId: null,
} satisfies AgentBuilderSystemAgentState;

export function createAgentBuilderSystemAgentStateFromMessages(input: {
  agentId: AgentId;
  messages: readonly AgentBuilderMessageModel[];
}): AgentBuilderSystemAgentState {
  let lastPlannerRunId: AgentBuilderPlannerRunId | null = null;

  for (const message of input.messages.toReversed()) {
    lastPlannerRunId ??= message.plannerRunId;

    if (lastPlannerRunId !== null) {
      break;
    }
  }

  return {
    draftId: input.agentId,
    lastPlannerRunId,
  };
}
