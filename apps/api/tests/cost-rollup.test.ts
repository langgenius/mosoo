import { describe, expect, test } from "bun:test";

import { usageDailyRollupsTable } from "@mosoo/db";

import { resolveCostWindow } from "../src/modules/cost/application/cost-query-window";
import { queryTotals } from "../src/modules/cost/application/cost-query.repository";
import {
  createDailyRollupRetentionPredicate,
  getDailyRollupRetentionCutoffDate,
} from "../src/modules/cost/application/cost-rollup.service";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const APP_ID = "01J0000000000000000000000Q";
const AGENT_ID = "01J0000000000000000000000A";
const ACTOR_ID = "01J00000000000000000000001";
const OWNER_ID = "01J00000000000000000000002";
const ORGANIZATION_ID = "01J00000000000000000000006";
const ROLLUP_TIME = new Date(Date.UTC(2026, 6, 13, 12));

function createCostRollupDatabase(): SqliteD1Database {
  const database = new SqliteD1Database({ foreignKeys: false });

  database.execute(`
    CREATE TABLE session (
      id text PRIMARY KEY NOT NULL,
      metadata_json text NOT NULL,
      type text NOT NULL
    );

    CREATE TABLE usage_event (
      organization_id text NOT NULL,
      app_id text NOT NULL,
      agent_id text NOT NULL,
      actor_user_id text NOT NULL,
      agent_owner_user_id text NOT NULL,
      created_at integer NOT NULL,
      agent_publication_state_at_run text NOT NULL,
      run_purpose text NOT NULL,
      provider text NOT NULL,
      model text NOT NULL,
      input_tokens integer NOT NULL,
      output_tokens integer NOT NULL,
      cache_read_tokens integer NOT NULL,
      cache_creation_tokens integer NOT NULL,
      total_cost_usd_micros integer NOT NULL,
      pricing_status text NOT NULL,
      session_id text
    );

    CREATE TABLE usage_daily_rollup (
      organization_id text NOT NULL,
      app_id text NOT NULL,
      agent_id text NOT NULL,
      actor_user_id text NOT NULL,
      agent_owner_user_id text NOT NULL,
      date text NOT NULL,
      agent_publication_state_at_run text NOT NULL,
      run_purpose text NOT NULL,
      provider text NOT NULL,
      model text NOT NULL,
      request_count integer NOT NULL,
      input_tokens integer NOT NULL,
      output_tokens integer NOT NULL,
      cache_read_tokens integer NOT NULL,
      cache_creation_tokens integer NOT NULL,
      total_cost_usd_micros integer NOT NULL,
      unpriced_request_count integer NOT NULL,
      PRIMARY KEY (
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
      )
    );
  `);

  return database;
}

async function insertDailyRollup(
  database: SqliteD1Database,
  input: { date: string; totalCostUsdMicros: number },
): Promise<void> {
  await database
    .prepare(
      `
        INSERT INTO usage_daily_rollup (
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
        ) VALUES (?, ?, ?, ?, ?, ?, 'published', 'production', 'openai', 'gpt-test', 1, 10, 1, 0, 0, ?, 0)
      `,
    )
    .bind(
      ORGANIZATION_ID,
      APP_ID,
      AGENT_ID,
      ACTOR_ID,
      OWNER_ID,
      input.date,
      input.totalCostUsdMicros,
    )
    .run();
}

describe("cost daily rollup retention", () => {
  test("keeps the preceding 90-day comparison window for LAST_90_DAYS", async () => {
    const database = createCostRollupDatabase();
    await insertDailyRollup(database, { date: "2026-01-15", totalCostUsdMicros: 5_000_000 });
    await insertDailyRollup(database, { date: "2025-12-01", totalCostUsdMicros: 7_000_000 });

    const dailyRollupRetentionCutoffDate = getDailyRollupRetentionCutoffDate(ROLLUP_TIME);
    await database
      .app()
      .delete(usageDailyRollupsTable)
      .where(createDailyRollupRetentionPredicate(ROLLUP_TIME))
      .run();

    const retainedDates = await database
      .prepare("SELECT date FROM usage_daily_rollup ORDER BY date")
      .all<{ date: string }>();
    const currentWindow = resolveCostWindow("LAST_90_DAYS", ROLLUP_TIME);
    const previousWindow = resolveCostWindow("LAST_90_DAYS", new Date(currentWindow.sinceMs - 1));
    const previousTotals = await queryTotals(database, {
      appId: APP_ID,
      organizationId: ORGANIZATION_ID,
      window: previousWindow,
    });

    expect(dailyRollupRetentionCutoffDate).toBe("2026-01-14");
    expect(retainedDates.results).toEqual([{ date: "2026-01-15" }]);
    expect(previousTotals).toMatchObject({
      requestCount: 1,
      totalCostUsd: 5,
    });
  });
});
