import { describe, expect, test } from "bun:test";

import { runUsageDailyRollup } from "../src/modules/cost/application/cost-rollup.service";
import { recordRuntimeUsageEvent } from "../src/modules/cost/application/cost-usage-event.service";
import type { RecordRuntimeUsageEventInput } from "../src/modules/cost/application/cost-usage-event.service";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const APP_ID = "01J0000000000000000000000Q";
const AGENT_ID = "01J0000000000000000000000A";
const ACTOR_ID = "01J00000000000000000000001";
const OWNER_ID = "01J00000000000000000000002";
const ORGANIZATION_ID = "01J00000000000000000000006";
const SESSION_ID = "01J00000000000000000000005";
const SESSION_RUN_ID = "01J00000000000000000000004";
const DRIVER_INSTANCE_ID = "01J00000000000000000000003";
const AGENT_REVISION_ID = "01J00000000000000000000007";

const ROLLUP_TIME = new Date(Date.UTC(2026, 6, 13, 12));
const EVENT_TIME_MS = Date.UTC(2026, 6, 1, 12);

function createUsageDatabase(): SqliteD1Database {
  const database = new SqliteD1Database({ foreignKeys: false });

  database.execute(`
    CREATE TABLE usage_event (
      actor_user_id text NOT NULL,
      agent_id text NOT NULL,
      agent_owner_user_id text NOT NULL,
      agent_publication_state_at_run text NOT NULL,
      agent_revision_id text,
      cache_creation_tokens integer NOT NULL,
      cache_read_tokens integer NOT NULL,
      created_at integer NOT NULL,
      id text PRIMARY KEY NOT NULL,
      input_tokens integer NOT NULL,
      model text NOT NULL,
      organization_id text NOT NULL,
      app_id text NOT NULL,
      output_tokens integer NOT NULL,
      price_snapshot_json text,
      pricing_status text NOT NULL,
      provider text NOT NULL,
      run_purpose text NOT NULL,
      runtime_id text,
      session_id text,
      session_run_id text,
      source text NOT NULL,
      source_event_id text NOT NULL,
      total_cost_usd_micros integer NOT NULL,
      usage_contract text NOT NULL
    );

    CREATE UNIQUE INDEX usage_event_source_event_idx ON usage_event (source, source_event_id);

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

    CREATE TABLE usage_event_rollup_receipt (
      rolled_up_at integer NOT NULL,
      source text NOT NULL,
      source_event_id text NOT NULL,
      PRIMARY KEY (source, source_event_id)
    );
  `);

  return database;
}

function createUsageEventInput(): RecordRuntimeUsageEventInput {
  return {
    callKey: "call-key-1",
    driverInstanceId: DRIVER_INSTANCE_ID as RecordRuntimeUsageEventInput["driverInstanceId"],
    nativeCallId: "native-call-1",
    run: {
      actorUserId: ACTOR_ID as RecordRuntimeUsageEventInput["run"]["actorUserId"],
      agentId: AGENT_ID as RecordRuntimeUsageEventInput["run"]["agentId"],
      agentOwnerUserId: OWNER_ID as RecordRuntimeUsageEventInput["run"]["agentOwnerUserId"],
      agentRevisionId: AGENT_REVISION_ID as RecordRuntimeUsageEventInput["run"]["agentRevisionId"],
      agentStatus: "published",
      createdAtMs: EVENT_TIME_MS,
      model: "gpt-test",
      organizationId: ORGANIZATION_ID as RecordRuntimeUsageEventInput["run"]["organizationId"],
      appId: APP_ID as RecordRuntimeUsageEventInput["run"]["appId"],
      provider: "openai",
      runtimeId: "openai-runtime",
      sessionId: SESSION_ID as RecordRuntimeUsageEventInput["run"]["sessionId"],
      sessionType: "ui",
      sessionRunId: SESSION_RUN_ID as RecordRuntimeUsageEventInput["run"]["sessionRunId"],
      trigger: "user_prompt",
      triggerProvider: null,
    },
    usage: {
      cachedReadTokens: 0,
      cachedWriteTokens: 0,
      callId: "native-call-1",
      costAmount: 5,
      costCurrency: "USD",
      inputTokens: 100,
      outputTokens: 50,
      source: "prompt_response",
      usageContract: "openai_total_with_cached_breakdown",
    },
  };
}

async function readRollupTotals(
  database: SqliteD1Database,
): Promise<{ requestCount: number; totalCostUsdMicros: number }> {
  const row = await database
    .prepare(
      "SELECT SUM(request_count) AS request_count, SUM(total_cost_usd_micros) AS total_cost_usd_micros FROM usage_daily_rollup",
    )
    .first<{ request_count: number | null; total_cost_usd_micros: number | null }>();

  return {
    requestCount: row?.request_count ?? 0,
    totalCostUsdMicros: row?.total_cost_usd_micros ?? 0,
  };
}

describe("runtime usage idempotency across rollup", () => {
  test("does not double-count an event replayed after its raw row is rolled up", async () => {
    const database = createUsageDatabase();
    const env = { DB: database } as unknown as ApiBindings;

    await recordRuntimeUsageEvent(database, createUsageEventInput());
    await runUsageDailyRollup(env, ROLLUP_TIME);

    const afterFirstRollup = await readRollupTotals(database);
    expect(afterFirstRollup).toEqual({ requestCount: 1, totalCostUsdMicros: 5_000_000 });

    const rawAfterRollup = await database
      .prepare("SELECT COUNT(*) AS count FROM usage_event")
      .first<{ count: number }>();
    expect(rawAfterRollup?.count).toBe(0);

    const receipts = await database
      .prepare("SELECT source, source_event_id FROM usage_event_rollup_receipt")
      .all<{ source: string; source_event_id: string }>();
    expect(receipts.results).toEqual([
      { source: "runtime_driver", source_event_id: `${DRIVER_INSTANCE_ID}:native-call-1` },
    ]);

    await recordRuntimeUsageEvent(database, createUsageEventInput());

    const rawAfterReplay = await database
      .prepare("SELECT COUNT(*) AS count FROM usage_event")
      .first<{ count: number }>();
    expect(rawAfterReplay?.count).toBe(0);

    await runUsageDailyRollup(env, ROLLUP_TIME);

    const afterSecondRollup = await readRollupTotals(database);
    expect(afterSecondRollup).toEqual({ requestCount: 1, totalCostUsdMicros: 5_000_000 });
  });

  test("prunes rollup receipts past the daily rollup retention window", async () => {
    const database = createUsageDatabase();
    const env = { DB: database } as unknown as ApiBindings;

    await database
      .prepare(
        "INSERT INTO usage_event_rollup_receipt (source, source_event_id, rolled_up_at) VALUES (?, ?, ?)",
      )
      .bind("runtime_driver", "stale:receipt", Date.UTC(2025, 0, 1))
      .run();

    await runUsageDailyRollup(env, ROLLUP_TIME);

    const receipts = await database
      .prepare("SELECT COUNT(*) AS count FROM usage_event_rollup_receipt")
      .first<{ count: number }>();
    expect(receipts?.count).toBe(0);
  });
});
