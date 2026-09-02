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
const PROJECT_ONE_ID = "01J000000000000000000000P1";
const PROJECT_TWO_ID = "01J000000000000000000000P2";
const OWNER_ID = "01J00000000000000000000001";
const ACTOR_ID = "01J00000000000000000000011";
const PROJECT_ONE_AGENT_ID = "01J000000000000000000000A1";
const PROJECT_TWO_AGENT_ID = "01J000000000000000000000A2";

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
      agent_id text,
      project_id text,
      created_at integer,
      metadata_json text NOT NULL,
      model text,
      provider text,
      type text NOT NULL
    );

    CREATE TABLE usage_event (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL,
      project_id text NOT NULL,
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
      project_id text NOT NULL,
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
      ('${PROJECT_ONE_AGENT_ID}', 'Planner'),
      ('${PROJECT_TWO_AGENT_ID}', 'Support');
  `);

  await insertUsageEvent(database, {
    agentId: PROJECT_ONE_AGENT_ID,
    id: "project-one-event",
    projectId: PROJECT_ONE_ID,
    totalCostUsd: 2,
  });
  await insertUsageEvent(database, {
    agentId: PROJECT_TWO_AGENT_ID,
    id: "project-two-event",
    projectId: PROJECT_TWO_ID,
    totalCostUsd: 5,
  });

  return database;
}

async function insertUsageEvent(
  database: SqliteD1Database,
  input: {
    agentId: string;
    id: string;
    projectId: string;
    totalCostUsd: number;
  },
): Promise<void> {
  await database
    .prepare(
      `
        INSERT INTO usage_event (
          id,
          organization_id,
          project_id,
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
      input.projectId,
      input.agentId,
      ACTOR_ID,
      OWNER_ID,
      EVENT_TIME_MS,
      Math.round(input.totalCostUsd * 1_000_000),
    )
    .run();
}

describe("cost project queries", () => {
  test("scopes usage totals to the requested Project", async () => {
    const database = await createCostQueryDatabase();
    const window = resolveCostWindow("LAST_30_DAYS", new Date(Date.UTC(2026, 4, 21, 12)));

    const [projectTotals, organizationTotals, projectAgents, projectModels] = await Promise.all([
      queryTotals(database, {
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ONE_ID,
        window,
      }),
      queryTotals(database, {
        organizationId: ORGANIZATION_ID,
        window,
      }),
      queryAgents(database, {
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ONE_ID,
        window,
      }),
      queryModels(database, {
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ONE_ID,
        window,
      }),
    ]);

    expect(projectTotals).toMatchObject({
      requestCount: 1,
      totalCostUsd: 2,
    });
    expect(organizationTotals).toMatchObject({
      requestCount: 2,
      totalCostUsd: 7,
    });
    expect(projectAgents.map((agent) => agent.agentId)).toEqual([PROJECT_ONE_AGENT_ID]);
    expect(projectModels).toHaveLength(1);
    expect(projectModels[0]).toMatchObject({
      requestCount: 1,
      totalCostUsd: 2,
    });
  });
});
