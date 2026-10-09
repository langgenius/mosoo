import type { AccountId, AgentId, ProjectId, SessionId, SessionRunId } from "@mosoo/id";

import type {
  AgentCostCardQuery,
  CostAgentFieldsFragment,
  CostRecentSessionFieldsFragment,
  ProjectCostCardQuery,
} from "@/gql/graphql";
import { requestGraphQL } from "@/platform/http/graphql-client";

import { AGENT_COST_QUERY, PROJECT_COST_QUERY } from "./cost-graphql-documents";
import type {
  AgentCostCard,
  CostAgentRow,
  CostAttributionCard,
  CostRangeInput,
  CostRecentSession,
  CostRunPurpose,
  ProjectCostCard,
} from "./cost-model";

export type {
  AgentCostCard,
  CostAgentRow,
  CostAttributionCard,
  CostModelRow,
  CostRangeInput,
  CostRunPurpose,
  CostTotals,
  ProjectCostCard,
} from "./cost-model";

function toCostAgentRow(agent: CostAgentFieldsFragment): CostAgentRow {
  return {
    ...agent,
    agentId: agent.agentId as AgentId | null,
    ownerId: agent.ownerId as AccountId,
  };
}

function toCostRecentSession(session: CostRecentSessionFieldsFragment): CostRecentSession {
  return {
    ...session,
    sessionId: session.sessionId as SessionId | null,
    sessionRunId: session.sessionRunId as SessionRunId | null,
  };
}

function toCostAttributionCard(
  card: AgentCostCardQuery["agentCostCard"] | ProjectCostCardQuery["projectCostCard"],
): CostAttributionCard {
  return {
    ...card,
    agents: card.agents.map(toCostAgentRow),
    recentSessions: card.recentSessions.map(toCostRecentSession),
  };
}

function toProjectCostCard(card: ProjectCostCardQuery["projectCostCard"]): ProjectCostCard {
  return {
    ...toCostAttributionCard(card),
    previousTotals: card.previousTotals,
    projectId: card.projectId as ProjectId,
    projectName: card.projectName,
  };
}

function toAgentCostCard(card: AgentCostCardQuery["agentCostCard"]): AgentCostCard {
  return {
    ...toCostAttributionCard(card),
    agentId: card.agentId as AgentId,
    agentName: card.agentName,
    ownerId: card.ownerId as AccountId,
    ownerName: card.ownerName,
  };
}

export async function fetchProjectCost(
  projectId: ProjectId,
  range: CostRangeInput,
  runPurposes: CostRunPurpose[] = [],
): Promise<ProjectCostCard> {
  const payload = await requestGraphQL(PROJECT_COST_QUERY, {
    projectId,
    range,
    runPurposes: runPurposes.length > 0 ? runPurposes : null,
  });
  return toProjectCostCard(payload.projectCostCard);
}

export async function fetchAgentCost(input: {
  agentId: AgentId;
  projectId: ProjectId;
  range: CostRangeInput;
  runPurposes?: CostRunPurpose[];
}): Promise<AgentCostCard> {
  const payload = await requestGraphQL(AGENT_COST_QUERY, {
    ...input,
    runPurposes: input.runPurposes ?? null,
  });
  return toAgentCostCard(payload.agentCostCard);
}
