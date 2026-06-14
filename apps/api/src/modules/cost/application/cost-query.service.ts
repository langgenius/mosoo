import { accountsTable, agentsTable } from "@mosoo/db";
import type { AccountId, AgentId, OrganizationId, AppId } from "@mosoo/id";
import { eq, sql } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { forbiddenError } from "../../../platform/errors";
import { ensureAppAgentOwner } from "../../agents/application/agent-access.service";
import { ensureAppOwnership } from "../../apps/application/app.service";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { ensureOrganizationOwnership } from "../../organizations/domain/organization-ownership.policy";
import { resolveCostWindow } from "./cost-query-window";
import {
  queryAgents,
  queryDaily,
  queryModels,
  queryRecentSessions,
  queryTotals,
} from "./cost-query.repository";
import type {
  AgentCostCardView,
  CostAttributionCardView,
  CostRange,
  OrganizationBillingCostCardView,
  AppCostCardView,
} from "./cost-query.types";

export type { CostRange } from "./cost-query.types";

interface CostCardAccessInput {
  database: D1Database;
  viewer: AuthenticatedViewer;
}

export interface OrganizationBillingCostCardInput extends CostCardAccessInput {
  organizationId: OrganizationId;
  range: CostRange;
  runPurposes?: readonly string[];
}

export interface AppCostCardInput extends CostCardAccessInput {
  appId: AppId;
  range: CostRange;
  runPurposes?: readonly string[];
}

export interface AgentCostCardInput extends CostCardAccessInput {
  agentId: AgentId;
  appId: AppId;
  range: CostRange;
  runPurposes?: readonly string[];
}

async function buildAttributionCard(
  database: D1Database,
  input: {
    agentId?: AgentId;
    organizationId: OrganizationId;
    appId?: AppId;
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

export async function getOrganizationBillingCostCard({
  database,
  organizationId,
  range,
  runPurposes = [],
  viewer,
}: OrganizationBillingCostCardInput): Promise<OrganizationBillingCostCardView> {
  await ensureOrganizationOwnership(database, viewer.id, organizationId);

  const window = resolveCostWindow(range);
  const previousWindow = resolveCostWindow(previousRange(range), new Date(window.sinceMs - 1));
  const [daily, models, previousTotals, totals] = await Promise.all([
    queryDaily(database, { organizationId, runPurposes, window }),
    queryModels(database, { organizationId, runPurposes, window }),
    queryTotals(database, {
      organizationId,
      runPurposes,
      window: previousWindow,
    }),
    queryTotals(database, { organizationId, runPurposes, window }),
  ]);

  return {
    daily,
    models,
    previousTotals,
    totals,
  };
}

export async function getAppCostCard({
  database,
  appId,
  range,
  runPurposes = [],
  viewer,
}: AppCostCardInput): Promise<AppCostCardView> {
  const app = await ensureAppOwnership(database, viewer.id, appId);
  const window = resolveCostWindow(range);
  const previousWindow = resolveCostWindow(previousRange(range), new Date(window.sinceMs - 1));
  const [card, previousTotals] = await Promise.all([
    buildAttributionCard(database, {
      organizationId: app.organizationId,
      appId: app.id,
      range,
      runPurposes,
    }),
    queryTotals(database, {
      organizationId: app.organizationId,
      appId: app.id,
      runPurposes,
      window: previousWindow,
    }),
  ]);

  return {
    ...card,
    previousTotals,
    appId: app.id,
    appName: app.name,
  };
}

export async function getAgentCostCard({
  agentId,
  database,
  appId,
  range,
  runPurposes = [],
  viewer,
}: AgentCostCardInput): Promise<AgentCostCardView> {
  const app = await ensureAppOwnership(database, viewer.id, appId);
  const { agent } = await ensureAppAgentOwner(database, viewer.id, { agentId, appId });
  const [header, card] = await Promise.all([
    getAgentHeader(database, agentId),
    buildAttributionCard(database, {
      agentId,
      organizationId: app.organizationId,
      appId: agent.appId,
      range,
      runPurposes,
    }),
  ]);

  return {
    ...card,
    agentId,
    agentName: header.agentName,
    ownerId: header.ownerId,
    ownerName: header.ownerName,
  };
}
