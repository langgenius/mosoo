import { usageDailyRollupsTable, usageEventsTable } from "@mosoo/db";
import { lt, sql } from "drizzle-orm";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { runAppDatabaseBatch } from "../../../platform/db/drizzle";

const DETAIL_RETENTION_DAYS = 7;

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function toUtcDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export async function runUsageDailyRollup(env: ApiBindings, now = new Date()): Promise<void> {
  const cutoff = startOfUtcDay(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - DETAIL_RETENTION_DAYS);
  const cutoffDate = toUtcDate(cutoff);
  const cutoffMs = cutoff.getTime();

  await runAppDatabaseBatch(env.DB, (db) => [
    db.run(sql`
        INSERT INTO ${usageDailyRollupsTable}
          (
            organization_id,
            app_id,
            agent_id,
            actor_user_id,
            agent_owner_user_id,
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
            total_cost_usd_micros,
            unpriced_request_count
          )
        SELECT
          ${usageEventsTable.organizationId},
          ${usageEventsTable.appId},
          ${usageEventsTable.agentId},
          ${usageEventsTable.actorUserId},
          ${usageEventsTable.agentOwnerUserId},
          date(${usageEventsTable.createdAt} / 1000, 'unixepoch') AS date,
          ${usageEventsTable.agentPublicationStateAtRun},
          ${usageEventsTable.runPurpose},
          ${usageEventsTable.provider},
          ${usageEventsTable.model},
          COUNT(*) AS request_count,
          SUM(${usageEventsTable.inputTokens}) AS input_tokens,
          SUM(${usageEventsTable.outputTokens}) AS output_tokens,
          SUM(${usageEventsTable.cacheReadTokens}) AS cache_read_tokens,
          SUM(${usageEventsTable.cacheCreationTokens}) AS cache_creation_tokens,
          SUM(${usageEventsTable.totalCostUsdMicros}) AS total_cost_usd_micros,
          SUM(CASE WHEN ${usageEventsTable.pricingStatus} = 'unknown' THEN 1 ELSE 0 END)
            AS unpriced_request_count
        FROM ${usageEventsTable}
        WHERE ${usageEventsTable.createdAt} < ${cutoffMs}
        GROUP BY
          ${usageEventsTable.organizationId},
          ${usageEventsTable.appId},
          ${usageEventsTable.agentId},
          ${usageEventsTable.actorUserId},
          ${usageEventsTable.agentOwnerUserId},
          date,
          ${usageEventsTable.agentPublicationStateAtRun},
          ${usageEventsTable.runPurpose},
          ${usageEventsTable.provider},
          ${usageEventsTable.model}
        ON CONFLICT(
          organization_id,
          app_id,
          agent_id,
          actor_user_id,
          agent_owner_user_id,
          date,
          agent_publication_state_at_run,
          run_purpose,
          provider,
          model
        ) DO UPDATE SET
          request_count = usage_daily_rollup.request_count + excluded.request_count,
          input_tokens = usage_daily_rollup.input_tokens + excluded.input_tokens,
          output_tokens = usage_daily_rollup.output_tokens + excluded.output_tokens,
          cache_read_tokens = usage_daily_rollup.cache_read_tokens + excluded.cache_read_tokens,
          cache_creation_tokens =
            usage_daily_rollup.cache_creation_tokens + excluded.cache_creation_tokens,
          total_cost_usd_micros =
            usage_daily_rollup.total_cost_usd_micros + excluded.total_cost_usd_micros,
          unpriced_request_count =
            usage_daily_rollup.unpriced_request_count + excluded.unpriced_request_count
      `),
    db.delete(usageEventsTable).where(lt(usageEventsTable.createdAt, cutoffMs)),
    db
      .delete(usageDailyRollupsTable)
      .where(sql`${usageDailyRollupsTable.date} < date(${cutoffDate}, '-90 days')`),
  ]);
}
