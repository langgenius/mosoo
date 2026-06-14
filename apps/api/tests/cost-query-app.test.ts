import { describe, expect, test } from "bun:test";

import { resolveCostWindow } from "../src/modules/cost/application/cost-query-window";
import {
  queryAgents,
  queryModels,
  queryTotals,
} from "../src/modules/cost/application/cost-query.repository";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const EVENT_TIME_MS = Date.UTC(2026, 4, 20, 12);
const ORGANIZATION_ID = "01J00000000000000000000006";
const APP_ONE_ID = "01J000000000000000000000P1";
const APP_TWO_ID = "01J000000000000000000000P2";
const OWNER_ID = "01J00000000000000000000001";
const ACTOR_ID = "01J00000000000000000000011";
const APP_ONE_AGENT_ID = "01J000000000000000000000A1";
const APP_TWO_AGENT_ID = "01J000000000000000000000A2";

async function createCostQueryDatabase(): Promise<SqliteD1Database> {
  const database = new SqliteD1Database({ foreignKeys: false });

  database.execute(`
    CREATE TABLE account (
      id text PRIMARY KEY NOT NULL,
      name text NOT NULL,
      email text NOT NULL
    );

    CREATE TABLE agent (
      id text PRIMARY KEY NOT NULL,
      name text NOT NULL
    );

    CREATE TABLE session (
      id text PRIMARY KEY NOT NULL,
      metadata_json text NOT NULL,
      type text NOT NULL
    );

    CREATE TABLE usage_event (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL,
      app_id text NOT NULL,
      agent_id text NOT NULL,
      actor_user_id text NOT NULL,
      agent_owner_user_id text NOT NULL,
      agent_publication_state_at_run text NOT NULL,
      run_purpose text NOT NULL,
      provider text NOT NULL,
      model text NOT NULL,
      created_at integer NOT NULL,
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
      unpriced_request_count integer NOT NULL
    );

    INSERT INTO account (id, name, email)
    VALUES
      ('${OWNER_ID}', 'Owner One', 'owner@example.com'),
      ('${ACTOR_ID}', 'Actor One', 'actor1@example.com');

    INSERT INTO agent (id, name)
    VALUES
      ('${APP_ONE_AGENT_ID}', 'Planner'),
      ('${APP_TWO_AGENT_ID}', 'Support');
  `);

  await insertUsageEvent(database, {
    agentId: APP_ONE_AGENT_ID,
    id: "app-one-event",
    appId: APP_ONE_ID,
    totalCostUsd: 2,
  });
  await insertUsageEvent(database, {
    agentId: APP_TWO_AGENT_ID,
    id: "app-two-event",
    appId: APP_TWO_ID,
    totalCostUsd: 5,
  });

  return database;
}

async function insertUsageEvent(
  database: SqliteD1Database,
  input: {
    agentId: string;
    id: string;
    appId: string;
    totalCostUsd: number;
  },
): Promise<void> {
  await database
    .prepare(
      `
        INSERT INTO usage_event (
          id,
          organization_id,
          app_id,
          agent_id,
          actor_user_id,
          agent_owner_user_id,
          agent_publication_state_at_run,
          run_purpose,
          provider,
          model,
          created_at,
          input_tokens,
          output_tokens,
          cache_read_tokens,
          cache_creation_tokens,
          total_cost_usd_micros,
          pricing_status,
          session_id
        )
        VALUES (?, ?, ?, ?, ?, ?, 'published', 'production', 'openai', 'gpt-test', ?, 10, 1, 0, 0, ?, 'priced', NULL)
      `,
    )
    .bind(
      input.id,
      ORGANIZATION_ID,
      input.appId,
      input.agentId,
      ACTOR_ID,
      OWNER_ID,
      EVENT_TIME_MS,
      Math.round(input.totalCostUsd * 1_000_000),
    )
    .run();
}

describe("cost app queries", () => {
  test("scopes usage totals to the requested App", async () => {
    const database = await createCostQueryDatabase();
    const window = resolveCostWindow("LAST_30_DAYS", new Date(Date.UTC(2026, 4, 21, 12)));

    const [appTotals, organizationTotals, appAgents, appModels] = await Promise.all([
      queryTotals(database, {
        organizationId: ORGANIZATION_ID,
        appId: APP_ONE_ID,
        window,
      }),
      queryTotals(database, {
        organizationId: ORGANIZATION_ID,
        window,
      }),
      queryAgents(database, {
        organizationId: ORGANIZATION_ID,
        appId: APP_ONE_ID,
        window,
      }),
      queryModels(database, {
        organizationId: ORGANIZATION_ID,
        appId: APP_ONE_ID,
        window,
      }),
    ]);

    expect(appTotals).toMatchObject({
      requestCount: 1,
      totalCostUsd: 2,
    });
    expect(organizationTotals).toMatchObject({
      requestCount: 2,
      totalCostUsd: 7,
    });
    expect(appAgents.map((agent) => agent.agentId)).toEqual([APP_ONE_AGENT_ID]);
    expect(appModels).toHaveLength(1);
    expect(appModels[0]).toMatchObject({
      requestCount: 1,
      totalCostUsd: 2,
    });
  });
});
