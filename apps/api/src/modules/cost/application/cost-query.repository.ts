import { parsePlatformId } from "@mosoo/id";
import type { AccountId, AgentId, OrganizationId, SessionId, SessionRunId } from "@mosoo/id";

import { getAppDatabase, parameterizedSql } from "../../../platform/db/drizzle";
import { isTruthy } from "../../../shared/truthiness";
import { findModelPricing } from "../domain/cost-pricing";
import {
  aggregateSelect,
  buildUsageSourceCte,
  buildWhere,
  toTotalsView,
} from "./cost-query-window";
import type {
  AgentAggregateRow,
  AggregateRow,
  CostAgentRowView,
  CostDailyPointView,
  CostExternalChannelAttributionView,
  CostModelRowView,
  CostRecentSessionView,
  CostTotalsView,
  CostUserAttributionMode,
  CostUserRowView,
  CostWindow,
  DailyRow,
  ModelAggregateRow,
  RecentUsageRow,
  UserAggregateRow,
} from "./cost-query.types";

async function getCostRow<T>(
  database: D1Database,
  query: string,
  bindings: readonly unknown[],
): Promise<T | null> {
  return (await getAppDatabase(database).get<T>(parameterizedSql(query, bindings))) ?? null;
}

async function listCostRows<T>(
  database: D1Database,
  query: string,
  bindings: readonly unknown[],
): Promise<T[]> {
  return getAppDatabase(database).all<T>(parameterizedSql(query, bindings));
}

function mergeTotalsView<T extends object>(totals: CostTotalsView, view: T): CostTotalsView & T {
  return Object.assign(view, totals);
}

function readAccountId(value: unknown, label: string): AccountId {
  return parsePlatformId<AccountId>(value, label);
}

function readAgentId(value: unknown, label: string): AgentId {
  return parsePlatformId<AgentId>(value, label);
}

function readSessionId(value: unknown, label: string): SessionId | null {
  return value === null ? null : parsePlatformId<SessionId>(value, label);
}

function readSessionRunId(value: unknown, label: string): SessionRunId | null {
  return value === null ? null : parsePlatformId<SessionRunId>(value, label);
}

interface ScopedCostQuery {
  actorUserId?: AccountId;
  agentId?: AgentId;
  externalChannel?: boolean;
  organizationId: OrganizationId;
  ownerUserId?: AccountId;
  runPurposes?: readonly string[];
}

interface WindowedCostQuery extends ScopedCostQuery {
  window: CostWindow;
}

export async function queryTotals(
  database: D1Database,
  input: WindowedCostQuery,
): Promise<CostTotalsView> {
  const source = buildUsageSourceCte(input.window, input.organizationId);
  const where = buildWhere(input);
  const row = await getCostRow<AggregateRow>(
    database,
    `
        ${source.sql}
        SELECT
          ${aggregateSelect()}
        FROM usage_source
        WHERE ${where.sql}
      `,
    [...source.bindings, ...where.bindings],
  );

  return toTotalsView(row);
}

export async function queryDaily(
  database: D1Database,
  input: WindowedCostQuery,
): Promise<CostDailyPointView[]> {
  const source = buildUsageSourceCte(input.window, input.organizationId);
  const where = buildWhere(input);
  const results = await listCostRows<DailyRow>(
    database,
    `
        ${source.sql}
        SELECT
          date,
          ${aggregateSelect()}
        FROM usage_source
        WHERE ${where.sql}
        GROUP BY date
        ORDER BY date ASC
      `,
    [...source.bindings, ...where.bindings],
  );

  return results.map((row) =>
    mergeTotalsView(toTotalsView(row), {
      date: row.date,
    }),
  );
}

