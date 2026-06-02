import type { AccountId, AgentId, SessionId, SessionRunId } from "@mosoo/contracts/id";

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

export interface CostUserRow extends CostTotals {
  agentCount: number;
  previousCostUsd: number | null;
  topAgentId: AgentId | null;
  topAgentName: string | null;
  userEmail: string | null;
  userId: AccountId;
  userName: string;
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
  actorUserId: AccountId;
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

export interface OrganizationCostCard extends CostAttributionCard {
  ownerUsers: CostUserRow[];
  previousTotals: CostTotals;
  users: CostUserRow[];
}

export interface AgentCostCard extends CostAttributionCard {
  agentId: AgentId;
  agentName: string;
  ownerId: AccountId;
  ownerName: string;
  users: CostUserRow[];
}

export interface MemberCostCard {
  owned: CostAttributionCard;
  used: CostAttributionCard;
}
