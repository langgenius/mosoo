import type { AccountId, AgentId, ProjectId, SessionId, SessionRunId } from "@mosoo/id";

export type CostRangeInput = "LAST_7_DAYS" | "LAST_30_DAYS" | "MONTH_TO_DATE" | "LAST_90_DAYS";
export type CostRunPurpose = "debug" | "preview" | "production";

export interface CostTotals {
  activeUsers: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  inputTokens: number;
  outputTokens: number;
  requestCount: number;
  totalCostUsd: number;
  unpricedRequestCount: number;
}

export interface CostDailyPoint extends CostTotals {
  date: string;
}

export interface CostAgentRow extends CostTotals {
  agentId: AgentId | null;
  agentName: string;
  debugCostUsd: number;
  ownerEmail: string | null;
  ownerId: AccountId;
  ownerName: string;
  previewCostUsd: number;
  productionCostUsd: number;
}

export interface CostModelRow extends CostTotals {
  cacheReadUsdPerMillion: number | null;
  cacheWriteUsdPerMillion: number | null;
  inputUsdPerMillion: number | null;
  model: string;
  outputUsdPerMillion: number | null;
  provider: string;
  vendor: string;
}

export interface CostRecentSession {
  actorEmail: string | null;
  actorName: string;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  createdAt: string;
  inputTokens: number;
  model: string;
  outputTokens: number;
  provider: string;
  runPurpose: string;
  sessionId: SessionId | null;
  sessionRunId: SessionRunId | null;
  totalCostUsd: number;
}

export interface CostAttributionCard {
  agents: CostAgentRow[];
  daily: CostDailyPoint[];
  models: CostModelRow[];
  recentSessions: CostRecentSession[];
  totals: CostTotals;
}

export interface ProjectCostCard extends CostAttributionCard {
  previousTotals: CostTotals;
  projectId: ProjectId;
  projectName: string;
}

export interface AgentCostCard extends CostAttributionCard {
  agentId: AgentId;
  agentName: string;
  ownerId: AccountId;
  ownerName: string;
}
