import type { AccountId, AgentId, OrganizationId } from "@mosoo/contracts/id";

import type {
  AgentCostCardQuery,
  CostAgentFieldsFragment,
  CostAttributionFieldsFragment,
  CostRecentSessionFieldsFragment,
  MemberCostCardQuery,
  OrganizationCostCardQuery,
} from "@/gql/graphql";
import { requestGraphQL } from "@/platform/http/graphql-client";
import {
  toAccountId,
  toAgentId,
  toNullableSessionId,
  toNullableSessionRunId,
} from "@/routes/typed-id";

import {
  AGENT_COST_QUERY,
  MEMBER_COST_QUERY,
  ORGANIZATION_COST_QUERY,
} from "./cost-graphql-documents";
import type {
  AgentCostCard,
  CostAgentRow,
  CostAttributionCard,
  CostRangeInput,
  CostRecentSession,
  CostRunPurpose,
  CostUserRow,
  MemberCostCard,
  OrganizationCostCard,
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
  CostUserRow,
  MemberCostCard,
  OrganizationCostCard,
} from "./cost-model";

type GraphQLCostUserRow = OrganizationCostCardQuery["organizationCostCard"]["users"][number];

function toCostAgentRow(agent: CostAgentFieldsFragment): CostAgentRow {
  return {
    ...agent,
    agentId: toAgentId(agent.agentId),
    ownerId: toAccountId(agent.ownerId),
  };
}

function toCostUserRow(user: GraphQLCostUserRow): CostUserRow {
  return {
    ...user,
    topAgentId: user.topAgentId === null ? null : toAgentId(user.topAgentId),
    userId: toAccountId(user.userId),
  };
}

function toCostRecentSession(session: CostRecentSessionFieldsFragment): CostRecentSession {
  return {
    ...session,
    actorUserId: toAccountId(session.actorUserId),
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

function toOrganizationCostCard(
  card: OrganizationCostCardQuery["organizationCostCard"],
): OrganizationCostCard {
  return {
    ...toCostAttributionCard(card),
    ownerUsers: card.ownerUsers.map(toCostUserRow),
    previousTotals: card.previousTotals,
    users: card.users.map(toCostUserRow),
  };
}

function toAgentCostCard(card: AgentCostCardQuery["agentCostCard"]): AgentCostCard {
  return {
    ...toCostAttributionCard(card),
    agentId: toAgentId(card.agentId),
    agentName: card.agentName,
    ownerId: toAccountId(card.ownerId),
    ownerName: card.ownerName,
    users: card.users.map(toCostUserRow),
  };
}

function toMemberCostCard(card: MemberCostCardQuery["memberCostCard"]): MemberCostCard {
  return {
    owned: toCostAttributionCard(card.owned),
    used: toCostAttributionCard(card.used),
  };
}

export async function fetchOrganizationCost(
  organizationId: OrganizationId,
  range: CostRangeInput,
  runPurposes: CostRunPurpose[] = [],
): Promise<OrganizationCostCard> {
  const payload = await requestGraphQL(ORGANIZATION_COST_QUERY, {
    organizationId,
    range,
    runPurposes: runPurposes.length > 0 ? runPurposes : null,
  });
  return toOrganizationCostCard(payload.organizationCostCard);
}

export async function fetchAgentCost(input: {
  agentId: AgentId;
  range: CostRangeInput;
  runPurposes?: CostRunPurpose[];
}): Promise<AgentCostCard> {
  const payload = await requestGraphQL(AGENT_COST_QUERY, {
    ...input,
    runPurposes: input.runPurposes ?? null,
  });
  return toAgentCostCard(payload.agentCostCard);
}

export async function fetchMemberCost(input: {
  memberId: AccountId;
  organizationId: OrganizationId;
  range: CostRangeInput;
}): Promise<MemberCostCard> {
  const payload = await requestGraphQL(MEMBER_COST_QUERY, input);
  return toMemberCostCard(payload.memberCostCard);
}
