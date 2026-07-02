import type { AgentId, AppId } from "@mosoo/contracts/id";

import type {
  AgentCostCardQuery,
  CostAgentFieldsFragment,
  CostAttributionFieldsFragment,
  CostRecentSessionFieldsFragment,
  AppCostCardQuery,
} from "@/gql/graphql";
import { requestGraphQL } from "@/platform/http/graphql-client";
import {
  toAccountId,
  toAgentId,
  toNullableSessionId,
  toNullableSessionRunId,
  toAppId,
} from "@/routes/typed-id";

import { AGENT_COST_QUERY, APP_COST_QUERY } from "./cost-graphql-documents";
import type {
  AgentCostCard,
  CostAgentRow,
  CostAttributionCard,
  CostRangeInput,
  CostRecentSession,
  CostRunPurpose,
  AppCostCard,
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
  AppCostCard,
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

function toAppCostCard(card: AppCostCardQuery["appCostCard"]): AppCostCard {
  return {
    ...toCostAttributionCard(card),
    previousTotals: card.previousTotals,
    appId: toAppId(card.appId),
    appName: card.appName,
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

export async function fetchAppCost(
  appId: AppId,
  range: CostRangeInput,
  runPurposes: CostRunPurpose[] = [],
): Promise<AppCostCard> {
  const payload = await requestGraphQL(APP_COST_QUERY, {
    appId,
    range,
    runPurposes: runPurposes.length > 0 ? runPurposes : null,
  });
  return toAppCostCard(payload.appCostCard);
}

export async function fetchAgentCost(input: {
  agentId: AgentId;
  appId: AppId;
  range: CostRangeInput;
  runPurposes?: CostRunPurpose[];
}): Promise<AgentCostCard> {
  const payload = await requestGraphQL(AGENT_COST_QUERY, {
    ...input,
    runPurposes: input.runPurposes ?? null,
  });
  return toAgentCostCard(payload.agentCostCard);
}