export async function queryAgents(
  database: D1Database,
  input: WindowedCostQuery,
): Promise<CostAgentRowView[]> {
  const source = buildUsageSourceCte(input.window, input.organizationId);
  const where = buildWhere(input);
  const results = await listCostRows<AgentAggregateRow>(
    database,
    `
        ${source.sql}
        SELECT
          usage_source.agent_id,
          COALESCE(agent.name, usage_source.agent_id) AS agent_name,
          usage_source.agent_owner_user_id AS owner_id,
          account.name AS owner_name,
          account.email AS owner_email,
          ${aggregateSelect()},
          SUM(CASE WHEN usage_source.run_purpose = 'production'
            THEN usage_source.total_cost_usd ELSE 0 END) AS production_cost_usd,
          SUM(CASE WHEN usage_source.run_purpose = 'debug'
            THEN usage_source.total_cost_usd ELSE 0 END) AS debug_cost_usd,
          SUM(CASE WHEN usage_source.run_purpose = 'preview'
            THEN usage_source.total_cost_usd ELSE 0 END) AS preview_cost_usd,
          SUM(CASE WHEN usage_source.run_purpose = 'scheduled'
            THEN usage_source.total_cost_usd ELSE 0 END) AS scheduled_cost_usd,
          SUM(CASE WHEN usage_source.run_purpose = 'eval'
            THEN usage_source.total_cost_usd ELSE 0 END) AS eval_cost_usd
        FROM usage_source
        LEFT JOIN agent ON agent.id = usage_source.agent_id
        LEFT JOIN account ON account.id = usage_source.agent_owner_user_id
        WHERE ${where.sql}
        GROUP BY usage_source.agent_id, usage_source.agent_owner_user_id
        ORDER BY total_cost_usd DESC
      `,
    [...source.bindings, ...where.bindings],
  );

  return results.map((row) => {
    const agentId = readAgentId(row.agent_id, "cost agent ID");
    const ownerId = readAccountId(row.owner_id, "cost agent owner ID");

    return mergeTotalsView(toTotalsView(row), {
      agentId,
      agentName: row.agent_name ?? agentId,
      debugCostUsd: row.debug_cost_usd ?? 0,
      evalCostUsd: row.eval_cost_usd ?? 0,
      ownerEmail: row.owner_email,
      ownerId,
      ownerName: row.owner_name ?? row.owner_email ?? ownerId,
      previewCostUsd: row.preview_cost_usd ?? 0,
      previousCostUsd: null,
      productionCostUsd: row.production_cost_usd ?? 0,
      scheduledCostUsd: row.scheduled_cost_usd ?? 0,
    });
  });
}

export async function queryExternalChannelAttribution(
  database: D1Database,
  input: WindowedCostQuery,
): Promise<CostExternalChannelAttributionView> {
  const source = buildUsageSourceCte(input.window, input.organizationId);
  const where = buildWhere({ ...input, externalChannel: true });
  const row = await getCostRow<AggregateRow>(
    database,
    `
        ${source.sql}
        SELECT
          ${aggregateSelect()}
        FROM usage_source
        WHERE ${where.sql}
      `,
    [...source.bindings, ...where.bindings],
  );

  return {
    ...toTotalsView(row),
    previousCostUsd: null,
  };
}

export async function queryUsers(
  database: D1Database,
  input: {
    agentId?: AgentId;
    mode: CostUserAttributionMode;
    organizationId: OrganizationId;
    runPurposes?: readonly string[];
    window: CostWindow;
  },
): Promise<CostUserRowView[]> {
  const source = buildUsageSourceCte(input.window, input.organizationId);
  const whereInput: {
    agentId?: AgentId;
    externalChannel?: boolean;
    runPurposes?: readonly string[];
  } = {};

  if (isTruthy(input.agentId)) {
    whereInput.agentId = input.agentId;
  }

  if (input.runPurposes) {
    whereInput.runPurposes = input.runPurposes;
  }

  if (input.mode === "used_by") {
    whereInput.externalChannel = false;
  }

  const where = buildWhere(whereInput);
  const userColumn = input.mode === "owned_by" ? "agent_owner_user_id" : "actor_user_id";
  const results = await listCostRows<UserAggregateRow>(
    database,
    `
        ${source.sql}
        , filtered_usage AS (
          SELECT *
          FROM usage_source
          WHERE ${where.sql}
        ),
        user_totals AS (
          SELECT
            filtered_usage.${userColumn} AS user_id,
            account.name AS user_name,
            account.email AS user_email,
            COUNT(DISTINCT filtered_usage.agent_id) AS agent_count,
            ${aggregateSelect()}
          FROM filtered_usage
          LEFT JOIN account ON account.id = filtered_usage.${userColumn}
          GROUP BY filtered_usage.${userColumn}
        ),
        agent_totals AS (
          SELECT
            filtered_usage.${userColumn} AS user_id,
            filtered_usage.agent_id,
            COALESCE(agent.name, filtered_usage.agent_id) AS agent_name,
            ROW_NUMBER() OVER (
              PARTITION BY filtered_usage.${userColumn}
              ORDER BY SUM(filtered_usage.total_cost_usd) DESC, filtered_usage.agent_id ASC
            ) AS agent_rank
          FROM filtered_usage
          LEFT JOIN agent ON agent.id = filtered_usage.agent_id
          GROUP BY filtered_usage.${userColumn}, filtered_usage.agent_id
        )
        SELECT
          user_totals.*,
          agent_totals.agent_id AS top_agent_id,
          agent_totals.agent_name AS top_agent_name
        FROM user_totals
        LEFT JOIN agent_totals
          ON agent_totals.user_id = user_totals.user_id
          AND agent_totals.agent_rank = 1
        ORDER BY total_cost_usd DESC
      `,
    [...source.bindings, ...where.bindings],
  );

  return results.map((row) => {
    const userId = readAccountId(row.user_id, "cost user ID");
    const topAgentId =
      row.top_agent_id === null ? null : readAgentId(row.top_agent_id, "top cost agent ID");

    return mergeTotalsView(toTotalsView(row), {
      agentCount: row.agent_count,
      previousCostUsd: null,
      topAgentId,
      topAgentName: row.top_agent_name,
      userEmail: row.user_email,
      userId,
      userName: row.user_name ?? row.user_email ?? userId,
    });
  });
}

