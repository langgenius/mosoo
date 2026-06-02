import { describe, expect, test } from "bun:test";

import { resolveCostWindow } from "../src/modules/cost/application/cost-query-window";
import {
  queryExternalChannelAttribution,
  queryTotals,
  queryUsers,
} from "../src/modules/cost/application/cost-query.repository";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const EVENT_TIME_MS = Date.UTC(2026, 4, 20, 12);
const SUPPORT_AGENT_ID = "01J00000000000000000000010";
const ORGANIZATION_ID = "01J00000000000000000000006";
const OWNER_ID = "01J00000000000000000000001";
const TELEGRAM_SESSION_ID = "01J00000000000000000000020";
const ACTOR_ONE_ID = "01J00000000000000000000011";
const ACTOR_TWO_ID = "01J00000000000000000000012";
const ACTOR_THREE_ID = "01J00000000000000000000013";

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
      ('01J00000000000000000000001', 'Owner One', 'owner@example.com'),
      ('${ACTOR_ONE_ID}', 'Actor One', 'actor1@example.com'),
      ('${ACTOR_TWO_ID}', 'Actor Two', 'actor2@example.com'),
      ('${ACTOR_THREE_ID}', 'Actor Three', 'actor3@example.com');

    INSERT INTO agent (id, name)
    VALUES
      ('01J00000000000000000000009', 'Planner'),
      ('${SUPPORT_AGENT_ID}', 'Support');
  `);

  await insertUsageEvent(database, {
    actorUserId: ACTOR_ONE_ID,
    agentId: "01J00000000000000000000009",
    id: "event-1",
    totalCostUsd: 2,
  });
  await insertUsageEvent(database, {
    actorUserId: ACTOR_TWO_ID,
    agentId: SUPPORT_AGENT_ID,
    id: "event-2",
    totalCostUsd: 5,
  });
  await insertUsageEvent(database, {
    actorUserId: ACTOR_THREE_ID,
    agentId: SUPPORT_AGENT_ID,
    id: "event-3",
    totalCostUsd: 1,
  });

  return database;
}

async function insertTelegramChannelUsage(database: SqliteD1Database): Promise<void> {
  await database
    .prepare(
      `
        INSERT INTO session (id, metadata_json, type)
        VALUES (?, ?, 'api_channel')
      `,
    )
    .bind(
      TELEGRAM_SESSION_ID,
      JSON.stringify({
        triggered_by: {
          binding_id: "01J00000000000000000000021",
          event_id: "telegram:update:1",
          external_actor_id: "telegram:user:42",
          external_message_id: "42:77",
          external_thread_id: "42:main",
          external_workspace_id: "42",
          provider: "telegram",
        },
      }),
    )
    .run();
  await insertUsageEvent(database, {
    actorUserId: OWNER_ID,
    agentId: SUPPORT_AGENT_ID,
    id: "event-telegram-1",
    runPurpose: "channel",
    sessionId: TELEGRAM_SESSION_ID,
    totalCostUsd: 7,
  });
}

async function insertUsageEvent(
  database: SqliteD1Database,
  input: {
    actorUserId: string;
    agentId: string;
    id: string;
    runPurpose?: string;
    sessionId?: string;
    totalCostUsd: number;
  },
): Promise<void> {
  await database
    .prepare(
      `
        INSERT INTO usage_event (
          id,
          organization_id,
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
        VALUES (?, ?, ?, ?, ?, 'published', ?, 'openai', 'gpt-test', ?, 10, 1, 0, 0, ?, 'priced', ?)
      `,
    )
    .bind(
      input.id,
      ORGANIZATION_ID,
      input.agentId,
      input.actorUserId,
      OWNER_ID,
      input.runPurpose ?? "production",
      EVENT_TIME_MS,
      Math.round(input.totalCostUsd * 1_000_000),
      input.sessionId ?? null,
    )
    .run();
}

describe("cost user queries", () => {
  test("counts owned active users across all owned agents", async () => {
    const database = await createCostQueryDatabase();
    const window = resolveCostWindow("LAST_30_DAYS", new Date(Date.UTC(2026, 4, 21, 12)));

    const rows = await queryUsers(database, {
      mode: "owned_by",
      organizationId: ORGANIZATION_ID,
      window,
    });

    expect(rows).toEqual([
      {
        activeUsers: 3,
        agentCount: 2,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        inputTokens: 30,
        outputTokens: 3,
        previousCostUsd: null,
        requestCount: 3,
        topAgentId: SUPPORT_AGENT_ID,
        topAgentName: "Support",
        totalCostUsd: 8,
        unpricedRequestCount: 0,
        userEmail: "owner@example.com",
        userId: OWNER_ID,
        userName: "Owner One",
      },
    ]);
  });

  test("keeps Telegram channel cost in organization totals without a used-by member row", async () => {
    const database = await createCostQueryDatabase();
    await insertTelegramChannelUsage(database);
    const window = resolveCostWindow("LAST_30_DAYS", new Date(Date.UTC(2026, 4, 21, 12)));

    const [channelTotals, externalChannel, productionTotals, totals, users] = await Promise.all([
      queryTotals(database, {
        organizationId: ORGANIZATION_ID,
        runPurposes: ["channel"],
        window,
      }),
      queryExternalChannelAttribution(database, {
        organizationId: ORGANIZATION_ID,
        window,
      }),
      queryTotals(database, {
        organizationId: ORGANIZATION_ID,
        runPurposes: ["production"],
        window,
      }),
      queryTotals(database, {
        organizationId: ORGANIZATION_ID,
        window,
      }),
      queryUsers(database, {
        mode: "used_by",
        organizationId: ORGANIZATION_ID,
        window,
      }),
    ]);

    expect(totals.totalCostUsd).toBe(15);
    expect(totals.requestCount).toBe(4);
    expect(totals.activeUsers).toBe(3);
    expect(channelTotals).toMatchObject({
      activeUsers: 0,
      requestCount: 1,
      totalCostUsd: 7,
    });
    expect(externalChannel).toMatchObject({
      activeUsers: 0,
      requestCount: 1,
      totalCostUsd: 7,
    });
    expect(productionTotals).toMatchObject({
      activeUsers: 3,
      requestCount: 3,
      totalCostUsd: 8,
    });
    expect(users.map((user) => user.userId)).not.toContain(OWNER_ID);
    expect(users.reduce((sum, user) => sum + user.totalCostUsd, 0)).toBe(8);
  });
});
