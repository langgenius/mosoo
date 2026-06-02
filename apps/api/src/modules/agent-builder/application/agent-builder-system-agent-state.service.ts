import { parseAgentBuilderStarterPackResult } from "@mosoo/contracts/agent-builder";
import type { AgentBuilderPlannerRunId, AgentId } from "@mosoo/id";

import type { AgentBuilderMessageModel } from "./agent-builder-thread.service";

export interface AgentBuilderSystemAgentState {
  readonly draftId: AgentId | null;
  readonly lastPlannerRunId: AgentBuilderPlannerRunId | null;
  readonly openApprovalCount: number;
}

export const INITIAL_AGENT_BUILDER_SYSTEM_AGENT_STATE = {
  draftId: null,
  lastPlannerRunId: null,
  openApprovalCount: 0,
} satisfies AgentBuilderSystemAgentState;

function countOpenAgentBuilderApprovals(cardsJson: string | null): number {
  if (cardsJson === null) {
    return 0;
  }

  try {
    const starterPack = parseAgentBuilderStarterPackResult(JSON.parse(cardsJson));

    if (starterPack === null) {
      return 0;
    }

    return starterPack.items.filter(
      (item) =>
        item.status === "pending" &&
        (item.approvalMode === "single_only" || item.approvalMode === "single_or_batch") &&
        (item.action.type === "bind_existing_asset" || item.action.type === "draft_patch"),
    ).length;
  } catch {
    return 0;
  }
}

export function createAgentBuilderSystemAgentStateFromMessages(input: {
  agentId: AgentId;
  messages: readonly AgentBuilderMessageModel[];
}): AgentBuilderSystemAgentState {
  let lastCardsJson: string | null = null;
  let lastPlannerRunId: AgentBuilderPlannerRunId | null = null;

  for (const message of input.messages.toReversed()) {
    lastCardsJson ??= message.cardsJson;
    lastPlannerRunId ??= message.plannerRunId;

    if (lastCardsJson !== null && lastPlannerRunId !== null) {
      break;
    }
  }

  return {
    draftId: input.agentId,
    lastPlannerRunId,
    openApprovalCount: countOpenAgentBuilderApprovals(lastCardsJson),
  };
}

export async function readOpenAgentBuilderApprovalCountForPlannerRun(
  database: D1Database,
  plannerRunId: AgentBuilderPlannerRunId,
): Promise<number> {
  const row = await database
    .prepare("SELECT output_json FROM agent_builder_planner_run WHERE id = ?")
    .bind(plannerRunId)
    .first<{ output_json: string | null }>();

  return countOpenAgentBuilderApprovals(row?.output_json ?? null);
}