export async function queryModels(
  database: D1Database,
  input: WindowedCostQuery,
): Promise<CostModelRowView[]> {
  const source = buildUsageSourceCte(input.window, input.organizationId);
  const where = buildWhere(input);
  const results = await listCostRows<ModelAggregateRow>(
    database,
    `
        ${source.sql}
        SELECT
          usage_source.provider,
          usage_source.model,
          ${aggregateSelect()}
        FROM usage_source
        WHERE ${where.sql}
        GROUP BY usage_source.provider, usage_source.model
        ORDER BY total_cost_usd DESC
      `,
    [...source.bindings, ...where.bindings],
  );

  return results.map((row) => {
    const pricing = findModelPricing({
      modelId: row.model,
      providerId: row.provider,
    });

    return mergeTotalsView(toTotalsView(row), {
      cacheReadUsdPerMillion: pricing?.cacheReadUsdPerMillion ?? null,
      cacheWriteUsdPerMillion: pricing?.cacheWriteUsdPerMillion ?? null,
      inputUsdPerMillion: pricing?.inputUsdPerMillion ?? null,
      model: row.model,
      outputUsdPerMillion: pricing?.outputUsdPerMillion ?? null,
      provider: row.provider,
      vendor: pricing?.vendor ?? row.provider,
    });
  });
}

export async function queryRecentSessions(
  database: D1Database,
  input: ScopedCostQuery,
): Promise<CostRecentSessionView[]> {
  const filters = ["usage_event.organization_id = ?"];
  const bindings: string[] = [input.organizationId];

  if (isTruthy(input.agentId)) {
    filters.push("usage_event.agent_id = ?");
    bindings.push(input.agentId);
  }

  if (isTruthy(input.actorUserId)) {
    filters.push("usage_event.actor_user_id = ?");
    bindings.push(input.actorUserId);
    filters.push(
      "COALESCE(json_extract(session.metadata_json, '$.triggered_by.provider'), '') = ''",
    );
  }

  if (isTruthy(input.ownerUserId)) {
    filters.push("usage_event.agent_owner_user_id = ?");
    bindings.push(input.ownerUserId);
  }

  if (input.runPurposes && input.runPurposes.length > 0) {
    filters.push(`usage_event.run_purpose IN (${input.runPurposes.map(() => "?").join(", ")})`);
    bindings.push(...input.runPurposes);
  }

  const results = await listCostRows<RecentUsageRow>(
    database,
    `
        SELECT
          usage_event.actor_user_id,
          account.name AS actor_name,
          account.email AS actor_email,
          usage_event.cache_creation_tokens,
          usage_event.cache_read_tokens,
          usage_event.created_at,
          usage_event.input_tokens,
          usage_event.model,
          usage_event.output_tokens,
          usage_event.provider,
          usage_event.run_purpose,
          usage_event.session_id,
          usage_event.session_run_id,
          usage_event.total_cost_usd_micros / 1000000.0 AS total_cost_usd
        FROM usage_event
        LEFT JOIN session ON session.id = usage_event.session_id
        LEFT JOIN account ON account.id = usage_event.actor_user_id
        WHERE ${filters.join(" AND ")}
        ORDER BY usage_event.created_at DESC
        LIMIT 7
      `,
    bindings,
  );

  return results.map((row) => {
    const actorUserId = readAccountId(row.actor_user_id, "recent usage actor user ID");

    return {
      actorEmail: row.actor_email,
      actorName: row.actor_name ?? row.actor_email ?? actorUserId,
      actorUserId,
      cacheCreationTokens: row.cache_creation_tokens,
      cacheReadTokens: row.cache_read_tokens,
      createdAt: new Date(row.created_at).toISOString(),
      inputTokens: row.input_tokens,
      model: row.model,
      outputTokens: row.output_tokens,
      provider: row.provider,
      runPurpose: row.run_purpose,
      sessionId: readSessionId(row.session_id, "recent usage session ID"),
      sessionRunId: readSessionRunId(row.session_run_id, "recent usage session run ID"),
      totalCostUsd: row.total_cost_usd,
    };
  });
}
