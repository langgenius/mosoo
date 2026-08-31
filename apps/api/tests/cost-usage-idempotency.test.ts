import { describe, expect, test } from "bun:test";

import { runUsageDailyRollup } from "../src/modules/cost/application/cost-rollup.service";
import { recordRuntimeUsageEvent } from "../src/modules/cost/application/cost-usage-event.service";
import type { RecordRuntimeUsageEventInput } from "../src/modules/cost/application/cost-usage-event.service";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
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
      source_event_seq integer DEFAULT 0 NOT NULL,
      total_cost_usd_micros integer NOT NULL,
      usage_contract text NOT NULL
    );

    CREATE UNIQUE INDEX usage_event_source_event_idx ON usage_event (source, source_event_id);

    CREATE TABLE session_model_call (
      call_key text NOT NULL,
      driver_instance_id text,
      native_call_id text,
      session_id text NOT NULL,
      session_run_id text NOT NULL,
      source_event_seq integer DEFAULT 0 NOT NULL
    );

    CREATE TABLE session_event (
      content_text text NOT NULL,
      event_type text NOT NULL,
      run_id text,
      seq integer NOT NULL,
      session_id text NOT NULL
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
      unpriced_request_count integer NOT NULL,
      PRIMARY KEY (
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

async function seedDurableUsageAuthority(
  database: SqliteD1Database,
  input: { eventSeq: number; nativeCallId?: string | null },
): Promise<void> {
  const nativeCallId = input.nativeCallId === undefined ? "native-call-1" : input.nativeCallId;
  const callKey = nativeCallId === null ? "run_usage" : `model_call:${nativeCallId}`;

  await database
    .prepare(
      `INSERT INTO session_model_call (
        call_key,
        driver_instance_id,
        native_call_id,
        session_id,
        session_run_id,
        source_event_seq
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(callKey, DRIVER_INSTANCE_ID, nativeCallId, SESSION_ID, SESSION_RUN_ID, input.eventSeq)
    .run();
  await database
    .prepare(
      `INSERT INTO session_event (content_text, event_type, run_id, seq, session_id)
       VALUES (?, 'usage.updated', ?, ?, ?)`,
    )
    .bind(
      JSON.stringify(nativeCallId === null ? {} : { callId: nativeCallId }),
      SESSION_RUN_ID,
      input.eventSeq,
      SESSION_ID,
    )
    .run();
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

    await seedDurableUsageAuthority(database, { eventSeq: 0 });
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

  test("does not strand billable usage behind a newer non-recordable receipt", async () => {
    const database = createUsageDatabase();
    const env = { DB: database } as unknown as ApiBindings;
    const input = { ...createUsageEventInput(), sourceEventSeq: 1 };

    await seedDurableUsageAuthority(database, { eventSeq: 1 });
    await recordRuntimeUsageEvent(database, input);
    await database
      .prepare(
        `INSERT INTO session_event (content_text, event_type, run_id, seq, session_id)
         VALUES (?, 'usage.updated', ?, 2, ?)`,
      )
      .bind(
        JSON.stringify({ callId: "native-call-1", source: "session_update", totalTokens: 150 }),
        SESSION_RUN_ID,
        SESSION_ID,
      )
      .run();
    await database.prepare("UPDATE session_model_call SET source_event_seq = 2").run();
    await recordRuntimeUsageEvent(database, {
      ...input,
      sourceEventSeq: 2,
      usage: {
        callId: "native-call-1",
        source: "session_update",
        totalTokens: 150,
      },
    });

    await runUsageDailyRollup(env, ROLLUP_TIME);

    expect(await readRollupTotals(database)).toEqual({
      requestCount: 1,
      totalCostUsdMicros: 5_000_000,
    });
    expect(
      await database
        .prepare("SELECT COUNT(*) AS count FROM usage_event")
        .first<{ count: number }>(),
    ).toEqual({ count: 0 });
    expect(
      await database
        .prepare("SELECT COUNT(*) AS count FROM usage_event_rollup_receipt")
        .first<{ count: number }>(),
    ).toEqual({ count: 1 });

    await runUsageDailyRollup(env, ROLLUP_TIME);
    expect(await readRollupTotals(database)).toEqual({
      requestCount: 1,
      totalCostUsdMicros: 5_000_000,
    });
  });

  test("rolls up only the latest recordable usage once", async () => {
    const database = createUsageDatabase();
    const env = { DB: database } as unknown as ApiBindings;
    const input = { ...createUsageEventInput(), sourceEventSeq: 1 };

    await seedDurableUsageAuthority(database, { eventSeq: 1 });
    await recordRuntimeUsageEvent(database, input);
    await database
      .prepare(
        `INSERT INTO session_event (content_text, event_type, run_id, seq, session_id)
         VALUES (?, 'usage.updated', ?, 2, ?)`,
      )
      .bind(JSON.stringify({ callId: "native-call-1" }), SESSION_RUN_ID, SESSION_ID)
      .run();
    await database.prepare("UPDATE session_model_call SET source_event_seq = 2").run();

    await recordRuntimeUsageEvent(database, {
      ...input,
      sourceEventSeq: 2,
      usage: { ...input.usage, costAmount: 7 },
    });

    expect(
      await database
        .prepare("SELECT COUNT(*) AS count, source_event_seq FROM usage_event")
        .first<{ count: number; source_event_seq: number }>(),
    ).toEqual({ count: 1, source_event_seq: 2 });

    await runUsageDailyRollup(env, ROLLUP_TIME);

    expect(await readRollupTotals(database)).toEqual({
      requestCount: 1,
      totalCostUsdMicros: 7_000_000,
    });
    expect(
      await database
        .prepare("SELECT COUNT(*) AS count FROM usage_event")
        .first<{ count: number }>(),
    ).toEqual({ count: 0 });

    await runUsageDailyRollup(env, ROLLUP_TIME);
    expect(await readRollupTotals(database)).toEqual({
      requestCount: 1,
      totalCostUsdMicros: 7_000_000,
    });
    expect(
      await database
        .prepare("SELECT COUNT(*) AS count FROM usage_event_rollup_receipt")
        .first<{ count: number }>(),
    ).toEqual({ count: 1 });
  });

  test("reprices the merged token snapshot before rolling up a partial update", async () => {
    const database = createUsageDatabase();
    const env = { DB: database } as unknown as ApiBindings;
    const input = {
      ...createUsageEventInput(),
      run: {
        ...createUsageEventInput().run,
        model: "gpt-5.4",
        provider: "openai",
      },
      sourceEventSeq: 1,
      usage: {
        callId: "native-call-1",
        inputTokens: 300_000,
        outputTokens: 5,
        source: "prompt_response" as const,
        usageContract: "openai_total_with_cached_breakdown" as const,
      },
    };

    await seedDurableUsageAuthority(database, { eventSeq: 1 });
    await recordRuntimeUsageEvent(database, input);
    await database.prepare("UPDATE session_model_call SET source_event_seq = 2").run();
    const partialInput = {
      ...input,
      sourceEventSeq: 2,
      usage: {
        callId: "native-call-1",
        outputTokens: 7,
        source: "prompt_response",
        usageContract: "openai_total_with_cached_breakdown",
      },
    };

    await recordRuntimeUsageEvent(database, partialInput);
    await recordRuntimeUsageEvent(database, partialInput);

    expect(
      await database
        .prepare(
          `SELECT input_tokens, output_tokens, price_snapshot_json,
                  source_event_seq, total_cost_usd_micros
           FROM usage_event`,
        )
        .first(),
    ).toEqual({
      input_tokens: 300_000,
      output_tokens: 7,
      price_snapshot_json: JSON.stringify({
        billableInputTokens: 300_000,
        cacheReadUsdPerMillion: 0.5,
        cacheWriteUsdPerMillion: 6.25,
        inputUsdPerMillion: 5,
        longContextApplied: true,
        model: "gpt-5.4",
        outputUsdPerMillion: 22.5,
        provider: "openai",
        source: "mosoo_seed_2026_07_10",
      }),
      source_event_seq: 2,
      total_cost_usd_micros: 1_500_158,
    });

    await runUsageDailyRollup(env, ROLLUP_TIME);

    expect(
      await database
        .prepare(
          `SELECT input_tokens, output_tokens, request_count, total_cost_usd_micros
           FROM usage_daily_rollup`,
        )
        .first(),
    ).toEqual({
      input_tokens: 300_000,
      output_tokens: 7,
      request_count: 1,
      total_cost_usd_micros: 1_500_158,
    });
  });

  test("matches call-less usage receipts through the durable run_usage identity", async () => {
    const database = createUsageDatabase();
    const env = { DB: database } as unknown as ApiBindings;

    await seedDurableUsageAuthority(database, { eventSeq: 3, nativeCallId: null });
    await recordRuntimeUsageEvent(database, {
      ...createUsageEventInput(),
      callKey: "run_usage",
      nativeCallId: null,
      sourceEventSeq: 3,
      usage: { ...createUsageEventInput().usage, callId: null },
    });
    await runUsageDailyRollup(env, ROLLUP_TIME);

    expect(await readRollupTotals(database)).toEqual({
      requestCount: 1,
      totalCostUsdMicros: 5_000_000,
    });
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
