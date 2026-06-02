import { Permission } from "@mosoo/contracts/permission";
import { accountsTable, agentsTable } from "@mosoo/db";
import type { AccountId, AgentId, OrganizationId } from "@mosoo/id";
import { eq, sql } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { forbiddenError } from "../../../platform/errors";
import { ensureAgentCostAccess } from "../../agents/application/agent-access.service";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { ensureOrganizationPermission } from "../../organizations/domain/organization-access.policy";
import { resolveCostWindow } from "./cost-query-window";
import {
  queryAgents,
  queryDaily,
  queryExternalChannelAttribution,
  queryModels,
  queryRecentSessions,
  queryTotals,
  queryUsers,
} from "./cost-query.repository";
import type {
  AgentCostCardView,
  CostAttributionCardView,
  CostRange,
  MemberCostCardView,
  OrganizationCostCardView,
} from "./cost-query.types";

export type { CostRange } from "./cost-query.types";

interface CostCardAccessInput {
  database: D1Database;
  viewer: AuthenticatedViewer;
}

export interface OrganizationCostCardInput extends CostCardAccessInput {
  organizationId: OrganizationId;
  range: CostRange;
  runPurposes?: readonly string[];
}

export interface AgentCostCardInput extends CostCardAccessInput {
  agentId: AgentId;
  range: CostRange;
  runPurposes?: readonly string[];
}

export interface MemberCostCardInput extends CostCardAccessInput {
  memberId: AccountId;
  organizationId: OrganizationId;
  range: CostRange;
}

export interface OwnerCostCardInput extends CostCardAccessInput {
  organizationId: OrganizationId;
  ownerUserId: AccountId;
  range: CostRange;
}

async function buildAttributionCard(
  database: D1Database,
  input: {
    actorUserId?: AccountId;
    agentId?: AgentId;
    organizationId: OrganizationId;
    ownerUserId?: AccountId;
    range: CostRange;
    runPurposes?: readonly string[];
  },
): Promise<CostAttributionCardView> {
  const window = resolveCostWindow(input.range);
  const [agents, daily, models, recentSessions, totals] = await Promise.all([
    queryAgents(database, { ...input, window }),
    queryDaily(database, { ...input, window }),
    queryModels(database, { ...input, window }),
    queryRecentSessions(database, input),
    queryTotals(database, { ...input, window }),
  ]);

  return {
    agents,
    daily,
    models,
    recentSessions,
    totals,
  };
}

async function getAgentHeader(
  database: D1Database,
  agentId: AgentId,
): Promise<{ agentName: string; ownerId: AccountId; ownerName: string }> {
  const row =
    (await getAppDatabase(database)
      .select({
        agent_name: sql`${agentsTable.name}`.mapWith(agentsTable.name).as("agent_name"),
        owner_email: accountsTable.email,
        owner_id: agentsTable.ownerId,
        owner_name: sql`${accountsTable.name}`.mapWith(accountsTable.name).as("owner_name"),
      })
      .from(agentsTable)
      .leftJoin(accountsTable, eq(accountsTable.id, agentsTable.ownerId))
      .where(eq(agentsTable.id, agentId))
      .limit(1)
      .get()) ?? null;

  if (!row) {
    throw forbiddenError();
  }

  return {
    agentName: row.agent_name,
    ownerId: row.owner_id,
    ownerName: row.owner_name ?? row.owner_email ?? row.owner_id,
  };
}

function previousRange(range: CostRange): CostRange {
  if (range === "LAST_7_DAYS") {
    return "LAST_7_DAYS";
  }

  if (range === "LAST_90_DAYS") {
    return "LAST_90_DAYS";
  }

  return "LAST_30_DAYS";
}

function attachPreviousAgentCosts(
  agents: Awaited<ReturnType<typeof queryAgents>>,
  previousAgents: Awaited<ReturnType<typeof queryAgents>>,
): Awaited<ReturnType<typeof queryAgents>> {
  const previousByAgentId = new Map(
    previousAgents.map((agent) => [agent.agentId, agent.totalCostUsd]),
  );

  return agents.map((agent) => ({
    ...agent,
    previousCostUsd: previousByAgentId.get(agent.agentId) ?? 0,
  }));
}

function attachPreviousUserCosts(
  users: Awaited<ReturnType<typeof queryUsers>>,
  previousUsers: Awaited<ReturnType<typeof queryUsers>>,
): Awaited<ReturnType<typeof queryUsers>> {
  const previousByUserId = new Map(previousUsers.map((user) => [user.userId, user.totalCostUsd]));

  return users.map((user) => ({
    ...user,
    previousCostUsd: previousByUserId.get(user.userId) ?? 0,
  }));
}

