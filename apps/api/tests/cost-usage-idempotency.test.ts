import { describe, expect, test } from "bun:test";

import { runUsageDailyRollup } from "../src/modules/cost/application/cost-rollup.service";
import { createRuntimeUsageEventUpsert } from "../src/modules/cost/application/cost-usage-event.service";
import type { RecordRuntimeUsageEventInput } from "../src/modules/cost/application/cost-usage-event.service";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import { getAppDatabase } from "../src/platform/db/drizzle";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const PROJECT_ID = "01J0000000000000000000000Q";
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
      agent_id text,
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
      project_id text NOT NULL,
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
      project_id text NOT NULL,
      agent_id text,
      agent_scope_key text GENERATED ALWAYS AS (coalesce(agent_id, '')) VIRTUAL,
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
      UNIQUE (
        organization_id,
        project_id,
        agent_scope_key,
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
      projectId: PROJECT_ID as RecordRuntimeUsageEventInput["run"]["projectId"],
      provider: "openai",
      runtimeId: "openai-runtime",
      sessionId: SESSION_ID as RecordRuntimeUsageEventInput["run"]["sessionId"],
      sessionRunId: SESSION_RUN_ID as RecordRuntimeUsageEventInput["run"]["sessionRunId"],
      trigger: "user_prompt",
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

async function recordRuntimeUsageEvent(
  database: SqliteD1Database,
  input: RecordRuntimeUsageEventInput,
): Promise<void> {
  await createRuntimeUsageEventUpsert(getAppDatabase(database), input)?.run();
}

describe("runtime usage rollup", () => {
  test("groups direct usage once across separate rollup batches without an Agent ID", async () => {
    const database = createUsageDatabase();
    const env = { DB: database } as unknown as ApiBindings;
    const first = createUsageEventInput();
    first.run = { ...first.run, agentId: null, agentRevisionId: null, agentStatus: null };
    await recordRuntimeUsageEvent(database, first);
    expect(
      await database
        .prepare("SELECT agent_id, agent_publication_state_at_run, run_purpose FROM usage_event")
        .first(),
    ).toEqual({
      agent_id: null,
      agent_publication_state_at_run: "not_applicable",
      run_purpose: "production",
    });
    await runUsageDailyRollup(env, ROLLUP_TIME);
    await recordRuntimeUsageEvent(database, { ...first, nativeCallId: "direct-second-call" });
    await runUsageDailyRollup(env, ROLLUP_TIME);
    expect(
      await database
        .prepare("SELECT agent_id, request_count, total_cost_usd_micros FROM usage_daily_rollup")
        .all(),
    ).toMatchObject({
      results: [{ agent_id: null, request_count: 2, total_cost_usd_micros: 10_000_000 }],
    });
    expect(await database.prepare("SELECT COUNT(*) AS count FROM usage_event").first()).toEqual({
      count: 0,
    });
  });
});
