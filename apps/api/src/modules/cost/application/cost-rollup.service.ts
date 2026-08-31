import {
  sessionModelCallsTable,
  usageDailyRollupsTable,
  usageEventRollupReceiptsTable,
  usageEventsTable,
} from "@mosoo/db";
import { lt, sql } from "drizzle-orm";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { runAppDatabaseBatch } from "../../../platform/db/drizzle";

const DETAIL_RETENTION_DAYS = 7;

export const DAILY_ROLLUP_RETENTION_DAYS = 180;

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function toUtcDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function getDailyRollupRetentionCutoffDate(now: Date): string {
  const cutoff = startOfUtcDay(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - DAILY_ROLLUP_RETENTION_DAYS);
  return toUtcDate(cutoff);
}

export function getUsageDetailRetentionCutoffMs(now: Date): number {
  const cutoff = startOfUtcDay(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - DETAIL_RETENTION_DAYS);
  return cutoff.getTime();
}

export function getUsageRollupReceiptRetentionCutoffMs(now: Date): number {
  const cutoff = startOfUtcDay(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - DAILY_ROLLUP_RETENTION_DAYS);
  return cutoff.getTime();
}

export function createDailyRollupRetentionPredicate(now: Date) {
  return lt(usageDailyRollupsTable.date, getDailyRollupRetentionCutoffDate(now));
}

export async function runUsageDailyRollup(env: ApiBindings, now = new Date()): Promise<void> {
  const cutoffMs = getUsageDetailRetentionCutoffMs(now);

  if (!Number.isSafeInteger(cutoffMs)) {
    throw new Error("Usage detail retention cutoff must be a valid timestamp.");
  }

  const receiptCutoffMs = getUsageRollupReceiptRetentionCutoffMs(now);
  const rolledUpAtMs = now.getTime();

  if (!Number.isSafeInteger(rolledUpAtMs)) {
    throw new Error("Usage rollup timestamp must be a valid timestamp.");
  }

  // Drizzle's D1 batch cannot prepare parameterized db.run(sql) queries.
  const cutoffSql = sql.raw(String(cutoffMs));
  const rolledUpAtSql = sql.raw(String(rolledUpAtMs));
  const eligibleUsage = sql`
    ${usageEventsTable.createdAt} < ${cutoffSql}
    AND (
      ${usageEventsTable.source} <> 'runtime_driver'
      OR EXISTS (
        SELECT 1
        FROM ${sessionModelCallsTable} AS rollup_model_call
        WHERE rollup_model_call.session_id = ${usageEventsTable.sessionId}
          AND rollup_model_call.session_run_id = ${usageEventsTable.sessionRunId}
          AND ${usageEventsTable.sourceEventId} =
            rollup_model_call.driver_instance_id || ':' ||
            CASE
              WHEN trim(COALESCE(rollup_model_call.native_call_id, '')) <> ''
                THEN trim(rollup_model_call.native_call_id)
              ELSE rollup_model_call.session_run_id || ':' || rollup_model_call.call_key
            END
          AND rollup_model_call.source_event_seq >= ${usageEventsTable.sourceEventSeq}
      )
    )
  `;

  await runAppDatabaseBatch(env.DB, (db) => [
    db.run(sql`
        INSERT INTO ${usageDailyRollupsTable}
          (
            organization_id,
            project_id,
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
          ${usageEventsTable.projectId},
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
        WHERE ${eligibleUsage}
        GROUP BY
          ${usageEventsTable.organizationId},
          ${usageEventsTable.projectId},
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
          project_id,
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
    db.run(sql`
        INSERT INTO ${usageEventRollupReceiptsTable} (source, source_event_id, rolled_up_at)
        SELECT
          ${usageEventsTable.source},
          ${usageEventsTable.sourceEventId},
          ${rolledUpAtSql}
        FROM ${usageEventsTable}
        WHERE ${eligibleUsage}
        ON CONFLICT(source, source_event_id) DO NOTHING
      `),
    db.delete(usageEventsTable).where(eligibleUsage),
    db.delete(usageDailyRollupsTable).where(createDailyRollupRetentionPredicate(now)),
    db
      .delete(usageEventRollupReceiptsTable)
      .where(lt(usageEventRollupReceiptsTable.rolledUpAt, receiptCutoffMs)),
  ]);
}
