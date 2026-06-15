import type { AgentId, OrganizationId, AppId } from "@mosoo/id";

import { isTruthy } from "../../../shared/truthiness";
import type { AggregateRow, CostRange, CostTotalsView, CostWindow } from "./cost-query.types";

interface CostWhereInput {
  agentId?: AgentId;
  runPurposes?: readonly string[];
}

function toDateString(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

export function resolveCostWindow(range: CostRange, now = new Date()): CostWindow {
  const today = startOfUtcDay(now);
  const since = new Date(today);

  if (range === "LAST_7_DAYS") {
    since.setUTCDate(today.getUTCDate() - 6);
  } else if (range === "LAST_90_DAYS") {
    since.setUTCDate(today.getUTCDate() - 89);
  } else if (range === "MONTH_TO_DATE") {
    since.setUTCDate(1);
  } else {
    since.setUTCDate(today.getUTCDate() - 29);
  }

  const detailBoundary = new Date(today);
  detailBoundary.setUTCDate(today.getUTCDate() - 7);

  return {
    dailyBeforeDate: toDateString(detailBoundary),
    detailSinceMs: Math.max(since.getTime(), detailBoundary.getTime()),
    label: range,
    sinceDate: toDateString(since),
    sinceMs: since.getTime(),
  };
}

function zeroTotals(): CostTotalsView {
  return {
    activeUsers: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    requestCount: 0,
    totalCostUsd: 0,
    unpricedRequestCount: 0,
  };
}

export function toTotalsView(row: AggregateRow | null): CostTotalsView {
  if (!row) {
    return zeroTotals();
  }

  return {
    activeUsers: row.active_user_count ?? 0,
    cacheCreationTokens: row.cache_creation_tokens ?? 0,
    cacheReadTokens: row.cache_read_tokens ?? 0,
    inputTokens: row.input_tokens ?? 0,
    outputTokens: row.output_tokens ?? 0,
    requestCount: row.request_count ?? 0,
    totalCostUsd: row.total_cost_usd ?? 0,
    unpricedRequestCount: row.unpriced_request_count ?? 0,
  };
}

export function buildUsageSourceCte(
  window: CostWindow,
  scope: {
    organizationId: OrganizationId;
    appId?: AppId;
  },
): {
  bindings: (number | string)[];
  sql: string;
} {
  const detailAppFilter = isTruthy(scope.appId) ? "AND usage_event.app_id = ?" : "";
  const rollupAppFilter = isTruthy(scope.appId) ? "AND app_id = ?" : "";

  return {
    bindings: [
      scope.organizationId,
      ...(isTruthy(scope.appId) ? [scope.appId] : []),
      window.detailSinceMs,
      scope.organizationId,
      ...(isTruthy(scope.appId) ? [scope.appId] : []),
      window.sinceDate,
      window.dailyBeforeDate,
    ],
    sql: `
      WITH usage_source AS (
        SELECT
          usage_event.organization_id,
          usage_event.app_id,
          usage_event.agent_id,
          usage_event.actor_user_id,
          usage_event.agent_owner_user_id,
          CASE
            WHEN session.type = 'api_channel'
              AND json_extract(session.metadata_json, '$.triggered_by.provider') IS NOT NULL
              THEN 1
            ELSE 0
          END AS is_external_channel,
          date(usage_event.created_at / 1000, 'unixepoch') AS date,
          usage_event.agent_publication_state_at_run,
          usage_event.run_purpose,
          usage_event.provider,
          usage_event.model,
          1 AS request_count,
          usage_event.input_tokens,
          usage_event.output_tokens,
          usage_event.cache_read_tokens,
          usage_event.cache_creation_tokens,
          usage_event.total_cost_usd_micros / 1000000.0 AS total_cost_usd,
          CASE WHEN usage_event.pricing_status = 'unknown' THEN 1 ELSE 0 END
            AS unpriced_request_count
        FROM usage_event
        LEFT JOIN session ON session.id = usage_event.session_id
        WHERE usage_event.organization_id = ?
          ${detailAppFilter}
          AND usage_event.created_at >= ?
        UNION ALL
        SELECT
          organization_id,
          app_id,
          agent_id,
          actor_user_id,
          agent_owner_user_id,
          CASE WHEN run_purpose = 'channel' THEN 1 ELSE 0 END AS is_external_channel,
          date,
          agent_publication_state_at_run,
          run_purpose,
          provider,
          model,
          request_count,
          input_tokens,
          output_tokens,
          cache_read_tokens,
          cache_creation_tokens,
          total_cost_usd_micros / 1000000.0 AS total_cost_usd,
          unpriced_request_count
        FROM usage_daily_rollup
        WHERE organization_id = ?
          ${rollupAppFilter}
          AND date >= ?
          AND date < ?
      )
    `,
  };
}

export function buildWhere(input: CostWhereInput): { bindings: string[]; sql: string } {
  const filters: string[] = ["1 = 1"];
  const bindings: string[] = [];

  if (isTruthy(input.agentId)) {
    filters.push("usage_source.agent_id = ?");
    bindings.push(input.agentId);
  }

  if (input.runPurposes && input.runPurposes.length > 0) {
    filters.push(`usage_source.run_purpose IN (${input.runPurposes.map(() => "?").join(", ")})`);
    bindings.push(...input.runPurposes);
  }

  return {
    bindings,
    sql: filters.join(" AND "),
  };
}

export function aggregateSelect(): string {
  return `
    SUM(request_count) AS request_count,
    SUM(input_tokens) AS input_tokens,
    SUM(output_tokens) AS output_tokens,
    SUM(cache_read_tokens) AS cache_read_tokens,
    SUM(cache_creation_tokens) AS cache_creation_tokens,
    SUM(total_cost_usd) AS total_cost_usd,
    COUNT(DISTINCT CASE
      WHEN is_external_channel = 0 THEN actor_user_id
      ELSE NULL
    END) AS active_user_count,
    SUM(unpriced_request_count) AS unpriced_request_count
  `;
}