export async function getOrganizationCostCard({
  database,
  organizationId,
  range,
  runPurposes = [],
  viewer,
}: OrganizationCostCardInput): Promise<OrganizationCostCardView> {
  await ensureOrganizationPermission(
    database,
    viewer.id,
    organizationId,
    Permission.CostOrganizationRead,
  );

  const window = resolveCostWindow(range);
  const previousWindow = resolveCostWindow(previousRange(range), new Date(window.sinceMs - 1));
  const [
    agents,
    previousAgents,
    users,
    previousUsers,
    externalChannel,
    previousExternalChannel,
    ownerUsers,
    previousOwnerUsers,
    daily,
    models,
    previousTotals,
    recentSessions,
    totals,
  ] = await Promise.all([
    queryAgents(database, { organizationId, runPurposes, window }),
    queryAgents(database, {
      organizationId,
      runPurposes,
      window: previousWindow,
    }),
    queryUsers(database, {
      mode: "used_by",
      organizationId,
      runPurposes,
      window,
    }),
    queryUsers(database, {
      mode: "used_by",
      organizationId,
      runPurposes,
      window: previousWindow,
    }),
    queryExternalChannelAttribution(database, {
      organizationId,
      runPurposes,
      window,
    }),
    queryExternalChannelAttribution(database, {
      organizationId,
      runPurposes,
      window: previousWindow,
    }),
    queryUsers(database, {
      mode: "owned_by",
      organizationId,
      runPurposes,
      window,
    }),
    queryUsers(database, {
      mode: "owned_by",
      organizationId,
      runPurposes,
      window: previousWindow,
    }),
    queryDaily(database, { organizationId, runPurposes, window }),
    queryModels(database, { organizationId, runPurposes, window }),
    queryTotals(database, {
      organizationId,
      runPurposes,
      window: previousWindow,
    }),
    queryRecentSessions(database, { organizationId, runPurposes }),
    queryTotals(database, { organizationId, runPurposes, window }),
  ]);

  return {
    agents: attachPreviousAgentCosts(agents, previousAgents),
    daily,
    externalChannel: {
      ...externalChannel,
      previousCostUsd: previousExternalChannel.totalCostUsd,
    },
    models,
    ownerUsers: attachPreviousUserCosts(ownerUsers, previousOwnerUsers),
    previousTotals,
    recentSessions,
    totals,
    users: attachPreviousUserCosts(users, previousUsers),
  };
}

export async function getAgentCostCard({
  agentId,
  database,
  range,
  runPurposes = [],
  viewer,
}: AgentCostCardInput): Promise<AgentCostCardView> {
  const { agent } = await ensureAgentCostAccess(database, viewer.id, agentId);
  const window = resolveCostWindow(range);
  const [header, card, users] = await Promise.all([
    getAgentHeader(database, agentId),
    buildAttributionCard(database, {
      agentId,
      organizationId: agent.organizationId,
      range,
      runPurposes,
    }),
    queryUsers(database, {
      agentId,
      mode: "used_by",
      organizationId: agent.organizationId,
      runPurposes,
      window,
    }),
  ]);

  return {
    ...card,
    agentId,
    agentName: header.agentName,
    ownerId: header.ownerId,
    ownerName: header.ownerName,
    users,
  };
}

export async function getMemberCostCard({
  database,
  memberId,
  organizationId,
  range,
  viewer,
}: MemberCostCardInput): Promise<MemberCostCardView> {
  await ensureOrganizationPermission(
    database,
    viewer.id,
    organizationId,
    Permission.CostOrganizationRead,
  );
  const [owned, used] = await Promise.all([
    buildAttributionCard(database, {
      organizationId,
      ownerUserId: memberId,
      range,
    }),
    buildAttributionCard(database, {
      actorUserId: memberId,
      organizationId,
      range,
    }),
  ]);

  return {
    owned,
    used,
  };
}

export async function getOwnerCostCard({
  database,
  organizationId,
  ownerUserId,
  range,
  viewer,
}: OwnerCostCardInput): Promise<CostAttributionCardView> {
  await ensureOrganizationPermission(
    database,
    viewer.id,
    organizationId,
    Permission.CostOrganizationRead,
  );

  return buildAttributionCard(database, {
    organizationId,
    ownerUserId,
    range,
  });
}
