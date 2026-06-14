import type { AccountId, AgentId, AppId, SessionId, SessionRunId } from "@mosoo/contracts/id";

export type CostRangeInput = "LAST_7_DAYS" | "LAST_30_DAYS" | "MONTH_TO_DATE" | "LAST_90_DAYS";
export type CostRunPurpose = "debug" | "eval" | "preview" | "production" | "scheduled";

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
  agentId: AgentId;
  agentName: string;
  debugCostUsd: number;
  evalCostUsd: number;
  ownerEmail: string | null;
  ownerId: AccountId;
  ownerName: string;
  previousCostUsd: number | null;
  previewCostUsd: number;
  productionCostUsd: number;
  scheduledCostUsd: number;
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

export interface OrganizationBillingCostCard {
  daily: CostDailyPoint[];
  previousTotals: CostTotals;
  models: CostModelRow[];
  totals: CostTotals;
}

export interface AppCostCard extends CostAttributionCard {
  previousTotals: CostTotals;
  appId: AppId;
  appName: string;
}

export interface AgentCostCard extends CostAttributionCard {
  agentId: AgentId;
  agentName: string;
  ownerId: AccountId;
  ownerName: string;
}
