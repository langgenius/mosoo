import type { AccountId, AgentId, AppId, SessionId, SessionRunId } from "@mosoo/id";

export type CostRange = "LAST_7_DAYS" | "LAST_30_DAYS" | "MONTH_TO_DATE" | "LAST_90_DAYS";

export interface CostWindow {
  dailyBeforeDate: string;
  detailSinceMs: number;
  label: string;
  sinceDate: string;
  sinceMs: number;
}

export interface AggregateRow {
  active_user_count: number | null;
  cache_creation_tokens: number | null;
  cache_read_tokens: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  request_count: number | null;
  total_cost_usd: number | null;
  unpriced_request_count: number | null;
}

export interface DailyRow extends AggregateRow {
  date: string;
}

export interface AgentAggregateRow extends AggregateRow {
  agent_id: string;
  agent_name: string | null;
  debug_cost_usd: number | null;
  eval_cost_usd: number | null;
  owner_email: string | null;
  owner_id: string;
  owner_name: string | null;
  preview_cost_usd: number | null;
  production_cost_usd: number | null;
  scheduled_cost_usd: number | null;
}

export interface ModelAggregateRow extends AggregateRow {
  model: string;
  provider: string;
}

export interface RecentUsageRow {
  actor_email: string | null;
  actor_name: string | null;
  actor_user_id: string;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  created_at: number;
  input_tokens: number;
  model: string;
  output_tokens: number;
  provider: string;
  run_purpose: string;
  session_id: string | null;
  session_run_id: string | null;
  total_cost_usd: number;
}

export interface CostTotalsView {
  activeUsers: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  inputTokens: number;
  outputTokens: number;
  requestCount: number;
  totalCostUsd: number;
  unpricedRequestCount: number;
}

export interface CostDailyPointView extends CostTotalsView {
  date: string;
}

export interface CostAgentRowView extends CostTotalsView {
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

export interface CostModelRowView extends CostTotalsView {
  cacheReadUsdPerMillion: number | null;
  cacheWriteUsdPerMillion: number | null;
  inputUsdPerMillion: number | null;
  model: string;
  outputUsdPerMillion: number | null;
  provider: string;
  vendor: string;
}

export interface CostRecentSessionView {
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

export interface CostAttributionCardView {
  agents: CostAgentRowView[];
  daily: CostDailyPointView[];
  models: CostModelRowView[];
  recentSessions: CostRecentSessionView[];
  totals: CostTotalsView;
}

export interface OrganizationBillingCostCardView {
  daily: CostDailyPointView[];
  models: CostModelRowView[];
  previousTotals: CostTotalsView;
  totals: CostTotalsView;
}

export interface AppCostCardView extends CostAttributionCardView {
  previousTotals: CostTotalsView;
  appId: AppId;
  appName: string;
}

export interface AgentCostCardView extends CostAttributionCardView {
  agentId: AgentId;
  agentName: string;
  ownerId: AccountId;
  ownerName: string;
}
