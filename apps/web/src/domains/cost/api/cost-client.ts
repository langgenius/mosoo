import type { AgentId, ProjectId } from "@mosoo/contracts/id";

import type {
  AgentCostCardQuery,
  CostAgentFieldsFragment,
  CostAttributionFieldsFragment,
  CostRecentSessionFieldsFragment,
  ProjectCostCardQuery,
} from "@/gql/graphql";
import { requestGraphQL } from "@/platform/http/graphql-client";
import {
  toAccountId,
  toAgentId,
  toNullableSessionId,
  toNullableSessionRunId,
  toProjectId,
} from "@/routes/typed-id";

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
  CostDailyPoint,
  CostModelRow,
  CostRangeInput,
  CostRecentSession,
  CostRunPurpose,
  CostTotals,
  OrganizationBillingCostCard,
  ProjectCostCard,
} from "./cost-model";

function toCostAgentRow(agent: CostAgentFieldsFragment): CostAgentRow {
  return {
    ...agent,
    agentId: toAgentId(agent.agentId),
    ownerId: toAccountId(agent.ownerId),
  };
}

function toCostRecentSession(session: CostRecentSessionFieldsFragment): CostRecentSession {
  return {
    ...session,
    sessionId: toNullableSessionId(session.sessionId),
    sessionRunId: toNullableSessionRunId(session.sessionRunId),
  };
}

function toCostAttributionCard(card: CostAttributionFieldsFragment): CostAttributionCard {
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
    projectId: toProjectId(card.projectId),
    projectName: card.projectName,
  };
}

function toAgentCostCard(card: AgentCostCardQuery["agentCostCard"]): AgentCostCard {
  return {
    ...toCostAttributionCard(card),
    agentId: toAgentId(card.agentId),
    agentName: card.agentName,
    ownerId: toAccountId(card.ownerId),
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
