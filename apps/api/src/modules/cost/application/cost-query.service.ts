import type { AgentId, ProjectId } from "@mosoo/id";

import { ensureProjectAgentOwner } from "../../agents/application/agent-access.service";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { ensureProjectOwnership } from "../../projects/application/project.service";
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
  ProjectCostCardView,
} from "./cost-query.types";

export type { CostRange } from "./cost-query.types";

interface CostCardAccessInput {
  database: D1Database;
  viewer: AuthenticatedViewer;
}

export interface ProjectCostCardInput extends CostCardAccessInput {
  projectId: ProjectId;
  range: CostRange;
  runPurposes?: readonly string[];
}

export interface AgentCostCardInput extends CostCardAccessInput {
  agentId: AgentId;
  projectId: ProjectId;
  range: CostRange;
  runPurposes?: readonly string[];
}

async function buildAttributionCard(
  database: D1Database,
  input: {
    agentId?: AgentId;
    projectId: ProjectId;
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

export async function getProjectCostCard({
  database,
  projectId,
  range,
  runPurposes = [],
  viewer,
}: ProjectCostCardInput): Promise<ProjectCostCardView> {
  const project = await ensureProjectOwnership(database, viewer.id, projectId);
  const window = resolveCostWindow(range);
  const previousWindow = resolveCostWindow(
    range === "MONTH_TO_DATE" ? "LAST_30_DAYS" : range,
    new Date(window.sinceMs - 1),
  );
  const [card, previousTotals] = await Promise.all([
    buildAttributionCard(database, { projectId, range, runPurposes }),
    queryTotals(database, { projectId, runPurposes, window: previousWindow }),
  ]);

  return {
    ...card,
    previousTotals,
    projectId: project.id,
    projectName: project.name,
  };
}

export async function getAgentCostCard({
  agentId,
  database,
  projectId,
  range,
  runPurposes = [],
  viewer,
}: AgentCostCardInput): Promise<AgentCostCardView> {
  const agent = await ensureProjectAgentOwner(database, viewer.id, { agentId, projectId });
  const card = await buildAttributionCard(database, { agentId, projectId, range, runPurposes });

  return {
    ...card,
    agentId,
    agentName: agent.name,
    ownerId: viewer.id,
    ownerName: viewer.name,
  };
}
